import { execSync } from "node:child_process";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

// Lấy danh sách file truyền vào
const files = process.argv.slice(2).filter(f => !f.startsWith("-"));

if (files.length === 0) {
  // Chạy chế độ mặc định (toàn bộ dự án)
  console.log("Formatting entire project...");
  try {
    execSync("pnpm format:js && pnpm format:rust", { stdio: "inherit", cwd: rootDir });
  } catch (err) {
    process.exit(1);
  }
} else {
  // Chạy chế độ format từng file cụ thể
  for (let file of files) {
    // Chuẩn hóa path tương đối từ root
    const normalizedPath = file.replace(/\\/g, "/");
    const absolutePath = resolve(rootDir, normalizedPath);
    const relativePath = relative(rootDir, absolutePath).replace(/\\/g, "/");

    console.log(`Formatting: ${relativePath}`);

    try {
      if (relativePath.endsWith(".rs")) {
        // Rust file format
        const rustFileRelative = relative(resolve(rootDir, "src-tauri"), absolutePath).replace(/\\/g, "/");
        execSync(`cargo fmt -- ${rustFileRelative}`, { stdio: "inherit", cwd: resolve(rootDir, "src-tauri") });
      } else if (
        relativePath.endsWith(".ts") ||
        relativePath.endsWith(".tsx") ||
        relativePath.endsWith(".js") ||
        relativePath.endsWith(".jsx") ||
        relativePath.endsWith(".json") ||
        relativePath.endsWith(".css")
      ) {
        if (relativePath.startsWith("donut-sync/")) {
          // Biome format cho donut-sync
          const syncFileRelative = relative(resolve(rootDir, "donut-sync"), absolutePath).replace(/\\/g, "/");
          execSync(`npx biome check --write --unsafe ${syncFileRelative}`, { stdio: "inherit", cwd: resolve(rootDir, "donut-sync") });
        } else {
          // Biome format cho frontend
          execSync(`npx biome check --write --unsafe ${relativePath}`, { stdio: "inherit", cwd: rootDir });
        }
      } else {
        console.log(`Unsupported file type for formatting: ${relativePath}`);
      }
    } catch (err) {
      console.error(`Failed to format: ${relativePath}`);
      process.exit(1);
    }
  }
}
