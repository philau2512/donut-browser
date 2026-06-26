pub fn run() {
  let args: Vec<String> = env::args().collect();
  let startup_url = args.iter().find(|arg| arg.starts_with("http")).cloned();

  if let Some(url) = startup_url.clone() {
    log::info!("Found startup URL in command line: {url}");
    let mut pending = PENDING_URLS.lock().unwrap();
    pending.push(url.clone());
  }

  let log_file_name = app_dirs::app_name();

  // Honor DONUTBROWSER_DATA_ROOT: when set, logs go to <root>/logs instead of
  // the platform default app log dir, so all on-disk state lives under one root.
  let file_log_target = match app_dirs::log_dir_override() {
    Some(path) => Target::new(TargetKind::Folder {
      path,
      file_name: Some(log_file_name.to_string()),
    }),
    None => Target::new(TargetKind::LogDir {
      file_name: Some(log_file_name.to_string()),
    }),
  };

  tauri::Builder::default()
    .plugin(
      tauri_plugin_log::Builder::new()
        .clear_targets() // Clear default targets to avoid duplicates
        .target(Target::new(TargetKind::Stdout))
        .target(Target::new(TargetKind::Webview))
        .target(file_log_target)
        // 5 MB per rotated file × KeepAll — the previous 100 KB limit
        // truncated useful context in customer support reports; 50 MB
        // turned out to be excessive disk pressure.
        .max_file_size(5 * 1024 * 1024)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
        .level(log::LevelFilter::Info)
        .format(|out, message, record| {
          use chrono::Local;
          let now = Local::now();
          let timestamp = format!(
            "{}.{:03}",
            now.format("%Y-%m-%d %H:%M:%S"),
            now.timestamp_subsec_millis()
          );
          out.finish(format_args!(
            "[{}][{}][{}] {}",
            timestamp,
            record.target(),
            record.level(),
            message
          ))
        })
        .build(),
    )
    .plugin(tauri_plugin_single_instance::init(
      |app_handle, args, _cwd| {
        log::info!("Single instance triggered with args: {args:?}");
        if let Some(window) = app_handle.get_webview_window("main") {
          let _ = window.show();
          let _ = window.set_focus();
          let _ = window.unminimize();
        }
      },
    ))
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_macos_permissions::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    // Persist window size/position across restarts. VISIBLE is excluded
    // because the app hides to tray: restoring visibility would otherwise
    // relaunch with an invisible window after quitting from the tray while
    // hidden. FULLSCREEN is excluded because native fullscreen is disabled
    // (the green button zooms instead) — the maximized flag captures the
    // "filled screen" state, including green-button zoom on macOS.
    .plugin(
      tauri_plugin_window_state::Builder::default()
        .with_state_flags(
          tauri_plugin_window_state::StateFlags::all()
            & !tauri_plugin_window_state::StateFlags::VISIBLE
            & !tauri_plugin_window_state::StateFlags::FULLSCREEN,
        )
        .build(),
    )
    .setup(move |app| { setup_tauri_app(app, startup_url)?; Ok(()) })
    .invoke_handler(tauri::generate_handler![
      confirm_quit,
      hide_to_tray,
      update_tray_menu,
      get_supported_browsers,
      is_browser_supported_on_platform,
      download_browser,
      cancel_download,
      delete_profile,
      clone_profile,
      check_browser_exists,
      create_browser_profile_new,
      list_browser_profiles,
      launch_browser_profile,
      fetch_browser_versions_with_count,
      fetch_browser_versions_cached_first,
      fetch_browser_versions_with_count_cached_first,
      get_downloaded_browser_versions,
      get_all_tags,
      get_browser_release_types,
      update_profile_proxy,
      update_profile_vpn,
      update_profile_tags,
      update_profile_note,
      update_profile_launch_hook,
      update_profile_proxy_bypass_rules,
      update_profile_dns_blocklist,
      check_browser_status,
      kill_browser_profile,
      rename_profile,
      get_app_settings,
      save_app_settings,
      read_log_files,
      open_log_directory,
      get_table_sorting_settings,
      save_table_sorting_settings,
      get_system_language,
      get_system_info,
      dismiss_window_resize_warning,
      get_window_resize_warning_dismissed,
      get_onboarding_completed,
      complete_onboarding,
      clear_all_version_cache_and_refetch,
      is_default_browser,
      open_url_with_profile,
      set_as_default_browser,
      trigger_manual_version_update,
      get_version_update_status,
      check_for_browser_updates,
      dismiss_update_notification,
      complete_browser_update_with_auto_update,
      check_for_app_updates,
      check_for_app_updates_manual,
      download_and_prepare_app_update,
      restart_application,
      detect_existing_profiles,
      import_browser_profile,
      check_missing_binaries,
      check_missing_geoip_database,
      ensure_all_binaries_exist,
      ensure_active_browsers_downloaded,
      create_stored_proxy,
      get_stored_proxies,
      update_stored_proxy,
      delete_stored_proxy,
      check_proxy_validity,
      get_cached_proxy_check,
      export_proxies,
      import_proxies_json,
      parse_txt_proxies,
      import_proxies_from_parsed,
      update_camoufox_config,
      update_wayfern_config,
      generate_sample_fingerprint,
      get_profile_groups,
      get_groups_with_profile_counts,
      create_profile_group,
      update_profile_group,
      delete_profile_group,
      assign_profiles_to_group,
      delete_selected_profiles,
      list_extensions,
      get_extension_icon,
      add_extension,
      update_extension,
      delete_extension,
      list_extension_groups,
      create_extension_group,
      update_extension_group,
      delete_extension_group,
      add_extension_to_group,
      remove_extension_from_group,
      assign_extension_group_to_profile,
      get_extension_group_for_profile,
      is_geoip_database_available,
      download_geoip_database,
      start_api_server,
      stop_api_server,
      get_api_server_status,
      get_all_traffic_snapshots,
      get_profile_traffic_snapshot,
      clear_all_traffic_stats,
      get_traffic_stats_for_period,
      get_sync_settings,
      save_sync_settings,
      set_profile_sync_mode,
      cancel_profile_sync,
      request_profile_sync,
      set_proxy_sync_enabled,
      set_group_sync_enabled,
      is_proxy_in_use_by_synced_profile,
      is_group_in_use_by_synced_profile,
      set_vpn_sync_enabled,
      is_vpn_in_use_by_synced_profile,
      set_extension_sync_enabled,
      set_extension_group_sync_enabled,
      get_unsynced_entity_counts,
      enable_sync_for_all_entities,
      set_e2e_password,
      check_has_e2e_password,
      verify_e2e_password,
      delete_e2e_password,
      rollover_encryption_for_all_entities,
      read_profile_cookies,
      get_profile_cookie_stats,
      copy_profile_cookies,
      import_cookies_from_file,
      export_profile_cookies,
      check_wayfern_terms_accepted,
      check_wayfern_downloaded,
      accept_wayfern_terms,
      get_commercial_trial_status,
      acknowledge_trial_expiration,
      has_acknowledged_trial_expiration,
      start_mcp_server,
      stop_mcp_server,
      get_mcp_server_status,
      get_mcp_config,
      list_mcp_agents,
      add_mcp_to_agent,
      remove_mcp_from_agent,
      // VPN commands
      import_vpn_config,
      list_vpn_configs,
      get_vpn_config,
      delete_vpn_config,
      create_vpn_config_manual,
      update_vpn_config,
      check_vpn_validity,
      connect_vpn,
      disconnect_vpn,
      get_vpn_status,
      list_active_vpn_connections,
      // Cloud auth commands
      cloud_auth::cloud_exchange_device_code,
      cloud_auth::cloud_get_user,
      cloud_auth::cloud_refresh_profile,
      cloud_auth::cloud_logout,
      cloud_auth::cloud_get_proxy_usage,
      cloud_auth::cloud_get_countries,
      cloud_auth::cloud_get_regions,
      cloud_auth::cloud_get_cities,
      cloud_auth::cloud_get_isps,
      cloud_auth::create_cloud_location_proxy,
      cloud_auth::restart_sync_service,
      cloud_auth::cloud_get_wayfern_token,
      cloud_auth::cloud_refresh_wayfern_token,
      // Team lock commands
      team_lock::get_team_locks,
      team_lock::get_team_lock_status,
      // Synchronizer commands
      synchronizer::start_sync_session,
      synchronizer::stop_sync_session,
      synchronizer::remove_sync_follower,
      synchronizer::get_sync_sessions,
      // DNS blocklist commands
      dns_blocklist::get_dns_blocklist_cache_status,
      dns_blocklist::refresh_dns_blocklists,
      // Profile password commands
      set_profile_password,
      change_profile_password,
      remove_profile_password,
      verify_profile_password,
      unlock_profile,
      lock_profile,
      is_profile_locked,
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_app_handle, _event| {
      #[cfg(target_os = "macos")]
      if let tauri::RunEvent::Reopen { .. } = _event {
        if let Some(window) = _app_handle.get_webview_window("main") {
          let _ = window.show();
          let _ = window.set_focus();
          let _ = window.unminimize();
        }
      }
    });
}

