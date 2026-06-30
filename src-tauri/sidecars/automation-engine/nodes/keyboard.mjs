import { getLocatorRoot, getPage } from "../lib/execution-target.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;

/** typeText: Hidemium Type text — global keyboard (focus field with Click first) */
export async function typeText(node, page, ctx) {
  const { text, delay, intervalMs } = node.params ?? {};
  const d = Number.isFinite(delay)
    ? delay
    : Number.isFinite(intervalMs)
      ? intervalMs
      : 0;
  const pg = getPage(ctx);
  ctx.logger.info(node.id, `typeText → <redacted>`);
  await pg.keyboard.type(String(text ?? ""), { delay: d });
}

/** sendTextToSelector: Hidemium Send text to selector — click then fill/type */
export async function sendTextToSelector(node, page, ctx) {
  const { selector, text, timeout, delay } = node.params ?? {};
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("sendTextToSelector: selector is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  const root = getLocatorRoot(ctx);
  ctx.logger.info(node.id, `sendTextToSelector → <redacted> into ${selector}`);
  await root.click(selector, { timeout: t });
  if (Number.isFinite(delay) && delay > 0 && typeof root.type === "function") {
    await root.type(selector, String(text ?? ""), { delay });
  } else {
    await root.fill(selector, String(text ?? ""));
  }
}

/** pressKey: press a keyboard key */
export async function pressKey(node, page, ctx) {
  const { key, selector } = node.params ?? {};
  if (typeof key !== "string" || key.trim() === "") {
    throw new Error("pressKey: key is required");
  }

  ctx.logger.info(node.id, `pressKey → ${key}${selector ? ` on ${selector}` : ""}`);

  const pg = getPage(ctx);
  if (selector) {
    const root = getLocatorRoot(ctx);
    await root.waitForSelector(selector, { timeout: DEFAULT_TIMEOUT_MS });
    await root.focus(selector);
  }

  await pg.keyboard.press(key);
}

/** clearInput: clear an input field */
export async function clearInput(node, page, ctx) {
  const { selector, timeout } = node.params ?? {};
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("clearInput: selector is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  const root = getLocatorRoot(ctx);

  ctx.logger.info(node.id, `clearInput → ${selector}`);
  await root.fill(selector, "", { timeout: t });
}