/** getCookies: get cookies from browser context and save to variable */
export async function getCookies(node, page, ctx) {
  const { domain, saveToVar } = node.params ?? {};
  if (typeof saveToVar !== "string" || saveToVar.trim() === "") {
    throw new Error("getCookies: saveToVar is required");
  }

  ctx.logger.info(node.id, `getCookies${domain ? ` → domain: ${domain}` : ""} → save to ${saveToVar}`);

  const urls = domain ? [domain] : undefined;
  const cookies = await page.context().cookies(urls);
  const cookieJson = JSON.stringify(cookies);

  ctx.vars[saveToVar] = cookieJson;
  ctx.logger.info(node.id, `getCookies → saved ${cookies.length} cookies to ${saveToVar}`);
}

/** setCookies: set cookies from JSON string or variable */
export async function setCookies(node, page, ctx) {
  const { cookieJson } = node.params ?? {};
  if (typeof cookieJson !== "string" || cookieJson.trim() === "") {
    throw new Error("setCookies: cookieJson is required");
  }

  ctx.logger.info(node.id, `setCookies`);

  let cookies;
  try {
    cookies = JSON.parse(cookieJson);
  } catch (e) {
    throw new Error(`setCookies: invalid JSON - ${e.message}`);
  }

  if (!Array.isArray(cookies)) {
    throw new Error("setCookies: cookieJson must be an array");
  }

  // Validate each cookie has required Playwright fields
  const requiredFields = ["name", "value", "domain"];
  for (let i = 0; i < cookies.length; i++) {
    const cookie = cookies[i];
    if (!cookie || typeof cookie !== "object") {
      throw new Error(`setCookies: cookie[${i}] must be an object`);
    }
    for (const field of requiredFields) {
      if (!(field in cookie)) {
        throw new Error(`setCookies: cookie[${i}] missing required field "${field}"`);
      }
    }
  }

  await page.context().addCookies(cookies);
  ctx.logger.info(node.id, `setCookies → added ${cookies.length} cookies`);
}

/** clearCookies: clear all cookies from browser context */
export async function clearCookies(node, page, ctx) {
  ctx.logger.info(node.id, `clearCookies`);
  await page.context().clearCookies();
  ctx.logger.info(node.id, `clearCookies → cleared all cookies`);
}
