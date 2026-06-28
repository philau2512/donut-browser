// Network & Advanced handlers — Phase 6
// http, setUserAgent, getUrl, convertingJson, imageSearch

import { readFile } from "node:fs/promises";
import { assertNavigableUrl } from "../lib/url-guard.mjs";
import { containArtifactPath } from "../lib/safe-path.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;

/** http: send an HTTP request and save response body to a variable */
export async function http(node, page, ctx) {
  const { url, method, headers, body, saveToVar, timeout } = node.params ?? {};
  if (typeof url !== "string" || url.trim() === "") {
    throw new Error("http: url is required");
  }
  const parsed = assertNavigableUrl(url, ctx.allowedSchemes);
  const m = (typeof method === "string" ? method : "GET").toUpperCase();
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;

  let parsedHeaders = {};
  if (typeof headers === "string" && headers.trim() !== "") {
    try {
      parsedHeaders = JSON.parse(headers);
      if (typeof parsedHeaders !== "object" || Array.isArray(parsedHeaders)) {
        throw new TypeError("headers must be a JSON object");
      }
    } catch (e) {
      throw new Error(`http: invalid headers JSON — ${e.message}`);
    }
  }

  ctx.logger.info(node.id, `http → ${m} ${parsed.href}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), t);

  let responseText;
  let status;
  try {
    const res = await fetch(parsed.href, {
      method: m,
      headers: parsedHeaders,
      // Only attach body for methods that support it
      body: body && !["GET", "HEAD"].includes(m) ? body : undefined,
      signal: controller.signal,
    });
    status = res.status;
    responseText = await res.text();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`http: request timed out after ${t}ms`);
    }
    throw new Error(`http: request failed — ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  ctx.logger.info(node.id, `http → ${status}, ${responseText.length} chars`);
  if (typeof saveToVar === "string" && saveToVar.trim() !== "") {
    ctx.vars[saveToVar] = responseText;
  }
}

/** setUserAgent: override the user agent for the current page via CDP */
export async function setUserAgent(node, page, ctx) {
  const { userAgent } = node.params ?? {};
  if (typeof userAgent !== "string" || userAgent.trim() === "") {
    throw new Error("setUserAgent: userAgent is required");
  }

  ctx.logger.info(node.id, `setUserAgent → ${userAgent.substring(0, 80)}…`);

  // Use CDP Network.setUserAgentOverride — the only reliable per-page UA setter
  // when connecting over CDP to an existing browser (Playwright context-level
  // userAgent option requires creation-time setup).
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Network.setUserAgentOverride", { userAgent });
  } finally {
    await client.detach().catch(() => {});
  }

  ctx.logger.info(node.id, "setUserAgent → applied");
}

/** getUrl: read the current page URL and save it to a variable */
export async function getUrl(node, page, ctx) {
  const { saveToVar } = node.params ?? {};
  if (typeof saveToVar !== "string" || saveToVar.trim() === "") {
    throw new Error("getUrl: saveToVar is required");
  }

  const url = page.url();
  ctx.vars[saveToVar] = url;
  ctx.logger.info(node.id, `getUrl → saved "${url}" to ${saveToVar}`);
}

/** convertingJson: parse JSON string → value, or stringify value → JSON string */
export async function convertingJson(node, page, ctx) {
  const { input, operation, saveToVar } = node.params ?? {};
  if (typeof input !== "string") {
    throw new Error("convertingJson: input is required");
  }
  if (operation !== "parse" && operation !== "stringify") {
    throw new Error(`convertingJson: operation must be "parse" or "stringify" (got: ${JSON.stringify(operation)})`);
  }
  if (typeof saveToVar !== "string" || saveToVar.trim() === "") {
    throw new Error("convertingJson: saveToVar is required");
  }

  ctx.logger.info(node.id, `convertingJson → operation: ${operation}`);

  if (operation === "parse") {
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch (e) {
      throw new Error(`convertingJson: invalid JSON input — ${e.message}`);
    }
    // Store as JSON string if object/array so downstream interpolation works
    ctx.vars[saveToVar] = typeof parsed === "object" && parsed !== null
      ? JSON.stringify(parsed)
      : String(parsed);
  } else {
    // stringify: treat input as the value to serialize
    ctx.vars[saveToVar] = JSON.stringify(input);
  }

  ctx.logger.info(node.id, `convertingJson → saved result to ${saveToVar}`);
}

/** imageSearch: find a reference image on the page via SAD template matching.
 *
 * Algorithm:
 *   1. Take a full-page PNG screenshot (in-memory buffer).
 *   2. Load the reference image from the artifacts directory.
 *   3. Slide the reference over the screenshot pixel-by-pixel, computing
 *      Sum of Absolute Differences (SAD) at each position.
 *   4. The position with the lowest normalised SAD becomes the match.
 *   5. Confidence = 1 − (minSAD / maxPossibleSAD). If confidence ≥ threshold
 *      the match is accepted.
 *
 * Result saved to saveToVar as JSON: { found: boolean, x: number, y: number, confidence: number }
 *
 * Requires: sharp (listed in package.json)
 */
export async function imageSearch(node, page, ctx) {
  const { imagePath, saveToVar, threshold } = node.params ?? {};
  if (typeof imagePath !== "string" || imagePath.trim() === "") {
    throw new Error("imageSearch: imagePath is required");
  }
  if (typeof saveToVar !== "string" || saveToVar.trim() === "") {
    throw new Error("imageSearch: saveToVar is required");
  }
  const matchThreshold = Number.isFinite(threshold) ? threshold : 0.9;

  // Validate reference image path is inside artifactsDir
  const safeImagePath = containArtifactPath(ctx.artifactsDir, imagePath);

  ctx.logger.info(node.id, `imageSearch → ref: ${safeImagePath}, threshold: ${matchThreshold}`);

  // Lazy-load sharp to keep startup fast when imageSearch is not used
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    throw new Error(
      "imageSearch: sharp module not found — run `npm install` in the automation-engine directory",
    );
  }

  // Take in-memory screenshot (no disk write needed)
  const screenshotBuf = await page.screenshot({ type: "png" });

  // Load reference image file
  let refBuf;
  try {
    refBuf = await readFile(safeImagePath);
  } catch (e) {
    throw new Error(`imageSearch: cannot read reference image "${imagePath}" — ${e.message}`);
  }

  // Decode both images to raw RGB (3 channels) for pixel comparison
  const { data: srcData, info: srcInfo } = await sharp(screenshotBuf)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data: refData, info: refInfo } = await sharp(refBuf)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: sw, height: sh, channels: sc } = srcInfo;
  const { width: rw, height: rh, channels: rc } = refInfo;

  if (rw > sw || rh > sh) {
    ctx.vars[saveToVar] = JSON.stringify({ found: false, x: 0, y: 0, confidence: 0 });
    ctx.logger.warn(node.id, "imageSearch → reference image larger than screenshot, no match possible");
    return;
  }

  const channels = Math.min(sc, rc, 3); // compare up to 3 channels (R, G, B)
  const maxSADPerPixel = 255 * channels;
  const maxSAD = maxSADPerPixel * rw * rh;

  let minSAD = Infinity;
  let bestX = 0;
  let bestY = 0;

  // Slide reference over source — O(sw*sh*rw*rh*channels)
  // For large images this can be slow; acceptable for automation use-case
  for (let y = 0; y <= sh - rh; y++) {
    for (let x = 0; x <= sw - rw; x++) {
      let sad = 0;
      outer: for (let ry = 0; ry < rh; ry++) {
        for (let rx = 0; rx < rw; rx++) {
          const srcIdx = ((y + ry) * sw + (x + rx)) * sc;
          const refIdx = (ry * rw + rx) * rc;
          for (let c = 0; c < channels; c++) {
            sad += Math.abs(srcData[srcIdx + c] - refData[refIdx + c]);
          }
          // Early-exit if already worse than current best
          if (sad >= minSAD) break outer;
        }
      }
      if (sad < minSAD) {
        minSAD = sad;
        bestX = x;
        bestY = y;
      }
    }
  }

  const confidence = maxSAD > 0 ? 1 - minSAD / maxSAD : 1;
  const found = confidence >= matchThreshold;

  ctx.logger.info(
    node.id,
    `imageSearch → found=${found} at (${bestX},${bestY}) confidence=${confidence.toFixed(4)}`,
  );
  ctx.vars[saveToVar] = JSON.stringify({ found, x: bestX, y: bestY, confidence });
}

