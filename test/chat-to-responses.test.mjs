import assert from "node:assert/strict";
import { test } from "node:test";
import { convertChatCompletion, convertUsage, createSyntheticSseEvents, formatSseEvent } from "../src/chat-to-responses.mjs";

test("converts text-only chat completion to a Responses object", () => {
  const converted = convertChatCompletion(
    {
      id: "chatcmpl_1",
      model: "model",
      created: 123,
      choices: [{ message: { role: "assistant", content: "OK" } }],
    },
    { idFactory: sequenceIds() }
  );

  assert.equal(converted.object, "response");
  assert.equal(converted.model, "model");
  assert.deepEqual(converted.output, [
    {
      id: "msg_id_1",
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: "OK", annotations: [] }],
    },
  ]);
});

test("converts multiple tool calls", () => {
  const converted = convertChatCompletion(
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "exec", arguments: '{"cmd":"pwd"}' } },
              { id: "call_2", type: "function", function: { name: "exec", arguments: '{"cmd":"ls"}' } },
            ],
          },
        },
      ],
    },
    { model: "model", idFactory: sequenceIds() }
  );

  assert.deepEqual(
    converted.output.map((item) => [item.type, item.call_id, item.name, item.arguments]),
    [
      ["function_call", "call_1", "exec", '{"cmd":"pwd"}'],
      ["function_call", "call_2", "exec", '{"cmd":"ls"}'],
    ]
  );
});

test("preserves assistant text alongside tool calls by default", () => {
  const converted = convertChatCompletion(
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: "I will run that.",
            tool_calls: [{ id: "call_1", type: "function", function: { name: "exec", arguments: "{}" } }],
          },
        },
      ],
    },
    { idFactory: sequenceIds() }
  );

  assert.deepEqual(
    converted.output.map((item) => item.type),
    ["message", "function_call"]
  );
});

test("can drop assistant text alongside tool calls for compatibility", () => {
  const converted = convertChatCompletion(
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: "I will run that.",
            tool_calls: [{ id: "call_1", type: "function", function: { name: "exec", arguments: "{}" } }],
          },
        },
      ],
    },
    { dropToolCallContent: true, idFactory: sequenceIds() }
  );

  assert.deepEqual(
    converted.output.map((item) => item.type),
    ["function_call"]
  );
});

test("maps usage token fields", () => {
  assert.deepEqual(
    convertUsage({
      prompt_tokens: 3,
      completion_tokens: 5,
      total_tokens: 8,
      prompt_tokens_details: { cached_tokens: 1 },
      completion_tokens_details: { reasoning_tokens: 2 },
    }),
    {
      input_tokens: 3,
      output_tokens: 5,
      total_tokens: 8,
      input_tokens_details: { cached_tokens: 1 },
      output_tokens_details: { reasoning_tokens: 2 },
    }
  );
});

test("builds synthetic SSE event sequence", () => {
  const response = convertChatCompletion(
    {
      choices: [{ message: { role: "assistant", content: "OK" } }],
    },
    { model: "model", idFactory: sequenceIds() }
  );

  const events = createSyntheticSseEvents(response);

  assert.deepEqual(
    events.map((item) => item.event),
    [
      "response.created",
      "response.output_item.added",
      "response.output_text.delta",
      "response.output_text.done",
      "response.output_item.done",
      "response.completed",
    ]
  );
  assert.match(formatSseEvent(events[2].event, events[2].data), /event: response\.output_text\.delta/);
});

function sequenceIds() {
  let id = 0;
  return () => {
    id += 1;
    return `id_${id}`;
  };
}
