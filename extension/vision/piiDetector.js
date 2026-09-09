/**
 * piiDetector.js
 * ----------------------------------------------------------------------
 * Runs entirely inside the page context (content script). Detects
 * sensitive elements/text on the current viewport and returns a list
 * of bounding boxes to redact, WITHOUT ever exposing the raw values
 * outside the browser.
 *
 * Two detection layers:
 *  1. Structural: form fields whose type/name/autocomplete signals PII
 *     (password, email, credit-card, ssn, phone, address, otp...)
 *  2. Content-based: regex scan over visible text nodes for patterns
 *     that look like emails, phone numbers, card numbers, SSNs, PANs,
 *     Aadhaar numbers, etc. Bounding boxes are computed per matched
 *     text range using Range.getClientRects(), so we don't need to
 *     redact the whole element (precision).
 *
 * Output shape:
 *  [{ x, y, w, h, kind, method, confidence }]
 * Coordinates are in *viewport* pixels (same space as the captured
 * screenshot), ready to be used directly for canvas redaction.
 * ----------------------------------------------------------------------
 */

(function (global) {
  const SENSITIVE_INPUT_TYPES = new Set([
    "password",
    "email",
    "tel",
  ]);

  const SENSITIVE_AUTOCOMPLETE = [
    "cc-number", "cc-csc", "cc-exp", "cc-name",
    "current-password", "new-password",
    "email", "tel", "street-address", "postal-code",
    "one-time-code",
  ];

  const SENSITIVE_NAME_HINTS = [
    "password", "passwd", "pwd", "email", "ssn", "aadhaar", "aadhar",
    "pan", "card", "cvv", "cvc", "otp", "phone", "mobile", "dob",
    "account", "iban", "routing", "national_id", "passport",
  ];

  // Regex patterns for free text on the page (kept conservative to
  // limit false positives; precision is a scored metric).
  const TEXT_PATTERNS = [
    { kind: "email", re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
    { kind: "credit_card", re: /\b(?:\d[ -]?){13,16}\b/g },
    { kind: "phone", re: /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3,4}\)?[-.\s]?){2,3}\d{3,4}\b/g },
    { kind: "ssn_us", re: /\b\d{3}-\d{2}-\d{4}\b/g },
    { kind: "aadhaar_in", re: /\b\d{4}\s?\d{4}\s?\d{4}\b/g },
    { kind: "pan_in", re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  ];

  function elementLooksSensitive(el) {
    if (!(el instanceof HTMLElement)) return null;
    const tag = el.tagName.toLowerCase();

    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      const name = (el.getAttribute("name") || el.id || "").toLowerCase();
      const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();

      if (SENSITIVE_INPUT_TYPES.has(type)) return "input:" + type;
      if (SENSITIVE_AUTOCOMPLETE.some((a) => autocomplete.includes(a))) {
        return "autocomplete:" + autocomplete;
      }
      if (SENSITIVE_NAME_HINTS.some((h) => name.includes(h))) {
        return "name-hint:" + name;
      }
    }

    // Elements explicitly opted out by the page author or by the user
    // via a data attribute: data-agent-sensitive="true"
    if (el.dataset && el.dataset.agentSensitive === "true") {
      return "data-attr";
    }

    // Face / avatar-like <img>: heuristic via alt text or class names.
    if (tag === "img") {
      const hint = ((el.getAttribute("alt") || "") + " " + (el.className || "")).toLowerCase();
      if (/(avatar|profile|face|selfie|photo-id|id-card)/.test(hint)) {
        return "img-hint";
      }
    }

    return null;
  }

  function rectFromElement(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }

  function scanStructuralElements(root = document) {
    const boxes = [];
    const candidates = root.querySelectorAll("input, textarea, img, [data-agent-sensitive]");
    candidates.forEach((el) => {
      const reason = elementLooksSensitive(el);
      if (!reason) return;
      const rect = rectFromElement(el);
      if (!rect) return;
      boxes.push({
        ...rect,
        kind: reason.startsWith("img") ? "image" : "form_field",
        method: "structural",
        detail: reason,
        confidence: 0.95,
      });
    });
    return boxes;
  }

  function isVisible(node) {
    const parent = node.parentElement;
    if (!parent) return false;
    const style = getComputedStyle(parent);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const r = parent.getBoundingClientRect();
    return r.width > 0 && r.height > 0 &&
      r.bottom > 0 && r.right > 0 &&
      r.top < innerHeight && r.left < innerWidth;
  }

  function scanTextNodes(root = document.body) {
    const boxes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const tag = node.parentElement && node.parentElement.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
          return NodeFilter.FILTER_REJECT;
        }
        if (!isVisible(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      for (const { kind, re } of TEXT_PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          try {
            const range = document.createRange();
            range.setStart(node, m.index);
            range.setEnd(node, m.index + m[0].length);
            const rects = range.getClientRects();
            for (const r of rects) {
              if (r.width <= 0 || r.height <= 0) continue;
              boxes.push({
                x: r.x, y: r.y, w: r.width, h: r.height,
                kind,
                method: "text_regex",
                confidence: 0.75,
              });
            }
          } catch (e) {
            // Range could fail on weird DOM edges; skip silently.
          }
        }
      }
    }
    return boxes;
  }

  /**
   * Merge overlapping boxes so we don't redact the same region twice
   * and so the server-side precision/recall metric isn't skewed by
   * duplicate detections.
   */
  function mergeBoxes(boxes, iouThreshold = 0.3) {
    const merged = [];
    const used = new Array(boxes.length).fill(false);

    function iou(a, b) {
      const x1 = Math.max(a.x, b.x);
      const y1 = Math.max(a.y, b.y);
      const x2 = Math.min(a.x + a.w, b.x + b.w);
      const y2 = Math.min(a.y + a.h, b.y + b.h);
      const interW = Math.max(0, x2 - x1);
      const interH = Math.max(0, y2 - y1);
      const inter = interW * interH;
      const union = a.w * a.h + b.w * b.h - inter;
      return union > 0 ? inter / union : 0;
    }

    for (let i = 0; i < boxes.length; i++) {
      if (used[i]) continue;
      let cur = boxes[i];
      for (let j = i + 1; j < boxes.length; j++) {
        if (used[j]) continue;
        if (iou(cur, boxes[j]) > iouThreshold) {
          const x = Math.min(cur.x, boxes[j].x);
          const y = Math.min(cur.y, boxes[j].y);
          const x2 = Math.max(cur.x + cur.w, boxes[j].x + boxes[j].w);
          const y2 = Math.max(cur.y + cur.h, boxes[j].y + boxes[j].h);
          cur = {
            ...cur,
            x, y, w: x2 - x, h: y2 - y,
            confidence: Math.max(cur.confidence, boxes[j].confidence),
          };
          used[j] = true;
        }
      }
      merged.push(cur);
    }
    return merged;
  }

  function detectPII() {
    const structural = scanStructuralElements();
    const textual = scanTextNodes();
    return mergeBoxes([...structural, ...textual]);
  }

  global.PIIDetector = { detectPII, elementLooksSensitive };
})(typeof window !== "undefined" ? window : globalThis);
