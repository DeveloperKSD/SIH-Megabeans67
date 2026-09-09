import { detectSensitiveRegions, getResourceStats } from "./vision/visionModel.js";
import { redactImage } from "./vision/redactor.js";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "OFFSCREEN_PROCESS_FRAME") return false;

  (async () => {
    try {
      const blob = await (await fetch(msg.dataUrl)).blob();
      const imageBitmap = await createImageBitmap(blob);

      // 1. Local on-device vision pass (faces / persons in images, video, canvases)
      const { boxes: visionBoxes, latencyMs, model } = await detectSensitiveRegions(imageBitmap);

      // 2. Merge with DOM-derived PII boxes (already computed in content.js,
      //    passed through msg.domBoxes) — coordinates are already in the
      //    same viewport pixel space as the screenshot.
      const allBoxes = [...(msg.domBoxes || []), ...visionBoxes];

      // 3. Redact locally. Nothing beyond this point is unredacted.
      const { canvas, redactedBoxCount } = await redactImage(imageBitmap, allBoxes);
      const sanitizedDataUrl = canvas.toDataURL("image/webp", 0.85);

      sendResponse({
        ok: true,
        sanitizedDataUrl,
        redactedBoxCount,
        visionLatencyMs: latencyMs,
        model,
        resourceStats: getResourceStats(),
        totalBoxes: allBoxes.map(({ kind, method, confidence }) => ({ kind, method, confidence })),
      });
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  })();

  return true; // keep the message channel open for the async response
});
