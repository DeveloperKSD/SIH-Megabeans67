# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - Unreleased (SIH Prototype)

### Added
- **Client (Extension):**
  - DOM Scanner engine (`dom-scanner.js`) detecting password fields, credit card inputs, and email string patterns.
  - WebGPU-accelerated local ONNX/Transformers.js vision pipeline running in offscreen extension context.
  - Canvas compositor drawing hard blackout bounding boxes over detected PII coordinates.
  - Manifest V3 configuration supporting Chrome and Firefox.
- **Server (FastAPI Engine):**
  - Asynchronous WebSocket endpoint handling real-time base64 image streams.
  - Integration with Qwen2-VL / LLaVA models returning structured JSON navigation commands (`click`, `type`, `scroll`).
  - Strict JSON schema validation for client action execution.

### Security
- Enforced client-side blackout mask generation before any websocket transmission.
