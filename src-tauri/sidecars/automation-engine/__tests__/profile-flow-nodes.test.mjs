import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFlow } from "../lib/validate.mjs";
import { handlers } from "../nodes/index.mjs";

test("openProfile and closeProfile handlers are registered", () => {
  assert.equal(typeof handlers.openProfile, "function");
  assert.equal(typeof handlers.closeProfile, "function");
});

test("validateFlow accepts minimal profile open/close flow", () => {
  const flow = validateFlow({
    version: 1,
    name: "profile-smoke",
    variables: { API_KEY: "x" },
    nodes: [
      { id: "n1", type: "openProfile", params: { profileId: "{{PROFILE_ID}}" } },
      { id: "n2", type: "closeProfile", params: { profileId: "{{PROFILE_ID}}", cleanupMode: "cookies" } },
    ],
    edges: [
      { from: "n1", to: "n2", sourceHandle: "success" },
    ],
  });
  assert.equal(flow.nodes.length, 2);
});

test("validateFlow accepts openProfile without profileId (uses run profile fallback)", () => {
  // profileId is optional — runtime falls back to AUTOMATION_RUN_PROFILE_ID
  const flow = validateFlow({
    version: 1,
    name: "settings-only",
    variables: {},
    nodes: [{ id: "n1", type: "openProfile", params: {} }],
    edges: [],
  });
  assert.equal(flow.nodes.length, 1);
});

test("validateFlow accepts openProfile with explicit profileId override", () => {
  const flow = validateFlow({
    version: 1,
    name: "explicit-profile",
    variables: {},
    nodes: [{ id: "n1", type: "openProfile", params: { profileId: "my-profile" } }],
    edges: [],
  });
  assert.equal(flow.nodes.length, 1);
});