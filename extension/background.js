/**
 * background.js (MV3 service worker)
 * ----------------------------------------------------------------------
 * Orchestrates the end-to-end pipeline:
 *   1. Ask content script for DOM-based PII boxes + sanitized DOM summary
 *   2. Capture the visible tab as a screenshot
 *   3. Hand screenshot + PII boxes to the offscreen document for local
 *      ViT inference + redaction (steps that need canvas/WebGPU)
 *   4. POST only the sanitized image + sanitized DOM summary to the
 *      server, along with the user's task instruction
 *   5. Receive an action plan back and forward it to the content script
 *      to execute (click / type / scroll)
 * ----------------------------------------------------------------------
 */

const SERVER_URL = "http://localhost:8000/analyze"; // change to your deployed server
let offscreenReady = null;

async function ensureOffscreenDocument() {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    const existing = await chrome.runtime.getContexts?.({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (existing && existing.length > 0) return;
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["DOM_SCRAPING"], // best-fit reason for canvas/ML inference w/o UI
      justification: "Run local vision model + canvas redaction off the main thread context.",
    });
  })();
  return offscreenReady;
}

async function captureVisibleTabDataUrl(windowId) {
  return chrome.tabs.captureVisibleTab(windowId, { format: "png" });
}

async function runPipeline({ tabId, windowId, task }) {
  const timings = { start: performance.now() };

  // Step 1: DOM PII scan happens in-page (content.js), we just ask for it.
  const domResult = await chrome.tabs.sendMessage(tabId, { type: "SCAN_PII" });
  timings.domScan = performance.now();

  // Step 2: screenshot
  const dataUrl = await captureVisibleTabDataUrl(windowId);
  timings.capture = performance.now();

  // Step 3: local vision + redaction in the offscreen document
  await ensureOffscreenDocument();
  const offscreenResult = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_PROCESS_FRAME",
    dataUrl,
    domBoxes: domResult.boxes,
  });
  timings.redaction = performance.now();

  if (!offscreenResult.ok) {
    throw new Error("Redaction pipeline failed: " + offscreenResult.error);
  }

  // Step 4: send ONLY sanitized data to the server.
  const serverResponse = await fetch(SERVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task,
      image_base64: offscreenResult.sanitizedDataUrl,
      dom_summary: domResult.domSummary,
      redaction_meta: {
        redacted_box_count: offscreenResult.redactedBoxCount,
        model: offscreenResult.model,
      },
    }),
  }).then((r) => r.json());
  timings.server = performance.now();

  // Step 5: execute the returned action(s) in the page.
  let execResult = null;
  if (serverResponse.action && serverResponse.action.type !== "none") {
    execResult = await chrome.tabs.sendMessage(tabId, {
      type: "EXECUTE_ACTION",
      action: serverResponse.action,
    });
  }
  timings.execute = performance.now();

  return {
    serverResponse,
    execResult,
    telemetry: {
      domScanMs: +(timings.domScan - timings.start).toFixed(1),
      captureMs: +(timings.capture - timings.domScan).toFixed(1),
      redactionMs: +(timings.redaction - timings.capture).toFixed(1),
      visionModelMs: +(offscreenResult.visionLatencyMs || 0).toFixed(1),
      serverRoundTripMs: +(timings.server - timings.redaction).toFixed(1),
      executeMs: +(timings.execute - timings.server).toFixed(1),
      totalMs: +(timings.execute - timings.start).toFixed(1),
      resourceStats: offscreenResult.resourceStats,
      detections: offscreenResult.totalBoxes,
    },
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "RUN_AGENT_TASK") {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        const result = await runPipeline({ tabId: tab.id, windowId: tab.windowId, task: msg.task });
        sendResponse({ ok: true, result });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    })();
    return true;
  }
  return false;
});
