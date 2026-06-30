impl ProfileImporter {
  #[allow(clippy::too_many_arguments)]
  pub async fn import_profile(
    &self,
    app_handle: &tauri::AppHandle,
    source_path: &str,
    browser_type: &str,
    new_profile_name: &str,
    proxy_id: Option<String>,
    _camoufox_config: Option<CamoufoxConfig>,
    wayfern_config: Option<WayfernConfig>,
  ) -> Result<(), Box<dyn std::error::Error>> {
    let source_path = Path::new(source_path);
    if !source_path.exists() {
      return Err("Source profile path does not exist".into());
    }

    let mapped = map_browser_type(browser_type);

    if let Some(ref pid) = proxy_id {
      if PROXY_MANAGER.is_cloud_or_derived(pid)
        || pid == crate::proxy::proxy_manager::CLOUD_PROXY_ID
      {
        crate::api::cloud_auth::CLOUD_AUTH.sync_cloud_proxy().await;
      }
    }

    let existing_profiles = self.profile_manager.list_profiles()?;
    if existing_profiles
      .iter()
      .any(|p| p.name.to_lowercase() == new_profile_name.to_lowercase())
    {
      return Err(format!("Profile with name '{new_profile_name}' already exists").into());
    }

    let profile_id = uuid::Uuid::new_v4();
    let profiles_dir = self.profile_manager.get_profiles_dir();
    let new_profile_uuid_dir = profiles_dir.join(profile_id.to_string());
    let new_profile_data_dir = new_profile_uuid_dir.join("profile");

    create_dir_all(&new_profile_uuid_dir)?;
    create_dir_all(&new_profile_data_dir)?;

    Self::copy_directory_recursive(source_path, &new_profile_data_dir)?;

    let version = self.get_default_version_for_browser(mapped)?;

    let final_camoufox_config: Option<CamoufoxConfig> = None;

    let final_wayfern_config = if mapped == "wayfern" {
      let mut config = wayfern_config.unwrap_or_default();

      if let Some(ref proxy_id_val) = proxy_id {
        if let Some(proxy_settings) = PROXY_MANAGER.get_proxy_settings_by_id(proxy_id_val) {
          let proxy_url = if let (Some(username), Some(password)) =
            (&proxy_settings.username, &proxy_settings.password)
          {
            format!(
              "{}://{}:{}@{}:{}",
              proxy_settings.proxy_type.to_lowercase(),
              username,
              password,
              proxy_settings.host,
              proxy_settings.port
            )
          } else {
            format!(
              "{}://{}:{}",
              proxy_settings.proxy_type.to_lowercase(),
              proxy_settings.host,
              proxy_settings.port
            )
          };
          config.proxy = Some(proxy_url);
        }
      }

      if config.fingerprint.is_none() {
        let temp_profile = BrowserProfile {
          id: uuid::Uuid::new_v4(),
          name: new_profile_name.to_string(),
          browser: mapped.to_string(),
          version: version.clone(),
          proxy_id: proxy_id.clone(),
          vpn_id: None,
          launch_hook: None,
          automation: None,
          process_id: None,
          last_launch: None,
          release_type: "stable".to_string(),
          camoufox_config: None,
          wayfern_config: None,
        };
        if let Ok(fp) = self.wayfern_manager.generate_fingerprint(&temp_profile).await {
          config.fingerprint = Some(fp);
        }
      }

      Some(config)
    } else {
      None
    };

    let profile = BrowserProfile {
      id: profile_id,
      name: new_profile_name.to_string(),
      browser: mapped.to_string(),
      version,
      proxy_id,
      vpn_id: None,
      launch_hook: None,
      automation: None,
      process_id: None,
      last_launch: None,
      release_type: "stable".to_string(),
      camoufox_config: final_camoufox_config,
      wayfern_config: final_wayfern_config,
    };

    self.profile_manager.save_profile(&profile)?;

    log::info!(
      "Successfully imported profile '{}' from '{}'",
      new_profile_name,
      source_path.display()
    );

    Ok(())
  }

  fn get_default_version_for_browser(
    &self,
    browser_type: &str,
  ) -> Result<String, Box<dyn std::error::Error>> {
    let downloaded_versions = self
      .downloaded_browsers_registry
      .get_downloaded_versions(browser_type);

    if let Some(version) = downloaded_versions.first() {
      return Ok(version.clone());
    }

    Err(
      format!(
        "No downloaded versions found for browser '{}'. Please download a version of {} first before importing profiles.",
        browser_type,
        self.get_browser_display_name(browser_type)
      )
      .into(),
    )
  }

  pub fn copy_directory_recursive(
    source: &Path,
    destination: &Path,
  ) -> Result<(), Box<dyn std::error::Error>> {
    if !destination.exists() {
      create_dir_all(destination)?;
    }

    for entry in fs::read_dir(source)? {
      let entry = entry?;
      let source_path = entry.path();
      let dest_path = destination.join(entry.file_name());

      if source_path.is_dir() {
        Self::copy_directory_recursive(&source_path, &dest_path)?;
      } else {
        fs::copy(&source_path, &dest_path)?;
      }
    }

    Ok(())
  }
}
