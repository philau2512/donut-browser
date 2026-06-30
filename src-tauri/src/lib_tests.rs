#[cfg(test)]
mod tests {
  use std::fs;

  #[test]
  fn test_no_unused_tauri_commands() {
    check_unused_commands(false); // Run in strict mode for CI
  }

  #[test]
  fn test_unused_tauri_commands_detailed() {
    check_unused_commands(true); // Run in verbose mode for development
  }

  fn check_unused_commands(verbose: bool) {
    // Commands that are intentionally not used in the frontend
    // but are used via MCP server or other programmatic APIs
    let mcp_only_commands = [
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
      "validate_automation_flow",
    ];
    let lib_rs_content = fs::read_to_string("src/lib_run.rs").expect("Failed to read lib_run.rs");
    let commands = extract_tauri_commands(&lib_rs_content);

    // Get all frontend files
    let frontend_files = get_frontend_files("../src");

    // Check which commands are actually used
    let mut unused_commands = Vec::new();
    let mut used_commands = Vec::new();

    for command in &commands {
      // Skip commands that are intentionally MCP-only
      if mcp_only_commands.contains(&command.as_str()) {
        used_commands.push(command.clone());
        if verbose {
          println!("✅ {command} (MCP-only)");
        }
        continue;
      }

      let mut is_used = false;

      for file_content in &frontend_files {
        // More comprehensive search for command usage
        if is_command_used(file_content, command) {
          is_used = true;
          break;
        }
      }

      if is_used {
        used_commands.push(command.clone());
        if verbose {
          println!("✅ {command}");
        }
      } else {
        unused_commands.push(command.clone());
        if verbose {
          println!("❌ {command} (UNUSED)");
        }
      }
    }

    if verbose {
      println!("\n📊 Summary:");
      println!("  ✅ Used commands: {}", used_commands.len());
      println!("  ❌ Unused commands: {}", unused_commands.len());
    }

    if !unused_commands.is_empty() {
      let message = format!(
        "Found {} unused Tauri commands: {}\n\nThese commands are exported in generate_handler! but not used in the frontend.\nConsider removing them or add them to the allowlist if they're used elsewhere.\n\nRun `pnpm check-unused-commands` for detailed analysis.",
        unused_commands.len(),
        unused_commands.join(", ")
      );

      if verbose {
        println!("\n🚨 {message}");
      } else {
        panic!("{}", message);
      }
    } else if verbose {
      println!("\n🎉 All exported commands are being used!");
    } else {
      println!(
        "✅ All {} exported Tauri commands are being used in the frontend",
        commands.len()
      );
    }
  }

  fn is_command_used(content: &str, command: &str) -> bool {
    // Check various patterns for invoke usage
    let patterns = vec![
      format!("invoke<{}>(\"{}\"", "", command), // invoke<Type>("command"
      format!("invoke(\"{}\"", command),         // invoke("command"
      format!("invoke<{}>(\"{}\",", "", command), // invoke<Type>("command",
      format!("invoke(\"{}\",", command),        // invoke("command",
      format!("\"{}\"", command),                // Just the command name in quotes
    ];

    for pattern in patterns {
      if content.contains(&pattern) {
        return true;
      }
    }

    // Also check for the command name appearing after "invoke" within a reasonable distance
    if let Some(invoke_pos) = content.find("invoke") {
      let after_invoke = &content[invoke_pos..];
      if let Some(cmd_pos) = after_invoke.find(&format!("\"{command}\"")) {
        // If the command appears within 100 characters of "invoke", consider it used
        if cmd_pos < 100 {
          return true;
        }
      }
    }

    false
  }

  fn extract_tauri_commands(content: &str) -> Vec<String> {
    let mut commands = Vec::new();

    // Find the generate_handler! macro
    if let Some(start) = content.find("tauri::generate_handler![") {
      if let Some(end) = content[start..].find("])") {
        let handler_content = &content[start + 25..start + end]; // Skip "tauri::generate_handler!["

        // Extract command names
        for line in handler_content.lines() {
          let line = line.trim();
          if !line.is_empty() && !line.starts_with("//") {
            // Remove trailing comma and whitespace
            let command = line.trim_end_matches(',').trim();
            if !command.is_empty() {
              // Strip module prefix (e.g., "cloud_auth::cloud_get_user" -> "cloud_get_user")
              let command = command.rsplit("::").next().unwrap_or(command);
              commands.push(command.to_string());
            }
          }
        }
      }
    }

    commands
  }

  fn get_frontend_files(src_dir: &str) -> Vec<String> {
    let mut files_content = Vec::new();

    if let Ok(entries) = fs::read_dir(src_dir) {
      for entry in entries.flatten() {
        let path = entry.path();

        if path.is_dir() {
          // Recursively read subdirectories
          let subdir_files = get_frontend_files(&path.to_string_lossy());
          files_content.extend(subdir_files);
        } else if let Some(extension) = path.extension() {
          if matches!(
            extension.to_str(),
            Some("ts") | Some("tsx") | Some("js") | Some("jsx")
          ) {
            if let Ok(content) = fs::read_to_string(&path) {
              files_content.push(content);
            }
          }
        }
      }
    }

    files_content
  }
}
