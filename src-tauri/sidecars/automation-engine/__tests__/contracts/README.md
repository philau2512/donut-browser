# Hidemium parity contract tests

TDD fixtures comparing donut automation behavior to [Hidemium docs](https://docs.hidemium.io/automation-user-manual).

- `context-page-stick.test.mjs` — dispatcher uses current `ctx.page`
- `registry-drift.test.mjs` — `hidemium-node-registry.json` ↔ handlers/schemas

Wave 2+ adds Playwright HTML fixtures under this folder.