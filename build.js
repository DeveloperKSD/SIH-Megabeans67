/**
 * build.js — Downloads the transformers.js bundle into the extension
 * so it can be loaded locally inside the MV3 extension (CSP-safe).
 *
 * Run once:
 *   node build.js
 *
 * This downloads ~3MB of JS (transformers.min.js) into:
 *   extension/vision/transformers.min.js
 *
 * After running, reload the extension in chrome://extensions.
 * The vision model (YOLOS face/person detection) will then work fully on-device.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const TRANSFORMERS_VERSION = "3.5.2";
const PACKAGE = "@huggingface/transformers";
const CDN_URL = `https://cdn.jsdelivr.net/npm/${PACKAGE}@${TRANSFORMERS_VERSION}/dist/transformers.min.js`;
const OUT_PATH = path.join(__dirname, "extension", "vision", "transformers.min.js");

function download(url, dest) {
  return new Promise((resolve, reject) => {
    // Handle redirects
    const follow = (url) => {
      https.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return follow(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let received = 0;
        const file = fs.createWriteStream(dest);
        res.on("data", (chunk) => {
          received += chunk.length;
          if (total) {
            const pct = ((received / total) * 100).toFixed(0);
            process.stdout.write(`\r  Downloading… ${pct}% (${(received / 1e6).toFixed(1)} MB)`);
          }
        });
        res.pipe(file);
        file.on("finish", () => { file.close(); process.stdout.write("\n"); resolve(); });
        file.on("error", reject);
      }).on("error", reject);
    };
    follow(url);
  });
}

(async () => {
  console.log(`\n📦 Downloading @xenova/transformers@${TRANSFORMERS_VERSION} dist bundle…`);
  console.log(`   From: ${CDN_URL}`);
  console.log(`   To:   ${OUT_PATH}\n`);

  if (fs.existsSync(OUT_PATH)) {
    const size = fs.statSync(OUT_PATH).size;
    console.log(`✅ Already exists (${(size / 1e6).toFixed(1)} MB). Delete it to re-download.\n`);
    return;
  }

  try {
    await download(CDN_URL, OUT_PATH);
    const size = fs.statSync(OUT_PATH).size;
    console.log(`✅ Saved to ${OUT_PATH} (${(size / 1e6).toFixed(1)} MB)`);
    console.log("\n👉 Now reload the extension in chrome://extensions");
    console.log("   The on-device vision model (face/person detection) will work fully offline.\n");
  } catch (err) {
    console.error("❌ Download failed:", err.message);
    console.error("   Check your internet connection and try again.\n");
    process.exit(1);
  }
})();
