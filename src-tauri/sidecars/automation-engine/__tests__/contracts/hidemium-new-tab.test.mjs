import { test } from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../../nodes/index.mjs";

test("newTab: context.newPage + goto updates ctx.page", async () => {
  const gotoUrls = [];
  const newPage = {
    url: () => "https://example.com/",
    goto: async (href, _opts) => {
      gotoUrls.push(href);
    },
  };
  const context = {
    newPage: async () => newPage,
    waitForEvent: async () => {
      throw new Error("should not use waitForEvent when newPage path works");
    },
  };
  const launch = {
    context: () => context,
    evaluate: async () => {},
  };
  const ctx = {
    page: launch,
    frame: null,
    allowedSchemes: ["http:", "https:"],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };

  const out = await handlers.newTab(
    {
      id: "n",
      type: "newTab",
      params: { url: "https://example.com" },
    },
    launch,
    ctx,
  );

  assert.equal(out, newPage);
  assert.equal(ctx.page, newPage);
  assert.ok(gotoUrls[0].includes("example.com"));
});