/**
 * redactor.js
 * ----------------------------------------------------------------------
 * Takes a raw screenshot (ImageBitmap) + a list of sensitive bounding
 * boxes (from piiDetector.js and/or visionModel.js) and produces a
 * SANITIZED image. Nothing unredacted ever leaves this function scope
 * bound for the network.
 *
 * Redaction strategies:
 *   - "blackbox": fully opaque fill (default for structured PII:
 *     passwords, card numbers, SSNs, form fields -> zero leakage)
 *   - "blur": strong gaussian-style box blur (default for faces, so
 *     the server-side VLM can still tell "a person is present" for
 *     task reasoning without recovering identity)
 *   - "pixelate": cheaper alternative to blur on low-power devices
 * ----------------------------------------------------------------------
 */

const STRATEGY_BY_KIND = {
  form_field: "blackbox",
  email: "blackbox",
  credit_card: "blackbox",
  phone: "blackbox",
  ssn_us: "blackbox",
  aadhaar_in: "blackbox",
  pan_in: "blackbox",
  image: "blur",
  face_or_person: "blur",
};

export async function redactImage(imageBitmap, boxes, opts = {}) {
  const { pixelateInsteadOfBlur = false, padding = 4 } = opts;

  const canvas = document.createElement("canvas");
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imageBitmap, 0, 0);

  for (const box of boxes) {
    const strategy = STRATEGY_BY_KIND[box.kind] || "blackbox";
    const rect = padRect(box, padding, canvas.width, canvas.height);

    if (strategy === "blackbox") {
      drawBlackbox(ctx, rect);
    } else if (pixelateInsteadOfBlur) {
      pixelateRegion(ctx, rect, 10);
    } else {
      blurRegion(ctx, rect, 18);
    }
  }

  const redactedBoxCount = boxes.length;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  return { canvas, blob, redactedBoxCount };
}

function padRect(box, pad, maxW, maxH) {
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const w = Math.min(maxW - x, box.w + pad * 2);
  const h = Math.min(maxH - y, box.h + pad * 2);
  return { x, y, w, h };
}

function drawBlackbox(ctx, { x, y, w, h }) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(x, y, w, h);
}

/** Cheap, dependency-free box blur applied only within the ROI so we
 * never touch (and never need to re-read) the rest of the frame. */
function blurRegion(ctx, rect, radius) {
  const { x, y, w, h } = rect;
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  // filter-based blur is hardware accelerated in modern browsers
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(ctx.canvas, 0, 0);
  ctx.filter = "none";
  ctx.restore();
}

function pixelateRegion(ctx, rect, blockSize) {
  const { x, y, w, h } = rect;
  if (w <= 0 || h <= 0) return;
  const imgData = ctx.getImageData(x, y, w, h);
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.floor(w / blockSize));
  small.height = Math.max(1, Math.floor(h / blockSize));
  const sctx = small.getContext("2d");
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  tmp.getContext("2d").putImageData(imgData, 0, 0);
  sctx.drawImage(tmp, 0, 0, small.width, small.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
}

/** Produces a DOM summary with sensitive text values replaced by
 * type placeholders (e.g. "[EMAIL]") instead of raw content -- this
 * travels to the server ALONGSIDE the redacted image, giving the VLM
 * structural context without any PII. */
export function buildSanitizedDomSummary(root = document.body, sensitiveBoxes = []) {
  const clickable = Array.from(
    root.querySelectorAll("a, button, input, select, textarea, [role='button'], [onclick]")
  ).slice(0, 200);

  return clickable.map((el, i) => {
    const rect = el.getBoundingClientRect();
    const isSensitive = sensitiveBoxes.some((b) => rectsOverlap(rect, b));
    return {
      id: i,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || null,
      type: el.getAttribute("type") || null,
      text: isSensitive ? "[REDACTED]" : (el.innerText || el.value || "").slice(0, 60),
      box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      sensitive: isSensitive,
    };
  });
}

function rectsOverlap(r, b) {
  return !(r.right < b.x || r.left > b.x + b.w || r.bottom < b.y || r.top > b.y + b.h);
}
