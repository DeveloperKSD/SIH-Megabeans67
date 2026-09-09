/**
 * visionModel.js
 * ----------------------------------------------------------------------
 * Loads and runs a lightweight on-device object-detection model
 * (@huggingface/transformers v3, WebGPU with WASM fallback) to find
 * visually sensitive regions that DOM-scanning can't catch, e.g.
 * faces/persons inside images, video thumbnails, etc.
 *
 * Load order:
 *   1. Local bundle: vision/transformers.min.js  (works offline / in MV3)
 *   2. CDN fallback: jsdelivr (only works if extension CSP allows it)
 *   3. Stub fallback: returns empty boxes so DOM-based PII redaction
 *      still works end-to-end even without the vision model.
 *
 * To enable full on-device vision (no stub), run:
 *   node build.js   (in the project root)
 * which downloads @huggingface/transformers v3 dist into extension/vision/.
 * ----------------------------------------------------------------------
 */

let pipelinePromise = null;
let visionAvailable = null; // null = untested, true/false after first attempt
const MODEL_ID = "Xenova/yolos-tiny"; // works with both v2 (Xenova) and v3 (HF) hubs
const SENSITIVE_LABELS = new Set(["person"]);

// Try to get a local URL for the bundled transformers.js
function localTransformersUrl() {
  try {
    return chrome.runtime.getURL("vision/transformers.min.js");
  } catch {
    return null;
  }
}

async function loadTransformers() {
  // 1. Try local bundle first (MV3-safe, works offline)
  const localUrl = localTransformersUrl();
  if (localUrl) {
    try {
      const mod = await import(localUrl);
      console.log("[vision] Loaded transformers.js from local bundle.");
      return mod;
    } catch (e) {
      console.warn("[vision] Local bundle not found, trying CDN…", e.message);
    }
  }

  // 2. Try CDN (only works in non-MV3 contexts or if CSP is relaxed)
  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/dist/transformers.min.js");
    console.log("[vision] Loaded transformers.js from CDN.");
    return mod;
  } catch (e) {
    console.warn("[vision] CDN import also failed:", e.message);
  }

  return null; // both failed
}

async function getDetector() {
  if (visionAvailable === false) return null; // already confirmed unavailable

  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const transformers = await loadTransformers();
      if (!transformers) {
        visionAvailable = false;
        return null;
      }

      const { pipeline, env } = transformers;
      // Allow remote model weights (first-time ~6MB download, then cached)
      env.allowRemoteModels = true;
      env.useBrowserCache = true;

      try {
        const detector = await pipeline("object-detection", MODEL_ID, {
          device: navigator.gpu ? "webgpu" : "wasm",
          dtype: "q8",
        });
        visionAvailable = true;
        console.log("[vision] Model loaded:", MODEL_ID);
        return detector;
      } catch (e) {
        visionAvailable = false;
        console.warn("[vision] Model load failed:", e.message);
        return null;
      }
    })();
  }

  return pipelinePromise;
}

/**
 * Run detection on an ImageBitmap/Canvas/OffscreenCanvas screenshot.
 * Returns boxes in the SAME pixel space as the input image.
 * Gracefully returns empty boxes if the vision model is unavailable.
 */
export async function detectSensitiveRegions(imageBitmapOrCanvas, { threshold = 0.6 } = {}) {
  const t0 = performance.now();

  const detector = await getDetector();

  // Graceful fallback: no vision model → DOM-only PII detection still runs
  if (!detector) {
    return {
      boxes: [],
      latencyMs: performance.now() - t0,
      model: "dom-only (vision model unavailable)",
    };
  }

  const canvas = toCanvas(imageBitmapOrCanvas);
  const results = await detector(canvas, { threshold });

  const boxes = results
    .filter((r) => SENSITIVE_LABELS.has(r.label))
    .map((r) => ({
      x: r.box.xmin,
      y: r.box.ymin,
      w: r.box.xmax - r.box.xmin,
      h: r.box.ymax - r.box.ymin,
      kind: "face_or_person",
      method: "onnx_vit_local",
      confidence: r.score,
    }));

  const latencyMs = performance.now() - t0;
  return { boxes, latencyMs, model: MODEL_ID };
}

function toCanvas(source) {
  if (source instanceof HTMLCanvasElement || source instanceof OffscreenCanvas) {
    return source;
  }
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/** Lightweight resource telemetry for the "client-side resource
 * utilization" evaluation metric. performance.memory is Chrome-only. */
export function getResourceStats() {
  const mem = performance.memory
    ? {
        usedJSHeapMB: +(performance.memory.usedJSHeapSize / 1e6).toFixed(1),
        totalJSHeapMB: +(performance.memory.totalJSHeapSize / 1e6).toFixed(1),
      }
    : null;
  return { mem, gpu: !!navigator.gpu, visionAvailable, timestamp: Date.now() };
}
