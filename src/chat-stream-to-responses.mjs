import { convertUsage, formatSseEvent } from "./chat-to-responses.mjs";

export async function writeChatCompletionStreamAsResponses({
  upstreamResponse,
  response,
  model,
  dropToolCallContent = false,
  idFactory = randomId,
}) {
  const createdAt = Math.floor(Date.now() / 1000);
  const responseObject = {
    id: `resp_${idFactory()}`,
    object: "response",
    created_at: createdAt,
    status: "in_progress",
    model,
    output: [],
    usage: convertUsage(),
  };
  const state = {
    response: responseObject,
    idFactory,
    textItem: null,
    textOutputIndex: null,
    text: "",
    bufferedText: "",
    toolCalls: new Map(),
    sawToolCalls: false,
  };

  writeEvent(response, "response.created", {
    type: "response.created",
    response: { ...responseObject, output: [] },
  });

  for await (const payload of parseChatCompletionSse(upstreamResponse.body)) {
    if (payload === "[DONE]") break;
    applyChatStreamChunk(payload, state, response, { dropToolCallContent });
  }

  finishStreamingResponse(state, response, { dropToolCallContent });
}

export async function* parseChatCompletionSse(readable) {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of readable) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const payload = parseSsePayload(part);
      if (!payload) continue;
      if (payload === "[DONE]") {
        yield "[DONE]";
        continue;
      }
      yield JSON.parse(payload);
    }
  }

  buffer += decoder.decode();
  const payload = parseSsePayload(buffer);
  if (payload && payload !== "[DONE]") yield JSON.parse(payload);
}

export function applyChatStreamChunk(chunk, state, response, { dropToolCallContent = false } = {}) {
  if (chunk.model && !state.response.model) state.response.model = chunk.model;
  if (chunk.usage) state.response.usage = convertUsage(chunk.usage);

  const choice = chunk.choices?.[0];
  const delta = choice?.delta ?? {};

  if (typeof delta.content === "string" && delta.content.length > 0) {
    if (dropToolCallContent) {
      state.bufferedText += delta.content;
    } else {
      streamTextDelta(state, response, delta.content);
    }
  }

  if (Array.isArray(delta.tool_calls)) {
    state.sawToolCalls = true;
    for (const toolCall of delta.tool_calls) {
      const key = String(toolCall.index ?? toolCall.id ?? state.toolCalls.size);
      const current =
        state.toolCalls.get(key) ??
        {
          id: `fc_${state.idFactory()}`,
          type: "function_call",
          status: "completed",
          call_id: toolCall.id,
          name: "",
          arguments: "",
        };

      if (toolCall.id) current.call_id = toolCall.id;
      if (toolCall.function?.name) current.name += toolCall.function.name;
      if (toolCall.function?.arguments) current.arguments += toolCall.function.arguments;
      state.toolCalls.set(key, current);
    }
  }
}

export function finishStreamingResponse(state, response, { dropToolCallContent = false } = {}) {
  if (dropToolCallContent && state.bufferedText && !state.sawToolCalls) {
    streamTextDelta(state, response, state.bufferedText);
  }

  if (state.textItem) {
    state.textItem.status = "completed";
    state.textItem.content[0].text = state.text;
    writeEvent(response, "response.output_text.done", {
      type: "response.output_text.done",
      output_index: state.textOutputIndex,
      content_index: 0,
      text: state.text,
    });
    writeEvent(response, "response.output_item.done", {
      type: "response.output_item.done",
      output_index: state.textOutputIndex,
      item: state.textItem,
    });
  }

  for (const item of state.toolCalls.values()) {
    if (!item.arguments) item.arguments = "{}";
    const outputIndex = state.response.output.length;
    state.response.output.push(item);
    writeEvent(response, "response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item,
    });
    writeEvent(response, "response.output_item.done", {
      type: "response.output_item.done",
      output_index: outputIndex,
      item,
    });
  }

  state.response.status = "completed";
  writeEvent(response, "response.completed", {
    type: "response.completed",
    response: state.response,
  });
  response.write("data: [DONE]\n\n");
  response.end();
}

function streamTextDelta(state, response, delta) {
  if (!state.textItem) {
    state.textItem = {
      id: `msg_${state.idFactory()}`,
      type: "message",
      status: "in_progress",
      role: "assistant",
      content: [{ type: "output_text", text: "", annotations: [] }],
    };
    state.textOutputIndex = state.response.output.length;
    state.response.output.push(state.textItem);
    writeEvent(response, "response.output_item.added", {
      type: "response.output_item.added",
      output_index: state.textOutputIndex,
      item: state.textItem,
    });
  }

  state.text += delta;
  writeEvent(response, "response.output_text.delta", {
    type: "response.output_text.delta",
    output_index: state.textOutputIndex,
    content_index: 0,
    delta,
  });
}

function writeEvent(response, event, data) {
  response.write(formatSseEvent(event, data));
}

function parseSsePayload(block) {
  const lines = block.split(/\r?\n/);
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  return data || null;
}

function randomId() {
  return Math.random().toString(36).slice(2, 12);
}
