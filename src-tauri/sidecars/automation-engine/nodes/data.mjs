// Data handlers & Utilities - Phase 3
import { readFile, writeFile } from "node:fs/promises";
import { parse as parseCsv } from "csv-parse/sync";
import { stringify as stringifyCsv } from "csv-stringify/sync";
import { assertNavigableUrl } from "../lib/url-guard.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;

/** screenshot: capture a page image */
export async function screenshot(node, page, ctx) {
  const { path: p, fullPage } = node.params ?? {};
  // safePath resolves it inside ctx.artifactsDir (#10 check)
  const resolved = ctx.logger.safePath(p ?? "screenshot.png", ctx.artifactsDir);
  ctx.logger.info(node.id, `screenshot → ${resolved}`);
  await page.screenshot({
    path: resolved,
    fullPage: fullPage === true,
  });
}

/** log: output message to console logs */
export async function log(node, page, ctx) {
  const { message, level } = node.params ?? {};
  const msg = message ?? "";
  const lvl = level ?? "info";
  if (lvl === "error") {
    ctx.logger.error(node.id, msg);
  } else if (lvl === "warn") {
    ctx.logger.warn(node.id, msg);
  } else if (lvl === "debug") {
    ctx.logger.debug(node.id, msg);
  } else {
    ctx.logger.info(node.id, msg);
  }
}

/** delay: sleep for ms */
export async function delay(node, page, ctx) {
  const { ms } = node.params ?? {};
  const delayMs = Number.isFinite(ms) ? ms : 1000;
  ctx.logger.info(node.id, `delay → ${delayMs}ms`);
  await page.waitForTimeout(delayMs);
}

/** setVariable: store a variable in ctx.vars */
export async function setVariable(node, page, ctx) {
  const { name, value } = node.params ?? {};
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("setVariable: name is required");
  }

  ctx.logger.info(node.id, `setVariable → ${name} = "${value}"`);
  ctx.vars[name] = value;
}

/** readCsv: read CSV file and parse to JSON array */
export async function readCsv(node, page, ctx) {
  const { path, saveToVar } = node.params ?? {};
  if (typeof path !== "string" || path.trim() === "") {
    throw new Error("readCsv: path is required");
  }
  if (typeof saveToVar !== "string" || saveToVar.trim() === "") {
    throw new Error("readCsv: saveToVar is required");
  }

  // Use safePath to ensure file is within allowed directory
  const resolved = ctx.logger.safePath(path, ctx.artifactsDir);
  ctx.logger.info(node.id, `readCsv → reading ${resolved}`);

  const content = await readFile(resolved, "utf-8");
  const records = parseCsv(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  ctx.vars[saveToVar] = JSON.stringify(records);
  ctx.logger.info(node.id, `readCsv → saved ${records.length} rows to ${saveToVar}`);
}

/** writeCsv: write data (JSON array) to CSV file */
export async function writeCsv(node, page, ctx) {
  const { path, data } = node.params ?? {};
  if (typeof path !== "string" || path.trim() === "") {
    throw new Error("writeCsv: path is required");
  }
  if (typeof data !== "string" || data.trim() === "") {
    throw new Error("writeCsv: data is required");
  }

  // Use safePath to ensure file is within allowed directory
  const resolved = ctx.logger.safePath(path, ctx.artifactsDir);
  ctx.logger.info(node.id, `writeCsv → writing to ${resolved}`);

  let records;
  try {
    records = JSON.parse(data);
  } catch (e) {
    throw new Error(`writeCsv: invalid JSON data - ${e.message}`);
  }

  if (!Array.isArray(records)) {
    throw new Error("writeCsv: data must be a JSON array");
  }

  const csvContent = stringifyCsv(records, {
    header: true,
  });

  await writeFile(resolved, csvContent, "utf-8");
  ctx.logger.info(node.id, `writeCsv → wrote ${records.length} rows`);
}

/** downloadFile: download a file from URL to disk */
export async function downloadFile(node, page, ctx) {
  const { url, savePath, timeout } = node.params ?? {};
  if (typeof url !== "string" || url.trim() === "") {
    throw new Error("downloadFile: url is required");
  }
  if (typeof savePath !== "string" || savePath.trim() === "") {
    throw new Error("downloadFile: savePath is required");
  }

  // Validate URL scheme matches allowedSchemes (same guard as openUrl)
  const parsed = assertNavigableUrl(url, ctx.allowedSchemes);

  const t = Number.isFinite(timeout) ? timeout : 60000; // Default 60s for downloads
  const resolved = ctx.logger.safePath(savePath, ctx.artifactsDir);

  ctx.logger.info(node.id, `downloadFile → ${parsed.href} → ${resolved}`);

  // Use fetch to download the file
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), t);

  try {
    const response = await fetch(parsed.href, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(resolved, buffer);
    ctx.logger.info(node.id, `downloadFile → downloaded ${buffer.length} bytes`);
  } finally {
    clearTimeout(timeoutId);
  }
}
