# Contributing Guidelines

Thank you for contributing to the **On-Device Visual Perception Browser Agent** project! To ensure code quality and privacy compliance, please follow these guidelines.

## Development Workflow

1. **Fork & Clone:** Fork the repository and clone it locally.
2. **Branch Naming:** Create a feature branch matching `feature/<component>-<description>` (e.g., `feature/client-canvas-blur`).
3. **Local Testing:** Test your changes against both Chrome and Firefox MV3 runtimes before opening a Pull Request.

## Code Standards & Guidelines

### Client Extension (JavaScript/TypeScript)
- **Zero Raw Image Network Calls:** Never invoke `fetch()` or `WebSocket.send()` on unredacted canvas frames.
- **WebGPU Fallbacks:** Ensure vision model code falls back gracefully to WebAssembly (WASM) if `navigator.gpu` is unavailable.
- **Resource Constraints:** Keep background memory footprint under 250MB during active ONNX inference.

### Server (Python)
- **Strict Payload Validation:** Use Pydantic schemas for all incoming WebSocket messages.
- **No Disk Storage for Screenshots:** In-memory image processing only. Do not persist received frames to temporary files or database logs.

## Submitting a Pull Request (PR)

- Include unit/integration test results verifying that PII detection recall remains above 90%.
- Ensure `npm run lint` and `black server/` pass without errors.
