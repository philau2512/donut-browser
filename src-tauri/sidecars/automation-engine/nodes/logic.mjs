/** ifCondition: compare values and branch based on operator */
export async function ifCondition(node, page, ctx) {
  const { leftValue, operator, rightValue } = node.params ?? {};

  ctx.logger.info(node.id, `ifCondition → "${leftValue}" ${operator} "${rightValue}"`);

  let result = false;

  switch (operator) {
    case "===":
      result = leftValue === rightValue;
      break;
    case "!==":
      result = leftValue !== rightValue;
      break;
    case "contains":
      result = String(leftValue).includes(String(rightValue));
      break;
    case ">":
      result = Number(leftValue) > Number(rightValue);
      break;
    case "<":
      result = Number(leftValue) < Number(rightValue);
      break;
    default:
      throw new Error(`ifCondition: unknown operator "${operator}"`);
  }

  const outcome = result ? "true" : "false";
  ctx.logger.info(node.id, `ifCondition → ${outcome}`);
  return outcome;
}

/** loopFor: loop N times with index variable */
export async function loopFor(node, page, ctx) {
  const { times, indexVar } = node.params ?? {};
  const varName = indexVar || "index";
  const stateKey = `__loop_state_${node.id}`;

  // Initialize or retrieve state
  let state = ctx.vars[stateKey];
  if (!state) {
    state = { index: 0 };
    ctx.vars[stateKey] = state;
  }

  // Check if loop is done
  if (state.index >= times) {
    // Clean up state and exit
    delete ctx.vars[stateKey];
    ctx.logger.info(node.id, `loopFor → done (${times} iterations)`);
    return "done";
  }

  // Update index variable and increment state
  ctx.vars[varName] = state.index;
  state.index += 1;

  ctx.logger.info(node.id, `loopFor → loop (iteration ${state.index}/${times}, ${varName}=${ctx.vars[varName]})`);
  return "loop";
}

/** loopElements: loop through elements matched by selector */
export async function loopElements(node, page, ctx) {
  const { selector, elementVar } = node.params ?? {};
  const stateKey = `__loop_state_${node.id}`;

  try {
    // Initialize or retrieve state
    let state = ctx.vars[stateKey];
    if (!state) {
      // First iteration: get all elements
      const elements = await page.locator(selector).all();
      state = { elements, index: 0 };
      ctx.vars[stateKey] = state;
      ctx.logger.info(node.id, `loopElements → found ${elements.length} elements matching "${selector}"`);
    }

    // Check if loop is done
    if (state.index >= state.elements.length) {
      // Clean up state and exit
      delete ctx.vars[stateKey];
      ctx.logger.info(node.id, `loopElements → done (${state.elements.length} elements)`);
      return "done";
    }

    // Store current element index/selector in variable
    // Note: We can't pass the actual Locator object as a variable (it's not serializable)
    // Instead, store the index so subsequent nodes can use `${selector}:nth-child(${elementVar})`
    ctx.vars[elementVar] = state.index;
    state.index += 1;

    ctx.logger.info(node.id, `loopElements → loop (element ${state.index}/${state.elements.length}, ${elementVar}=${ctx.vars[elementVar]})`);
    return "loop";
  } catch (err) {
    // Clean up state on error to prevent stale state in next run
    delete ctx.vars[stateKey];
    throw err;
  }
}

/** evalJs: execute JavaScript code in page context */
export async function evalJs(node, page, ctx) {
  const { code, saveToVar } = node.params ?? {};

  if (typeof code !== "string" || code.trim() === "") {
    throw new Error("evalJs: code is required");
  }

  ctx.logger.info(node.id, `evalJs → executing${saveToVar ? ` (save to ${saveToVar})` : ""}`);

  const result = await page.evaluate(code);

  if (saveToVar) {
    // Store result in variables (serialize to JSON if object)
    if (typeof result === "object" && result !== null) {
      ctx.vars[saveToVar] = JSON.stringify(result);
    } else {
      ctx.vars[saveToVar] = String(result);
    }
    ctx.logger.info(node.id, `evalJs → saved result to ${saveToVar}`);
  }
}
