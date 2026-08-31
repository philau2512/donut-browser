import { getLocatorRoot, getPage } from "../lib/execution-target.mjs";

const DEFAULT_TIMEOUT_MS = 60_000;

/** click: click an element by selector. */
export async function click(node, _page, ctx) {
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
export async function type(node, _page, ctx) {
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
export async function hover(node, _page, ctx) {
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
export async function dragAndDrop(node, _page, ctx) {
  const { sourceSelector, targetSelector, timeout } = node.params ?? {};
  if (typeof sourceSelector !== "string" || sourceSelector.trim() === "") {
    throw new Error("dragAndDrop: sourceSelector is required");
  }
  if (typeof targetSelector !== "string" || targetSelector.trim() === "") {
    throw new Error("dragAndDrop: targetSelector is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  const root = getLocatorRoot(ctx);
  ctx.logger.info(
    node.id,
    `dragAndDrop → ${sourceSelector} to ${targetSelector}`,
  );
  await root.dragAndDrop(sourceSelector, targetSelector, { timeout: t });
}

/** clickDown: press mouse button down on element */
export async function clickDown(node, _page, ctx) {
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
export async function clickUp(node, _page, ctx) {
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

/** moveAndClick: move mouse smoothly to element center then click.
 *  Persists final position in ctx.mouseX/ctx.mouseY so subsequent
 *  mouse nodes start from the last known position (human-like continuity).
 *  Uses Playwright page.mouse.move with `steps` intermediate points to
 *  fire real mousemove events — unlike root.click() which teleports. */
export async function moveAndClick(node, _page, ctx) {
  const { selector, timeout, button, steps } = node.params ?? {};

  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("moveAndClick: selector is required");
  }

  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  const btn = button ?? "left";
  // Clamp to at least 1 — 0 steps would be a raw teleport with no mousemove events
  const moveSteps = Math.max(1, Number.isFinite(steps) ? steps : 10);

  const root = getLocatorRoot(ctx);
  const pg = getPage(ctx);

  const element = await root.waitForSelector(selector, { timeout: t });
  // Ensure element is in viewport before measuring its position
  await element.scrollIntoViewIfNeeded();

  const box = await element.boundingBox();
  if (!box) {
    throw new Error(`moveAndClick: element "${selector}" has no bounding box`);
  }

  const targetX = box.x + box.width / 2;
  const targetY = box.y + box.height / 2;

  // Origin: last known virtual mouse position (Option B), default (0,0) on first use
  const startX = ctx.mouseX ?? 0;
  const startY = ctx.mouseY ?? 0;

  ctx.logger.info(
    node.id,
    `moveAndClick → ${selector} | (${Math.round(startX)},${Math.round(startY)}) → (${Math.round(targetX)},${Math.round(targetY)}) steps=${moveSteps}`,
  );

  // Sync Playwright's internal mouse state to our tracked position before moving,
  // preventing a jump if prior nodes used pg.mouse directly without updating ctx.mouseX/Y
  await pg.mouse.move(startX, startY, { steps: 1 });
  await pg.mouse.move(targetX, targetY, { steps: moveSteps });
  await pg.mouse.down({ button: btn });
  await pg.mouse.up({ button: btn });

  // Persist for subsequent mouse nodes
  ctx.mouseX = targetX;
  ctx.mouseY = targetY;
}
