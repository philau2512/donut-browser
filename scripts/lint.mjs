import { execSync } from "node:child_process";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

// Lấy danh sách file truyền vào
const files = process.argv.slice(2).filter(f => !f.startsWith("-"));

if (files.length === 0) {
  // Chạy chế độ mặc định (toàn bộ dự án)
  console.log("Linting entire project...");
  try {
    execSync("pnpm lint:js && pnpm lint:rust && pnpm lint:spell", { stdio: "inherit", cwd: rootDir });
  } catch (err) {
    process.exit(1);
  }
} else {
  // Chạy chế độ lint từng file cụ thể
  for (let file of files) {
    // Chuẩn hóa path tương đối từ root
    const normalizedPath = file.replace(/\\/g, "/");
    const absolutePath = resolve(rootDir, normalizedPath);
    const relativePath = relative(rootDir, absolutePath).replace(/\\/g, "/");

    console.log(`Linting: ${relativePath}`);

    try {
      if (relativePath.endsWith(".rs")) {
        // Rust file clippy lint
        execSync(`node scripts/cargo-clippy.mjs`, { stdio: "inherit", cwd: rootDir });
      } else if (
        relativePath.endsWith(".ts") ||
        relativePath.endsWith(".tsx") ||
        relativePath.endsWith(".js") ||
        relativePath.endsWith(".jsx") ||
        relativePath.endsWith(".json") ||
        relativePath.endsWith(".css")
      ) {
        if (relativePath.startsWith("donut-sync/")) {
          const syncFileRelative = relative(resolve(rootDir, "donut-sync"), absolutePath).replace(/\\/g, "/");
          execSync(`npx biome check ${syncFileRelative}`, { stdio: "inherit", cwd: resolve(rootDir, "donut-sync") });
        } else {
          execSync(`npx biome check ${relativePath}`, { stdio: "inherit", cwd: rootDir });
        }
      } else {
        console.log(`Unsupported file type for linting: ${relativePath}`);
      }

      // Check typos cho file này nếu typos được hỗ trợ
      try {
        execSync(`typos ${relativePath}`, { stdio: "inherit", cwd: rootDir });
      } catch (err) {
        // Bỏ qua lỗi nếu command typos không tồn tại hoặc lỗi nhẹ
      }

    } catch (err) {
      console.error(`Failed to lint: ${relativePath}`);
      process.exit(1);
    }
  }
}
