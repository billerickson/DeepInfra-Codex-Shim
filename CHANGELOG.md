# Changelog

## 0.1.0 - 2026-06-19

- Initial public package structure.
- Added `/v1/responses` to DeepInfra `/chat/completions` conversion.
- Added synthetic Responses-style SSE output for Codex streaming requests.
- Added `/v1/models` proxying and `/v1/chat/completions` passthrough.
- Added request conversion, response conversion, server, and integration tests.
- Added safe request-shape logging, token redaction, timeouts, JSON errors, and request body limits.
