/// Update the tray menu labels with localized strings pushed from the frontend
/// (which owns the active language). The item ids are unchanged so the existing
/// menu-event handler keeps matching.
#[tauri::command]
fn update_tray_menu(
  app_handle: tauri::AppHandle,
  show_label: String,
  quit_label: String,
) -> Result<(), String> {
  use tauri::menu::{MenuBuilder, MenuItemBuilder};
  if let Some(tray) = app_handle.tray_by_id("main") {
    let show_item = MenuItemBuilder::with_id("tray_show", show_label)
      .build(&app_handle)
      .map_err(|e| e.to_string())?;
    let quit_item = MenuItemBuilder::with_id("tray_quit", quit_label)
      .build(&app_handle)
      .map_err(|e| e.to_string())?;
    let menu = MenuBuilder::new(&app_handle)
      .item(&show_item)
      .separator()
      .item(&quit_item)
      .build()
      .map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
  }
  Ok(())
}

/// Build the system tray. Best-effort: on Linux the tray depends on
/// libayatana-appindicator at runtime, so any failure here must not abort app
/// startup — the caller logs and continues without a tray.
fn setup_system_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
  use std::sync::atomic::Ordering;
  use tauri::menu::{MenuBuilder, MenuItemBuilder};
  use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

  // Bootstrap labels only — the frontend pushes localized labels via
  // `update_tray_menu` on mount and on language change, and the menu is only
  // opened after a minimize-to-tray (post-mount), so these are never shown.
  let show_item = MenuItemBuilder::with_id("tray_show", "Show Donut Browser").build(app)?;
  let quit_item = MenuItemBuilder::with_id("tray_quit", "Quit").build(app)?;
  let tray_menu = MenuBuilder::new(app)
    .item(&show_item)
    .separator()
    .item(&quit_item)
    .build()?;

  // macOS uses the black icon as a template — the OS tints it for the light or
  // dark menu bar. Linux (and other non-Windows desktops) get a white-bodied
  // icon with a dark outline so it stays legible on both dark and light
  // panels: Tauri feeds the SNI/AppIndicator a fixed pixmap with no template
  // tinting, so the icon has to carry its own contrast (a solid black icon is
  // invisible on GNOME's dark top bar). Windows keeps its own solid icon.
  #[cfg(target_os = "macos")]
  let tray_icon_bytes: &[u8] = include_bytes!("../icons/tray-icon-44.png");
  #[cfg(target_os = "windows")]
  let tray_icon_bytes: &[u8] = include_bytes!("../icons/tray-icon-win-44.png");
  #[cfg(not(any(target_os = "macos", target_os = "windows")))]
  let tray_icon_bytes: &[u8] = include_bytes!("../icons/tray-icon-linux-44.png");
  let tray_rgba = image::load_from_memory(tray_icon_bytes)?.into_rgba8();
  let (tray_w, tray_h) = tray_rgba.dimensions();
  let tray_image = tauri::image::Image::new_owned(tray_rgba.into_raw(), tray_w, tray_h);

  TrayIconBuilder::with_id("main")
    .icon(tray_image)
    .icon_as_template(cfg!(target_os = "macos"))
    .tooltip("Donut Browser")
    .menu(&tray_menu)
    .show_menu_on_left_click(false)
    .on_menu_event(|app_handle, event| match event.id().as_ref() {
      "tray_show" => show_main_window(app_handle),
      "tray_quit" => {
        QUIT_CONFIRMED.store(true, Ordering::SeqCst);
        app_handle.exit(0);
      }
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      // Click events are not delivered on Linux (AppIndicator/SNI only drives
      // the menu), so left-click-to-restore is macOS/Windows only — Linux users
      // restore via the "Show Donut Browser" menu item.
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        show_main_window(tray.app_handle());
      }
    })
    .build(app)?;

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]

include!("lib_run.rs");
include!("lib_setup.rs");
include!("lib_tests.rs");
