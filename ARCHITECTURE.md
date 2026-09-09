# System Architecture

This document details the architectural design and operational dataflow for the **Privacy-Preserving On-Device Vision Agent**.

+-----------------------------------------------------------------------+
|                         CLIENT SIDE (Browser)                         |
|                                                                       |
|   [ Active Web Tab ]                                                  |
|           |                                                           |
|           v                                                           |
|   [ Content Script ] ----------> ( DOM PII Scanner )                  |
|           |                           | (Extract Coordinates)         |
|   (Screen Capture)                    v                               |
|           |                   +---------------+                       |
|           +------------------>| Canvas Engine |                       |
|                               +---------------+                       |
|                                       ^                               |
|   [ Background Worker ]               | (Object BBoxes)               |
|   (WebGPU / Transformers.js) ---------+                               |
|                                       |                               |
|                                       v                               |
|                         ( Sanitized Canvas Frame )                    |
+---------------------------------------|-------------------------------+
|
(WSS Base64 Encoded Image)
|
+---------------------------------------|-------------------------------+
|                         SERVER SIDE (Cloud)                           |
|                                       v                               |
|                            [ FastAPI WebSocket ]                      |
|                                       |                               |
|                                       v                               |
|                             [ VLM Inference ]                         |
|                           (Qwen2-VL / LLaVA Engine)                   |
|                                       |                               |
|                                       v                               |
|                           [ Action JSON Generator ]                   |
+---------------------------------------|-------------------------------+
|
(JSON UI Action Command)
|
+---------------------------------------|-------------------------------+
| CLIENT SIDE EXECUTION                 v                               |
|   [ Content Script Executor ] --> Triggers document.elementFromPoint()|
+-----------------------------------------------------------------------+

## Architectural Components

### 1. Client Subsystem (Manifest V3 Browser Extension)
* **DOM PII Scanner (`src/utils/dom-scanner.js`):** Parses DOM nodes using query selectors and regex to identify input fields (`input[type="password"]`, `autocomplete="cc-number"`) and sensitive textual patterns. Computes absolute viewport bounding rects.
* **On-Device Vision Pipeline (`src/utils/vision-model.js`):** Loads a lightweight, quantized ONNX/Transformers.js model via **WebGPU**. Performs visual object detection for faces, profile badges, and non-DOM visual media.
* **Redaction Compositor (`src/utils/redactor.js`):** Draws the captured viewport onto an offscreen HTML Canvas, overlays solid `#000000` rects on all combined coordinate sets, and outputs an anonymized JPEG image payload.

### 2. Server Subsystem (Python FastAPI & VLM Engine)
* **WebSocket Ingestion (`server/main.py`):** Maintains bidirectional stateful communication with the client extension.
* **Reasoning VLM Driver (`server/vlm_engine.py`):** Receives redacted screenshots and generates natural language UI navigation targets without context loss.
* **Command Parser (`server/action_parser.py`):** Formats VLM decisions into atomic, deterministic browser execution instructions (`{ "action": "click", "x": 420, "y": 180 }`).

## Performance Targets
- **Local Client Latency:** < 300ms (Frame Capture + DOM Scan + WebGPU Masking).
- **Server Roundtrip:** < 1000ms (Transmission + VLM Processing + Action Dispatch).
- **Client Memory Footprint:** < 200MB.
