import http from "node:http";
import { DEFAULT_CONFIG } from "./config.mjs";
import { convertChatCompletion } from "./chat-to-responses.mjs";
import { writeChatCompletionStreamAsResponses } from "./chat-stream-to-responses.mjs";
import { convertResponsesRequest } from "./responses-to-chat.mjs";
import { createLogger, redactText } from "./logging.mjs";

const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function createShimServer(config = {}, dependencies = {}) {
  const resolved = { ...DEFAULT_CONFIG, ...config };
  const fetchImpl = dependencies.fetch ?? fetch;
  const logger =
    dependencies.logger ?? createLogger({ level: resolved.logLevel, logContent: resolved.logContent });

  return http.createServer((request, response) => {
    const requestId = makeRequestId();
    const url = new URL(request.url || "/", `http://${request.headers.host || `${resolved.host}:${resolved.port}`}`);

    Promise.resolve()
      .then(async () => {
        if (url.pathname === "/health") {
          jsonResponse(response, 200, {
            ok: true,
            upstream: resolved.upstream,
            request_id: requestId,
          });
          return;
        }

        if (url.pathname === "/v1/models") {
          await proxyUpstream({
            request,
            response,
            requestId,
            upstreamUrl: `${resolved.upstream}/models${url.search}`,
            config: resolved,
            fetchImpl,
            logger,
          });
          return;
        }

        if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
          await proxyChatCompletions({ request, response, requestId, config: resolved, fetchImpl, logger });
          return;
        }

        if (url.pathname === "/v1/responses" && request.method === "POST") {
          await handleResponses({ request, response, requestId, config: resolved, fetchImpl, logger });
          return;
        }

        jsonResponse(response, 404, { error: { message: "Not found", type: "not_found" }, request_id: requestId });
      })
      .catch((error) => {
        logger.error({
          event: "shim_error",
          request_id: requestId,
          message: error.message,
          stack: error.stack,
        });
        if (!response.headersSent) {
          jsonResponse(response, error.statusCode ?? 502, {
            error: { message: redactText(error.message), type: error.type ?? "shim_error" },
            request_id: requestId,
          });
        } else {
          response.end();
        }
      });
  });
}

export async function startServer(config, dependencies = {}) {
  const server = createShimServer(config, dependencies);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

async function handleResponses({ request, response, requestId, config, fetchImpl, logger }) {
  const body = await readJsonBody(request, config.maxBodyBytes);
  const chatBody = convertResponsesRequest(body);
  const wantsStream = body.stream !== false;
  chatBody.stream = wantsStream;

  if (config.logRequests) {
    logger.info({
      event: "responses_to_chat",
      request_id: requestId,
      model: chatBody.model,
      messages: chatBody.messages.map((message) => ({
        role: message.role,
        hasContent: Boolean(message.content),
        toolCalls: message.tool_calls?.length || 0,
        toolCallId: message.tool_call_id,
      })),
      tools: chatBody.tools?.length || 0,
    });
  }

  const upstreamResponse = await fetchUpstream({
    request,
    requestId,
    url: `${config.upstream}/chat/completions`,
    init: {
      method: "POST",
      headers: {
        ...forwardHeaders(request.headers, config),
        "content-type": "application/json",
      },
      body: JSON.stringify(chatBody),
    },
    config,
    fetchImpl,
  });

  if (!upstreamResponse.ok) {
    const upstreamText = await upstreamResponse.text();
    handleUpstreamError({ response, requestId, upstreamResponse, upstreamText, logger });
    return;
  }

  if (wantsStream) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    await writeChatCompletionStreamAsResponses({
      upstreamResponse,
      response,
      model: chatBody.model,
      dropToolCallContent: config.compatibilityDropToolCallContent,
    });
    return;
  }

  const upstreamText = await upstreamResponse.text();
  let chatResponse;
  try {
    chatResponse = JSON.parse(upstreamText);
  } catch (error) {
    jsonResponse(response, 502, {
      error: {
        message: "DeepInfra returned non-JSON from /chat/completions.",
        type: "invalid_upstream_json",
      },
      request_id: requestId,
    });
    logger.error({
      event: "invalid_upstream_json",
      request_id: requestId,
      message: error.message,
      snippet: upstreamText.slice(0, 500),
    });
    return;
  }

  const converted = convertChatCompletion(chatResponse, {
    model: chatBody.model,
    dropToolCallContent: config.compatibilityDropToolCallContent,
  });

  jsonResponse(response, 200, converted);
}

async function proxyChatCompletions({ request, response, requestId, config, fetchImpl, logger }) {
  const rawBody = await readBody(request, config.maxBodyBytes);
  await proxyUpstream({
    request,
    response,
    requestId,
    upstreamUrl: `${config.upstream}/chat/completions`,
    config,
    fetchImpl,
    logger,
    method: "POST",
    body: rawBody,
    contentType: request.headers["content-type"] || "application/json",
  });
}

async function proxyUpstream({
  request,
  response,
  requestId,
  upstreamUrl,
  config,
  fetchImpl,
  logger,
  method = request.method,
  body,
  contentType,
}) {
  const headers = forwardHeaders(request.headers, config);
  if (contentType) headers["content-type"] = contentType;

  const upstreamResponse = await fetchUpstream({
    request,
    requestId,
    url: upstreamUrl,
    init: { method, headers, body },
    config,
    fetchImpl,
  });
  const text = await upstreamResponse.text();

  if (!upstreamResponse.ok) {
    handleUpstreamError({ response, requestId, upstreamResponse, upstreamText: text, logger });
    return;
  }

  response.writeHead(upstreamResponse.status, responseHeaders(upstreamResponse.headers));
  response.end(text);
}

async function fetchUpstream({ request, requestId, url, init, config, fetchImpl }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Upstream request timed out.")), config.timeoutMs);
  const abort = () => controller.abort(new Error("Client aborted the request."));
  request.on("aborted", abort);

  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    const message =
      error.name === "AbortError" || error.message.includes("timed out")
        ? `Upstream request timed out after ${config.timeoutMs}ms.`
        : error.message;
    const wrapped = new Error(message);
    wrapped.statusCode = error.name === "AbortError" ? 504 : 502;
    wrapped.type = "upstream_request_failed";
    wrapped.requestId = requestId;
    throw wrapped;
  } finally {
    clearTimeout(timeout);
    request.off("aborted", abort);
  }
}

export async function readJsonBody(request, maxBytes) {
  const raw = await readBody(request, maxBytes);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    const wrapped = new Error(`Invalid JSON request body: ${error.message}`);
    wrapped.statusCode = 400;
    wrapped.type = "invalid_json";
    throw wrapped;
  }
}

export async function readBody(request, maxBytes) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error(`Request body exceeds limit of ${maxBytes} bytes.`);
      error.statusCode = 413;
      error.type = "request_too_large";
      throw error;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function forwardHeaders(headers, config) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (!hopByHopHeaders.has(lower) && lower !== "host") result[key] = value;
  }
  const token = process.env[config.apiKeyEnv];
  if (token && !result.authorization && !result.Authorization) {
    result.authorization = `Bearer ${token}`;
  }
  return result;
}

export function responseHeaders(headers) {
  const result = {};
  for (const [key, value] of headers.entries()) {
    if (!hopByHopHeaders.has(key.toLowerCase())) result[key] = value;
  }
  return result;
}

export function jsonResponse(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
}

function handleUpstreamError({ response, requestId, upstreamResponse, upstreamText, logger }) {
  const message = redactText(upstreamText || upstreamResponse.statusText || "Upstream request failed.");
  logger.error({
    event: "chat_error",
    request_id: requestId,
    status: upstreamResponse.status,
    snippet: message.slice(0, 2000),
  });
  jsonResponse(response, upstreamResponse.status, {
    error: {
      message,
      type: "deepinfra_error",
    },
    request_id: requestId,
  });
}

function makeRequestId() {
  return `req_${Math.random().toString(36).slice(2, 12)}`;
}
