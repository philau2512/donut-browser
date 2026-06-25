# 2026-06-25 — src/components/ Feature Folder Reorganization

**Commit:** `ced00e7`
**Author:** philau2512
**Scope:** `src/components/`, `src/app/page.tsx`, `src/app/layout.tsx`

## Summary

Reorganized 66 flat component files from the `src/components/` root into 13 domain-based folders with barrel exports. The refactor was purely structural — no component internals were changed. TypeScript build passed at every phase gate, and the GitNexus index was re-indexed at 6,414 nodes after completion.

## What Changed

### Domain folders created under `src/components/`

| Folder | Files | Notes |
|---|---|---|
| `shared/` | 12 | LoadingButton, dialogs, toasts, cross-cutting components |
| `profile/` | 8 | Profile management |
| `profile/camoufox/` | 5 | Camoufox / wayfern components |
| `proxy/` | 7 | Proxy management dialogs |
| `group/` | 6 | Group management dialogs |
| `vpn/` | 4 | VPN + DNS components |
| `sync/` | 5 | Sync + account components |
| `onboarding/` | 4 | Onboarding flow |
| `cookie/` | 2 | Cookie management |
| `extension/` | 1 | Extension management |
| `settings/` | 3 | Settings, shortcuts, integrations |
| `navigation/` | 2 | Command palette, rail nav |
| `app-shell/` | 4 | Client providers, theme, i18n, window drag |
| `home/` | 3 | Home header, profiles table, data table action bar |

### Barrel exports

- 14 `index.ts` files created (one per domain folder)
- Root `src/components/index.ts` re-exports all domain barrels

### Import rewrites

- `src/app/page.tsx`: 37 flat imports rewritten to domain paths
- `src/app/layout.tsx`: updated to match new structure

### Left untouched

- `src/components/ui/` (31 files) — shadcn/ui primitives, no domain ownership
- `src/components/icons/` (2 files) — global asset, no domain ownership

## Why

The flat `src/components/` root had grown to 66 files with no grouping by feature or responsibility. Navigating, onboarding, and impact analysis were all significantly slower. Grouping by domain reduces cognitive load, makes barrel imports cleaner in consuming files, and aligns component ownership with feature areas already established elsewhere in the codebase.

## Key Decisions

- **`data-table-action-bar` stays in `home/`** — it has cross-domain imports (proxy, group, extension) but its primary consumer is the home profiles table. Moving it to `shared/` would be premature generalization.
- **`profile/` → `proxy/` cross-domain import retained** — `create-profile` importing `proxy-form-dialog` is intentional product coupling, not an accidental dependency.
- **No internal refactoring during migration** — component internals were left exactly as found to keep the diff reviewable and reduce merge risk.
- **`ui/` and `icons/` excluded** — these are not feature-domain components; reorganizing them would require touching every consumer in the codebase.

## Execution Notes

The migration ran in 8 phases using `--parallel` mode:

1. **Phase 1 (shared)** — executed first; all other phases depend on it
2. **Phases 2–6** — ran in parallel after Phase 1 cleared
3. **Phase 7** — remaining 19 files + `page.tsx` full import rewrite
4. **Phase 8** — final verification; build: zero errors

## Impact

- Import paths in `page.tsx` and `layout.tsx` now use domain-scoped paths (e.g., `@/components/profile`, `@/components/shared`)
- No runtime behavior changed
- GitNexus symbol count: 6,414 nodes (up from 6,373 pre-migration)
- Future components should be placed in the matching domain folder, not the root
