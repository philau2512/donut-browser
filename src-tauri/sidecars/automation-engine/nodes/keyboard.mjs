const DEFAULT_TIMEOUT_MS = 30_000;

/** pressKey: press a keyboard key */
export async function pressKey(node, page, ctx) {
  const { key, selector } = node.params ?? {};
  if (typeof key !== "string" || key.trim() === "") {
    throw new Error("pressKey: key is required");
  }

  ctx.logger.info(node.id, `pressKey → ${key}${selector ? ` on ${selector}` : ""}`);

  if (selector) {
    // Focus the element first, then press key
    await page.waitForSelector(selector, { timeout: DEFAULT_TIMEOUT_MS });
    await page.focus(selector);
  }

  await page.keyboard.press(key);
}

/** clearInput: clear an input field */
export async function clearInput(node, page, ctx) {
  const { selector, timeout } = node.params ?? {};
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("clearInput: selector is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;

  ctx.logger.info(node.id, `clearInput → ${selector}`);

  // Use Playwright's fill with empty string (most reliable)
  await page.fill(selector, "", { timeout: t });
}
