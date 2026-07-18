# Γ¢ö ABSOLUTE GIT RULE ΓÇö READ FIRST (2026-06-11)

**NEVER run any git command that modifies git history OR the working tree, in ANY repo** (wayfern, wayfern-macos, wayfern-test, donutbrowser, build/src), **unless the user EXPLICITLY authorizes that exact command.** Forbidden without per-command authorization: `commit`, `revert`, `cherry-pick`, `restore`, `checkout` (files/branches), `reset`, `rebase`, `merge`, `stash`, `clean`, `apply`, `add`, `rm`, `push`, any force op. Only read-only git (`status`, `log`, `show`, `diff`, `ls-files`, `rev-parse`) is allowed without asking. **Authorization is per-command: 1 explicit authorization = exactly 1 command.** If a git mutation seems needed, STOP and ask for that one command.

---

# Project Guidelines

> **NOTE**: CLAUDE.md is a symlink to AGENTS.md ΓÇö editing either file updates both.
> After significant changes (new modules, renamed files, new directories), re-evaluate the Repository Structure below and update it if needed.

## Repository Structure

```
donutbrowser/
Γö£ΓöÇΓöÇ src/                              # Next.js frontend
Γöé   Γö£ΓöÇΓöÇ app/                          # App router (page.tsx, layout.tsx)
Γöé   Γö£ΓöÇΓöÇ components/                   # 160+ React components organized by domain
Γöé   Γöé   Γö£ΓöÇΓöÇ app-shell/               # App shell, tray, window chrome
Γöé   Γöé   Γö£ΓöÇΓöÇ cookie/                  # Cookie management UI
Γöé   Γöé   Γö£ΓöÇΓöÇ extension/               # Extension management UI
Γöé   Γöé   Γö£ΓöÇΓöÇ group/                   # Profile group UI
Γöé   Γöé   Γö£ΓöÇΓöÇ home/                    # Main profiles list + sub-components
Γöé   Γöé   Γö£ΓöÇΓöÇ icons/                   # Icon components
Γöé   Γöé   Γö£ΓöÇΓöÇ navigation/              # Sidebar navigation
Γöé   Γöé   Γö£ΓöÇΓöÇ onboarding/              # First-run onboarding
Γöé   Γöé   Γö£ΓöÇΓöÇ profile/                 # Profile dialogs + camoufox config
Γöé   Γöé   Γö£ΓöÇΓöÇ proxy/                   # Proxy management UI
Γöé   Γöé   Γö£ΓöÇΓöÇ settings/                # Settings pages
Γöé   Γöé   Γö£ΓöÇΓöÇ shared/                  # Shared/reusable components
Γöé   Γöé   Γö£ΓöÇΓöÇ sync/                    # Cloud sync UI
Γöé   Γöé   Γö£ΓöÇΓöÇ ui/                      # shadcn/ui primitives
Γöé   Γöé   ΓööΓöÇΓöÇ vpn/                     # VPN management UI
Γöé   Γö£ΓöÇΓöÇ hooks/                        # Event-driven React hooks
Γöé   Γö£ΓöÇΓöÇ i18n/locales/                 # Translations (en, es, fr, ja, ko, pt, ru, vi, zh)
Γöé   Γö£ΓöÇΓöÇ lib/                          # Utilities (themes, toast, browser-utils, shortcuts)
Γöé   ΓööΓöÇΓöÇ types.ts                      # Shared TypeScript interfaces
Γö£ΓöÇΓöÇ src-tauri/                        # Rust backend (Tauri)
Γöé   Γö£ΓöÇΓöÇ src/
Γöé   Γöé   Γö£ΓöÇΓöÇ lib.rs                    # Tauri command registration entry point
Γöé   Γöé   Γö£ΓöÇΓöÇ lib_commands_proxy.rs     # Proxy/VPN/MCP Tauri commands
Γöé   Γöé   Γö£ΓöÇΓöÇ lib_commands_sync.rs      # Sync/VPN connect Tauri commands
Γöé   Γöé   Γö£ΓöÇΓöÇ lib_commands_tray.rs      # Tray menu Tauri commands
Γöé   Γöé   Γö£ΓöÇΓöÇ lib_run.rs                # Tauri app builder (run())
Γöé   Γöé   Γö£ΓöÇΓöÇ lib_setup.rs              # Tauri .setup() handler
Γöé   Γöé   Γö£ΓöÇΓöÇ api/                      # REST API (utoipa + axum)
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ api_server.rs         # Server setup + middleware
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ api_server_profile_handlers*.rs  # Profile CRUD endpoints
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ api_server_proxy_handlers.rs     # Proxy/VPN endpoints
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ api_server_run_handlers.rs       # Browser run/batch endpoints
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ api_client.rs         # Browser release API client
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ cloud_auth.rs         # Cloud auth manager + methods + commands
Γöé   Γöé   Γöé   ΓööΓöÇΓöÇ mod.rs
Γöé   Γöé   Γö£ΓöÇΓöÇ browser/                  # Browser management (all split into modules)
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ browser_runner*.rs    # Launch/kill orchestration (split)
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ browser.rs            # Browser trait + BrowserType
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ browser_version_manager*.rs  # Version fetching
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ camoufox_manager*.rs  # Camoufox process management
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ camoufox/             # Config, fingerprint, geolocation
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ downloaded_browsers_registry*.rs  # Installed browser tracking
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ downloader*.rs        # Binary downloader + progress
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ extraction*.rs        # Archive extraction (zip/tar/dmg/msi)
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ extension_manager*.rs # Extension management
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ platform_browser*.rs  # Platform-specific process launch/kill
Γöé   Γöé   Γöé   ΓööΓöÇΓöÇ wayfern_manager*.rs   # Wayfern (Chromium) process management
Γöé   Γöé   Γö£ΓöÇΓöÇ mcp/                      # MCP protocol server
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ server.rs             # MCP server core
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ tools*.rs             # Tool definitions (split)
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ mcp_integrations.rs   # Claude Desktop integrations
Γöé   Γöé   Γöé   ΓööΓöÇΓöÇ handlers/             # profiles*.rs, integrations*.rs, proxies_groups*.rs
Γöé   Γöé   Γö£ΓöÇΓöÇ profile/                  # Profile CRUD + password (all split)
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ manager*.rs           # ProfileManager (6 files)
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ cookie_manager*.rs    # Cookie import/export
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ password*.rs          # Profile encryption
Γöé   Γöé   Γöé   ΓööΓöÇΓöÇ encryption.rs, group_manager.rs, types.rs, ...
Γöé   Γöé   Γö£ΓöÇΓöÇ proxy/                    # Local proxy infrastructure
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ proxy_manager/        # ProxyManager (connection, crud, lifecycle)
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ proxy_server*.rs      # HTTP/SOCKS proxy server (split)
Γöé   Γöé   Γöé   ΓööΓöÇΓöÇ traffic_stats*.rs, socks5_local.rs, proxy_runner.rs, ...
Γöé   Γöé   Γö£ΓöÇΓöÇ settings/                 # App settings (app_dirs, manager, commands, types)
Γöé   Γöé   Γö£ΓöÇΓöÇ sync/                     # Cloud sync engine
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ engine/               # Sync engine modules
Γöé   Γöé   Γöé   ΓööΓöÇΓöÇ manifest*.rs, scheduler*.rs, synchronizer*.rs, client.rs, ...
Γöé   Γöé   Γö£ΓöÇΓöÇ updater/                  # Auto-updater
Γöé   Γöé   Γöé   Γö£ΓöÇΓöÇ app_auto_updater/     # In-app update flow (split)
Γöé   Γöé   Γöé   ΓööΓöÇΓöÇ auto_updater/, version_updater.rs, geoip_downloader.rs
Γöé   Γöé   ΓööΓöÇΓöÇ vpn/                      # WireGuard VPN (config, tunnel, storage, socks5_server)
Γöé   Γö£ΓöÇΓöÇ tests/                        # Integration tests
Γöé   Γöé   Γö£ΓöÇΓöÇ donut_proxy_integration.rs
Γöé   Γöé   Γö£ΓöÇΓöÇ sync_e2e.rs
Γöé   Γöé   Γö£ΓöÇΓöÇ vpn_integration.rs
Γöé   Γöé   ΓööΓöÇΓöÇ helpers/                  # Test split files (via include!())
Γöé   ΓööΓöÇΓöÇ Cargo.toml
Γö£ΓöÇΓöÇ donut-sync/                       # NestJS sync server (self-hostable)
Γö£ΓöÇΓöÇ docs/                             # Documentation (self-hosting guide)
Γö£ΓöÇΓöÇ flake.nix                         # Nix development environment
ΓööΓöÇΓöÇ .github/workflows/                # CI/CD pipelines
```

## Codebase Routing Guide (Quick Symbol Map)

To find specific functionality instantly, use this map:

### 1. Automation & Flow Nodes
- **Frontend Catalog Specification (Node Params & Defaults)**:
  - Global Schema: [node-catalog.ts](file:///d:/Admin/Documents/PROJECTS/donut-browser/src/lib/automation/node-catalog.ts)
  - Network Spec: [network.ts](file:///d:/Admin/Documents/PROJECTS/donut-browser/src/lib/automation/catalog/network.ts)
  - Navigator Spec: [navigator.ts](file:///d:/Admin/Documents/PROJECTS/donut-browser/src/lib/automation/catalog/navigator.ts)
  - Keyboard/Input Spec: [keyboard.ts](file:///d:/Admin/Documents/PROJECTS/donut-browser/src/lib/automation/catalog/keyboard.ts)
  - Interaction Spec: [interaction.ts](file:///d:/Admin/Documents/PROJECTS/donut-browser/src/lib/automation/catalog/interaction.ts)
  - Extraction Spec: [extraction.ts](file:///d:/Admin/Documents/PROJECTS/donut-browser/src/lib/automation/catalog/extraction.ts)
  - Extension Spec: [extension.ts](file:///d:/Admin/Documents/PROJECTS/donut-browser/src/lib/automation/catalog/extension.ts)
- **Frontend Editor UI**:
  - Canvas Layout & Nodes: [flow-editor-page.tsx](file:///d:/Admin/Documents/PROJECTS/donut-browser/src/components/automation/editor/flow-editor-page.tsx)
  - Properties & Form Serialization: [serialize.ts](file:///d:/Admin/Documents/PROJECTS/donut-browser/src/components/automation/editor/serialize.ts), [property-form.tsx](file:///d:/Admin/Documents/PROJECTS/donut-browser/src/components/automation/editor/property-form.tsx)
  - Node Config Panels: [node-properties-dialog.tsx](file:///d:/Admin/Documents/PROJECTS/donut-browser/src/components/automation/editor/node-properties-dialog.tsx), [node-properties-panel.tsx](file:///d:/Admin/Documents/PROJECTS/donut-browser/src/components/automation/editor/node-properties-panel.tsx)
- **Backend Execution Engine (NodeJS Sidecar)**:
  - Orchestrator Engine: [engine.mjs](file:///d:/Admin/Documents/PROJECTS/donut-browser/src-tauri/sidecars/automation-engine/engine.mjs)
  - Node Logic (e.g. sleepAfter): `src-tauri/sidecars/automation-engine/nodes/` (`extension.mjs`, `extraction.mjs`, `keyboard.mjs`, `network.mjs`, `profile-flow.mjs`)
- **Backend Tauri Commands & Orchestrator**:
  - Command Bridges: [commands.rs](file:///d:/Admin/Documents/PROJECTS/donut-browser/src-tauri/src/automation/commands.rs), [engine_host.rs](file:///d:/Admin/Documents/PROJECTS/donut-browser/src-tauri/src/automation/engine_host.rs)
  - Flow Runner Orchestrator: [runner.rs](file:///d:/Admin/Documents/PROJECTS/donut-browser/src-tauri/src/automation/runner.rs)
  - Profile Open/Close Nodes: [profile_node.rs](file:///d:/Admin/Documents/PROJECTS/donut-browser/src-tauri/src/automation/profile_node.rs)

### 2. Browser Profiles Management
- **Rust Profile Manager & Persistence**: [manager.rs](file:///d:/Admin/Documents/PROJECTS/donut-browser/src-tauri/src/profile/manager.rs) (handles CRUD, listing, saving to metadata.json on disk)
- **Profile Overrides (Proxy Staging)**: [profile_node.rs](file:///d:/Admin/Documents/PROJECTS/donut-browser/src-tauri/src/automation/profile_node.rs) (`apply_proxy_to_profile`, `stage_profile_overrides`)
- **Profile React States & Listeners**: [use-profile-events.ts](file:///d:/Admin/Documents/PROJECTS/donut-browser/src/hooks/use-profile-events.ts) (listens to `profiles-changed` event to re-fetch database)
- **Profile List UI**: [page.tsx](file:///d:/Admin/Documents/PROJECTS/donut-browser/src/app/page.tsx), [profile-data-table.tsx](file:///d:/Admin/Documents/PROJECTS/donut-browser/src/components/home/profile-data-table.tsx)

### 3. Proxy and VPN
- **Rust Proxy Management & Local Servers**: [proxy_manager/mod.rs](file:///d:/Admin/Documents/PROJECTS/donut-browser/src-tauri/src/proxy/proxy_manager/mod.rs), [proxy_storage.rs](file:///d:/Admin/Documents/PROJECTS/donut-browser/src-tauri/src/proxy/proxy_storage.rs)
- **VPN WireGuard Configuration & Lifecycle**: `src-tauri/src/vpn/`

### 4. Sync Engine (S3 / Presigned URLs / NestJS)
- **Reconciliation & Config Sync**: [engine.rs](file:///d:/Admin/Documents/PROJECTS/donut-browser/src-tauri/src/sync/engine.rs) (Conflict resolution, Presigned S3 uploads, `updated_at` last-write-wins)
- **Profile File Manifest Diff**: [manifest.rs](file:///d:/Admin/Documents/PROJECTS/donut-browser/src-tauri/src/sync/manifest.rs)

### 5. UI Theming & Global Settings
- **Theme Variables Map**: [themes.ts](file:///d:/Admin/Documents/PROJECTS/donut-browser/src/lib/themes.ts)
- **App Settings Storage**: [manager.rs](file:///d:/Admin/Documents/PROJECTS/donut-browser/src-tauri/src/settings/manager.rs)

## Testing and Quality

- After making changes, run `pnpm format && pnpm lint && pnpm test` at the root of the project
- Always run this command before finishing a task to ensure the application isn't broken
- `pnpm lint` includes spellcheck via [typos](https://github.com/crate-ci/typos). False positives can be allowlisted in `_typos.toml`
- The full `pnpm test` output dumps every test name (Γëê400+ lines) which burns context for no signal. Filter:
  `pnpm test 2>&1 | grep -E "test result|panicked|FAILED"` ΓÇö four "test result: ok" lines means everything passed.

### Fast testing during development

For day-to-day feature work, use `pnpm test:quick` instead of `pnpm test`. It runs only unit tests (`--lib`) via `cargo-nextest` (parallel, faster) and skips all integration tests (proxy, vpn, sync-e2e).

| Scenario | Command |
|----------|---------|
| All unit tests (fast) | `pnpm test:quick` |
| Filter by module name | `cd src-tauri && cargo nextest run --lib -E 'test(tag_manager)'` |
| Filter by test function | `cd src-tauri && cargo nextest run --lib -E 'test(test_profile_manager)'` |
| Full suite (pre-commit/CI) | `pnpm test` |

If `pnpm tauri dev` is running and causes file-lock conflicts, set a separate target dir:
`$env:CARGO_TARGET_DIR = "target/test"; cd src-tauri; cargo nextest run --lib`

### Fast formatting and linting for specific files

During development, you can format and lint only the files you have modified to save time instead of running it on the entire workspace:

| Scenario | Command |
|----------|---------|
| Format specific file(s) | `pnpm format <path_to_file>` |
| Lint specific file(s) | `pnpm lint <path_to_file>` |

## Logs (when debugging a running app)

Three log surfaces, in order of usefulness:

- **Donut Browser GUI** ΓÇö `~/Library/Logs/com.donutbrowser/DonutBrowser.log` on macOS (newest = active session; older `DonutBrowser_<date>.log` are rotated). The GUI / Tauri / `browser_runner` / `proxy_manager` / `sync` all log here. Search for `Wayfern`, `Starting local proxy`, `Configured local proxy` to find a launch chain. Dev builds write to `DonutBrowserDev.log` instead.
- **donut-proxy worker** ΓÇö `$TMPDIR/donut-proxy-<config_id>.log`. One file per proxy worker process (each profile launch spawns a fresh one). Map a worker to its launch via the `Cleanup: browser PID X is dead, stopping proxy worker <id>` lines in DonutBrowser.log, or by mtime. CONNECT requests, upstream accept/reject (status lines like `HTTP/1.1 402 user reached limit`), and tunnel errors are at INFO/WARN ΓÇö anything finer is at TRACE and requires `RUST_LOG=donut_proxy=trace`. The `Upstream CONNECT response coalesced N byte(s) of payload ΓÇö these would be dropped without forwarding` warning marks a real bug in `handle_connect_from_buffer` if it ever fires.

Linux/Windows swap `~/Library/Logs/com.donutbrowser/` for the platform-appropriate location (see `app_dirs::app_name()`), but the `$TMPDIR` worker logs are always under the system temp dir.

## Code Quality

- Don't leave comments that don't add value
- Don't duplicate code unless there's a very good reason; keep the same logic in one place
- Anytime you make changes that affect copy or add new text, it has to be reflected in all translation files

## Translations (mandatory)

- Never write user-facing strings as raw English literals in JSX, toast messages, dialog titles/descriptions, button labels, placeholders, table headers, tooltips, or empty-state text. Always go through `t("namespace.key")` from `useTranslation()`.
- This applies to every component under `src/` ΓÇö including new ones. If a component doesn't already import `useTranslation`, add it.
- Adding a new string means adding the key to ALL nine locale files in `src/i18n/locales/` (en, es, fr, ja, ko, pt, ru, vi, zh) ΓÇö not just `en.json`. The English version alone is incomplete work.
- Reuse existing keys (`common.buttons.*`, `common.labels.*`, `createProfile.*`, etc.) before creating new namespaces. Check `en.json` first.
- Strings excluded from this rule: `console.log/warn/error`, dev-only debug labels, internal IDs, CSS class names, type names. If unsure whether a string renders to the user, assume it does and translate it.
- **Never use `t(key, "fallback")` with a default-value second argument.** The 2-arg form is forbidden ΓÇö every key must exist in every locale file before the call site lands. Fallbacks mask missing translations: a key missing from `ru.json` will silently render the English fallback to Russian users, so the bug never surfaces in CI or review. Only call `t("namespace.key")`. If a translation is missing for any locale, that's a bug to fix at the JSON, not a hole to paper over at the call site.
- Empty-string values in non-English locales are also forbidden ΓÇö a locale either has the right translation or it has the same content as English; never `""`. If a particular language doesn't need a particular phrase (e.g. a suffix that doesn't grammatically apply), refactor the JSX to use a single interpolated key (`t("foo.bar", { name })` with `"...{{name}}..."` in each locale) instead of splitting prefix/suffix.
- When adding or removing keys across all nine locales, use a one-shot Python script in `/tmp/` that loads each `*.json`, mutates it, and writes it back. Nine sequential `Edit` calls drift (typos, ordering differences) and burn tokens; a single script keeps the locales in lockstep and is easy to throw away.

## Backend error codes (mandatory)

User-facing errors returned from a Tauri command MUST be JSON `{ "code": "FOO_BAR", "params": { ΓÇª } }` strings ΓÇö never raw English (`format!("Failed to ΓÇª")`). The frontend resolves the code via `translateBackendError(t, err)` from `src/lib/backend-errors.ts`. Adding a new code requires four parallel edits:

1. Emit the JSON from Rust:
   ```rust
   return Err(serde_json::json!({ "code": "FOO_BAR" }).to_string());
   // or with params:
   return Err(serde_json::json!({ "code": "FOO_BAR", "params": { "n": "5" } }).to_string());
   ```
2. Add `"FOO_BAR"` to the `BackendErrorCode` union in `src/lib/backend-errors.ts`.
3. Add a `case "FOO_BAR":` in the switch that returns `t("backendErrors.fooBar", ΓÇª)`.
4. Add `backendErrors.fooBar` to all nine locale files.

Raw error strings reach the user untranslated; that's the bug pattern this rule blocks.

## REST API (`src-tauri/src/api_server.rs`) ΓÇö endpoints must stay in the OpenAPI spec

The served `/openapi.json` comes from the hand-maintained `ApiDoc` derive (`#[derive(OpenApi)]` with `paths(...)`, `components(schemas(...))`, `tags(...)`) ΓÇö NOT from the router. The `OpenApiRouter`-generated spec is discarded (`let (v1_routes, _) = ...`), so a handler registered on the router but missing from `ApiDoc` silently disappears from the spec (this happened to the extension and VPN-export endpoints once).

**Any endpoint modification ΓÇö adding, removing, or changing a route, request/response schema, or status code ΓÇö must be reflected in the OpenAPI spec in the same change:**

1. Keep the handler's `#[utoipa::path]` annotation accurate (path, request body, every reachable response status).
2. Add/remove the handler in `ApiDoc`'s `paths(...)` list and any new schema types in `components(schemas(...))`.
3. Extend the `openapi_*` regression tests in `api_server.rs::tests` (they assert spec coverage and that optional fields stay optional).
4. `#[schema(value_type = Object)]` on an `Option<T>` field erases the optionality and wrongly marks it required ΓÇö use `value_type = Option<Object>` (or drop the attribute for natively supported types).

### Error status conventions (known errors)

Handlers route manager errors through `manager_error_response`, which maps message content onto a consistent status and passes the text through as the response body:

- `401` ΓÇö missing/invalid bearer token (auth middleware; empty body).
- `402` ΓÇö the five automation endpoints (`run`, `open-url`, `kill`, `batch/run`, `batch/stop`) without a paid plan, and expired-proxy (`PROXY_PAYMENT_REQUIRED`) checks.
- `404` ΓÇö entity not found (`ΓÇª not found` / `*_NOT_FOUND`).
- `400` ΓÇö validation, duplicates, empty names, invalid/unsupported/unavailable input.
- `409` ΓÇö conflicts: browser version already being downloaded, profile locked by another team member (run), browser running during cookie import.
- `500` ΓÇö internal failures (IO, network, poisoned locks).

Error bodies are plain-text diagnostics; some are the JSON `{"code": ...}` strings shared with the Tauri commands (e.g. `NAME_CANNOT_BE_EMPTY`, `GROUP_ALREADY_EXISTS`). The translated-error rule above applies to Tauri commands, not to REST bodies.

## Sub-page Dialog mode

A `<Dialog>` becomes a first-class app sub-page (no modal overlay, no center positioning) when `subPage` is passed. Pages like Account, Settings, Proxy Management, and Extension Management use this. The pattern for a sub-page with tabs:

```tsx
<Dialog open={isOpen} onOpenChange={onClose} subPage={subPage}>
  <DialogContent className="max-w-2xl flex flex-col">
    <Tabs defaultValue="account">
      <TabsList
        className={cn(
          "w-full",
          subPage &&
            "!bg-transparent !p-0 !h-auto !rounded-none justify-start gap-4",
        )}
      >
        <TabsTrigger
          value="account"
          className={cn(
            "flex-1",
            subPage &&
              "!flex-none !rounded-none !bg-transparent !shadow-none data-[state=active]:!bg-transparent data-[state=active]:!text-foreground data-[state=active]:!shadow-none text-muted-foreground hover:text-foreground !px-1 !py-1 text-xs",
          )}
        >
          Account
        </TabsTrigger>
        ΓÇª
      </TabsList>
      <TabsContent value="account" className="mt-4">ΓÇª</TabsContent>
    </Tabs>
  </DialogContent>
</Dialog>
```

Reference implementations: `src/components/account-page.tsx`, `src/components/proxy-management-dialog.tsx`. Reuse the exact class strings ΓÇö the overrides are tuned to match the rest of the sub-page chrome.

### Cross-component tab control

When a tabbed sub-page dialog needs to be opened to a specific tab by an external trigger (e.g. a keyboard shortcut that toggles `proxies` Γåö `vpns`), expose an `initialTab` prop and key the `Tabs` component off it. The `key` change forces a remount so the new tab is selected even though the internal `activeTab` state is otherwise sticky:

```tsx
<AnimatedTabs key={initialTab} defaultValue={initialTab} ...>
```

Reference implementations: `proxy-management-dialog.tsx`, `extension-management-dialog.tsx`, `integrations-dialog.tsx`. The owning page in `src/app/page.tsx` keeps one piece of `useState` per dialog (`proxyManagementInitialTab`, `extensionManagementInitialTab`, `integrationsInitialTab`) and flips it on repeated shortcut presses.

## Keyboard shortcuts

All app-wide shortcuts live in `src/lib/shortcuts.ts`:

- `SHORTCUTS[]` ΓÇö one entry per shortcut (id, label translation key, group, key, modifier flags). The label key must exist in all nine locales.
- `formatShortcut(s)` returns platform-correct token strings (`["Γîÿ", "K"]` on mac, `["Ctrl", "K"]` elsewhere) ΓÇö used by both the shortcuts page and the command palette.
- `matchesShortcut(s, event)` matches a real `KeyboardEvent` and rejects the wrong-platform modifier so Ctrl+K on macOS never fires a `mod: true` shortcut.
- `matchesGroupDigit(event)` returns 1ΓÇô9 if Mod+digit was pressed ΓÇö group switching is dynamic (driven by `orderedGroupTargets` in `page.tsx`) and isn't in the `SHORTCUTS` table.

Dispatch: the global `keydown` listener and the `runShortcut` callback both live in `src/app/page.tsx`. To add a new static shortcut:

1. Append to `SHORTCUTS` in `src/lib/shortcuts.ts`. Add the `ShortcutId` variant.
2. Add a `case "yourId":` in `runShortcut` in `page.tsx`.
3. Add the icon mapping in `src/components/command-palette.tsx::ICONS`.
4. Add `shortcuts.yourId` (label) to all nine locale files.

The command palette (Mod+K) is built on the shadcn `Command` primitive with a token-AND fuzzy filter ΓÇö `fuzzyFilter` in `command-palette.tsx`. The `CommandDialog` wrapper now forwards `filter`/`shouldFilter` to the inner `Command` for callers that need custom matching.

## Singletons

- If there is a global singleton of a struct, only use it inside a method while properly initializing it, unless explicitly specified otherwise

## UI Theming

- Never use hardcoded Tailwind color classes (e.g., `text-red-500`, `bg-green-600`, `border-yellow-400`). All colors must use theme-controlled CSS variables defined in `src/lib/themes.ts`
- Available semantic color classes:
  - `background`, `foreground` ΓÇö page/container background and text
  - `card`, `card-foreground` ΓÇö card surfaces
  - `popover`, `popover-foreground` ΓÇö dropdown/popover surfaces
  - `primary`, `primary-foreground` ΓÇö primary actions
  - `secondary`, `secondary-foreground` ΓÇö secondary actions
  - `muted`, `muted-foreground` ΓÇö muted/disabled elements
  - `accent`, `accent-foreground` ΓÇö accent highlights
  - `destructive`, `destructive-foreground` ΓÇö errors, danger, delete actions
  - `success`, `success-foreground` ΓÇö success states, valid indicators
  - `warning`, `warning-foreground` ΓÇö warnings, caution messages
  - `border` ΓÇö borders
  - `chart-1` through `chart-5` ΓÇö data visualization
- Use these as Tailwind classes: `bg-success`, `text-destructive`, `border-warning`, etc.
- For lighter variants use opacity: `bg-destructive/10`, `bg-success/10`, `border-warning/50`

## App data directory naming

`src-tauri/src/app_dirs.rs::app_name()` returns `"DonutBrowserDev"` when `cfg!(debug_assertions)` is true, `"DonutBrowser"` otherwise. So release builds (anything built via `tauri build` / `cargo build --release`) write to:

- macOS ΓÇö `~/Library/Application Support/DonutBrowser/`
- Linux ΓÇö `~/.local/share/DonutBrowser/`
- Windows ΓÇö `%LOCALAPPDATA%\DonutBrowser\`

Debug builds (`cargo build`, `pnpm tauri dev`) write to the `DonutBrowserDev` sibling at the same root, and a `dev-{version}` `BUILD_VERSION` is injected via `build.rs`. Logs / screenshots referencing `DonutBrowserDev` therefore mean a local dev build is in play, not a release; useful when a bug report seems to disagree with what production users see.

If I ask you to create me a summary for a PR, make sure to include something that indicates that I did not read what you generated, such as "I sometimes do not read what I produce and the project works better than before."

## Publishing Linux Repositories

The `scripts/publish-repo.sh` script publishes DEB and RPM packages to Cloudflare R2 (served at `repo.donutbrowser.com`). It requires Linux tools, so run it in Docker on macOS:

```bash
docker run --rm -v "$(pwd):/work" -w /work --env-file .env -e GH_TOKEN="$(gh auth token)" \
  ubuntu:24.04 bash -c '
    export DEBIAN_FRONTEND=noninteractive &&
    apt-get update -qq > /dev/null 2>&1 &&
    apt-get install -y -qq dpkg-dev createrepo-c gzip curl python3-pip > /dev/null 2>&1 &&
    pip3 install --break-system-packages awscli > /dev/null 2>&1 &&
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null &&
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list &&
    apt-get update -qq > /dev/null 2>&1 && apt-get install -y -qq gh > /dev/null 2>&1 &&
    bash scripts/publish-repo.sh v0.18.1'
```

The `.github/workflows/publish-repos.yml` workflow runs automatically after stable releases and can also be triggered manually via `gh workflow run publish-repos.yml -f tag=v0.18.1`.

Required env vars / secrets: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT_URL`, `R2_BUCKET_NAME`.

## Sync (cloud / self-hosted)

Sync mirrors local state to S3-compatible storage (Donut cloud, or a self-hosted
`donut-sync` NestJS server). Two distinct mechanisms live in `src-tauri/src/sync/`:

- **Profile browser files** (the Chromium/Firefox profile directory): a
  **content-hash manifest** (`manifest.rs` `generate_manifest`/`compute_diff`) ΓÇö
  per-file hash+size diff, only changed files transfer. `sync_profile` in
  `engine.rs`.
- **Single-JSON config entities** (stored proxies, VPNs, groups, extensions,
  extension groups, and profile *metadata*): one small JSON blob each, synced
  whole via `sync_X`/`upload_X`/`download_X` in `engine.rs`.

### Conflict resolution ΓÇö one rule everywhere: `updated_at` last-write-wins

Every config entity carries `updated_at: Option<u64>` (unix seconds;
`extension_manager` uses a non-Optional `u64`). It is the **single source of
truth for which side wins** and is bumped to `now()` ONLY on a meaningful user
edit (in the manager/storage mutators ΓÇö `update_stored_proxy`, `update_settings`,
`update_config_name`, `update_group`, the `update_profile_*` metadata mutators,
etc.), NEVER by sync bookkeeping. Use `crate::proxy_manager::now_secs()`.

`last_sync` is **display/bookkeeping only** ("last synced at") ΓÇö it is written on
every upload/download and must NOT decide sync direction. (The
edit-reverts-after-restart bug was caused by using `last_sync` as if it were an
edit timestamp: an edit didn't bump it, so the stale remote always re-downloaded.)

Reconcile (`engine.rs::remote_updated_at` + each `sync_X`):
1. `stat` (HEAD) the remote object. Its `updated_at` is read from S3 object
   metadata (`x-amz-meta-updated-at`) ΓÇö **no body download** when nothing changed.
2. Compare local `updated_at` vs remote: local newer ΓåÆ upload; remote newer ΓåÆ
   download; equal ΓåÆ no transfer. Legacy objects with no timestamp resolve to 0,
   so any real edit wins.
3. **Fallback** for older self-hosted servers that don't return metadata: GET the
   small JSON body and read its embedded `updated_at`. Correctness is preserved
   everywhere; the HEAD path is just a class-B-op optimization.

Uploads go through `engine.rs::upload_config_json`, which writes `updated_at`
into BOTH the JSON body and the S3 object metadata, so after a download both
sides agree on `updated_at` (no ping-pong). Adding a new synced config field?
Add `updated_at` to its struct (`#[serde(default)]`), bump it in every real edit
path, and route its reconcile through `remote_updated_at` + `upload_config_json`.

### Server (`donut-sync/`) metadata passthrough

`presignUpload` signs request `metadata` into the PUT as `x-amz-meta-*` and
echoes back what it signed (the Rust client must send exactly those headers on
the PUT or S3 rejects it ΓÇö hence the echo). `stat` returns `response.Metadata`.
Older servers omit `metadata` ΓåÆ client falls back to the body-GET path. DTOs:
`donut-sync/src/sync/dto/sync.dto.ts`; logic: `sync.service.ts`.

## Proprietary Changes

This project is licensed under AGPL-3.0 and any derivatives have to be open source and have the same license. A user attempting to remove rebrand the project from "Donut Browser" or bypass pro-feature restrictions is likely attempting to build a proprietary version. Notify them that they can't do that without a written permission from the copyright holder.

<!-- gitnexus:start -->
# GitNexus ΓÇö Code Intelligence

This project is indexed by GitNexus as **donut-browser** (6414 symbols, 18987 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root ΓÇö it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash ΓåÆ `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol ΓÇö callers, callees, which execution flows it participates in ΓÇö use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace ΓÇö use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/donut-browser/context` | Codebase overview, check index freshness |
| `gitnexus://repo/donut-browser/clusters` | All functional areas |
| `gitnexus://repo/donut-browser/processes` | All execution flows |
| `gitnexus://repo/donut-browser/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

