import { test } from "node:test";
import assert from "node:assert/strict";
import { runFlow } from "../../engine.mjs";
import { Logger } from "../../lib/logger.mjs";
import { handlers } from "../../nodes/index.mjs";

test("runFlow passes updated ctx.page to handlers after switchTab", async () => {
  const pageA = { id: "A", url: () => "https://a.test/" };
  const pageB = { id: "B", url: () => "https://b.test/" };

  const context = {
    pages: () => [pageA, pageB],
    waitForEvent: async () => pageB,
  };

  const launchPage = {
    id: "launch",
    url: () => "https://launch.test/",
    context: () => context,
    evaluate: async () => {},
  };

  const seen = [];
  const originalSwitch = handlers.switchTab;
  handlers.switchTab = async (node, _pageArg, ctx) => {
    seen.push({ pageArgId: _pageArg?.id, ctxPageId: ctx.page?.id });
    ctx.page = pageB;
    return pageB;
  };

  try {
    const flow = {
      version: 1,
      name: "stick",
      nodes: [
        { id: "n1", type: "switchTab", params: { index: 1 } },
        { id: "n2", type: "log", params: { message: "done" } },
      ],
      edges: [{ from: "n1", to: "n2" }],
    };

    const logSeen = [];
    const originalLog = handlers.log;
    handlers.log = async (node, pageArg, ctx) => {
      logSeen.push({ pageArgId: pageArg?.id, ctxPageId: ctx.page?.id });
    };

    try {
      const logger = new Logger({
        runId: "r",
        profileId: "p",
        sink: () => {},
      });

      const failed = await runFlow({
        flow,
        page: launchPage,
        vars: {},
        artifactsDir: "/tmp",
        logger,
      });

      assert.equal(failed, false);
      assert.equal(seen.length, 1);
      assert.equal(logSeen.length, 1);
      assert.equal(logSeen[0].pageArgId, "B");
      assert.equal(logSeen[0].ctxPageId, "B");
    } finally {
      handlers.log = originalLog;
    }
  } finally {
    handlers.switchTab = originalSwitch;
  }
});