/**
 * Resolves the active Playwright Page / Frame for automation handlers.
 * Navigator nodes update ctx.page; switchFrame (Phase 2) sets ctx.frame.
 */

/**
 * @param {{ page: import('playwright-core').Page, frame?: import('playwright-core').Frame | null }} ctx
 * @returns {import('playwright-core').Page}
 */
export function getPage(ctx) {
  if (!ctx?.page) {
    throw new Error("execution-target: ctx.page is required");
  }
  return ctx.page;
}

/**
 * Locator root for selector-based actions (frame when inside iframe, else page).
 * @param {object} ctx
 * @returns {import('playwright-core').Page | import('playwright-core').Frame}
 */
export function getLocatorRoot(ctx) {
  if (ctx.frame) return ctx.frame;
  return getPage(ctx);
}