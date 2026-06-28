// Data Extraction handlers - Phase 5
// getText, getAttributeValue, getValue, elementExists, extractionInText, random

const DEFAULT_TIMEOUT_MS = 30_000;

/** getText: read text content of an element (direct text only, not nested) */
export async function getText(node, page, ctx) {
  const { selector, timeout, saveToVar } = node.params ?? {};
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("getText: selector is required");
  }
  if (typeof saveToVar !== "string" || saveToVar.trim() === "") {
    throw new Error("getText: saveToVar is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;

  ctx.logger.info(node.id, `getText → selector: ${selector}, save to ${saveToVar}`);
  const element = await page.waitForSelector(selector, { timeout: t });

  // Get direct text only (not nested descendants)
  const textContent = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return "";
    // Get only direct text nodes
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 3) { // TEXT_NODE
        text += node.textContent;
      }
    }
    return text.trim();
  }, selector);

  ctx.vars[saveToVar] = textContent;
  ctx.logger.info(node.id, `getText → saved ${textContent.length} chars to ${saveToVar}`);
}

/** getAttributeValue: read HTML attribute value */
export async function getAttributeValue(node, page, ctx) {
  const { selector, attribute, timeout, saveToVar } = node.params ?? {};
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("getAttributeValue: selector is required");
  }
  if (typeof attribute !== "string" || attribute.trim() === "") {
    throw new Error("getAttributeValue: attribute is required");
  }
  if (typeof saveToVar !== "string" || saveToVar.trim() === "") {
    throw new Error("getAttributeValue: saveToVar is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;

  ctx.logger.info(node.id, `getAttributeValue → selector: ${selector}, attr: ${attribute}`);
  const element = await page.waitForSelector(selector, { timeout: t });

  const value = await element.getAttribute(attribute);
  if (value === null) {
    throw new Error(`getAttributeValue: attribute "${attribute}" not found on element`);
  }

  ctx.vars[saveToVar] = value;
  ctx.logger.info(node.id, `getAttributeValue → saved "${value}" to ${saveToVar}`);
}

/** getValue: read value from input/textarea/select */
export async function getValue(node, page, ctx) {
  const { selector, timeout, saveToVar } = node.params ?? {};
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("getValue: selector is required");
  }
  if (typeof saveToVar !== "string" || saveToVar.trim() === "") {
    throw new Error("getValue: saveToVar is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;

  ctx.logger.info(node.id, `getValue → selector: ${selector}, save to ${saveToVar}`);
  const element = await page.waitForSelector(selector, { timeout: t });

  // Check element type
  const tagName = await element.evaluate(el => el.tagName.toLowerCase());
  if (!["input", "textarea", "select"].includes(tagName)) {
    throw new Error(`getValue: element is ${tagName}, not form input (input/textarea/select)`);
  }

  const value = await element.inputValue();
  ctx.vars[saveToVar] = value;
  ctx.logger.info(node.id, `getValue → saved "${value}" to ${saveToVar}`);
}

/** elementExists: check if element exists with visibility state */
export async function elementExists(node, page, ctx) {
  const { selector, timeout, visibility } = node.params ?? {};
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("elementExists: selector is required");
  }
  const t = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  const vis = visibility ?? "visible"; // default: visible

  ctx.logger.info(node.id, `elementExists → selector: ${selector}, visibility: ${vis}`);

  const count = await page.locator(selector).count();

  if (count === 0) {
    ctx.logger.info(node.id, `elementExists → false (not found)`);
    return "false";
  }

  // Check visibility if requested
  if (vis === "any") {
    ctx.logger.info(node.id, `elementExists → true (exists)`);
    return "true";
  }

  const element = page.locator(selector).first();
  const isVisible = await element.isVisible();

  if (vis === "visible") {
    const result = isVisible ? "true" : "false";
    ctx.logger.info(node.id, `elementExists → ${result} (visibility: ${vis})`);
    return result;
  }

  if (vis === "hidden") {
    const result = !isVisible ? "true" : "false";
    ctx.logger.info(node.id, `elementExists → ${result} (visibility: ${vis})`);
    return result;
  }

  throw new Error(`elementExists: invalid visibility value "${vis}" (expected: visible|hidden|any)`);
}

/** extractionInText: extract substring via regex, save full match (groups[0]) */
export async function extractionInText(node, page, ctx) {
  const { text, regex, saveToVar, flags } = node.params ?? {};
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("extractionInText: text is required");
  }
  if (typeof regex !== "string" || regex.trim() === "") {
    throw new Error("extractionInText: regex is required");
  }
  if (typeof saveToVar !== "string" || saveToVar.trim() === "") {
    throw new Error("extractionInText: saveToVar is required");
  }

  ctx.logger.info(node.id, `extractionInText → regex: ${regex}, flags: ${flags ?? "(none)"}`);

  let regexObj;
  try {
    regexObj = new RegExp(regex, flags ?? "");
  } catch (e) {
    throw new Error(`extractionInText: invalid regex - ${e.message}`);
  }

  const match = text.match(regexObj);
  if (!match) {
    ctx.logger.warn(node.id, `extractionInText → no match found`);
    ctx.vars[saveToVar] = "";
    return;
  }

  // Save full match (groups[0]), not capture groups
  const fullMatch = match[0];
  ctx.vars[saveToVar] = fullMatch;
  ctx.logger.info(node.id, `extractionInText → saved "${fullMatch}" to ${saveToVar}`);
}

/** random: generate random value (email, fullName, randomLetters, password, firstName, lastName, number) */
export async function random(node, page, ctx) {
  const { type, saveToVar, domain, quantity, length: len, min, max } = node.params ?? {};
  if (typeof type !== "string" || type.trim() === "") {
    throw new Error("random: type is required");
  }
  if (typeof saveToVar !== "string" || saveToVar.trim() === "") {
    throw new Error("random: saveToVar is required");
  }

  ctx.logger.info(node.id, `random → type: ${type}, save to ${saveToVar}`);

  let value = "";

  switch (type) {
    case "email": {
      if (typeof domain !== "string" || domain.trim() === "") {
        throw new Error("random: email type requires domain param");
      }
      const randomUser = Math.random().toString(36).substring(2, 10);
      value = `${randomUser}@${domain}`;
      break;
    }
    case "fullName":
      value = `User${Math.floor(Math.random() * 10000)}`;
      break;
    case "randomLetters": {
      if (!Number.isFinite(quantity) || quantity < 1) {
        throw new Error("random: randomLetters type requires quantity param (>= 1)");
      }
      const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      for (let i = 0; i < quantity; i++) {
        value += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      break;
    }
    case "password": {
      if (!Number.isFinite(len) || len < 1) {
        throw new Error("random: password type requires length param (>= 1)");
      }
      const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
      for (let i = 0; i < len; i++) {
        value += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      break;
    }
    case "firstName":
      value = `FirstName${Math.floor(Math.random() * 1000)}`;
      break;
    case "lastName":
      value = `LastName${Math.floor(Math.random() * 1000)}`;
      break;
    case "number": {
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        throw new Error("random: number type requires min and max params");
      }
      if (min > max) {
        throw new Error("random: min must be <= max");
      }
      value = String(Math.floor(Math.random() * (max - min + 1)) + min);
      break;
    }
    default:
      throw new Error(`random: unknown type "${type}" (expected: email|fullName|randomLetters|password|firstName|lastName|number)`);
  }

  ctx.vars[saveToVar] = value;
  ctx.logger.info(node.id, `random → generated "${type}" value to ${saveToVar}`);
}
