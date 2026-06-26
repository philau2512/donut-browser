impl ExtensionManager {
  pub fn create_group(&self, name: String) -> Result<ExtensionGroup, Box<dyn std::error::Error>> {
    let mut data = self.load_groups_data()?;

    if data.groups.iter().any(|g| g.name == name) {
      return Err(format!("Extension group with name '{name}' already exists").into());
    }

    let now = now_secs();
    let group = ExtensionGroup {
      id: uuid::Uuid::new_v4().to_string(),
      name,
      extension_ids: Vec::new(),
      created_at: now,
      updated_at: now,
      sync_enabled: crate::sync::is_sync_configured(),
      last_sync: None,
    };

    data.groups.push(group.clone());
    self.save_groups_data(&data)?;

    if let Err(e) = events::emit_empty("extensions-changed") {
      log::error!("Failed to emit extensions-changed event: {e}");
    }

    if group.sync_enabled {
      if let Some(scheduler) = crate::sync::get_global_scheduler() {
        let id = group.id.clone();
        tauri::async_runtime::spawn(async move {
          scheduler.queue_extension_group_sync(id).await;
        });
      }
    }

    Ok(group)
  }

  pub fn get_group(&self, id: &str) -> Result<ExtensionGroup, Box<dyn std::error::Error>> {
    let data = self.load_groups_data()?;
    data
      .groups
      .into_iter()
      .find(|g| g.id == id)
      .ok_or_else(|| format!("Extension group with id '{id}' not found").into())
  }

  pub fn list_groups(&self) -> Result<Vec<ExtensionGroup>, Box<dyn std::error::Error>> {
    let data = self.load_groups_data()?;
    Ok(data.groups)
  }

  pub fn update_group(
    &self,
    id: &str,
    name: Option<String>,
    extension_ids: Option<Vec<String>>,
  ) -> Result<ExtensionGroup, Box<dyn std::error::Error>> {
    let mut data = self.load_groups_data()?;

    if let Some(ref new_name) = name {
      if data
        .groups
        .iter()
        .any(|g| g.name == *new_name && g.id != id)
      {
        return Err(format!("Extension group with name '{new_name}' already exists").into());
      }
    }

    let group = data
      .groups
      .iter_mut()
      .find(|g| g.id == id)
      .ok_or_else(|| format!("Extension group with id '{id}' not found"))?;

    if let Some(new_name) = name {
      group.name = new_name;
    }
    if let Some(new_ids) = extension_ids {
      group.extension_ids = new_ids;
    }
    group.updated_at = now_secs();

    let updated = group.clone();
    self.save_groups_data(&data)?;

    if let Err(e) = events::emit_empty("extensions-changed") {
      log::error!("Failed to emit extensions-changed event: {e}");
    }

    if updated.sync_enabled {
      if let Some(scheduler) = crate::sync::get_global_scheduler() {
        let gid = updated.id.clone();
        tauri::async_runtime::spawn(async move {
          scheduler.queue_extension_group_sync(gid).await;
        });
      }
    }

    Ok(updated)
  }

  pub fn delete_group(
    &self,
    app_handle: &tauri::AppHandle,
    id: &str,
  ) -> Result<(), Box<dyn std::error::Error>> {
    let mut data = self.load_groups_data()?;

    let was_sync_enabled = data
      .groups
      .iter()
      .find(|g| g.id == id)
      .map(|g| g.sync_enabled)
      .unwrap_or(false);

    let initial_len = data.groups.len();
    data.groups.retain(|g| g.id != id);
    if data.groups.len() == initial_len {
      return Err(format!("Extension group with id '{id}' not found").into());
    }
    self.save_groups_data(&data)?;

    // Clear extension_group_id from profiles that used this group
    let profile_manager = crate::profile::ProfileManager::instance();
    if let Ok(profiles) = profile_manager.list_profiles() {
      for mut p in profiles {
        if p.extension_group_id.as_deref() == Some(id) {
          p.extension_group_id = None;
          let _ = profile_manager.save_profile(&p);
        }
      }
    }

    if was_sync_enabled {
      let group_id_owned = id.to_string();
      let app_handle_clone = app_handle.clone();
      tauri::async_runtime::spawn(async move {
        match crate::sync::SyncEngine::create_from_settings(&app_handle_clone).await {
          Ok(engine) => {
            if let Err(e) = engine.delete_extension_group(&group_id_owned).await {
              log::warn!(
                "Failed to delete extension group {} from sync: {}",
                group_id_owned,
                e
              );
            }
          }
          Err(e) => {
            log::debug!("Sync not configured, skipping remote deletion: {}", e);
          }
        }
      });
    }

    if let Err(e) = events::emit_empty("extensions-changed") {
      log::error!("Failed to emit extensions-changed event: {e}");
    }

    Ok(())
  }

  pub fn add_extension_to_group(
    &self,
    group_id: &str,
    extension_id: &str,
  ) -> Result<ExtensionGroup, Box<dyn std::error::Error>> {
    // Verify extension exists
    let _ = self.get_extension(extension_id)?;

    let mut data = self.load_groups_data()?;
    let group = data
      .groups
      .iter_mut()
      .find(|g| g.id == group_id)
      .ok_or_else(|| format!("Extension group with id '{group_id}' not found"))?;

    if !group.extension_ids.contains(&extension_id.to_string()) {
      group.extension_ids.push(extension_id.to_string());
      group.updated_at = now_secs();
    }

    let updated = group.clone();
    self.save_groups_data(&data)?;

    if let Err(e) = events::emit_empty("extensions-changed") {
      log::error!("Failed to emit extensions-changed event: {e}");
    }

    if updated.sync_enabled {
      if let Some(scheduler) = crate::sync::get_global_scheduler() {
        let gid = updated.id.clone();
        tauri::async_runtime::spawn(async move {
          scheduler.queue_extension_group_sync(gid).await;
        });
      }
    }

    Ok(updated)
  }

  pub fn remove_extension_from_group(
    &self,
    group_id: &str,
    extension_id: &str,
  ) -> Result<ExtensionGroup, Box<dyn std::error::Error>> {
    let mut data = self.load_groups_data()?;
    let group = data
      .groups
      .iter_mut()
      .find(|g| g.id == group_id)
      .ok_or_else(|| format!("Extension group with id '{group_id}' not found"))?;

    group.extension_ids.retain(|eid| eid != extension_id);
    group.updated_at = now_secs();

    let updated = group.clone();
    self.save_groups_data(&data)?;

    if let Err(e) = events::emit_empty("extensions-changed") {
      log::error!("Failed to emit extensions-changed event: {e}");
    }

    if updated.sync_enabled {
      if let Some(scheduler) = crate::sync::get_global_scheduler() {
        let gid = updated.id.clone();
        tauri::async_runtime::spawn(async move {
          scheduler.queue_extension_group_sync(gid).await;
        });
      }
    }

    Ok(updated)
  }

  // Sync helpers

  pub fn update_extension_internal(
    &self,
    ext: &Extension,
  ) -> Result<(), Box<dyn std::error::Error>> {
    let metadata_path = self.get_metadata_path(&ext.id);
    if let Some(parent) = metadata_path.parent() {
      fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(ext)?;
    fs::write(metadata_path, json)?;
    Ok(())
  }

  pub fn upsert_extension_internal(
    &self,
    ext: &Extension,
  ) -> Result<(), Box<dyn std::error::Error>> {
    self.update_extension_internal(ext)
  }

  pub fn delete_extension_internal(&self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
    let ext_dir = self.get_extension_dir(id);
    if ext_dir.exists() {
      fs::remove_dir_all(&ext_dir)?;
    }
    // Remove from all groups
    let mut groups_data = self.load_groups_data()?;
    for group in &mut groups_data.groups {
      group.extension_ids.retain(|eid| eid != id);
    }
    self.save_groups_data(&groups_data)?;
    Ok(())
  }

  pub fn update_group_internal(
    &self,
    group: &ExtensionGroup,
  ) -> Result<(), Box<dyn std::error::Error>> {
    let mut data = self.load_groups_data()?;
    if let Some(existing) = data.groups.iter_mut().find(|g| g.id == group.id) {
      existing.name = group.name.clone();
      existing.extension_ids = group.extension_ids.clone();
      existing.sync_enabled = group.sync_enabled;
      existing.last_sync = group.last_sync;
      existing.updated_at = group.updated_at;
      self.save_groups_data(&data)?;
    }
    Ok(())
  }

  pub fn upsert_group_internal(
    &self,
    group: &ExtensionGroup,
  ) -> Result<(), Box<dyn std::error::Error>> {
    let mut data = self.load_groups_data()?;
    if let Some(existing) = data.groups.iter_mut().find(|g| g.id == group.id) {
      existing.name = group.name.clone();
      existing.extension_ids = group.extension_ids.clone();
      existing.sync_enabled = group.sync_enabled;
      existing.last_sync = group.last_sync;
      existing.updated_at = group.updated_at;
    } else {
      data.groups.push(group.clone());
    }
    self.save_groups_data(&data)?;
    Ok(())
  }

  pub fn delete_group_internal(&self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
    let mut data = self.load_groups_data()?;
    data.groups.retain(|g| g.id != id);
    self.save_groups_data(&data)?;
    Ok(())
  }

  // Compatibility validation

  pub fn validate_group_compatibility(
    &self,
    group_id: &str,
    browser: &str,
  ) -> Result<(), Box<dyn std::error::Error>> {
    let group = self.get_group(group_id)?;
    let browser_type = match browser {
      "camoufox" => "firefox",
      "wayfern" => "chromium",
      _ => return Err(format!("Extensions are not supported for browser '{browser}'").into()),
    };

    for ext_id in &group.extension_ids {
      let ext = self.get_extension(ext_id)?;
      if !ext
        .browser_compatibility
        .contains(&browser_type.to_string())
      {
        return Err(
          format!(
            "Extension '{}' ({}) is not compatible with {} browsers",
            ext.name, ext.file_type, browser_type
          )
          .into(),
        );
      }
    }

    Ok(())
  }

  // Launch-time installation

  pub fn install_extensions_for_profile(
    &self,
    profile: &crate::profile::BrowserProfile,
    profile_data_path: &std::path::Path,
  ) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let group_id = match &profile.extension_group_id {
      Some(id) => id,
      None => return Ok(Vec::new()),
    };

    let group = self.get_group(group_id)?;
    if group.extension_ids.is_empty() {
      return Ok(Vec::new());
    }

    let browser_type = match profile.browser.as_str() {
      "camoufox" => "firefox",
      "wayfern" => "chromium",
      _ => return Ok(Vec::new()),
    };

    let mut extension_paths = Vec::new();

    match browser_type {
      "firefox" => {
        let extensions_dir = profile_data_path.join("extensions");
        // Clear existing extensions
        if extensions_dir.exists() {
          fs::remove_dir_all(&extensions_dir)?;
        }
        fs::create_dir_all(&extensions_dir)?;

        for ext_id in &group.extension_ids {
          if let Ok(ext) = self.get_extension(ext_id) {
            if !ext.browser_compatibility.contains(&"firefox".to_string()) {
              continue;
            }
            let src_file = self.get_file_dir(ext_id).join(&ext.file_name);
            if !src_file.exists() {
              continue;
            }

            // Firefox/Camoufox only loads sideloaded .xpi files whose filename
            // matches `browser_specific_settings.gecko.id` from the manifest.
            // Prefer the cached value; fall back to reading the manifest now
            // for extensions added before the field existed.
            let gecko_id = if let Some(ref id) = ext.gecko_id {
              Some(id.clone())
            } else if let Ok(data) = fs::read(&src_file) {
              extract_gecko_id(&data, &ext.file_type)
            } else {
              None
            };

            let Some(gecko_id) = gecko_id else {
              log::warn!(
                "Skipping Firefox extension '{}': could not determine gecko id from manifest.json",
                ext.name
              );
              continue;
            };

            let dest = extensions_dir.join(format!("{gecko_id}.xpi"));
            fs::copy(&src_file, &dest)?;
            extension_paths.push(dest.to_string_lossy().to_string());
          }
        }
      }
      "chromium" => {
        // For Chromium, unpack extensions and return paths for --load-extension
        let unpacked_base = extensions_base_dir().join("unpacked");
        if unpacked_base.exists() {
          fs::remove_dir_all(&unpacked_base)?;
        }
        fs::create_dir_all(&unpacked_base)?;

        for ext_id in &group.extension_ids {
          if let Ok(ext) = self.get_extension(ext_id) {
            if !ext.browser_compatibility.contains(&"chromium".to_string()) {
              continue;
            }
            let src_file = self.get_file_dir(ext_id).join(&ext.file_name);
            if src_file.exists() {
              let unpack_dir = unpacked_base.join(ext_id);
              fs::create_dir_all(&unpack_dir)?;

              // Extract .crx or .zip
              match Self::unpack_extension(&src_file, &unpack_dir) {
                Ok(()) => {
                  extension_paths.push(unpack_dir.to_string_lossy().to_string());
                }
                Err(e) => {
                  log::warn!("Failed to unpack extension '{}': {}", ext.name, e);
                }
              }
            }
          }
        }
      }
      _ => {}
    }

    Ok(extension_paths)
  }

  fn unpack_extension(
    src: &std::path::Path,
    dest: &std::path::Path,
  ) -> Result<(), Box<dyn std::error::Error>> {
    let data = fs::read(src)?;
    let mut archive = match zip::ZipArchive::new(std::io::Cursor::new(data.as_slice())) {
      Ok(a) => a,
      Err(e) => {
        // CRX files have a header before the ZIP data — try skipping the CRX header
        if let Some(zip_start) = Self::find_zip_start(&data) {
          zip::ZipArchive::new(std::io::Cursor::new(&data[zip_start..]))
            .map_err(|e2| format!("Failed to open CRX as zip after header skip: {e2}"))?
        } else {
          return Err(format!("Failed to open as zip: {e}").into());
        }
      }
    };
    for i in 0..archive.len() {
      let mut file = archive.by_index(i)?;
      let out_path = dest.join(file.mangled_name());

      if file.is_dir() {
        fs::create_dir_all(&out_path)?;
      } else {
        if let Some(parent) = out_path.parent() {
          fs::create_dir_all(parent)?;
        }
        let mut out_file = fs::File::create(&out_path)?;
        std::io::copy(&mut file, &mut out_file)?;
      }
    }

    Ok(())
  }

  fn find_zip_start(data: &[u8]) -> Option<usize> {
    // ZIP local file header magic: PK\x03\x04
    let magic = [0x50, 0x4B, 0x03, 0x04];
    data.windows(4).position(|window| window == magic)
  }

  pub fn ensure_icons_extracted(&self) {
    let extensions = match self.list_extensions() {
      Ok(exts) => exts,
      Err(_) => return,
    };

    for ext in extensions {
      let ext_dir = self.get_extension_dir(&ext.id);
      let has_icon = ext_dir
        .read_dir()
        .map(|entries| {
          entries
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().starts_with("icon."))
        })
        .unwrap_or(false);

      if has_icon {
        continue;
      }

      let file_dir = self.get_file_dir(&ext.id);
      let file_path = file_dir.join(&ext.file_name);
      if let Ok(file_data) = fs::read(&file_path) {
        if let Some((icon_data, icon_ext)) = extract_icon_from_archive(&file_data, &ext.file_type) {
          let icon_path = ext_dir.join(format!("icon.{icon_ext}"));
          let _ = fs::write(icon_path, icon_data);
        }
      }

      let needs_meta_backfill = ext.version.is_none() && ext.description.is_none();
      let needs_gecko_backfill =
        ext.gecko_id.is_none() && ext.browser_compatibility.iter().any(|b| b == "firefox");

      if needs_meta_backfill || needs_gecko_backfill {
        let file_path = file_dir.join(&ext.file_name);
        if let Ok(file_data) = fs::read(&file_path) {
          let mut updated_ext = ext.clone();
          let mut changed = false;

          if needs_meta_backfill {
            let (manifest_name, version, description, author, homepage_url) =
              extract_manifest_metadata(&file_data, &ext.file_type);
            if version.is_some()
              || description.is_some()
              || author.is_some()
              || homepage_url.is_some()
              || manifest_name.is_some()
            {
              if let Some(v) = version {
                updated_ext.version = Some(v);
              }
              if let Some(d) = description {
                updated_ext.description = Some(d);
              }
              if let Some(a) = author {
                updated_ext.author = Some(a);
              }
              if let Some(h) = homepage_url {
                updated_ext.homepage_url = Some(h);
              }
              changed = true;
            }
          }

          if needs_gecko_backfill {
            if let Some(gid) = extract_gecko_id(&file_data, &ext.file_type) {
              updated_ext.gecko_id = Some(gid);
              changed = true;
            }
          }

          if changed {
            let metadata_path = self.get_metadata_path(&ext.id);
            if let Ok(json) = serde_json::to_string_pretty(&updated_ext) {
              let _ = fs::write(metadata_path, json);
            }
          }
        }
      }
    }
  }

  pub fn get_extension_icon(&self, ext_id: &str) -> Option<String> {
    let ext_dir = self.get_extension_dir(ext_id);
    let entries = ext_dir.read_dir().ok()?;
    for entry in entries.filter_map(|e| e.ok()) {
      let name = entry.file_name().to_string_lossy().to_string();
      if name.starts_with("icon.") {
        let icon_path = entry.path();
        let data = fs::read(&icon_path).ok()?;
        let ext = name.rsplit('.').next().unwrap_or("png");
        let mime = match ext {
          "png" => "image/png",
          "jpg" | "jpeg" => "image/jpeg",
          "svg" => "image/svg+xml",
          "gif" => "image/gif",
          "webp" => "image/webp",
          _ => "image/png",
        };
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
        return Some(format!("data:{};base64,{}", mime, b64));
      }
    }
    None
  }
}
