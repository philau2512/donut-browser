import { assertNavigableUrl } from "../lib/url-guard.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;

/** openUrl: navigate the page to a URL */
export async function openUrl(node, page, ctx) {
  const { url, timeout, waitUntil } = node.params ?? {};
  const parsed = assertNavigableUrl(url, ctx.allowedSchemes);
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  ctx.logger.info(node.id, `openUrl → ${parsed.href}`);
  await page.goto(parsed.href, {
    timeout: t,
    waitUntil: waitUntil ?? "load",
  });
}

/** scroll: scroll the page by (x,y) or to a selector */
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

/** wait: wait for a selector or fixed time */
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

/** newTab: open a new tab (window.open), switch context to it */
export async function newTab(node, page, ctx) {
  const { url, timeout } = node.params ?? {};
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;

  ctx.logger.info(node.id, `newTab${url ? ` → ${url}` : ""}`);

  // Listen for new page event before triggering window.open
  const [newPage] = await Promise.all([
    page.context().waitForEvent("page", { timeout: t }),
    page.evaluate(() => window.open()),
  ]);

  // Switch ctx.page reference to the new tab
  ctx.page = newPage;

  if (url) {
    const parsed = assertNavigableUrl(url, ctx.allowedSchemes);
    await newPage.goto(parsed.href, { timeout: t, waitUntil: "load" });
  }

  return newPage;
}

/** switchTab: switch to tab by index or urlPattern */
export async function switchTab(node, page, ctx) {
  const { index, urlPattern } = node.params ?? {};
  const allPages = page.context().pages();

  if (allPages.length === 0) {
    throw new Error("switchTab: no pages available");
  }

  let targetPage;
  if (Number.isFinite(index)) {
    const idx = Math.max(0, Math.min(index, allPages.length - 1));
    targetPage = allPages[idx];
    ctx.logger.info(node.id, `switchTab → index ${idx}`);
  } else if (urlPattern) {
    targetPage = allPages.find((p) => p.url().includes(urlPattern));
    if (!targetPage) {
      throw new Error(`switchTab: no page matching urlPattern "${urlPattern}"`);
    }
    ctx.logger.info(node.id, `switchTab → urlPattern "${urlPattern}"`);
  } else {
    // Default to first tab
    targetPage = allPages[0];
    ctx.logger.info(node.id, `switchTab → default (first tab)`);
  }

  ctx.page = targetPage;
  await targetPage.bringToFront();
  return targetPage;
}

/** closeTab: close current tab, switch to remaining tab if any */
export async function closeTab(node, page, ctx) {
  ctx.logger.info(node.id, `closeTab → ${page.url()}`);
  await page.close();

  const remaining = page.context().pages();
  if (remaining.length > 0) {
    ctx.page = remaining[0];
    await remaining[0].bringToFront();
  } else {
    // No pages left — throw instead of setting to null
    // This ensures subsequent handlers fail immediately with a clear error
    throw new Error("closeTab: no pages remaining in context (all tabs closed)");
  }
}

/** reloadPage: reload current page */
export async function reloadPage(node, page, ctx) {
  ctx.logger.info(node.id, `reloadPage → ${page.url()}`);
  await page.reload({ waitUntil: "load" });
}

/** goBack: navigate back in history */
export async function goBack(node, page, ctx) {
  ctx.logger.info(node.id, `goBack`);
  await page.goBack({ waitUntil: "load" });
}

/** goForward: navigate forward in history */
export async function goForward(node, page, ctx) {
  ctx.logger.info(node.id, `goForward`);
  await page.goForward({ waitUntil: "load" });
}

/** switchFrame: switch page context to iframe */
export async function switchFrame(node, page, ctx) {
  const { selector, timeout } = node.params ?? {};
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("switchFrame: selector is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;

  ctx.logger.info(node.id, `switchFrame → ${selector}`);
  const frameElement = await page.waitForSelector(selector, { timeout: t });
  const frame = await frameElement.contentFrame();

  if (!frame) {
    throw new Error(`switchFrame: selector "${selector}" is not an iframe`);
  }

  // Note: Playwright Frame objects are read-only and cannot directly replace Page.
  // This is a Phase 5 enhancement requiring architectural changes (frame-as-page wrapper or
  // separate frame-targeting handlers). For MVP, we validate the frame exists but cannot
  // yet switch page context to it. Handlers after switchFrame still target the main page.
  // TODO(Phase 5): Implement Frame-as-Page context switching or frame-aware handler variants.
  ctx.logger.warn(node.id, `switchFrame → frame found but context switch not yet implemented (MVP limitation)`);
}
