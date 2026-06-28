import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { NODE_SCHEMAS } from "../../lib/validate.mjs";
import { handlers, NODE_TYPES } from "../../nodes/index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTRY_PATH = join(ROOT, "hidemium-node-registry.json");

test("registry file exists and parses", () => {
  const raw = readFileSync(REGISTRY_PATH, "utf-8");
  const data = JSON.parse(raw);
  assert.ok(Array.isArray(data.nodes));
  assert.ok(data.nodes.length > 0);
});

test("every implemented registry entry has handler and schema", () => {
  const data = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
  const implemented = data.nodes.filter((n) => n.status === "implemented");
  for (const entry of implemented) {
    const type = entry.donutType;
    assert.ok(
      Object.prototype.hasOwnProperty.call(handlers, type),
      `missing handler for ${type} (${entry.hidemiumSlug})`,
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(NODE_SCHEMAS, type),
      `missing NODE_SCHEMAS for ${type}`,
    );
  }
});

test("handler keys match NODE_SCHEMAS (anti-drift)", () => {
  const schemaSet = new Set(Object.keys(NODE_SCHEMAS));
  const handlerSet = new Set(NODE_TYPES);
  for (const t of handlerSet) {
    assert.ok(schemaSet.has(t), `handler ${t} missing in NODE_SCHEMAS`);
  }
  for (const t of schemaSet) {
    assert.ok(handlerSet.has(t), `schema ${t} missing in handlers`);
  }
});