# Changelog

## 0.1.1 - 2026-06-19

- Added real upstream streaming for DeepInfra chat completions when Codex requests streaming.
- Streamed text deltas are converted to Responses-style SSE events as they arrive.
- Streaming tool-call fragments are accumulated and emitted as complete Responses `function_call` items.
- Updated the integration test to exercise the live streaming path.

## 0.1.0 - 2026-06-19

- Initial public package structure.
- Added `/v1/responses` to DeepInfra `/chat/completions` conversion.
- Added synthetic Responses-style SSE output for Codex streaming requests.
- Added `/v1/models` proxying and `/v1/chat/completions` passthrough.
- Added request conversion, response conversion, server, and integration tests.
- Added safe request-shape logging, token redaction, timeouts, JSON errors, and request body limits.
