const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /(authorization["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
  /(api[_-]?key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
  /(token["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
];

export function createLogger({ level = "info", logContent = false } = {}) {
  const normalized = String(level).toLowerCase();
  const enabled = normalized !== "silent";
  const debugEnabled = normalized === "debug";

  function write(event) {
    if (!enabled) return;
    console.error(JSON.stringify(redactObject(event, { logContent })));
  }

  return {
    info(event) {
      write(event);
    },
    debug(event) {
      if (debugEnabled) write(event);
    },
    error(event) {
      write(event);
    },
  };
}

export function redactText(value) {
  let text = String(value);
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match, prefix) => (prefix ? `${prefix}[REDACTED]` : "[REDACTED]"));
  }
  return text;
}

export function redactObject(value, { logContent = false } = {}) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactText(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactObject(item, { logContent }));

  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (lower.includes("authorization") || lower.includes("token") || lower.includes("api_key")) {
      result[key] = "[REDACTED]";
      continue;
    }
    if (!logContent && ["content", "prompt", "input", "output", "body"].includes(lower)) {
      result[key] = summarizeContent(nested);
      continue;
    }
    result[key] = redactObject(nested, { logContent });
  }
  return result;
}

function summarizeContent(value) {
  if (typeof value === "string") return { type: "string", length: value.length };
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (value && typeof value === "object") return { type: "object", keys: Object.keys(value).sort() };
  return value;
}
