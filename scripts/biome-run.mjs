/**
 * Run Biome from the repo root's @biomejs/biome install (Windows-safe; avoids bare `biome` on PATH).
 *
 * Usage: node scripts/biome-run.mjs [--cwd <dir>] <biome-args...>
 * Example: node scripts/biome-run.mjs check src/ --write --unsafe
 *          node scripts/biome-run.mjs --cwd donut-sync check src/ --write --unsafe
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function resolveBiomeEntry() {
  try {
    const pkgPath = require.resolve("@biomejs/biome/package.json", {
      paths: [rootDir],
    });
    const pkg = require(pkgPath);
    const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.biome;
    if (rel) {
      const entry = join(dirname(pkgPath), rel);
      if (existsSync(entry)) {
        return entry;
      }
    }
  } catch {
    // fall through
  }

  const candidates = [
    join(rootDir, "node_modules", "@biomejs", "biome", "bin", "biome"),
    join(rootDir, "node_modules", "@biomejs", "biome", "bin", "biome.js"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      return p;
    }
  }
  return null;
}

const rawArgv = process.argv.slice(2);
let cwd = rootDir;
const biomeArgs = [];

for (let i = 0; i < rawArgv.length; i++) {
  if (rawArgv[i] === "--cwd") {
    const next = rawArgv[++i];
    if (!next) {
      console.error("biome-run: --cwd requires a directory");
      process.exit(1);
    }
    cwd = resolve(rootDir, next);
    continue;
  }
  biomeArgs.push(rawArgv[i]);
}

const biomeEntry = resolveBiomeEntry();
if (!biomeEntry) {
  console.error(
    "Biome not found under node_modules/@biomejs/biome.\nRun from repo root: pnpm install",
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [biomeEntry, ...biomeArgs], {
  cwd,
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
