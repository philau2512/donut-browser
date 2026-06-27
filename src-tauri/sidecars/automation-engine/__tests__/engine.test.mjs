// Unit tests for the automation engine — run with `node --test`.
// No real browser: nodes are exercised against a mock page that records calls.

import { test } from "node:test";
import assert from "node:assert/strict";

import { interpolateString, interpolateParams } from "../lib/interpolate.mjs";
import { validateFlow, FlowValidationError } from "../lib/validate.mjs";
import { createRedactor, Logger } from "../lib/logger.mjs";
import { assertNavigableUrl, isAllowedUrlScheme } from "../lib/url-guard.mjs";
import { containArtifactPath, sanitizeFilenameFragment } from "../lib/safe-path.mjs";
import { topoOrder, runFlow } from "../engine.mjs";

// ---- interpolate ----------------------------------------------------------

test("interpolate replaces known vars", () => {
  assert.equal(
    interpolateString("u/{{PROFILE_ID}}", { PROFILE_ID: "abc" }),
    "u/abc",
  );
});

test("interpolate leaves unknown vars untouched (non-strict)", () => {
  assert.equal(interpolateString("{{NOPE}}", {}), "{{NOPE}}");
});

test("interpolate strict throws on unknown var", () => {
  assert.throws(() => interpolateString("{{NOPE}}", {}, { strict: true }));
});

test("interpolateParams recurses nested objects + arrays", () => {
  const out = interpolateParams(
    { url: "https://x/{{ID}}", list: ["{{ID}}", "static"] },
    { ID: "7" },
  );
  assert.deepEqual(out, { url: "https://x/7", list: ["7", "static"] });
});

// ---- validate (closed schema #7b) -----------------------------------------

const goodFlow = {
  version: 1,
  name: "t",
  nodes: [
    { id: "n1", type: "openUrl", params: { url: "https://example.com" } },
    { id: "n2", type: "click", params: { selector: "#go" }, continueOnError: true },
  ],
  edges: [{ from: "n1", to: "n2" }],
};

test("validate accepts a well-formed flow", () => {
  assert.equal(validateFlow(structuredClone(goodFlow)).name, "t");
});

test("validate rejects unknown node type", () => {
  const f = structuredClone(goodFlow);
  f.nodes[0].type = "evilEval";
  assert.throws(() => validateFlow(f), FlowValidationError);
});

test("validate rejects unknown param (closed schema)", () => {
  const f = structuredClone(goodFlow);
  f.nodes[0].params.script = "alert(1)";
  assert.throws(() => validateFlow(f), FlowValidationError);
});

test("validate rejects missing required param", () => {
  const f = structuredClone(goodFlow);
  delete f.nodes[0].params.url;
  assert.throws(() => validateFlow(f), FlowValidationError);
});

test("validate rejects hostile literal url scheme", () => {
  const f = structuredClone(goodFlow);
  f.nodes[0].params.url = "file:///etc/passwd";
  assert.throws(() => validateFlow(f), FlowValidationError);
});

test("validate rejects cycle", () => {
  const f = structuredClone(goodFlow);
  f.edges.push({ from: "n2", to: "n1" });
  assert.throws(() => validateFlow(f), FlowValidationError);
});

test("validate rejects wrong version", () => {
  const f = structuredClone(goodFlow);
  f.version = 2;
  assert.throws(() => validateFlow(f), FlowValidationError);
});

// ---- url-guard (#10) ------------------------------------------------------

test("url-guard allows http/https", () => {
  assert.ok(isAllowedUrlScheme("https://example.com"));
  assert.ok(isAllowedUrlScheme("http://example.com"));
});

test("url-guard rejects dangerous schemes", () => {
  for (const u of ["file:///x", "javascript:alert(1)", "chrome://settings", "data:text/html,x"]) {
    assert.equal(isAllowedUrlScheme(u), false, `should reject ${u}`);
  }
});

test("assertNavigableUrl throws on bad scheme", () => {
  assert.throws(() => assertNavigableUrl("file:///x"));
});

// ---- safe-path (#11) ------------------------------------------------------

test("containArtifactPath keeps file inside dir", () => {
  const base = process.platform === "win32" ? "C:\\runs\\a" : "/runs/a";
  const p = containArtifactPath(base, "shot.png");
  assert.ok(p.endsWith("shot.png"));
});

test("containArtifactPath rejects traversal", () => {
  const base = process.platform === "win32" ? "C:\\runs\\a" : "/runs/a";
  assert.throws(() => containArtifactPath(base, "../../etc/passwd"));
});

test("containArtifactPath rejects absolute path", () => {
  const base = process.platform === "win32" ? "C:\\runs\\a" : "/runs/a";
  const abs = process.platform === "win32" ? "C:\\Windows\\x" : "/etc/x";
  assert.throws(() => containArtifactPath(base, abs));
});

test("sanitizeFilenameFragment strips separators and dotdot", () => {
  // Result must contain no path separators and no parent-dir tokens; the exact
  // substitution count is an implementation detail, the safety properties are not.
  const cleaned = sanitizeFilenameFragment("../../evil");
  assert.ok(!cleaned.includes("/"));
  assert.ok(!cleaned.includes("\\"));
  assert.ok(!cleaned.includes(".."));
  assert.ok(cleaned.endsWith("evil"));
  assert.ok(!sanitizeFilenameFragment("a/b\\c").includes("/"));
  assert.ok(!sanitizeFilenameFragment("a/b\\c").includes("\\"));
});

// ---- logger redaction (#12) -----------------------------------------------

test("redactor masks secret-named var values", () => {
  const redact = createRedactor({ MY_PASSWORD: "hunter2", PROFILE_ID: "x" });
  const out = redact("logging in with hunter2 now");
  assert.ok(!out.includes("hunter2"));
  assert.ok(out.includes("<redacted>"));
});

test("redactor leaves non-secret vars intact", () => {
  const redact = createRedactor({ PROFILE_ID: "abc" });
  assert.equal(redact("profile abc"), "profile abc");
});

test("logger emits one json line with redaction", () => {
  const lines = [];
  const logger = new Logger({
    runId: "r1",
    profileId: "p1",
    redact: createRedactor({ TOKEN: "sekret" }),
    sink: (l) => lines.push(l),
  });
  logger.info("n1", "using sekret value");
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.runId, "r1");
  assert.equal(rec.nodeId, "n1");
  assert.equal(rec.level, "info");
  assert.ok(!rec.msg.includes("sekret"));
});

// ---- walk order + continue-on-error ---------------------------------------

test("topoOrder follows edges from root", () => {
  const flow = {
    version: 1,
    name: "t",
    nodes: [
      { id: "a", type: "log", params: { message: "a" } },
      { id: "b", type: "log", params: { message: "b" } },
      { id: "c", type: "log", params: { message: "c" } },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ],
  };
  assert.deepEqual(topoOrder(flow).map((n) => n.id), ["a", "b", "c"]);
});

function mockPage() {
  return {
    calls: [],
    async goto(url) {
      this.calls.push(["goto", url]);
    },
    async click(sel) {
      this.calls.push(["click", sel]);
    },
    async fill(sel, text) {
      this.calls.push(["fill", sel, text]);
    },
    async type(sel, text) {
      this.calls.push(["type", sel, text]);
    },
    async waitForSelector(sel) {
      this.calls.push(["waitForSelector", sel]);
      return { async scrollIntoViewIfNeeded() {} };
    },
    async waitForTimeout(ms) {
      this.calls.push(["waitForTimeout", ms]);
    },
    async evaluate() {
      this.calls.push(["evaluate"]);
    },
    async screenshot(opts) {
      this.calls.push(["screenshot", opts.path]);
    },
  };
}

function collectLogger() {
  const lines = [];
  const logger = new Logger({
    runId: "r",
    profileId: "p",
    sink: (l) => lines.push(JSON.parse(l)),
  });
  return { logger, lines };
}

test("runFlow runs all nodes in order on success", async () => {
  const flow = {
    version: 1,
    name: "t",
    nodes: [
      { id: "n1", type: "openUrl", params: { url: "https://example.com" } },
      { id: "n2", type: "log", params: { message: "hi {{PROFILE_ID}}" } },
    ],
    edges: [{ from: "n1", to: "n2" }],
  };
  const page = mockPage();
  const { logger, lines } = collectLogger();
  const failed = await runFlow({
    flow,
    page,
    vars: { PROFILE_ID: "42" },
    artifactsDir: process.platform === "win32" ? "C:\\tmp" : "/tmp",
    logger,
  });
  assert.equal(failed, false);
  assert.deepEqual(page.calls[0], ["goto", "https://example.com/"]);
  // interpolation reached the log node
  assert.ok(lines.some((l) => l.msg.includes("hi 42")));
});

test("runFlow stops on error when continueOnError=false", async () => {
  const flow = {
    version: 1,
    name: "t",
    nodes: [
      { id: "n1", type: "openUrl", params: { url: "https://example.com" } },
      { id: "n2", type: "log", params: { message: "after" } },
    ],
    edges: [{ from: "n1", to: "n2" }],
  };
  const page = mockPage();
  page.goto = async () => {
    throw new Error("nav boom");
  };
  const { logger, lines } = collectLogger();
  const failed = await runFlow({ flow, page, vars: {}, artifactsDir: "/tmp", logger });
  assert.equal(failed, true);
  // n2 must NOT have run
  assert.ok(!lines.some((l) => l.nodeId === "n2" && l.msg.includes("after")));
});

test("runFlow continues past error when continueOnError=true", async () => {
  const flow = {
    version: 1,
    name: "t",
    nodes: [
      { id: "n1", type: "openUrl", params: { url: "https://example.com" }, continueOnError: true },
      { id: "n2", type: "log", params: { message: "after" } },
    ],
    edges: [{ from: "n1", to: "n2" }],
  };
  const page = mockPage();
  page.goto = async () => {
    throw new Error("nav boom");
  };
  const { logger, lines } = collectLogger();
  const failed = await runFlow({ flow, page, vars: {}, artifactsDir: "/tmp", logger });
  assert.equal(failed, false);
  assert.ok(lines.some((l) => l.level === "warn"));
  assert.ok(lines.some((l) => l.nodeId === "n2" && l.msg.includes("after")));
});

test("type node never logs the typed text (#12)", async () => {
  const flow = {
    version: 1,
    name: "t",
    nodes: [{ id: "n1", type: "type", params: { selector: "#pw", text: "{{MY_PASSWORD}}" } }],
    edges: [],
  };
  const page = mockPage();
  const { logger, lines } = collectLogger();
  await runFlow({
    flow,
    page,
    vars: { MY_PASSWORD: "hunter2" },
    artifactsDir: "/tmp",
    logger,
  });
  // The value was filled into the page…
  assert.ok(page.calls.some((c) => c[0] === "fill" && c[2] === "hunter2"));
  // …but never appears in any log line.
  assert.ok(!lines.some((l) => l.msg.includes("hunter2")));
});
