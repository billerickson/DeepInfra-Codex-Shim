import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { createShimServer } from "../src/server.mjs";

const token = process.env.DEEPINFRA_TOKEN;
const model = process.env.DEEPINFRA_CODEX_SHIM_INTEGRATION_MODEL || "deepseek-ai/DeepSeek-V4-Flash";

test(
  "makes a harmless streaming DeepInfra Responses-compatible request",
  { skip: token ? false : "Set DEEPINFRA_TOKEN to run the integration test." },
  async () => {
    const shim = await listen(
      createShimServer({
        logLevel: "silent",
        apiKeyEnv: "DEEPINFRA_TOKEN",
        timeoutMs: 60000,
      })
    );

    try {
      const response = await request({
        port: shim.port,
        path: "/v1/responses",
        method: "POST",
        body: JSON.stringify({
          model,
          input: "Reply with exactly OK.",
          max_output_tokens: 8,
          temperature: 0,
        }),
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.match(response.headers["content-type"], /text\/event-stream/);
      assert.match(response.body, /event: response\.completed/);
      assert.match(response.body, /data: \[DONE\]/);
    } finally {
      await shim.close();
    }
  }
);

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
