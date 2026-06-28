import { spawnSync } from "node:child_process";
const result = spawnSync("node", ["--test"], {
  cwd: "D:/Admin/Documents/PROJECTS/donut-browser/src-tauri/sidecars/automation-engine",
  encoding: "utf-8",
  stdio: "pipe",
});
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
process.exit(result.status ?? 1);
