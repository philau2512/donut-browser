// Utility nodes: screenshot, log, delay.
// ctx = { logger, vars, artifactsDir, allowedSchemes }

import { containArtifactPath, sanitizeFilenameFragment } from "../lib/safe-path.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;

/** screenshot: capture the page to a file INSIDE artifactsDir (#11 contained). */
export async function screenshot(node, page, ctx) {
  const { path: requested, fullPage } = node.params ?? {};
  // Default name when none given; sanitize any user-controlled fragment.
  const name = sanitizeFilenameFragment(
    requested && String(requested).trim() !== "" ? requested : `${node.id}.png`,
  );
  const dest = containArtifactPath(ctx.artifactsDir, name);
  ctx.logger.info(node.id, `screenshot → ${dest}`);
  await page.screenshot({ path: dest, fullPage: Boolean(fullPage) });
}

/** log: emit a message to the run log (already redacted by the logger). */
export async function log(node, page, ctx) {
  const { message, level } = node.params ?? {};
  const lvl = level === "warn" || level === "error" || level === "debug" ? level : "info";
  ctx.logger.emit(lvl, node.id, String(message ?? ""));
}

/** delay: pause for a fixed number of milliseconds. */
export async function delay(node, page, ctx) {
  const { ms } = node.params ?? {};
  const d = Number.isFinite(ms) ? ms : 1000;
  ctx.logger.info(node.id, `delay → ${d}ms`);
  await page.waitForTimeout(d);
}

export { DEFAULT_TIMEOUT_MS };
