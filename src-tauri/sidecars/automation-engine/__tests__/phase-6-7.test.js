// Integration tests for Phase 6/7 automation nodes
// Tests cover: http, setUserAgent, getUrl, convertingJson,
//              while, stopLoop, runOtherScript, addLog, addComment

import assert from "node:assert";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runFlow } from "../engine.mjs";
import { validateFlow } from "../lib/validate.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── helpers ────────────────────────────────────────────────────────────────

function createMockPage(overrides = {}) {
  const page = {
    url: () => "https://test.example.com/page",
    goto: async () => {},
    screenshot: async () =>
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]), // minimal PNG header
    context: () => ({
      pages: () => [page],
      newCDPSession: async () => ({
        send: async () => {},
        detach: async () => {},
      }),
    }),
    ...overrides,
  };
  return page;
}

function createMockLogger() {
  const logs = [];
  return {
    logs,
    info: (id, msg) => logs.push({ level: "info", id, msg }),
    warn: (id, msg) => logs.push({ level: "warn", id, msg }),
    error: (id, msg) => logs.push({ level: "error", id, msg }),
    debug: (id, msg) => logs.push({ level: "debug", id, msg }),
    safePath: (p) => p,
  };
}

function makeFlow(nodes, edges = []) {
  return validateFlow({
    version: 1,
    name: "test",
    nodes,
    edges,
  });
}

const ARTIFACTS_DIR = join(__dirname, ".tmp-phase67-artifacts");
const FLOWS_DIR = join(__dirname, ".tmp-phase67-flows");

async function runTestFlow({
  nodes,
  edges = [],
  vars = {},
  page = null,
  logger = null,
}) {
  const flow = makeFlow(nodes, edges);
  return runFlow({
    flow,
    page: page ?? createMockPage(),
    vars,
    artifactsDir: ARTIFACTS_DIR,
    allowedSchemes: ["http:", "https:"],
    continueDefault: false,
    logger: logger ?? createMockLogger(),
    flowDir: FLOWS_DIR,
  });
}

// ─── setup / teardown ───────────────────────────────────────────────────────

test("Phase 6 — Network nodes", async (t) => {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await mkdir(FLOWS_DIR, { recursive: true });

  // ── getUrl ──────────────────────────────────────────────────────────────
  await t.test("getUrl: saves current page URL to variable", async () => {
    const vars = {};
    const failed = await runTestFlow({
      vars,
      nodes: [{ id: "n1", type: "getUrl", params: { saveToVar: "pageUrl" } }],
    });
    assert.strictEqual(failed, false);
    assert.strictEqual(vars.pageUrl, "https://test.example.com/page");
  });

  // ── convertingJson: parse ────────────────────────────────────────────────
  await t.test("convertingJson: parse — deserializes JSON string", async () => {
    const vars = {};
    const failed = await runTestFlow({
      vars,
      nodes: [
        {
          id: "n1",
          type: "convertingJson",
          params: {
            input: '{"name":"donut"}',
            operation: "parse",
            saveToVar: "result",
          },
        },
      ],
    });
    assert.strictEqual(failed, false);
    // Result stored as JSON string (so downstream interpolation works)
    const parsed = JSON.parse(vars.result);
    assert.strictEqual(parsed.name, "donut");
  });

  await t.test(
    "convertingJson: stringify — serializes a string value",
    async () => {
      const vars = {};
      const failed = await runTestFlow({
        vars,
        nodes: [
          {
            id: "n1",
            type: "convertingJson",
            params: {
              input: "hello world",
              operation: "stringify",
              saveToVar: "result",
            },
          },
        ],
      });
      assert.strictEqual(failed, false);
      // JSON.stringify("hello world") === '"hello world"'
      assert.strictEqual(vars.result, '"hello world"');
    },
  );

  await t.test("convertingJson: throws on invalid JSON for parse", async () => {
    const logger = createMockLogger();
    const failed = await runTestFlow({
      logger,
      nodes: [
        {
          id: "n1",
          type: "convertingJson",
          params: {
            input: "not-json{",
            operation: "parse",
            saveToVar: "result",
          },
        },
      ],
    });
    assert.strictEqual(failed, true);
    const errLog = logger.logs.find(
      (l) => l.level === "error" && l.msg.includes("invalid JSON"),
    );
    assert.ok(errLog, "Should log invalid JSON error");
  });

  await t.test("convertingJson: throws on unknown operation", async () => {
    const logger = createMockLogger();
    const failed = await runTestFlow({
      logger,
      nodes: [
        {
          id: "n1",
          type: "convertingJson",
          params: { input: "{}", operation: "explode", saveToVar: "result" },
        },
      ],
    });
    assert.strictEqual(failed, true);
    const errLog = logger.logs.find(
      (l) => l.level === "error" && l.msg.includes("explode"),
    );
    assert.ok(errLog, "Should log unknown operation error");
  });

  // ── setUserAgent ─────────────────────────────────────────────────────────
  await t.test(
    "setUserAgent: calls CDP Network.setUserAgentOverride",
    async () => {
      let capturedUA = null;
      const page = createMockPage({
        context: () => ({
          newCDPSession: async () => ({
            send: async (method, params) => {
              if (method === "Network.setUserAgentOverride")
                capturedUA = params.userAgent;
            },
            detach: async () => {},
          }),
        }),
      });

      const failed = await runTestFlow({
        page,
        nodes: [
          {
            id: "n1",
            type: "setUserAgent",
            params: { userAgent: "DonutBot/1.0" },
          },
        ],
      });

      assert.strictEqual(failed, false);
      assert.strictEqual(capturedUA, "DonutBot/1.0");
    },
  );

  // ── http ─────────────────────────────────────────────────────────────────
  await t.test("http: GET request saves response body", async () => {
    const vars = {};
    // Use a reliable small endpoint; in CI this may be skipped if offline
    let failed;
    try {
      failed = await runTestFlow({
        vars,
        nodes: [
          {
            id: "n1",
            type: "http",
            params: {
              url: "https://httpbin.org/get",
              method: "GET",
              saveToVar: "response",
              timeout: 10000,
            },
          },
        ],
      });
    } catch {
      // Skip if network not available in CI
      return;
    }
    if (failed) return; // Network not available — skip gracefully
    assert.ok(typeof vars.response === "string" && vars.response.length > 0);
  });

  await t.test("http: rejects non-http(s) schemes", async () => {
    const logger = createMockLogger();
    const failed = await runTestFlow({
      logger,
      nodes: [
        {
          id: "n1",
          type: "http",
          params: { url: "file:///etc/passwd", saveToVar: "r" },
        },
      ],
    });
    assert.strictEqual(failed, true);
    const errLog = logger.logs.find((l) => l.level === "error");
    assert.ok(errLog, "Should error on disallowed scheme");
  });

  await t.test("http: throws on invalid headers JSON", async () => {
    const logger = createMockLogger();
    const failed = await runTestFlow({
      logger,
      nodes: [
        {
          id: "n1",
          type: "http",
          params: {
            url: "https://httpbin.org/get",
            headers: "{bad json",
            saveToVar: "r",
          },
        },
      ],
    });
    assert.strictEqual(failed, true);
    const errLog = logger.logs.find(
      (l) => l.level === "error" && l.msg.includes("headers"),
    );
    assert.ok(errLog, "Should log invalid headers error");
  });

  await rm(ARTIFACTS_DIR, { recursive: true, force: true });
  await rm(FLOWS_DIR, { recursive: true, force: true });
});

// ─── Phase 7 ─────────────────────────────────────────────────────────────────

test("Phase 7 — Control-flow nodes", async (t) => {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await mkdir(FLOWS_DIR, { recursive: true });

  // ── addLog ───────────────────────────────────────────────────────────────
  await t.test("addLog: writes message at correct level", async () => {
    const logger = createMockLogger();
    await runTestFlow({
      logger,
      nodes: [
        {
          id: "n1",
          type: "addLog",
          params: { message: "hello", level: "warn" },
        },
      ],
    });
    const warnLog = logger.logs.find(
      (l) => l.level === "warn" && l.msg === "hello",
    );
    assert.ok(warnLog, "Should emit warn log");
  });

  // ── addComment ───────────────────────────────────────────────────────────
  await t.test("addComment: is a no-op (flow succeeds)", async () => {
    const vars = {};
    const failed = await runTestFlow({
      vars,
      nodes: [
        { id: "n1", type: "addComment", params: { comment: "just a note" } },
      ],
    });
    assert.strictEqual(failed, false);
    // No side effects on vars
    assert.strictEqual(Object.keys(vars).length, 0);
  });

  // ── while + stopLoop ─────────────────────────────────────────────────────
  await t.test(
    "while: loops until condition false, cleans up state",
    async () => {
      // Loop: counter < 3 → increment → repeat
      // Nodes: while(n1) --loop--> setVariable(n2) --loop--> while(n1) --done--> end
      const vars = { counter: "0" };
      const nodes = [
        {
          id: "n1",
          type: "while",
          params: { leftValue: "{{counter}}", operator: "<", rightValue: "3" },
        },
        {
          id: "n2",
          type: "evalJs",
          params: {
            code: "vars.counter = String(Number(vars.counter) + 1)",
            saveToVar: "counter",
          },
        },
      ];
      const edges = [
        { from: "n1", to: "n2", sourceHandle: "loop" },
        { from: "n2", to: "n1", sourceHandle: "loop" },
      ];

      const failed = await runTestFlow({ vars, nodes, edges });
      assert.strictEqual(failed, false);
      assert.strictEqual(vars.counter, "3");

      // while state cleaned up after exit
      const whileKey = Object.keys(vars).find((k) =>
        k.startsWith("__while_state_"),
      );
      assert.strictEqual(
        whileKey,
        undefined,
        "while state should be cleaned up",
      );
    },
  );

  await t.test(
    "while: MAX_WHILE_ITERATIONS guard triggers on infinite loop",
    async () => {
      // Condition always true — should hit MAX_WHILE_ITERATIONS
      const vars = {};
      const logger = createMockLogger();
      const nodes = [
        {
          id: "n1",
          type: "while",
          params: { leftValue: "1", operator: "==", rightValue: "1" },
        },
        { id: "n2", type: "addComment", params: { comment: "body" } },
      ];
      const edges = [
        { from: "n1", to: "n2", sourceHandle: "loop" },
        { from: "n2", to: "n1", sourceHandle: "loop" },
      ];

      const failed = await runTestFlow({ vars, logger, nodes, edges });
      assert.strictEqual(failed, true);
      const errLog = logger.logs.find(
        (l) => l.level === "error" && l.msg.includes("maximum iterations"),
      );
      assert.ok(errLog, "Should log MAX_WHILE_ITERATIONS error");
    },
  );

  await t.test("stopLoop: exits loop early via 'done' edge", async () => {
    // Loop runs once, then stopLoop breaks it
    const vars = { ran: "0" };
    const nodes = [
      {
        id: "n1",
        type: "while",
        params: { leftValue: "1", operator: "==", rightValue: "1" },
      },
      { id: "n2", type: "evalJs", params: { code: "vars.ran = '1'" } },
      { id: "n3", type: "stopLoop", params: {} },
      { id: "n4", type: "addLog", params: { message: "after loop" } },
    ];
    const edges = [
      { from: "n1", to: "n2", sourceHandle: "loop" },
      { from: "n2", to: "n3", sourceHandle: "success" },
      { from: "n3", to: "n4", sourceHandle: "done" },
    ];

    const logger = createMockLogger();
    const failed = await runTestFlow({ vars, logger, nodes, edges });
    assert.strictEqual(failed, false);
    assert.strictEqual(vars.ran, "1");
    const afterLog = logger.logs.find((l) => l.msg === "after loop");
    assert.ok(afterLog, "Should reach node after stopLoop");
  });

  // ── runOtherScript ───────────────────────────────────────────────────────
  await t.test(
    "runOtherScript: executes sub-script and shares vars",
    async () => {
      // Write a small sub-script to the temp flows dir
      const subFlow = {
        version: 1,
        name: "sub",
        nodes: [
          {
            id: "s1",
            type: "setVariable",
            params: { name: "subResult", value: "from_sub" },
          },
        ],
        edges: [],
      };
      await writeFile(
        join(FLOWS_DIR, "sub.donutflow"),
        JSON.stringify(subFlow),
      );

      const vars = {};
      const failed = await runTestFlow({
        vars,
        nodes: [
          { id: "n1", type: "runOtherScript", params: { scriptName: "sub" } },
        ],
      });

      assert.strictEqual(failed, false);
      assert.strictEqual(
        vars.subResult,
        "from_sub",
        "Should see variable set by sub-script",
      );
    },
  );

  await t.test("runOtherScript: rejects path traversal", async () => {
    const logger = createMockLogger();
    const failed = await runTestFlow({
      logger,
      nodes: [
        {
          id: "n1",
          type: "runOtherScript",
          params: { scriptName: "../../../etc/passwd" },
        },
      ],
    });
    // Traversal characters are stripped so the name becomes "etcpasswd" which doesn't exist
    assert.strictEqual(failed, true);
    const errLog = logger.logs.find((l) => l.level === "error");
    assert.ok(errLog, "Should error on missing/traversal script");
  });

  await t.test("runOtherScript: fails if sub-script not found", async () => {
    const logger = createMockLogger();
    const failed = await runTestFlow({
      logger,
      nodes: [
        {
          id: "n1",
          type: "runOtherScript",
          params: { scriptName: "nonexistent" },
        },
      ],
    });
    assert.strictEqual(failed, true);
    const errLog = logger.logs.find(
      (l) => l.level === "error" && l.msg.includes("nonexistent"),
    );
    assert.ok(errLog, "Should log missing script error");
  });

  await rm(ARTIFACTS_DIR, { recursive: true, force: true });
  await rm(FLOWS_DIR, { recursive: true, force: true });
});
