import { test } from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../../nodes/index.mjs";

test("switchFrame main clears ctx.frame", async () => {
  const fakeFrame = { kind: "frame" };
  const page = { url: () => "https://main/" };
  const ctx = {
    page,
    frame: fakeFrame,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };

  await handlers.switchFrame(
    { id: "f", type: "switchFrame", params: { mode: "main" } },
    page,
    ctx,
  );
  assert.equal(ctx.frame, null);
});

test("switchFrame sub sets ctx.frame from contentFrame", async () => {
  const innerFrame = { click: async () => {} };
  const frameElement = {
    contentFrame: async () => innerFrame,
  };
  const page = {
    waitForSelector: async () => frameElement,
  };
  const ctx = {
    page,
    frame: null,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };

  await handlers.switchFrame(
    { id: "f", type: "switchFrame", params: { mode: "sub", selector: "#ifr" } },
    page,
    ctx,
  );
  assert.equal(ctx.frame, innerFrame);
});

test("click uses ctx.frame for selector after switchFrame sub", async () => {
  const clicks = [];
  const innerFrame = {
    click: async (sel, opts) => {
      clicks.push(["frame", sel, opts]);
    },
  };
  const page = {
    click: async () => {
      clicks.push(["page"]);
    },
  };
  const ctx = {
    page,
    frame: innerFrame,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };

  await handlers.click(
    { id: "c", type: "click", params: { selector: "#btn" } },
    page,
    ctx,
  );
  assert.deepEqual(clicks[0][0], "frame");
  assert.equal(clicks[0][1], "#btn");
});