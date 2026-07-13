import { getLocatorRoot } from "../lib/execution-target.mjs";
import { matchFilter, resolveTabIndex } from "../lib/tab-match.mjs";
import { assertNavigableUrl } from "../lib/url-guard.mjs";

const DEFAULT_TIMEOUT_MS = 60_000;

/** openUrl: navigate the page to a URL, with optional retry on failure */
export async function openUrl(node, page, ctx) {
  const { url, timeout, waitUntil, retryOnFail, maxRetry, retrySleep } = node.params ?? {};
  const parsed = assertNavigableUrl(url, ctx.allowedSchemes);
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  const gotoOpts = { timeout: t, waitUntil: waitUntil ?? "load" };

  if (!retryOnFail) {
    ctx.logger.info(node.id, `openUrl → ${parsed.href}`);
    await page.goto(parsed.href, gotoOpts);
    return;
  }

  const attempts = Number.isFinite(maxRetry) && maxRetry > 0 ? maxRetry : 3;
  const sleepMs = Number.isFinite(retrySleep) && retrySleep >= 0 ? retrySleep : 1000;

  let lastError;
  for (let i = 0; i <= attempts; i++) {
    try {
      ctx.logger.info(node.id, `openUrl → ${parsed.href}${i > 0 ? ` (retry ${i}/${attempts})` : ""}`);
      await page.goto(parsed.href, gotoOpts);
      return;
    } catch (err) {
      lastError = err;
      if (i < attempts) {
        ctx.logger.warn(node.id, `openUrl failed (attempt ${i + 1}/${attempts + 1}), retrying in ${sleepMs}ms — ${err.message}`);
        if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
      }
    }
  }

  throw lastError;
}

/** scroll: scroll the page by (x,y) or to a selector */
export async function scroll(node, page, ctx) {
  const { x, y, selector } = node.params ?? {};
  const root = getLocatorRoot(ctx);
  if (selector) {
    ctx.logger.info(node.id, `scroll → into view: ${selector}`);
    const el = await root.waitForSelector(selector, { timeout: DEFAULT_TIMEOUT_MS });
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
    const root = getLocatorRoot(ctx);
    ctx.logger.info(node.id, `wait → selector: ${selector} (state=${state ?? "visible"})`);
    await root.waitForSelector(selector, { timeout: t, state: state ?? "visible" });
    return;
  }
  ctx.logger.info(node.id, `wait → ${t}ms`);
  await page.waitForTimeout(t);
}

/** newTab: open a new tab and switch ctx.page (Hidemium: next steps use URL) */
export async function newTab(node, page, ctx) {
  const { url, timeout } = node.params ?? {};
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  const context = page.context();

  ctx.logger.info(node.id, `newTab${url ? ` → ${url}` : ""}`);

  let newPage;
  if (typeof context.newPage === "function") {
    newPage = await context.newPage();
  } else {
    [newPage] = await Promise.all([
      context.waitForEvent("page", { timeout: t }),
      page.evaluate(() => window.open()),
    ]);
  }

  ctx.page = newPage;
  ctx.frame = null;

  if (url) {
    const parsed = assertNavigableUrl(url, ctx.allowedSchemes);
    await newPage.goto(parsed.href, { timeout: t, waitUntil: "load" });
  }

  return newPage;
}

/** Resolve target page for Active tab (Hidemium) filters. */
async function pickSwitchTabPage(allPages, params) {
  const {
    matchBy,
    matchValue,
    matchMode,
    // Legacy parameters for backward compatibility
    urlPattern,
    urlFilter,
    urlMode,
    titleFilter,
    titleMode,
  } = params ?? {};

  // If matchBy is present, use new logic. Otherwise, fall back to old logic.
  const urlNeedle = matchBy === "url" ? matchValue : (urlFilter ?? urlPattern);
  const urlMatchMode = matchBy === "url" ? (matchMode ?? "contain") : (urlMode ?? "contain");

  const titleNeedle = matchBy === "title" ? matchValue : titleFilter;
  const titleMatchMode = matchBy === "title" ? (matchMode ?? "contain") : (titleMode ?? "contain");

  let candidates = allPages;
  if (urlNeedle) {
    candidates = [];
    for (const p of allPages) {
      if (matchFilter(p.url(), urlNeedle, urlMatchMode)) candidates.push(p);
    }
  }
  if (titleNeedle) {
    const next = [];
    for (const p of candidates) {
      const title = await p.title();
      if (matchFilter(title, titleNeedle, titleMatchMode)) next.push(p);
    }
    candidates = next;
  }

  let idx = matchBy === "index" ? parseInt(matchValue, 10) : resolveTabIndex(params);
  if (isNaN(idx)) idx = null;
  
  if (idx != null) {
    if (candidates.length === 0) {
      const clamped = Math.max(0, Math.min(idx, allPages.length - 1));
      return allPages[clamped];
    }
    const clamped = Math.max(0, Math.min(idx, candidates.length - 1));
    return candidates[clamped];
  }

  if (candidates.length > 0) return candidates[0];
  return allPages[0];
}

/** switchTab / Active tab: Hidemium tab number (1-based) + URL/title filters */
export async function switchTab(node, page, ctx) {
  const params = node.params ?? {};
  const allPages = page.context().pages();

  if (allPages.length === 0) {
    throw new Error("switchTab: no pages available");
  }

  const targetPage = await pickSwitchTabPage(allPages, params);
  if (!targetPage) {
    throw new Error("switchTab: no matching tab");
  }

  ctx.logger.info(node.id, `switchTab → ${targetPage.url()}`);
  ctx.page = targetPage;
  ctx.frame = null;
  await targetPage.bringToFront();
  return targetPage;
}

/** closeTab: close current tab, switch to remaining tab if any */
/** closeTab: close current tab, select tab, or all other tabs */
export async function closeTab(node, page, ctx) {
  const { target, tabIndex } = node.params ?? {};
  const t = target ?? "current";

  if (t === "current") {
    ctx.logger.info(node.id, `closeTab → current (${page.url()})`);
    await page.close();
  } else if (t === "select") {
    const allPages = page.context().pages();
    const idx = Number.isFinite(tabIndex) ? tabIndex : 1;
    // index is 1-based usually in the UI, convert to 0-based
    const arrayIndex = Math.max(0, idx - 1);
    if (arrayIndex < allPages.length) {
      ctx.logger.info(node.id, `closeTab → index ${idx}`);
      await allPages[arrayIndex].close();
    } else {
      ctx.logger.warn(node.id, `closeTab → index ${idx} out of bounds`);
    }
  } else if (t === "other") {
    ctx.logger.info(node.id, `closeTab → other tabs`);
    const allPages = page.context().pages();
    for (const p of allPages) {
      if (p !== page) {
        await p.close();
      }
    }
  }

  // Update ctx.page if current was closed, or just ensure it's valid
  const remaining = page.context().pages();
  if (remaining.length > 0) {
    if (remaining.indexOf(page) === -1) {
      ctx.page = remaining[0];
      ctx.frame = null;
      await remaining[0].bringToFront();
    }
  } else {
    throw new Error("closeTab: no pages remaining in context (all tabs closed)");
  }
}

/** reloadPage: reload current page */
/** reloadPage: reload current page */
export async function reloadPage(node, page, ctx) {
  const { timeout } = node.params ?? {};
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  ctx.logger.info(node.id, `reloadPage → ${page.url()}`);
  await page.reload({ timeout: t, waitUntil: "load" });
}

/** goBack: navigate back in history */
export async function goBack(node, page, ctx) {
  const { timeout } = node.params ?? {};
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  ctx.logger.info(node.id, `goBack`);
  await page.goBack({ timeout: t, waitUntil: "load" });
}

/** goForward: navigate forward in history */
export async function goForward(node, page, ctx) {
  const { timeout } = node.params ?? {};
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  ctx.logger.info(node.id, `goForward`);
  await page.goForward({ timeout: t, waitUntil: "load" });
}

/** switchFrame: sub (iframe) or main — sets ctx.frame for subsequent selectors */
export async function switchFrame(node, page, ctx) {
  const { mode, selector, timeout } = node.params ?? {};
  const m = mode === "main" ? "main" : mode === "sub" ? "sub" : "sub";

  if (m === "main") {
    ctx.logger.info(node.id, `switchFrame → main`);
    ctx.frame = null;
    return;
  }

  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("switchFrame: selector is required for sub frame");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;

  ctx.logger.info(node.id, `switchFrame → sub ${selector}`);
  const frameElement = await page.waitForSelector(selector, { timeout: t });
  const frame = await frameElement.contentFrame();

  if (!frame) {
    throw new Error(`switchFrame: selector "${selector}" is not an iframe`);
  }

  ctx.frame = frame;
}