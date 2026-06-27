// Sidecar engine spawn + stream — Phase 3.
//
// Resolves the automation-engine executable and spawns it for one profile,
// draining BOTH stdout and stderr (red-team #5: an undrained stderr pipe fills
// its 64KB buffer and the sidecar blocks on write → hang). stdout carries the
// JSON-line protocol; stderr carries playwright-core driver noise we discard
// (but must still read).
//
// Resolution order:
//   1. DONUT_AUTOMATION_ENGINE env override (tests / manual runs).
//   2. Compiled single-executable next to the app binary (Tauri externalBin
//      strips the `-<target-triple>` suffix at bundle time, so the runtime name
//      is just `automation-engine[.exe]`).
//   3. Dev fallback: `node <sidecars>/automation-engine/engine.mjs` when the
//      source tree is present (no compiled binary during `pnpm tauri dev`).

use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

/// How to invoke the engine: either a compiled binary, or `node <script>`.
#[derive(Debug, Clone)]
pub struct EngineInvocation {
  pub program: PathBuf,
  /// Leading args before the per-run flags (e.g. the .mjs path for `node`).
  pub prefix_args: Vec<String>,
}

impl EngineInvocation {
  /// Resolve the engine invocation for this platform/build.
  pub fn resolve() -> Result<Self, String> {
    if let Ok(path) = std::env::var("DONUT_AUTOMATION_ENGINE") {
      let p = PathBuf::from(&path);
      if p.extension().map(|e| e == "mjs").unwrap_or(false) {
        return Ok(Self {
          program: PathBuf::from("node"),
          prefix_args: vec![p.to_string_lossy().to_string()],
        });
      }
      return Ok(Self {
        program: p,
        prefix_args: vec![],
      });
    }

    let exe_name = if cfg!(windows) {
      "automation-engine.exe"
    } else {
      "automation-engine"
    };

    // 2. Next to the current executable (production bundle).
    if let Ok(cur) = std::env::current_exe() {
      if let Some(dir) = cur.parent() {
        let candidate = dir.join(exe_name);
        if candidate.exists() {
          return Ok(Self {
            program: candidate,
            prefix_args: vec![],
          });
        }
      }
    }

    // 3. Dev fallback: run the source via node.
    let dev_script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("sidecars")
      .join("automation-engine")
      .join("engine.mjs");
    if dev_script.exists() {
      return Ok(Self {
        program: PathBuf::from("node"),
        prefix_args: vec![dev_script.to_string_lossy().to_string()],
      });
    }

    Err(format!(
      "automation-engine not found: no DONUT_AUTOMATION_ENGINE, no `{exe_name}` next to app, no dev engine.mjs"
    ))
  }
}

/// Args passed to the engine for one profile run.
pub struct SidecarArgs {
  pub flow_path: PathBuf,
  pub cdp_port: u16,
  pub vars_json: String,
  pub run_id: String,
  pub profile_id: String,
  pub artifacts_dir: PathBuf,
  pub continue_default: bool,
}

/// Spawn the engine. Returns the child handle; caller drains stdout via
/// `stream_stdout` and must also drain stderr (see `drain_stderr`).
pub fn spawn_engine(inv: &EngineInvocation, args: &SidecarArgs) -> Result<Child, String> {
  let mut cmd = Command::new(&inv.program);
  cmd.args(&inv.prefix_args);
  cmd.arg("--flow").arg(&args.flow_path);
  cmd.arg("--cdp-port").arg(args.cdp_port.to_string());
  cmd.arg("--vars").arg(&args.vars_json);
  cmd.arg("--run-id").arg(&args.run_id);
  cmd.arg("--profile-id").arg(&args.profile_id);
  cmd.arg("--artifacts-dir").arg(&args.artifacts_dir);
  cmd.arg("--continue-default").arg(if args.continue_default {
    "true"
  } else {
    "false"
  });

  cmd.stdin(Stdio::null());
  cmd.stdout(Stdio::piped());
  cmd.stderr(Stdio::piped());

  // Quiet the playwright-core driver's stderr debug spew so the pipe stays small
  // even though we still drain it.
  cmd.env("DEBUG", "");

  #[cfg(windows)]
  {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }

  cmd
    .spawn()
    .map_err(|e| format!("Failed to spawn automation-engine: {e}"))
}

/// Drain stderr to the log (red-team #5: must read or the pipe blocks the child).
/// Driver noise is logged at debug level, not surfaced as run errors.
pub fn drain_stderr(child: &mut Child, run_id: String, profile_id: String) {
  if let Some(stderr) = child.stderr.take() {
    tokio::spawn(async move {
      let mut lines = BufReader::new(stderr).lines();
      while let Ok(Some(line)) = lines.next_line().await {
        log::debug!("[automation-engine stderr {run_id}/{profile_id}] {line}");
      }
    });
  }
}
