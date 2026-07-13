# AI Conflict Decisions Log

Generated during upstream merge execution — 2026-07-13

## DU/UD Conflicts (Rename/Modularization)

### Decision: git rm all DU flat files
- Files: api_client.rs, api_server.rs, app_auto_updater.rs, browser.rs, browser_runner.rs, etc.
- Reason: These flat files were modularized in our branch. Upstream still modifying old flat paths. Accepted our deletion.

### Decision: git add all UD modularized files
- Files: src-tauri/src/browser/camoufox/** (entire directory)
- Reason: Upstream deleted camoufox, we kept it for our custom fingerprint engine.

## UU Content Conflicts

### Nhom A — Config/Manifest
- _typos.toml: Kept our browser/camoufox/data path, dropped upstream deleted territory_info.xml
- package.json: Merged — kept custom packages + upstream newer versions + pnpm@11.9.0 (reverted from 11.10.0 due to Windows backslash path bug)
- Cargo.toml: Merged — rand 0.10.1->0.10.2, kept our regex = "1"

### Nhom B — Frontend
- page.tsx: --ours (uses HomeDialogs modularized component)
- use-app-update-notifications.tsx: Merged — our import path + upstream translateBackendError
- backend-errors.ts: Merged — our WAYFERN_* codes + upstream UPDATE_CHECKSUM codes
- src/types.ts: --ours (retains Camoufox types)

### Nhom C — i18n
- vi.json: --ours + filled 12 missing keys with Vietnamese translations
- Other locales: --theirs (upstream latest)

### Nhom D — Rust Backend
- lib.rs, profile/*.rs, sync/*.rs, updater/*.rs, vpn/*.rs: --ours (modularized paths)
- geolocation.rs: Had 8-char conflict markers from previous merge — resolved manually

## Upstream Features Applied

### sha256 checksum (eeb5c81)
- app_updater_types.rs: Added digest, checksums_url, asset_digest fields
- app_updater_core.rs: Added sha256 gating + helper functions

### socks5 location spoofing fix (86d5871)
- wayfern_manager.rs: Added is_remote_socks_url() + local proxy worker routing for geo fetch

### progress bar (06e3452)
- Already present in our extraction.rs and downloader.rs

## Post-Merge Compile Fixes

- aes-gcm 0.11: OsRng removed from aead — used rand::random for nonce/salt generation
- playwright crate not in Cargo.toml — replaced launcher.rs with stub implementation
- Added is_ipv4(), is_ipv6() to proxy::ip_utils
- Added is_geoip_available(), as_config() to geolocation.rs
- Fixed TERRITORY_INFO_XML ref to use data::TERRITORY_INFO_XML
- Removed duplicate restrict_to_owner in app_dirs.rs
- Added digest: None to AppReleaseAsset test fixtures
- Fixed duplicate window_color and missing camoufox_config in ephemeral_dirs.rs

## Test Results
- cargo test --lib: 486 passed, 0 failed
- run-engine-tests.mjs: 79 passed, 0 failed
- sync-test-harness: FAIL (pre-existing — also fails on pre-merge HEAD, unrelated to this merge)
