import { getLocatorRoot, getPage } from "../lib/execution-target.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;

/** click: click an element by selector. */
export async function click(node, page, ctx) {
  const { selector, timeout, button, clickCount } = node.params ?? {};
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("click: selector is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  const root = getLocatorRoot(ctx);
  ctx.logger.info(node.id, `click → ${selector}`);
  await root.click(selector, {
    timeout: t,
    button: button ?? "left",
    clickCount: Number.isFinite(clickCount) ? clickCount : 1,
  });
}

/** type: fill text into an element. The typed VALUE is always masked in logs */
export async function type(node, page, ctx) {
  const { selector, text, timeout, delay } = node.params ?? {};
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("type: selector is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  const root = getLocatorRoot(ctx);
  ctx.logger.info(node.id, `type → <redacted> into ${selector}`);
  await root.waitForSelector(selector, { timeout: t });
  if (Number.isFinite(delay) && delay > 0 && typeof root.type === "function") {
    await root.type(selector, String(text ?? ""), { delay });
  } else {
    await root.fill(selector, String(text ?? ""));
  }
}

/** hover: hover over an element */
export async function hover(node, page, ctx) {
  const { selector, timeout } = node.params ?? {};
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("hover: selector is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  const root = getLocatorRoot(ctx);
  ctx.logger.info(node.id, `hover → ${selector}`);
  await root.hover(selector, { timeout: t });
}

/** dragAndDrop: drag element from source to target */
export async function dragAndDrop(node, page, ctx) {
  const { sourceSelector, targetSelector, timeout } = node.params ?? {};
  if (typeof sourceSelector !== "string" || sourceSelector.trim() === "") {
    throw new Error("dragAndDrop: sourceSelector is required");
  }
  if (typeof targetSelector !== "string" || targetSelector.trim() === "") {
    throw new Error("dragAndDrop: targetSelector is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  const root = getLocatorRoot(ctx);
  ctx.logger.info(node.id, `dragAndDrop → ${sourceSelector} to ${targetSelector}`);
  await root.dragAndDrop(sourceSelector, targetSelector, { timeout: t });
}

/** clickDown: press mouse button down on element */
export async function clickDown(node, page, ctx) {
  const { selector, button, timeout } = node.params ?? {};
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("clickDown: selector is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  const btn = button ?? "left";
  const root = getLocatorRoot(ctx);
  const pg = getPage(ctx);
  ctx.logger.info(node.id, `clickDown → ${selector} (${btn})`);

  const element = await root.waitForSelector(selector, { timeout: t });
  const box = await element.boundingBox();
  if (!box) {
    throw new Error(`clickDown: element ${selector} has no bounding box`);
  }
  await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pg.mouse.down({ button: btn });
}

/** clickUp: release mouse button on element */
export async function clickUp(node, page, ctx) {
  const { selector, button, timeout } = node.params ?? {};
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("clickUp: selector is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  const btn = button ?? "left";
  const root = getLocatorRoot(ctx);
  const pg = getPage(ctx);
  ctx.logger.info(node.id, `clickUp → ${selector} (${btn})`);

  const element = await root.waitForSelector(selector, { timeout: t });
  const box = await element.boundingBox();
  if (!box) {
    throw new Error(`clickUp: element ${selector} has no bounding box`);
  }
  await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pg.mouse.up({ button: btn });
}