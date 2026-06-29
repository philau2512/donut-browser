fn setup_tauri_app(app: &mut tauri::App, startup_url: Option<String>) -> Result<(), Box<dyn std::error::Error>> {
  // Recover ephemeral dir mappings from RAM-backed storage (tmpfs/ramdisk)
    browser::ephemeral_dirs::recover_ephemeral_dirs();

    // Extract icons and metadata for existing extensions that don't have them yet
    {
      let mgr = extension_manager::ExtensionManager::new();
      mgr.ensure_icons_extracted();
    }

    // Create the main window programmatically
    #[allow(unused_variables)]
    let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
      .title("Donut Browser")
      .inner_size(880.0, 500.0)
      .min_inner_size(640.0, 400.0)
      .resizable(true)
      .fullscreen(false)
      .center()
      .focused(true)
      .visible(true);

    #[cfg(target_os = "windows")]
    let win_builder = win_builder.decorations(false);

    // Disable the OS-level file-drop handler on Windows so that WebView2 does
    // not intercept drag events before they reach the HTML5 DnD API.
    // Without this, dragging anything over the window shows a 🚫 cursor and
    // onDrop / onDragOver never fire in React.
    #[cfg(target_os = "windows")]
    let win_builder = win_builder.disable_drag_drop_handler();

    #[allow(unused_variables)]
    let window = win_builder.build().unwrap();

    // System tray so the user can keep the app running after the close
    // dialog's "Minimize" action hides the window. Best-effort: a tray
    // failure (e.g. missing libayatana-appindicator on Linux) must never
    // prevent the app from launching, so we log and continue without it.
    if let Err(e) = setup_system_tray(app.handle()) {
      log::warn!("System tray unavailable, continuing without it: {e}");
    }

    // Intercept the window close so the frontend can ask the user whether
    // to minimize or quit. The app exits when `confirm_quit` flips
    // QUIT_CONFIRMED — until then, every CloseRequested is held back.
    {
      let app_handle = app.handle().clone();
      window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
          if QUIT_CONFIRMED.load(Ordering::SeqCst) {
            return;
          }
          api.prevent_close();
          if let Err(e) = app_handle.emit("close-confirm-requested", ()) {
            log::warn!("Failed to emit close-confirm-requested: {e}");
          }
        }
      });
    }

    // Set transparent titlebar for macOS
    #[cfg(target_os = "macos")]
    {
      if let Err(e) = window.set_transparent_titlebar(true) {
        log::warn!("Failed to set transparent titlebar: {e}");
      }
      // Green title-bar button maximizes (zoom) the window rather than
      // entering immersive native fullscreen.
      if let Err(e) = window.disable_native_fullscreen() {
        log::warn!("Failed to disable native fullscreen: {e}");
      }
    }

    // Set up deep link handler
    let handle = app.handle().clone();

    // Initialize the global event emitter for the events module
    let emitter = std::sync::Arc::new(events::TauriEmitter::new(handle.clone()));
    if let Err(e) = events::set_global_emitter(emitter) {
      log::warn!("Failed to set global event emitter: {e}");
    }

    #[cfg(windows)]
    {
      // For Windows, register all deep links at runtime
      if let Err(e) = app.deep_link().register_all() {
        log::warn!("Failed to register deep links: {e}");
      }
    }

    #[cfg(target_os = "macos")]
    {
      // On macOS, try to register deep links for development builds
      if let Err(e) = app.deep_link().register_all() {
        log::debug!(
          "Note: Deep link registration failed on macOS (this is normal for production): {e}"
        );
      }
    }

    app.deep_link().on_open_url({
      let handle = handle.clone();
      move |event| {
        let urls = event.urls();
        log::info!("Deep link event received with {} URLs", urls.len());

        for url in urls {
          let url_string = url.to_string();
          log::info!("Deep link received: {url_string}");

          // Clone the handle for each async task
          let handle_clone = handle.clone();

          // Handle the URL asynchronously
          tauri::async_runtime::spawn(async move {
            if let Err(e) = handle_url_open(handle_clone, url_string.clone()).await {
              log::error!("Failed to handle deep link URL: {e}");
            }
          });
        }
      }
    });

    // Clone startup_url for background services (before potential move in URL handling)
    let startup_url_for_services = startup_url.clone();

    if let Some(startup_url) = startup_url {
      let handle_clone = handle.clone();
      tauri::async_runtime::spawn(async move {
        log::info!("Processing startup URL from command line: {startup_url}");
        if let Err(e) = handle_url_open(handle_clone, startup_url.clone()).await {
          log::error!("Failed to handle startup URL: {e}");
        }
      });
    }

    // Background tasks: updaters, services, cleanup (extracted to domain modules)
    crate::lib_setup_background_updaters::spawn_updater_tasks(app.handle());
    crate::lib_setup_background_services::spawn_service_tasks(app.handle(), startup_url_for_services);
    crate::lib_setup_background_cleanup::spawn_cleanup_tasks(app.handle());

    // [REMOVED] Version updater and MCP auto-start moved to lib_setup_background_updaters.rs and lib_setup_background_services.rs

    Ok(())
}
