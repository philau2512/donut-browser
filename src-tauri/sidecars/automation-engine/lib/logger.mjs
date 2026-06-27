// JSON-line logger for the automation engine — red-team #12 (secret redaction).
//
// Every step emits exactly one JSON object per line to stdout:
//   { ts, runId, profileId, nodeId, level, msg }
//
// The orchestrator (Phase 3) parses these line-by-line. Secrets must NEVER
// reach stdout (file log) or the realtime event panel, so redaction happens
// here, at the single emit chokepoint, before anything is written.
//
// Convention: any variable whose NAME matches the secret pattern has its VALUE
// redacted wherever it appears in a message. The `type` node also masks the
// typed value unconditionally (see nodes/interaction.mjs), so even a non-secret
// variable name does not leak keystrokes.

import { containArtifactPath } from "./safe-path.mjs";

const SECRET_NAME_RE = /(PASS|PASSWORD|TOKEN|SECRET|APIKEY|API_KEY)/i;

/**
 * Build a redactor bound to the run's variables. Values of secret-named vars
 * are replaced with "<redacted>" anywhere they occur in an emitted message.
 *
 * @param {Record<string, unknown>} vars
 * @returns {(msg: string) => string}
 */
export function createRedactor(vars) {
  const secretValues = [];
  for (const [name, value] of Object.entries(vars ?? {})) {
    if (SECRET_NAME_RE.test(name)) {
      const v = String(value ?? "");
      if (v.length > 0) secretValues.push(v);
    }
  }
  // Longest-first so overlapping secrets redact fully.
  secretValues.sort((a, b) => b.length - a.length);

  return function redact(msg) {
    let out = String(msg ?? "");
    for (const secret of secretValues) {
      if (secret.length === 0) continue;
      out = out.split(secret).join("<redacted>");
    }
    return out;
  };
}

/**
 * @typedef {"debug"|"info"|"warn"|"error"} LogLevel
 */

export class Logger {
  /**
   * @param {object} opts
   * @param {string} opts.runId
   * @param {string} opts.profileId
   * @param {(msg: string) => string} [opts.redact] - redactor from createRedactor
   * @param {(line: string) => void} [opts.sink] - defaults to stdout writer
   */
  constructor({ runId, profileId, redact, sink }) {
    this.runId = runId;
    this.profileId = profileId;
    this.redact = redact ?? ((m) => m);
    this.sink = sink ?? ((line) => process.stdout.write(line + "\n"));
  }

  /**
   * Emit one JSON-line. msg is redacted before serialization.
   * @param {LogLevel} level
   * @param {string|null} nodeId
   * @param {string} msg
   */
  emit(level, nodeId, msg) {
    const record = {
      ts: new Date().toISOString(),
      runId: this.runId,
      profileId: this.profileId,
      nodeId: nodeId ?? null,
      level,
      msg: this.redact(msg),
    };
    this.sink(JSON.stringify(record));
  }

  debug(nodeId, msg) {
    this.emit("debug", nodeId, msg);
  }
  info(nodeId, msg) {
    this.emit("info", nodeId, msg);
  }
  warn(nodeId, msg) {
    this.emit("warn", nodeId, msg);
  }
  error(nodeId, msg) {
    this.emit("error", nodeId, msg);
  }

  /**
   * Resolve a path against the artifacts directory, ensuring it stays contained.
   * Used by handlers that write/read files (screenshot, readCsv, writeCsv, downloadFile).
   * @param {string} requestedPath - filename or relative subpath from node params
   * @param {string} artifactsDir - base directory to contain paths
   * @returns {string} absolute path guaranteed within artifactsDir
   * @throws {Error} if path escapes artifacts dir
   */
  safePath(requestedPath, artifactsDir) {
    return containArtifactPath(artifactsDir, requestedPath);
  }
}

export { SECRET_NAME_RE };
