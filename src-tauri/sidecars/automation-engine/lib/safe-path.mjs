// Path containment for artifact writes — red-team #11.
// `screenshot` (and any future path param) must land INSIDE --artifacts-dir.
// A .donutflow is untrusted and may interpolate user-controlled values such as
// {{PROFILE_NAME}} (free text) into a filename. We must:
//   1. sanitize interpolated filename fragments (strip separators / .. / drive)
//   2. resolve the final path and prefix-check it against the canonical
//      artifacts dir, rejecting any path that escapes it.

import { resolve, sep, isAbsolute } from "node:path";

/**
 * Sanitize a single filename fragment that may have come from an untrusted
 * variable (e.g. PROFILE_NAME). Removes path separators, parent-dir tokens,
 * drive letters, and control chars. Returns a safe, non-empty token.
 * @param {string} fragment
 * @returns {string}
 */
export function sanitizeFilenameFragment(fragment) {
  const raw = String(fragment ?? "");
  // Strip Windows drive prefix (C:), all slashes/backslashes, NUL/control,
  // and collapse any remaining dots-only sequences.
  let cleaned = raw
    .replace(/^[a-zA-Z]:/, "") // drive letter
    .replace(/[/\\]/g, "_") // path separators
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, "") // control chars
    .replace(/\.\.+/g, "_"); // .. and longer dot runs

  cleaned = cleaned.trim();
  // Avoid names that are empty, all dots, or reserved-ish.
  if (cleaned === "" || /^\.+$/.test(cleaned)) {
    cleaned = "artifact";
  }
  return cleaned;
}

/**
 * Resolve a requested artifact path against the artifacts dir and guarantee it
 * does not escape. Accepts either a bare filename (preferred) or a relative
 * subpath; rejects absolute paths and any resolved path outside the dir.
 *
 * @param {string} artifactsDir - canonical-ish base dir (already created)
 * @param {string} requestedPath - filename/subpath from the node params
 * @returns {string} absolute path guaranteed within artifactsDir
 * @throws {Error} when the path escapes the artifacts dir
 */
export function containArtifactPath(artifactsDir, requestedPath) {
  if (typeof artifactsDir !== "string" || artifactsDir === "") {
    throw new Error("artifactsDir is required for path containment");
  }
  const base = resolve(artifactsDir);

  const req = String(requestedPath ?? "");
  if (req === "") {
    throw new Error("artifact path must be a non-empty string");
  }
  // Reject absolute paths outright — artifacts are always relative to the dir.
  if (isAbsolute(req)) {
    throw new Error(`artifact path must be relative, got absolute: ${req}`);
  }

  const candidate = resolve(base, req);

  // Prefix check with a trailing separator so /base does not match /base-evil.
  const baseWithSep = base.endsWith(sep) ? base : base + sep;
  if (candidate !== base && !candidate.startsWith(baseWithSep)) {
    throw new Error(
      `artifact path escapes artifacts dir: "${req}" resolved to "${candidate}"`,
    );
  }

  return candidate;
}
