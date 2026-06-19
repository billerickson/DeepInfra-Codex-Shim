import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { createShimServer } from "../src/server.mjs";

test("returns a clear JSON parse error", async () => {
  const shim = await listen(createShimServer({ logLevel: "silent" }, { fetch: unexpectedFetch }));
  try {
    const response = await request({
      port: shim.port,
      path: "/v1/responses",
      method: "POST",
      body: "{",
    });

    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(response.body).error.type, "invalid_json");
  } finally {
    await shim.close();
  }
});

test("enforces request body size limits", async () => {
  const shim = await listen(createShimServer({ maxBodyBytes: 5, logLevel: "silent" }, { fetch: unexpectedFetch }));
  try {
    const response = await request({
      port: shim.port,
      path: "/v1/responses",
      method: "POST",
      body: '{"input":"too large"}',
    });

    assert.equal(response.statusCode, 413);
    assert.equal(JSON.parse(response.body).error.type, "request_too_large");
  } finally {
    await shim.close();
  }
});

test("converts Responses requests and synthetic streams converted output", async () => {
  let upstreamBody;
  const shim = await listen(
    createShimServer(
      {
        upstream: "https://upstream.example/v1/openai",
        logLevel: "silent",
      },
      {
        fetch: async (url, init) => {
          upstreamBody = JSON.parse(init.body);
          assert.equal(url, "https://upstream.example/v1/openai/chat/completions");
          return jsonFetchResponse(200, {
            model: upstreamBody.model,
            choices: [{ message: { role: "assistant", content: "OK" } }],
            usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
          });
        },
      }
    )
  );

  try {
    const response = await request({
      port: shim.port,
      path: "/v1/responses",
      method: "POST",
      body: JSON.stringify({ model: "model", input: "Hello" }),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "text/event-stream");
    assert.deepEqual(upstreamBody.messages, [{ role: "user", content: "Hello" }]);
    assert.match(response.body, /event: response\.completed/);
    assert.match(response.body, /data: \[DONE\]/);
  } finally {
    await shim.close();
  }
});

test("returns non-streaming Responses JSON when stream is false", async () => {
  const shim = await listen(
    createShimServer(
      { upstream: "https://upstream.example/v1/openai", logLevel: "silent" },
      {
        fetch: async () =>
          jsonFetchResponse(200, {
            choices: [{ message: { role: "assistant", content: "OK" } }],
          }),
      }
    )
  );

  try {
    const response = await request({
      port: shim.port,
      path: "/v1/responses",
      method: "POST",
      body: JSON.stringify({ model: "model", input: "Hello", stream: false }),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "application/json");
    assert.equal(JSON.parse(response.body).output[0].content[0].text, "OK");
  } finally {
    await shim.close();
  }
});

test("passes chat completions through to DeepInfra", async () => {
  let upstreamBody;
  const shim = await listen(
    createShimServer(
      { upstream: "https://upstream.example/v1/openai", logLevel: "silent" },
      {
        fetch: async (url, init) => {
          upstreamBody = init.body;
          assert.equal(url, "https://upstream.example/v1/openai/chat/completions");
          return jsonFetchResponse(200, { choices: [{ message: { content: "OK" } }] });
        },
      }
    )
  );

  try {
    const body = JSON.stringify({ model: "model", messages: [{ role: "user", content: "Hi" }] });
    const response = await request({
      port: shim.port,
      path: "/v1/chat/completions",
      method: "POST",
      body,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(upstreamBody, body);
    assert.deepEqual(JSON.parse(response.body), { choices: [{ message: { content: "OK" } }] });
  } finally {
    await shim.close();
  }
});

test("redacts upstream authorization errors", async () => {
  const shim = await listen(
    createShimServer(
      { upstream: "https://upstream.example/v1/openai", logLevel: "silent" },
      {
        fetch: async () =>
          new Response("authorization: Bearer secret-token", {
            status: 401,
            headers: { "content-type": "text/plain" },
          }),
      }
    )
  );

  try {
    const response = await request({
      port: shim.port,
      path: "/v1/responses",
      method: "POST",
      body: JSON.stringify({ model: "model", input: "Hello", stream: false }),
    });

    assert.equal(response.statusCode, 401);
    assert.equal(JSON.parse(response.body).error.message, "authorization: [REDACTED]");
  } finally {
    await shim.close();
  }
});

function unexpectedFetch() {
  throw new Error("Fetch should not be called.");
}

function jsonFetchResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve({
        port: server.address().port,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function request({ port, path, method = "GET", body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: body
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            }
          : undefined,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
