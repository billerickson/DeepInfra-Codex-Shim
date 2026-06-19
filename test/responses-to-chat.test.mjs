import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coalesceToolCalls,
  convertResponsesRequest,
  convertTools,
  textFromContent,
} from "../src/responses-to-chat.mjs";

test("converts string input to a user chat message", () => {
  const converted = convertResponsesRequest({
    model: "deepseek-ai/DeepSeek-V4-Flash",
    input: "Hello",
  });

  assert.deepEqual(converted, {
    model: "deepseek-ai/DeepSeek-V4-Flash",
    messages: [{ role: "user", content: "Hello" }],
    stream: false,
  });
});

test("converts instructions to a system message before Responses messages", () => {
  const converted = convertResponsesRequest({
    model: "model",
    instructions: "Be concise.",
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "Ignored shape" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hi" }] },
    ],
  });

  assert.deepEqual(converted.messages, [
    { role: "system", content: "Be concise." },
    { role: "user", content: "Ignored shape" },
    { role: "assistant", content: "Hi" },
  ]);
});

test("converts function tools and drops unsupported tool types", () => {
  assert.deepEqual(
    convertTools([
      {
        type: "function",
        name: "exec_command",
        description: "Run a command",
        parameters: { type: "object", properties: { cmd: { type: "string" } } },
      },
      { type: "web_search" },
      { type: "function", function: { name: "read_file" } },
    ]),
    [
      {
        type: "function",
        function: {
          name: "exec_command",
          description: "Run a command",
          parameters: { type: "object", properties: { cmd: { type: "string" } } },
        },
      },
      {
        type: "function",
        function: {
          name: "read_file",
          description: "",
          parameters: { type: "object", properties: {} },
        },
      },
    ]
  );
});

test("converts function calls and function call outputs", () => {
  const converted = convertResponsesRequest({
    model: "model",
    input: [
      { type: "function_call", call_id: "call_1", name: "exec_command", arguments: { cmd: "pwd" } },
      { type: "function_call_output", call_id: "call_1", output: "done" },
    ],
    tools: [{ type: "function", name: "exec_command" }],
  });

  assert.deepEqual(converted.messages, [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "exec_command", arguments: '{"cmd":"pwd"}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "call_1", content: "done" },
  ]);
  assert.equal(converted.tool_choice, "auto");
});

test("coalesces adjacent assistant tool calls", () => {
  const messages = coalesceToolCalls([
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "a", arguments: "{}" } }],
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_2", type: "function", function: { name: "b", arguments: "{}" } }],
    },
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].tool_calls.length, 2);
});

test("empty and unsupported content parts become empty strings", () => {
  assert.equal(
    textFromContent([
      { type: "input_image", image_url: "https://example.test/image.png" },
      { type: "input_text", text: "" },
      { type: "output_text", text: "visible" },
    ]),
    "visible"
  );
});

test("passes common generation settings through to chat completions", () => {
  const converted = convertResponsesRequest({
    model: "model",
    input: "Hello",
    max_output_tokens: 42,
    temperature: 0.2,
    top_p: 0.9,
    tool_choice: "none",
  });

  assert.equal(converted.max_tokens, 42);
  assert.equal(converted.temperature, 0.2);
  assert.equal(converted.top_p, 0.9);
  assert.equal(converted.tool_choice, undefined);
});
