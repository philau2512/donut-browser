import fs from 'fs';
import path from 'path';

// Commands that are intentionally not used in the frontend
// but are used via MCP server or other programmatic APIs
const mcpOnlyCommands = [
  "connect_vpn",
  "disconnect_vpn",
  "get_vpn_status",
  "get_vpn_config",
  "list_active_vpn_connections",
  "export_profile_cookies",
  "update_extension",
  "set_extension_sync_enabled",
  "set_extension_group_sync_enabled",
  "get_team_lock_status",
  "generate_sample_fingerprint",
  "cloud_get_wayfern_token",
  "cloud_refresh_wayfern_token",
  "lock_profile",
];

const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

function extractTauriCommands(libRsPath) {
  const content = fs.readFileSync(libRsPath, 'utf-8');
  const startIdx = content.indexOf("tauri::generate_handler![");
  if (startIdx === -1) {
    throw new Error("Could not find tauri::generate_handler![ in lib.rs");
  }
  const endIdx = content.indexOf("])", startIdx);
  if (endIdx === -1) {
    throw new Error("Could not find closing ]) for generate_handler! in lib.rs");
  }
  const handlerContent = content.substring(startIdx + 25, endIdx);
  const lines = handlerContent.split("\n");
  const commands = [];

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("//")) {
      continue;
    }
    let command = line;
    if (command.endsWith(",")) {
      command = command.slice(0, -1).trim();
    }
    if (!command) continue;

    // Strip module prefix (e.g., "cloud_auth::cloud_get_user" -> "cloud_get_user")
    const parts = command.split("::");
    const commandName = parts[parts.length - 1].trim();
    if (commandName) {
      commands.push(commandName);
    }
  }

  return commands;
}

function getFrontendFiles(dir) {
  let files = [];
  if (!fs.existsSync(dir)) {
    return files;
  }
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      files = files.concat(getFrontendFiles(filePath));
    } else {
      const ext = path.extname(filePath);
      if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        files.push(filePath);
      }
    }
  }
  return files;
}

function isCommandUsed(fileContents, command) {
  const invokeRegex = new RegExp(`invoke\\s*(?:<[^>]*>)?\\s*\\(\\s*['"\`]${command}['"\`]`, 'g');
  for (const content of fileContents) {
    // Reset regex index
    invokeRegex.lastIndex = 0;
    if (invokeRegex.test(content)) {
      return true;
    }
    if (content.includes(`"${command}"`) || content.includes(`'${command}'`) || content.includes(`\`${command}\``)) {
      return true;
    }
    const invokePos = content.indexOf("invoke");
    if (invokePos !== -1) {
      const afterInvoke = content.substring(invokePos);
      const cmdPos = afterInvoke.indexOf(`"${command}"`);
      if (cmdPos !== -1 && cmdPos < 100) {
        return true;
      }
      const cmdPosSingle = afterInvoke.indexOf(`'${command}'`);
      if (cmdPosSingle !== -1 && cmdPosSingle < 100) {
        return true;
      }
      const cmdPosBacktick = afterInvoke.indexOf(`\`${command}\``);
      if (cmdPosBacktick !== -1 && cmdPosBacktick < 100) {
        return true;
      }
    }
  }
  return false;
}

function main() {
  console.log("🔍 Checking for unused Tauri commands...");
  try {
    const libRunRsPath = path.resolve('src-tauri/src/lib_run.rs');
    const srcDir = path.resolve('src');

    const commands = extractTauriCommands(libRunRsPath);
    console.log(`Found ${commands.length} registered Tauri commands in lib_run.rs`);

    const frontendFiles = getFrontendFiles(srcDir);
    console.log(`Scanning ${frontendFiles.length} frontend files in src/...`);

    const fileContents = frontendFiles.map(file => fs.readFileSync(file, 'utf-8'));

    const unusedCommands = [];
    const usedCommands = [];

    for (const command of commands) {
      if (mcpOnlyCommands.includes(command)) {
        usedCommands.push(command);
        if (verbose) {
          console.log(`✅ ${command} (MCP-only)`);
        }
        continue;
      }

      if (isCommandUsed(fileContents, command)) {
        usedCommands.push(command);
        if (verbose) {
          console.log(`✅ ${command}`);
        }
      } else {
        unusedCommands.push(command);
        if (verbose) {
          console.log(`❌ ${command} (UNUSED)`);
        }
      }
    }

    console.log("\n📊 Summary:");
    console.log(`  ✅ Used commands: ${usedCommands.length}`);
    console.log(`  ❌ Unused/mismatched commands: ${unusedCommands.length}`);

    if (unusedCommands.length > 0) {
      console.error(`\n🚨 Error: Found ${unusedCommands.length} unused/mismatched Tauri commands:`);
      console.error(unusedCommands.map(cmd => `  - ${cmd}`).join("\n"));
      console.error("\nThese commands are registered in `tauri::generate_handler!` in `lib.rs` but not used in frontend code.");
      console.error("If they are only used by the MCP server, add them to `mcpOnlyCommands` whitelist in `scripts/check-unused-commands.mjs`.");
      console.error("Otherwise, remove them from `lib.rs` or implement their frontend usage.");
      process.exit(1);
    }

    console.log("\n🎉 All registered Tauri commands are used in the frontend!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Static analysis failed:", error.message);
    process.exit(1);
  }
}

main();
