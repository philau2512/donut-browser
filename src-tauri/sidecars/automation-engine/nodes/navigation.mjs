// Navigation nodes: openUrl, scroll, wait.
// Each handler receives (node, page, ctx) and returns nothing (throws on error).
// ctx = { logger, vars, artifactsDir, allowedSchemes }

import { assertNavigableUrl } from "../lib/url-guard.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;

/** openUrl: navigate the page to a URL (scheme-allowlisted). */
export async function openUrl(node, page, ctx) {
  const { url, timeout, waitUntil } = node.params ?? {};
  // #10: reject non-http(s) schemes before touching the page.
  const parsed = assertNavigableUrl(url, ctx.allowedSchemes);
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  ctx.logger.info(node.id, `openUrl → ${parsed.href}`);
  await page.goto(parsed.href, {
    timeout: t,
    waitUntil: waitUntil ?? "load",
  });
}

/** scroll: scroll the page by (x,y) or to a selector. */
export async function scroll(node, page, ctx) {
  const { x, y, selector } = node.params ?? {};
  if (selector) {
    ctx.logger.info(node.id, `scroll → into view: ${selector}`);
    const el = await page.waitForSelector(selector, { timeout: DEFAULT_TIMEOUT_MS });
    await el.scrollIntoViewIfNeeded();
    return;
  }
  const dx = Number.isFinite(x) ? x : 0;
  const dy = Number.isFinite(y) ? y : 0;
  ctx.logger.info(node.id, `scroll → by (${dx}, ${dy})`);
  await page.evaluate(
    ([sx, sy]) => window.scrollBy(sx, sy),
    [dx, dy],
  );
}

/** wait: wait for a selector to appear (or a fixed time if no selector). */
export async function wait(node, page, ctx) {
  const { selector, timeout, state } = node.params ?? {};
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  if (selector) {
    ctx.logger.info(node.id, `wait → selector: ${selector} (state=${state ?? "visible"})`);
    await page.waitForSelector(selector, { timeout: t, state: state ?? "visible" });
    return;
  }
  ctx.logger.info(node.id, `wait → ${t}ms`);
  await page.waitForTimeout(t);
}

export { DEFAULT_TIMEOUT_MS };
