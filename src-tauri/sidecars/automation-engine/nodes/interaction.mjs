// Interaction nodes: click, type.
// ctx = { logger, vars, artifactsDir, allowedSchemes }

const DEFAULT_TIMEOUT_MS = 30_000;

/** click: click an element by selector. */
export async function click(node, page, ctx) {
  const { selector, timeout, button, clickCount } = node.params ?? {};
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("click: selector is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  ctx.logger.info(node.id, `click → ${selector}`);
  await page.click(selector, {
    timeout: t,
    button: button ?? "left",
    clickCount: Number.isFinite(clickCount) ? clickCount : 1,
  });
}

/** type: fill text into an element. The typed VALUE is always masked in logs
 *  (#12) regardless of variable name, so keystrokes never leak. */
export async function type(node, page, ctx) {
  const { selector, text, timeout, delay } = node.params ?? {};
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("type: selector is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  // Never log `text` — it may be a password even if its var name isn't secret-like.
  ctx.logger.info(node.id, `type → <redacted> into ${selector}`);
  await page.waitForSelector(selector, { timeout: t });
  if (Number.isFinite(delay) && delay > 0) {
    await page.type(selector, String(text ?? ""), { delay });
  } else {
    await page.fill(selector, String(text ?? ""));
  }
}

export { DEFAULT_TIMEOUT_MS };
