# Privacy-Preserving On-Device Vision Browser Agent (SIH #26171)

PPT: https://docs.google.com/presentation/d/1aEsCqlIv1UtZo1ZP2E_lEXmNy42ZsgeFBiGTTn85znA/edit?usp=sharing

A working prototype split into two halves:

- **`extension/`** — Chrome/Firefox MV3 extension. Runs a local ViT-based
  object detector (Transformers.js, WebGPU→WASM fallback) plus a DOM/text
  PII scanner *entirely on-device*, redacts the screenshot (black boxes for
  structured PII, blur for faces/people), and only then sends the sanitized
  image + sanitized DOM summary to the server.
- **`server/`** — FastAPI service that receives the sanitized context,
  forwards it to a pluggable VLM (OpenAI-compatible API, local Ollama model,
  or an offline rule-based mock for demoing without any API key/GPU), and
  returns a single next UI action (`click` / `type` / `scroll`) for the
  extension to execute.

## Architecture

```
┌─────────────────────────── Browser (client, untrusted network) ───────────────────────────┐
│  content.js                                                                                │
│    ├─ piiDetector.js  → DOM/regex scan → bounding boxes for passwords, emails, cards, etc. │
│    └─ buildDomSummary → clickable elements, sensitive text replaced with "[REDACTED]"      │
│                                                                                              │
│  background.js (service worker) — orchestrator                                             │
│    ├─ captureVisibleTab() → raw screenshot                                                  │
│    └─ sends screenshot + DOM PII boxes to the offscreen document                            │
│                                                                                              │
│  offscreen.html/js (has DOM + WebGPU access, unlike the service worker)                    │
│    ├─ visionModel.js  → Xenova/yolos-tiny (ONNX, quantized) finds faces/people              │
│    └─ redactor.js     → black-box / gaussian-blur ALL sensitive regions on <canvas>         │
│                                                                                              │
│  ── network boundary: only the redacted image + redacted DOM summary cross it ──            │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                          │ POST /analyze
                                          ▼
┌────────────────────────────────── Server (trusted compute) ───────────────────────────────┐
│  app.py       → FastAPI endpoint, validates payload, never logs image/text content          │
│  vlm_client.py→ calls OpenAI-compatible / Ollama VLM, or offline mock planner               │
│  action_schema.py → shared contract: {type: click|type|scroll|none, agentId, value, dx, dy} │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                          │ action JSON
                                          ▼
                              content.js executes it in the page
```

## Running it

### Server
```bash
cd server
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```
Defaults to `VLM_BACKEND=mock` (no API key needed) so the full pipeline is
demoable offline. To use a real VLM:
```bash
export VLM_BACKEND=openai_compatible
export OPENAI_API_KEY=sk-...
export OPENAI_MODEL=gpt-4o-mini
```
or point at a local Ollama vision model:
```bash
export VLM_BACKEND=ollama
export OLLAMA_MODEL=moondream
```

### Extension
1. Open `chrome://extensions`, enable Developer Mode.
2. "Load unpacked" → select the `extension/` folder.
3. Open any page, click the extension icon, type a task (e.g. "click the
   login button"), hit **Run on current tab**.
4. The popup shows the executed action, which regions were redacted, and a
   full latency/resource breakdown.

> First run downloads the ~6MB quantized YOLOS model from the Transformers.js
> CDN into the browser cache — subsequent runs are fully local/offline for
> the vision step.

## How each evaluation metric is addressed

| Metric | Where it's implemented |
|---|---|
| Accuracy of visual context | `visionModel.js` (on-device ViT/YOLOS) + `piiDetector.js` structural scan feed a combined DOM+visual summary to the VLM |
| PII detection recall/precision | Dual-layer detection: structural (input type/autocomplete/name) + regex (email/phone/card/SSN/Aadhaar/PAN) + visual (person/face), merged via IoU de-duplication in `piiDetector.js` |
| Precision of redaction | Per-kind strategy (`STRATEGY_BY_KIND` in `redactor.js`): blackbox for structured PII (zero leakage), blur for faces (context preserved, identity destroyed), with padding to avoid edge leakage |
| Client-side resource utilization | Quantized (`q8`) tiny model, WebGPU-first with WASM fallback, `getResourceStats()` reports JS heap + backend used, surfaced live in the popup |
| End-to-end latency | `background.js` timestamps every pipeline stage (DOM scan, capture, redaction, server RTT, execution) and reports them in the popup |

## Extending this prototype
- Swap `Xenova/yolos-tiny` for a face-specific tiny detector for higher
  face-recall at similar latency.
- Add a real face-blur strength/PII-confidence slider in the popup for
  live precision/recall tuning during judging.
- Persist a redaction audit log (kind + confidence only, never content)
  for the "recall/precision" metric to be measured against a labeled test
  page set.
