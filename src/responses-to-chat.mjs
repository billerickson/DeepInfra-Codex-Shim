export function convertResponsesRequest(body = {}) {
  const messages = [];
  if (typeof body.instructions === "string" && body.instructions.length > 0) {
    messages.push({ role: "system", content: body.instructions });
  }

  const input = normalizeInput(body.input);
  for (const item of input) {
    const message = messageFromResponsesItem(item);
    if (message) messages.push(message);
  }

  const chatBody = {
    model: body.model,
    messages: coalesceToolCalls(messages),
    stream: false,
  };

  copyIfPresent(body, chatBody, "temperature");
  copyIfPresent(body, chatBody, "top_p");
  copyIfPresent(body, chatBody, "presence_penalty");
  copyIfPresent(body, chatBody, "frequency_penalty");
  copyIfPresent(body, chatBody, "seed");
  copyIfPresent(body, chatBody, "stop");
  copyMapped(body, chatBody, "max_output_tokens", "max_tokens");

  const tools = convertTools(body.tools);
  if (tools) {
    chatBody.tools = tools;
    chatBody.tool_choice = body.tool_choice ?? "auto";
  }

  return chatBody;
}

export function normalizeInput(input) {
  if (typeof input === "string") {
    return [{ type: "message", role: "user", content: input }];
  }
  if (Array.isArray(input)) return input;
  return [];
}

export function messageFromResponsesItem(item) {
  if (!item || typeof item !== "object") return null;

  if (item.type === "message" || (!item.type && item.role)) {
    return {
      role: chatRole(item.role),
      content: textFromContent(item.content),
    };
  }

  if (item.type === "function_call") {
    return {
      role: "assistant",
      content: typeof item.content === "string" && item.content.length > 0 ? item.content : null,
      tool_calls: [
        {
          id: item.call_id || item.id,
          type: "function",
          function: {
            name: item.name,
            arguments: stringifyArguments(item.arguments),
          },
        },
      ],
    };
  }

  if (item.type === "function_call_output") {
    return {
      role: "tool",
      tool_call_id: item.call_id,
      content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? ""),
    };
  }

  return null;
}

export function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.input_text === "string") return part.input_text;
      if (typeof part?.output_text === "string") return part.output_text;
      if (typeof part?.refusal === "string") return part.refusal;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function coalesceToolCalls(messages) {
  const result = [];

  for (const message of messages) {
    const previous = result[result.length - 1];
    if (
      previous?.role === "assistant" &&
      Array.isArray(previous.tool_calls) &&
      message?.role === "assistant" &&
      Array.isArray(message.tool_calls) &&
      !previous.content &&
      !message.content
    ) {
      previous.tool_calls.push(...message.tool_calls);
      continue;
    }
    result.push(message);
  }

  return result;
}

export function convertTools(tools) {
  if (!Array.isArray(tools)) return undefined;

  const converted = tools
    .filter((tool) => tool?.type === "function")
    .map((tool) => ({
      type: "function",
      function: {
        name: tool.name || tool.function?.name,
        description: tool.description || tool.function?.description || "",
        parameters: tool.parameters || tool.function?.parameters || { type: "object", properties: {} },
      },
    }))
    .filter((tool) => tool.function.name);

  return converted.length > 0 ? converted : undefined;
}

function chatRole(role) {
  if (role === "assistant" || role === "system" || role === "tool") return role;
  if (role === "developer") return "system";
  return "user";
}

function stringifyArguments(args) {
  if (typeof args === "string") return args;
  return JSON.stringify(args ?? {});
}

function copyIfPresent(source, target, key) {
  if (source[key] !== undefined) target[key] = source[key];
}

function copyMapped(source, target, sourceKey, targetKey) {
  if (source[sourceKey] !== undefined) target[targetKey] = source[sourceKey];
}
