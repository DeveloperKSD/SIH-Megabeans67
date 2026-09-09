# On-Device Visual Perception for Light-Weight Browser Agents (SIH PS 26171)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![WebGPU](https://img.shields.io/badge/Accelerated_By-WebGPU-green)](https://gpuweb.github.io/gpuweb/)
[![Chrome Extension](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/intro/)

An end-to-end, privacy-preserving hybrid browser extension and server architecture for AI-assisted web automation. The client side performs real-time local computer vision detection and redaction of PII (faces, passwords, financial info) using WebGPU before transmitting any visual state to a backend Vision-Language Model (VLM).

---

## Key Features

- **Local-First Privacy Guard:** Runs on-device detection using `Transformers.js` and ONNX Runtime Web via **WebGPU**.
- **Dual-Layer Redaction:** Combines DOM node element coordinates (`input[type="password"]`, pattern matching) with Canvas visual object detection.
- **VLM Automation Loop:** Communicates with a Python backend running open-weights VLMs (Qwen2-VL / LLaVA) via WebSockets to execute complex UI actions (`click`, `type`, `scroll`).
- **Privacy Audit Dashboard:** Real-time side-by-side view showing raw browser capture versus sanitized server payload.

---

## Directory Structure (temp)

```text
.
├── client/                     # Chrome / Firefox Browser Extension (MV3)
│   ├── manifest.json           # Extension manifest configuration
│   ├── package.json            # Client dependencies
│   ├── src/
│   │   ├── background/         # Service worker & offscreen session runner
│   │   │   └── background.js
│   │   ├── content/            # DOM scanner & action execution script
│   │   │   └── content.js
│   │   ├── popup/              # Extension control popup UI
│   │   │   ├── popup.html
│   │   │   └── popup.js
│   │   └── utils/
│   │       ├── dom-scanner.js  # DOM PII identifier
│   │       ├── vision-model.js # WebGPU Transformers.js launcher
│   │       └── redactor.js     # HTML Canvas blackout renderer
│   └── public/
│       └── icons/
│
├── server/                     # Backend Python VLM Server
│   ├── main.py                 # FastAPI WebSocket entry point
│   ├── vlm_engine.py           # Interface for Qwen2-VL / Ollama / vLLM
│   ├── action_parser.py        # Converts model text outputs into UI action JSON
│   ├── requirements.txt        # Python packages
│   └── Dockerfile              # Deployment config
│
├── .gitignore
├── LICENSE
└── README.md
