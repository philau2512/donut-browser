impl BrowserRunner {
  /// Helper method to find browser process by profile path
  fn find_browser_process_by_profile(
    &self,
    profile: &BrowserProfile,
  ) -> Result<u32, Box<dyn std::error::Error + Send + Sync>> {
    let system = System::new_all();
    let profiles_dir = self.profile_manager.get_profiles_dir();
    let profile_data_path = profile.get_profile_data_path(&profiles_dir);
    let profile_data_path_str = profile_data_path.to_string_lossy();

    log::info!(
      "Searching for {} browser process with profile path: {}",
      profile.browser,
      profile_data_path_str
    );

    for (pid, process) in system.processes() {
      let cmd = process.cmd();
      if cmd.is_empty() {
        continue;
      }

      // Check if this is the right browser executable first
      let exe_name = process.name().to_string_lossy().to_lowercase();
      let is_correct_browser = match profile.browser.as_str() {
        "firefox" => {
          exe_name.contains("firefox")
            && !exe_name.contains("developer")
            && !exe_name.contains("camoufox")
        }
        "firefox-developer" => {
          // More flexible detection for Firefox Developer Edition
          (exe_name.contains("firefox") && exe_name.contains("developer"))
            || (exe_name.contains("firefox")
              && cmd.iter().any(|arg| {
                let arg_str = arg.to_str().unwrap_or("");
                arg_str.contains("Developer")
                  || arg_str.contains("developer")
                  || arg_str.contains("FirefoxDeveloperEdition")
                  || arg_str.contains("firefox-developer")
              }))
            || exe_name == "firefox" // Firefox Developer might just show as "firefox"
        }
        "zen" => exe_name.contains("zen"),
        "chromium" => exe_name.contains("chromium") || exe_name.contains("chrome"),
        "brave" => exe_name.contains("brave") || exe_name.contains("Brave"),
        _ => false,
      };

      if !is_correct_browser {
        continue;
      }

      // Check for profile path match with improved logic
      let profile_path_match = if matches!(
        profile.browser.as_str(),
        "firefox" | "firefox-developer" | "zen"
      ) {
        // Firefox-based browsers: look for -profile argument followed by path
        let mut found_profile_arg = false;
        for (i, arg) in cmd.iter().enumerate() {
          if let Some(arg_str) = arg.to_str() {
            if arg_str == "-profile" && i + 1 < cmd.len() {
              if let Some(next_arg) = cmd.get(i + 1).and_then(|a| a.to_str()) {
                if next_arg == profile_data_path_str {
                  found_profile_arg = true;
                  break;
                }
              }
            }
            // Also check for combined -profile=path format
            if arg_str == format!("-profile={profile_data_path_str}") {
              found_profile_arg = true;
              break;
            }
            // Check if the argument is the profile path directly
            if arg_str == profile_data_path_str {
              found_profile_arg = true;
              break;
            }
          }
        }
        found_profile_arg
      } else {
        // Chromium-based browsers: look for --user-data-dir argument
        cmd.iter().any(|s| {
          if let Some(arg) = s.to_str() {
            arg == format!("--user-data-dir={profile_data_path_str}")
              || arg == profile_data_path_str
          } else {
            false
          }
        })
      };

      if profile_path_match {
        let pid_u32 = pid.as_u32();
        log::info!(
          "Found matching {} browser process with PID: {} for profile: {} (ID: {})",
          profile.browser,
          pid_u32,
          profile.name,
          profile.id
        );
        return Ok(pid_u32);
      }
    }

    Err(
      format!(
        "No running {} browser process found for profile: {} (ID: {})",
        profile.browser, profile.name, profile.id
      )
      .into(),
    )
  }

  pub async fn open_url_with_profile(
    &self,
    app_handle: tauri::AppHandle,
    profile_id: String,
    url: String,
  ) -> Result<(), String> {
    // Get the profile by name
    let profiles = self
      .profile_manager
      .list_profiles()
      .map_err(|e| format!("Failed to list profiles: {e}"))?;
    let profile = profiles
      .into_iter()
      .find(|p| p.id.to_string() == profile_id)
      .ok_or_else(|| format!("Profile '{profile_id}' not found"))?;

    if profile.is_cross_os() {
      return Err(format!(
        "Cannot open URL with profile '{}': this profile was created on {} and cannot be used on a different operating system",
        profile.name,
        profile.host_os.as_deref().unwrap_or("another OS"),
      ));
    }

    log::info!("Opening URL '{url}' with profile '{profile_id}'");

    // Use launch_or_open_url which handles both launching new instances and opening in existing ones
    self
      .launch_or_open_url(app_handle, &profile, Some(url.clone()), None)
      .await
      .map_err(|e| {
        log::info!("Failed to open URL with profile '{profile_id}': {e}");
        format!("Failed to open URL with profile: {e}")
      })?;

    log::info!("Successfully opened URL '{url}' with profile '{profile_id}'");
    Ok(())
  }
}
