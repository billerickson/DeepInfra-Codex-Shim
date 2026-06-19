import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { startServer } from "./server.mjs";

export async function main(argv = process.argv.slice(2)) {
  const config = loadConfig({ argv });

  if (config.help) {
    console.log(helpText());
    return 0;
  }

  if (config.version) {
    console.log(readPackageVersion());
    return 0;
  }

  const server = await startServer(config);
  console.error(
    `deepinfra-codex-shim listening on http://${config.host}:${config.port}/v1 -> ${config.upstream}/chat/completions`
  );

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return 0;
}

export function helpText() {
  return `deepinfra-codex-shim

Run a local Responses API compatibility shim for DeepInfra chat completions.

Usage:
  deepinfra-codex-shim [flags]

Flags:
  --host <host>                         Listen host (default: 127.0.0.1)
  --port <port>                         Listen port (default: 8797)
  --upstream <url>                      DeepInfra OpenAI-compatible base URL
  --api-key-env <name>                  Env var containing the DeepInfra token
  --log-requests                        Log request shape summaries
  --log-level silent|info|debug         Logging level
  --log-content                         Include prompt/tool content in logs
  --compat-drop-tool-call-content       Drop assistant text when tool calls exist
  --timeout-ms <ms>                     Upstream timeout
  --max-body-bytes <bytes>              Request body size limit
  --version                             Print version
  --help                                Show this help
`;
}

function readPackageVersion() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(currentDir, "../package.json"), "utf8"));
  return pkg.version;
}
