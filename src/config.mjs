export const DEFAULT_CONFIG = {
  host: "127.0.0.1",
  port: 8797,
  upstream: "https://api.deepinfra.com/v1/openai",
  apiKeyEnv: "DEEPINFRA_TOKEN",
  logLevel: "info",
  logContent: false,
  logRequests: false,
  compatibilityDropToolCallContent: false,
  timeoutMs: 120000,
  maxBodyBytes: 10 * 1024 * 1024,
};

const BOOLEAN_FLAGS = new Set([
  "help",
  "version",
  "log-requests",
  "log-content",
  "compat-drop-tool-call-content",
]);

export function loadConfig({ argv = process.argv.slice(2), env = process.env } = {}) {
  const flags = parseArgs(argv);

  return {
    host: flags.host ?? env.DEEPINFRA_CODEX_SHIM_HOST ?? DEFAULT_CONFIG.host,
    port: Number(flags.port ?? env.DEEPINFRA_CODEX_SHIM_PORT ?? DEFAULT_CONFIG.port),
    upstream: stripTrailingSlashes(
      flags.upstream ?? env.DEEPINFRA_CODEX_SHIM_UPSTREAM ?? DEFAULT_CONFIG.upstream
    ),
    apiKeyEnv: flags["api-key-env"] ?? env.DEEPINFRA_CODEX_SHIM_API_KEY_ENV ?? DEFAULT_CONFIG.apiKeyEnv,
    logLevel: flags["log-level"] ?? env.DEEPINFRA_CODEX_SHIM_LOG_LEVEL ?? DEFAULT_CONFIG.logLevel,
    logContent: BooleanFlag(flags["log-content"], env.DEEPINFRA_CODEX_SHIM_LOG_CONTENT),
    logRequests: BooleanFlag(flags["log-requests"], env.DEEPINFRA_CODEX_SHIM_LOG_REQUESTS),
    compatibilityDropToolCallContent: BooleanFlag(
      flags["compat-drop-tool-call-content"],
      env.DEEPINFRA_CODEX_SHIM_COMPAT_DROP_TOOL_CALL_CONTENT
    ),
    timeoutMs: Number(flags["timeout-ms"] ?? env.DEEPINFRA_CODEX_SHIM_TIMEOUT_MS ?? DEFAULT_CONFIG.timeoutMs),
    maxBodyBytes: Number(
      flags["max-body-bytes"] ?? env.DEEPINFRA_CODEX_SHIM_MAX_BODY_BYTES ?? DEFAULT_CONFIG.maxBodyBytes
    ),
    help: Boolean(flags.help),
    version: Boolean(flags.version),
  };
}

export function parseArgs(argv) {
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;

    const withoutPrefix = arg.slice(2);
    const [name, inlineValue] = withoutPrefix.split("=", 2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = inlineValue === undefined ? true : inlineValue !== "false";
      continue;
    }

    if (inlineValue !== undefined) {
      flags[name] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    flags[name] = next;
    index += 1;
  }

  return flags;
}

export function stripTrailingSlashes(value) {
  return String(value).replace(/\/+$/, "");
}

function BooleanFlag(flagValue, envValue) {
  if (flagValue !== undefined) return Boolean(flagValue);
  if (envValue === undefined) return false;
  return !["0", "false", "no", "off"].includes(String(envValue).toLowerCase());
}
