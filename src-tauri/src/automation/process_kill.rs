// Kill a process by PID — Phase 3 (red-team #4).
//
// CRITICAL: automation kills by the SPECIFIC pid it launched, never by profile
// path. Killing by path (as the GUI kill does) could terminate a user's own
// browser instance on the same profile, or miss the automation instance. We
// kill exactly the pid we spawned, with its child tree (the browser spawns
// renderer/gpu children).

/// Kill a process (and its child tree) by PID. Best-effort. Async so the
/// orchestrator can await it without blocking the runtime; the actual kill
/// command runs on a blocking thread.
pub async fn kill_pid_tree(pid: u32) -> Result<(), String> {
  tokio::task::spawn_blocking(move || kill_pid_tree_blocking(pid))
    .await
    .map_err(|e| format!("join error killing pid {pid}: {e}"))?
}

fn kill_pid_tree_blocking(pid: u32) -> Result<(), String> {
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    // /T kills the whole tree, /F forces.
    match std::process::Command::new("taskkill")
      .args(["/PID", &pid.to_string(), "/T", "/F"])
      .creation_flags(CREATE_NO_WINDOW)
      .status()
    {
      Ok(s) if s.success() => Ok(()),
      Ok(s) => Err(format!("taskkill {pid} exited with {s}")),
      Err(e) => Err(format!("taskkill {pid} failed: {e}")),
    }
  }

  #[cfg(unix)]
  {
    use std::os::unix::process::ExitStatusExt;
    match std::process::Command::new("kill")
      .args(["-TERM", &pid.to_string()])
      .status()
    {
      Ok(s) if s.success() || s.signal() == Some(0) => Ok(()),
      Ok(s) => Err(format!("kill {pid} exited with {s}")),
      Err(e) => Err(format!("kill {pid} failed: {e}")),
    }
  }
}

/// True if a process with this pid is currently alive.
pub fn is_pid_alive(pid: u32) -> bool {
  use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System};
  let system = System::new_with_specifics(
    RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing()),
  );
  system.process(Pid::from(pid as usize)).is_some()
}
