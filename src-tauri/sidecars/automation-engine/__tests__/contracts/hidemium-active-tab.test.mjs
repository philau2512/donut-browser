import { test } from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../../nodes/index.mjs";
import { matchFilter, resolveTabIndex } from "../../lib/tab-match.mjs";

test("matchFilter contain and equal", () => {
  assert.equal(matchFilter("https://www.facebook.com/", "facebook", "contain"), true);
  assert.equal(matchFilter("https://www.facebook.com/", "twitter", "contain"), false);
  assert.equal(
    matchFilter("https://www.facebook.com/", "https://www.facebook.com/", "equal"),
    true,
  );
});

test("resolveTabIndex: tabIndex 1-based vs index 0-based", () => {
  assert.equal(resolveTabIndex({ tabIndex: 1 }), 0);
  assert.equal(resolveTabIndex({ tabIndex: 2 }), 1);
  assert.equal(resolveTabIndex({ index: 0 }), 0);
  assert.equal(resolveTabIndex({}), null);
});

test("switchTab: tabIndex 1 + url contain selects second matching page", async () => {
  const page0 = {
    url: () => "https://google.com/",
    title: async () => "Google",
    bringToFront: async () => {},
  };
  const page1 = {
    url: () => "https://www.facebook.com/",
    title: async () => "Facebook",
    bringToFront: async () => {},
  };
  const context = { pages: () => [page0, page1] };
  const launch = { context: () => context };

  const ctx = {
    page: launch,
    frame: null,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };

  const out = await handlers.switchTab(
    {
      id: "t",
      type: "switchTab",
      params: {
        tabIndex: 2,
        urlFilter: "facebook",
        urlMode: "contain",
      },
    },
    launch,
    ctx,
  );

  assert.equal(out, page1);
  assert.equal(ctx.page, page1);
});

test("switchTab: title contain filter", async () => {
  const pages = [
    { url: () => "https://a/", title: async () => "Shop", bringToFront: async () => {} },
    { url: () => "https://b/", title: async () => "Facebook Home", bringToFront: async () => {} },
  ];
  const context = { pages: () => pages };
  const launch = { context: () => context };
  const ctx = {
    page: launch,
    frame: null,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };

  await handlers.switchTab(
    {
      id: "t",
      type: "switchTab",
      params: { titleFilter: "Facebook", titleMode: "contain" },
    },
    launch,
    ctx,
  );
  assert.equal(ctx.page.url(), "https://b/");
});