# DeepInfra Codex Shim

Codex currently sends Responses API requests. DeepInfra's OpenAI-compatible endpoint accepts chat completions requests. This shim runs locally and translates between those formats so Codex can use DeepInfra-hosted models.

This is experimental. It is not a full Responses API implementation. It is a small compatibility layer for Codex CLI coding workflows that use text prompts, text responses, and function/tool calls.

The one manual step is providing a DeepInfra API token. The shim reads it from `DEEPINFRA_TOKEN` by default, and Codex should use that same environment variable in its provider config. Everything else can be scripted by Codex or another local AI harness.

## What this is

`deepinfra-codex-shim` starts a local HTTP server. Codex talks to the local server with `wire_api = "responses"`. The shim converts `POST /v1/responses` requests into DeepInfra `POST /chat/completions` requests, sends them upstream, and converts the result back into the Responses-shaped output Codex expects.

It also proxies `GET /v1/models` and provides a `POST /v1/chat/completions` passthrough for smoke testing your DeepInfra token and model.

## Why this exists

Codex and chat-completions providers speak similar but different API dialects. Codex expects Responses API objects and events. DeepInfra exposes an OpenAI-compatible chat completions API. This project bridges the narrow overlap that is useful for model benchmarking and coding workflows.

## Quick start

```bash
git clone https://github.com/billerickson/DeepInfra-Codex-Shim.git
cd DeepInfra-Codex-Shim
npm install
npm test

export DEEPINFRA_TOKEN="your_deepinfra_api_token"
npm start -- --log-requests
```

The server listens at:

```text
http://127.0.0.1:8797/v1
```

Check health:

```bash
curl http://127.0.0.1:8797/health
```

Smoke test chat passthrough:

```bash
curl http://127.0.0.1:8797/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer $DEEPINFRA_TOKEN" \
  -d '{"model":"deepseek-ai/DeepSeek-V4-Flash","messages":[{"role":"user","content":"Reply with exactly OK."}]}'
```

## Codex configuration

Use the same `DEEPINFRA_TOKEN` environment variable in Codex. Codex config formats may change, so treat this as a template:

```toml
[model_providers.deepinfra]
name = "DeepInfra via local shim"
base_url = "http://127.0.0.1:8797/v1"
env_key = "DEEPINFRA_TOKEN"
wire_api = "responses"
```

Example invocation:

```bash
codex --profile deepinfra --model deepseek-ai/DeepSeek-V4-Flash
```

## Environment variables

Required:

```text
DEEPINFRA_TOKEN=...
```

Optional:

```text
DEEPINFRA_CODEX_SHIM_HOST=127.0.0.1
DEEPINFRA_CODEX_SHIM_PORT=8797
DEEPINFRA_CODEX_SHIM_UPSTREAM=https://api.deepinfra.com/v1/openai
DEEPINFRA_CODEX_SHIM_API_KEY_ENV=DEEPINFRA_TOKEN
DEEPINFRA_CODEX_SHIM_LOG_LEVEL=info
DEEPINFRA_CODEX_SHIM_LOG_CONTENT=false
DEEPINFRA_CODEX_SHIM_LOG_REQUESTS=false
DEEPINFRA_CODEX_SHIM_TIMEOUT_MS=120000
DEEPINFRA_CODEX_SHIM_MAX_BODY_BYTES=10485760
DEEPINFRA_CODEX_SHIM_COMPAT_DROP_TOOL_CALL_CONTENT=false
```

Equivalent CLI flags:

```bash
node bin/deepinfra-codex-shim.js \
  --host 127.0.0.1 \
  --port 8797 \
  --upstream https://api.deepinfra.com/v1/openai \
  --api-key-env DEEPINFRA_TOKEN \
  --log-requests
```

## Supported endpoints

- `GET /health`
- `GET /v1/models`
- `POST /v1/responses`
- `POST /v1/chat/completions`

## Supported Codex workflows

- Text prompts
- Text responses
- Basic Responses message input
- `instructions` mapped to a chat `system` message
- Function tools used by Codex CLI
- `function_call` items
- `function_call_output` items
- Non-streaming Responses JSON when Codex sends `stream: false`
- DeepInfra streaming chat completions when Codex requests streaming
- Responses-style SSE text deltas for streamed text output
- Streamed tool-call fragments accumulated into complete Responses `function_call` items

## Known limitations

This does not support:

- Full Responses API compatibility
- Images
- Audio
- Built-in OpenAI tools
- Web search
- File search
- Reasoning item semantics
- Persistent response IDs or server-side conversation state
- Advanced structured output behavior
- Provider-specific model quirks

DeepInfra models differ in tool-call behavior. If a model does not reliably emit OpenAI-compatible tool calls, this shim cannot fix that at the transport layer.

For streamed tool calls, chat completions providers send function names and arguments in fragments. The shim accumulates those fragments and emits the complete Responses `function_call` item when the upstream stream finishes.

## Compatibility flags

There is an opt-in flag to drop assistant text whenever a tool call is present. This behavior can help with some Codex/tool-call turns:

```bash
deepinfra-codex-shim --compat-drop-tool-call-content
```

By default, assistant text returned alongside tool calls is preserved.

## Logging

Normal request logging is off. `--log-requests` logs message shape, tool counts, model name, and request IDs, not full prompts or tool outputs.

For deeper debugging:

```bash
deepinfra-codex-shim --log-level debug --log-content
```

`--log-content` may print prompts, code, file contents, command output, and other sensitive context. Use it only in a safe local environment.

Tokens and authorization headers are redacted from structured logs and upstream error snippets.

## Privacy and security

Keep the shim bound to `127.0.0.1` unless you have a specific reason to expose it elsewhere. The shim does not implement authentication beyond forwarding provider credentials upstream.

The shim does not store API keys. It reads the token from `DEEPINFRA_TOKEN` by default, or from the variable named by `DEEPINFRA_CODEX_SHIM_API_KEY_ENV`.

## Troubleshooting

If Codex cannot connect, verify the local server is running:

```bash
curl http://127.0.0.1:8797/health
```

If DeepInfra rejects the request, test the passthrough endpoint with a tiny chat completion. That separates token/model problems from Responses conversion problems.

If Codex tool calls fail, try a model known to support OpenAI-compatible tool calls, then run the shim with `--log-requests` to confirm function tools and tool call IDs are flowing through.

If requests hang, lower the timeout while debugging:

```bash
deepinfra-codex-shim --timeout-ms 30000
```

## Development

```bash
npm test
npm run lint
```

Run the optional integration test only when `DEEPINFRA_TOKEN` is set:

```bash
DEEPINFRA_TOKEN=... npm run test:integration
```

## License

MIT
