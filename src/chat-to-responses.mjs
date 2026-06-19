export function convertChatCompletion(chatResponse = {}, { model, dropToolCallContent = false, idFactory = randomId } = {}) {
  const choice = chatResponse.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const responseModel = chatResponse.model ?? model;
  const output = [];
  const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  const text = typeof message.content === "string" ? message.content : "";

  if (text && (!hasToolCalls || !dropToolCallContent)) {
    output.push({
      id: `msg_${idFactory()}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }],
    });
  }

  if (hasToolCalls) {
    for (const toolCall of message.tool_calls) {
      output.push({
        id: `fc_${idFactory()}`,
        type: "function_call",
        status: "completed",
        call_id: toolCall.id,
        name: toolCall.function?.name,
        arguments: toolCall.function?.arguments || "{}",
      });
    }
  }

  return {
    id: chatResponse.id?.startsWith("resp_") ? chatResponse.id : `resp_${idFactory()}`,
    object: "response",
    created_at: chatResponse.created ?? Math.floor(Date.now() / 1000),
    status: "completed",
    model: responseModel,
    output,
    usage: convertUsage(chatResponse.usage),
  };
}

export function convertUsage(usage) {
  if (!usage) {
    return {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };
  }

  const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: usage.total_tokens ?? inputTokens + outputTokens,
    input_tokens_details: usage.input_tokens_details ?? usage.prompt_tokens_details ?? { cached_tokens: 0 },
    output_tokens_details: usage.output_tokens_details ?? usage.completion_tokens_details ?? { reasoning_tokens: 0 },
  };
}

export function createSyntheticSseEvents(response) {
  const events = [
    {
      event: "response.created",
      data: {
        type: "response.created",
        response: { ...response, status: "in_progress", output: [] },
      },
    },
  ];

  response.output.forEach((item, outputIndex) => {
    events.push({
      event: "response.output_item.added",
      data: {
        type: "response.output_item.added",
        output_index: outputIndex,
        item,
      },
    });

    if (item.type === "message") {
      const part = item.content?.[0];
      if (part?.type === "output_text") {
        events.push({
          event: "response.output_text.delta",
          data: {
            type: "response.output_text.delta",
            output_index: outputIndex,
            content_index: 0,
            delta: part.text,
          },
        });
        events.push({
          event: "response.output_text.done",
          data: {
            type: "response.output_text.done",
            output_index: outputIndex,
            content_index: 0,
            text: part.text,
          },
        });
      }
    }

    events.push({
      event: "response.output_item.done",
      data: {
        type: "response.output_item.done",
        output_index: outputIndex,
        item,
      },
    });
  });

  events.push({
    event: "response.completed",
    data: {
      type: "response.completed",
      response,
    },
  });

  return events;
}

export function formatSseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function randomId() {
  return Math.random().toString(36).slice(2, 12);
}
