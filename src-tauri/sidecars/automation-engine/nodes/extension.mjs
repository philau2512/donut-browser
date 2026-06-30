/**
 * Extension popup handlers.
 *
 * Hidemium "Switch Extension popup" node allows automation to target
 * chrome-extension:// popup pages (e.g., for OAuth flows, 2FA extensions).
 *
 * Limitations (Wave 1 spike):
 * - Only works if the extension popup is already open in the browser context
 * - Popup discovery relies on URL pattern matching (chrome-extension://)
 * - May not work reliably with all extension popup implementations
 * - CDP/Playwright popup pages may have different lifecycle than regular tabs
 */

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * switchExtensionPopup: switch context to extension popup or back to main page.
 *
 * Params:
 *   mode: "popup" | "main"
 *   selector: CSS selector (required for "popup" mode to validate popup exists)
 *   timeout: ms (default 30000)
 */
export async function switchExtensionPopup(node, page, ctx) {
  const { mode, selector, timeout } = node.params ?? {};
  const m = mode === "main" ? "main" : "popup";
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;

  if (m === "main") {
    ctx.logger.info(node.id, "switchExtensionPopup → main page");
    // Find the first non-extension page
    const allPages = page.context().pages();
    const mainPage = allPages.find((p) => !p.url().startsWith("chrome-extension://")) || allPages[0];
    if (!mainPage) {
      throw new Error("switchExtensionPopup: no main page found");
    }
    ctx.page = mainPage;
    ctx.frame = null;
    await mainPage.bringToFront();
    return mainPage;
  }

  // mode === "popup"
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("switchExtensionPopup: selector is required for popup mode");
  }

  ctx.logger.info(node.id, `switchExtensionPopup → popup (selector: ${selector})`);

  const allPages = page.context().pages();
  const popupPage = allPages.find((p) => p.url().startsWith("chrome-extension://"));

  if (!popupPage) {
    throw new Error("switchExtensionPopup: no extension popup page found in context");
  }

  // Validate popup is ready by waiting for selector
  try {
    await popupPage.waitForSelector(selector, { timeout: t });
  } catch (err) {
    throw new Error(`switchExtensionPopup: popup did not contain selector "${selector}" within ${t}ms`);
  }

  ctx.page = popupPage;
  ctx.frame = null;
  await popupPage.bringToFront();
  return popupPage;
}