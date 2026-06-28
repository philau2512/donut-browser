import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const isFix = args.includes("--fix");

const __dirname = dirname(fileURLToPath(import.meta.url));

// Đảm bảo file lock tạm thời của Tauri dev tồn tại để cargo clippy không bị lỗi biên dịch khi dev server không chạy
const distDevDir = resolve(__dirname, "../dist/dev");
if (!existsSync(distDevDir)) {
  mkdirSync(distDevDir, { recursive: true });
}
const lockFile = resolve(distDevDir, "lock");
if (!existsSync(lockFile)) {
  writeFileSync(lockFile, "");
}

// Thiết lập thư mục target riêng dạng tuyệt đối để đảm bảo cache luôn được nhận diện chính xác
process.env.CARGO_TARGET_DIR = resolve(__dirname, "../src-tauri/target/clippy");

const command = isFix
  ? "cargo clippy --fix --allow-dirty --all-features -- -D warnings -D clippy::all && cargo fmt --all"
  : "cargo clippy --all-features -- -D warnings -D clippy::all && cargo fmt --all";

try {
  execSync(command, { cwd: "src-tauri", stdio: "inherit" });
} catch (error) {
  process.exit(1);
}
