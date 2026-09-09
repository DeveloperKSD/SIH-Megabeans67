/**
 * content.js
 * ----------------------------------------------------------------------
 * Injected into every page. Two jobs:
 *   1. On "SCAN_PII": run the local DOM/text PII detector and return
 *      bounding boxes + a sanitized DOM summary (no raw sensitive text).
 *   2. On "EXECUTE_ACTION": carry out a server-planned UI action
 *      (click, type, scroll, wait) using DOM selectors / element ids
 *      that were included in the sanitized DOM summary sent earlier.
 *
 * piiDetector.js is loaded first via manifest content_scripts array
 * ordering is not guaranteed across files, so we inline-require it by
 * also listing it as a content script (see manifest.json) — simplest
 * approach for a hackathon prototype without a bundler.
 * ----------------------------------------------------------------------
 */

// Fallback: if piiDetector.js wasn't injected as a separate content
// script (e.g. during manual testing), lazily fetch+eval it once.
async function ensurePIIDetector() {
  if (window.PIIDetector) return;
  const src = chrome.runtime.getURL("vision/piiDetector.js");
  await import(src).catch(() => {
    // piiDetector.js uses an IIFE attaching to window, not ESM export,
    // so a classic script injection is the safe fallback:
    const s = document.createElement("script");
    s.src = src;
    document.documentElement.appendChild(s);
  });
}

function buildDomSummaryLocal(sensitiveBoxes) {
  const clickable = Array.from(
    document.querySelectorAll("a, button, input, select, textarea, [role='button'], [onclick]")
  ).slice(0, 200);

  return clickable.map((el, i) => {
    el.dataset.agentId = String(i); // tag element so EXECUTE_ACTION can find it later
    const rect = el.getBoundingClientRect();
    const isSensitive = sensitiveBoxes.some((b) => rectsOverlap(rect, b));
    return {
      id: i,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || null,
      type: el.getAttribute("type") || null,
      placeholder: el.getAttribute("placeholder") || null,
      text: isSensitive ? "[REDACTED]" : (el.innerText || el.value || "").trim().slice(0, 60),
      box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      sensitive: isSensitive,
    };
  });
}

function rectsOverlap(r, b) {
  return !(r.right < b.x || r.left > b.x + b.w || r.bottom < b.y || r.top > b.y + b.h);
}

async function handleScanPII() {
  await ensurePIIDetector();
  const boxes = window.PIIDetector ? window.PIIDetector.detectPII() : [];
  const domSummary = buildDomSummaryLocal(boxes);
  return { boxes, domSummary };
}

function handleExecuteAction(action) {
  switch (action.type) {
    case "click": {
      const el = resolveTarget(action);
      if (!el) return { ok: false, error: "target not found" };
      el.scrollIntoView({ block: "center", behavior: "instant" });
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      el.click();
      return { ok: true };
    }
    case "type": {
      const el = resolveTarget(action);
      if (!el) return { ok: false, error: "target not found" };
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, action.value ?? "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    }
    case "scroll": {
      window.scrollBy({
        top: action.dy || 0,
        left: action.dx || 0,
        behavior: "smooth",
      });
      return { ok: true };
    }
    default:
      return { ok: false, error: "unknown action type: " + action.type };
  }
}

function resolveTarget(action) {
  if (action.agentId !== undefined && action.agentId !== null) {
    const byId = document.querySelector(`[data-agent-id="${action.agentId}"]`);
    if (byId) return byId;
  }
  if (action.selector) {
    try {
      return document.querySelector(action.selector);
    } catch (e) {
      return null;
    }
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SCAN_PII") {
    handleScanPII().then(sendResponse);
    return true;
  }
  if (msg.type === "EXECUTE_ACTION") {
    sendResponse(handleExecuteAction(msg.action));
    return false;
  }
  return false;
});
