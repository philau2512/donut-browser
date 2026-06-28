// Integration tests for automation engine (Phase 4)
//
// Tests validate:
// 1. Flow validation for all fixtures
// 2. Branching logic (If conditions)
// 3. Nested loops with proper variable isolation
// 4. Infinite loop protection (MAX_STEPS)

import assert from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runFlow } from "../engine.mjs";
import { validateFlow } from "../lib/validate.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock page object for testing without real browser
function createMockPage() {
  const mockPage = {
    url: () => "https://test.example.com",
    goto: async () => {},
    click: async () => {},
    fill: async () => {},
    type: async () => {},
    waitForSelector: async () => mockPage,
    waitForTimeout: async () => {},
    evaluate: async (fn) => {
      if (typeof fn === "function") return fn();
      return null;
    },
    screenshot: async () => {},
    reload: async () => {},
    goBack: async () => {},
    goForward: async () => {},
    hover: async () => {},
    dragAndDrop: async () => {},
    focus: async () => {},
    keyboard: {
      press: async () => {},
    },
    mouse: {
      move: async () => {},
      down: async () => {},
      up: async () => {},
    },
    locator: (selector) => ({
      all: async () => [mockPage, mockPage, mockPage],
      boundingBox: async () => ({ x: 0, y: 0, width: 100, height: 50 }),
    }),
    context: () => ({
      pages: () => [mockPage],
      waitForEvent: async () => mockPage,
      cookies: async () => [],
      addCookies: async () => {},
      clearCookies: async () => {},
    }),
    close: async () => {},
    bringToFront: async () => {},
  };
  return mockPage;
}

// Mock logger for capturing logs
function createMockLogger() {
  const logs = [];
  return {
    logs,
    info: (nodeId, msg) => logs.push({ level: "info", nodeId, msg }),
    warn: (nodeId, msg) => logs.push({ level: "warn", nodeId, msg }),
    error: (nodeId, msg) => logs.push({ level: "error", nodeId, msg }),
    debug: (nodeId, msg) => logs.push({ level: "debug", nodeId, msg }),
    safePath: (path) => path,
  };
}

// Helper to load a fixture
async function loadFixture(filename) {
  const path = join(__dirname, "fixtures", filename);
  const content = await readFile(path, "utf-8");
  return JSON.parse(content);
}

test("Phase 4 Integration Tests", async (t) => {
  await t.test("should validate test-branching.donutflow", async () => {
    const flow = await loadFixture("test-branching.donutflow");
    const validated = validateFlow(flow);
    assert.ok(validated, "Flow should be valid");
    assert.strictEqual(validated.version, 1);
    assert.strictEqual(validated.name, "Test Branching");
  });

  await t.test("should validate test-nested-loops.donutflow", async () => {
    const flow = await loadFixture("test-nested-loops.donutflow");
    const validated = validateFlow(flow);
    assert.ok(validated, "Flow should be valid");
    assert.strictEqual(validated.version, 1);
    assert.strictEqual(validated.name, "Test Nested Loops");
  });

  await t.test("should validate test-infinite-loop.donutflow", async () => {
    const flow = await loadFixture("test-infinite-loop.donutflow");
    const validated = validateFlow(flow);
    assert.ok(validated, "Flow should be valid");
    assert.strictEqual(validated.version, 1);
  });

  await t.test("should execute branching flow and take true path", async () => {
    const flow = await loadFixture("test-branching.donutflow");
    const page = createMockPage();
    const logger = createMockLogger();
    const vars = {};
    const artifactsDir = "/tmp/test";

    const failed = await runFlow({
      flow,
      page,
      vars,
      artifactsDir,
      allowedSchemes: ["http:", "https:"],
      continueDefault: false,
      logger,
    });

    assert.strictEqual(failed, false, "Flow should complete successfully");

    // Check that Branch A was logged (true path)
    const branchALog = logger.logs.find(
      (log) => log.msg.includes("Branch A") && log.level === "info",
    );
    assert.ok(branchALog, "Should log Branch A for true condition");

    // Branch B should NOT be logged (false path not taken)
    const branchBLog = logger.logs.find((log) => log.msg.includes("Branch B"));
    assert.strictEqual(branchBLog, undefined, "Should not log Branch B");
  });

  await t.test("should execute nested loops correctly", async () => {
    const flow = await loadFixture("test-nested-loops.donutflow");
    const page = createMockPage();
    const logger = createMockLogger();
    const vars = {};
    const artifactsDir = "/tmp/test";

    const failed = await runFlow({
      flow,
      page,
      vars,
      artifactsDir,
      allowedSchemes: ["http:", "https:"],
      continueDefault: false,
      logger,
    });

    assert.strictEqual(failed, false, "Flow should complete successfully");

    // Should log 2 * 3 = 6 combinations (0-0, 0-1, 0-2, 1-0, 1-1, 1-2)
    const loopLogs = logger.logs.filter((log) => log.msg.match(/^\d+-\d+$/));
    assert.strictEqual(
      loopLogs.length,
      6,
      "Should log 6 combinations for 2x3 nested loops",
    );

    // Check that we have the expected combinations
    const expected = ["0-0", "0-1", "0-2", "1-0", "1-1", "1-2"];
    for (const combo of expected) {
      const found = loopLogs.some((log) => log.msg === combo);
      assert.ok(found, `Should log combination ${combo}`);
    }

    // Check that completion log exists
    const completionLog = logger.logs.find((log) =>
      log.msg.includes("completed"),
    );
    assert.ok(completionLog, "Should log completion message");
  });

  await t.test("should stop infinite loop after MAX_STEPS", async () => {
    const flow = await loadFixture("test-infinite-loop.donutflow");
    const page = createMockPage();
    const logger = createMockLogger();
    const vars = {};
    const artifactsDir = "/tmp/test";

    const failed = await runFlow({
      flow,
      page,
      vars,
      artifactsDir,
      allowedSchemes: ["http:", "https:"],
      continueDefault: false,
      logger,
    });

    // Should fail due to MAX_STEPS limit
    assert.strictEqual(failed, true, "Flow should fail due to infinite loop");

    // Check that the max steps error was logged
    const maxStepsLog = logger.logs.find(
      (log) => log.level === "error" && log.msg.includes("maximum step"),
    );
    assert.ok(maxStepsLog, "Should log max steps error");

    // Count loop iterations - should be around 500 (MAX_STEPS=1000, each iteration = 2 steps: loopFor + log)
    const loopIterations = logger.logs.filter((log) =>
      log.msg.includes("Loop iteration"),
    );
    assert.ok(
      loopIterations.length >= 450 && loopIterations.length <= 550,
      `Loop iterations should be around 500, got ${loopIterations.length}`,
    );
  });

  await t.test("should isolate loop variables in nested loops", async () => {
    const flow = await loadFixture("test-nested-loops.donutflow");
    const page = createMockPage();
    const logger = createMockLogger();
    const vars = {};
    const artifactsDir = "/tmp/test";

    await runFlow({
      flow,
      page,
      vars,
      artifactsDir,
      allowedSchemes: ["http:", "https:"],
      continueDefault: false,
      logger,
    });

    // After completion, loop state should be cleaned up
    const loopStateKeys = Object.keys(vars).filter((k) =>
      k.startsWith("__loop_state_"),
    );
    assert.strictEqual(
      loopStateKeys.length,
      0,
      "Loop state should be cleaned up after completion",
    );
  });
});
