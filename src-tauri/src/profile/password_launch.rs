/// Decrypt a password-protected profile's encrypted dir into an ephemeral
/// dir, take a mtime snapshot for diff-on-quit, and return the ephemeral
/// path the browser should launch from.
///
/// Returns an error if the profile isn't unlocked yet — the frontend should
/// prompt for the password and call `unlock_profile` first.
pub fn prepare_for_launch(profile: &crate::profile::BrowserProfile) -> Result<PathBuf, String> {
  let id = profile.id;
  let key = get_cached_key(&id).ok_or_else(|| err_code("PROFILE_LOCKED"))?;

  let id_str = id.to_string();
  let ephemeral = match crate::browser::ephemeral_dirs::get_ephemeral_dir(&id_str) {
    Some(p) => p,
    None => crate::browser::ephemeral_dirs::create_ephemeral_dir(&id_str).map_err(err_internal)?,
  };

  let already_populated = POPULATED_EPHEMERAL
    .lock()
    .map(|g| g.contains(&id))
    .unwrap_or(false);

  let encrypted_dir = profile_data_dir(profile);

  let snapshot = if already_populated && ephemeral_has_files(&ephemeral) {
    // Reusing a kept-in-RAM copy from the previous session; just snapshot.
    snapshot_mtimes(&ephemeral)
  } else {
    // Wipe any stale contents and re-decrypt.
    if let Err(e) = clear_dir_contents(&ephemeral) {
      log::warn!("Failed to clear stale ephemeral contents: {e}");
    }
    decrypt_profile_dir(&key, &encrypted_dir, &ephemeral).map_err(|e| match e {
      crate::profile::encryption::PasswordError::WrongPassword => err_code("INCORRECT_PASSWORD"),
      other => err_internal(other),
    })?
  };

  if let Ok(mut guard) = LAUNCH_SNAPSHOTS.lock() {
    guard.insert(id, snapshot);
  }
  if let Ok(mut guard) = POPULATED_EPHEMERAL.lock() {
    guard.insert(id);
  }

  Ok(ephemeral)
}

fn ephemeral_has_files(dir: &Path) -> bool {
  std::fs::read_dir(dir)
    .map(|mut iter| iter.next().is_some())
    .unwrap_or(false)
}

fn clear_dir_contents(dir: &Path) -> std::io::Result<()> {
  if !dir.exists() {
    return Ok(());
  }
  for entry in std::fs::read_dir(dir)? {
    let entry = entry?;
    let path = entry.path();
    if path.is_dir() {
      std::fs::remove_dir_all(&path)?;
    } else {
      std::fs::remove_file(&path)?;
    }
  }
  Ok(())
}

fn read_keep_decrypted_setting() -> bool {
  crate::settings::settings_manager::SettingsManager::instance()
    .load_settings()
    .map(|s| s.keep_decrypted_profiles_in_ram)
    .unwrap_or(false)
}

/// Synchronous core of `complete_after_quit`: re-encrypts ephemeral → disk
/// and (unless `keep_decrypted` is true) drops cached key + purges ephemeral.
/// Returns the number of files re-encrypted, or `None` if there was nothing
/// to do. Public for testability.
pub fn complete_after_quit_blocking(
  profile: &crate::profile::BrowserProfile,
  keep_decrypted: bool,
) -> Option<usize> {
  use crate::profile::encryption::reencrypt_changed_files;

  let id = profile.id;
  if !profile.password_protected {
    return None;
  }

  // Snapshot is an optimization (skip re-encrypting unchanged files). When
  // it's missing — e.g. natural-exit detection firing twice, or status
  // checker firing for a profile whose snapshot was already consumed — we
  // fall back to treating every ephemeral file as new. Empty `before`
  // forces all files through encrypt, which is slower but correct.
  let snapshot = LAUNCH_SNAPSHOTS
    .lock()
    .ok()
    .and_then(|mut g| g.remove(&id))
    .unwrap_or_default();

  let id_str = id.to_string();
  let ephemeral = crate::browser::ephemeral_dirs::get_ephemeral_dir(&id_str)?;
  let encrypted = profile_data_dir(profile);
  let key = get_cached_key(&id)?;

  let result = match reencrypt_changed_files(
    &key,
    &ephemeral,
    &encrypted,
    DEFAULT_EXCLUDE_PATTERNS,
    &snapshot,
  ) {
    Ok(n) => {
      log::info!("Re-encrypted {n} changed file(s) for profile {id}");
      Some(n)
    }
    Err(e) => {
      log::error!("Re-encryption failed for profile {id}: {e}");
      None
    }
  };

  if keep_decrypted {
    log::info!("Keeping decrypted copy of profile {id} in RAM (per settings)");
  } else {
    drop_cached_key(&id);
    if let Ok(mut guard) = POPULATED_EPHEMERAL.lock() {
      guard.remove(&id);
    }
    crate::browser::ephemeral_dirs::remove_ephemeral_dir(&id_str);
  }

  result
}

/// Re-encrypt a password-protected profile's ephemeral dir back to the
/// on-disk encrypted dir after the browser process exits. Optionally purges
/// the ephemeral dir + cached key based on the global setting. Returns the
/// number of files re-encrypted (`None` when nothing to do or the profile
/// isn't protected).
///
/// Callers that release a queued sync run after a browser quit MUST await
/// this future — releasing sync while re-encryption is still in-flight
/// uploads the stale on-disk snapshot and leaves the fresh ciphertext
/// orphaned until the next scheduler tick.
pub async fn complete_after_quit_and_wait(
  profile: &crate::profile::BrowserProfile,
) -> Option<usize> {
  if !profile.password_protected {
    return None;
  }
  let keep_decrypted = read_keep_decrypted_setting();
  let profile = profile.clone();

  tokio::task::spawn_blocking(move || complete_after_quit_blocking(&profile, keep_decrypted))
    .await
    .unwrap_or_else(|e| {
      log::error!("complete_after_quit_and_wait join error: {e}");
      None
    })
}

#[cfg(test)]
mod tests_launch {
  use super::*;
  use crate::profile::BrowserProfile;
  use tempfile::TempDir;

  fn make_profile(name: &str) -> BrowserProfile {
    BrowserProfile {
      id: uuid::Uuid::new_v4(),
      name: name.to_string(),
      browser: "wayfern".to_string(),
      version: "1.0".to_string(),
      release_type: "stable".to_string(),
      ..Default::default()
    }
  }

  fn populate_plaintext_dir(dir: &Path) {
    std::fs::create_dir_all(dir.join("Default")).unwrap();
    std::fs::write(dir.join("Default/Cookies"), b"sqlite-data").unwrap();
    std::fs::write(dir.join("Default/Bookmarks"), b"{\"x\":1}").unwrap();
    std::fs::write(dir.join("Local State"), b"local-state").unwrap();
    // Cache files should be excluded:
    std::fs::create_dir_all(dir.join("Default/Cache")).unwrap();
    std::fs::write(dir.join("Default/Cache/data_0"), b"cache-blob").unwrap();
  }

  fn parse_err_code(err: &str) -> Option<&'static str> {
    let v: serde_json::Value = serde_json::from_str(err).ok()?;
    let code = v.get("code")?.as_str()?;
    Some(match code {
      "INCORRECT_PASSWORD" => "INCORRECT_PASSWORD",
      "LOCKED_OUT" => "LOCKED_OUT",
      "PROFILE_NOT_FOUND" => "PROFILE_NOT_FOUND",
      "PROFILE_NOT_PROTECTED" => "PROFILE_NOT_PROTECTED",
      "PROFILE_ALREADY_PROTECTED" => "PROFILE_ALREADY_PROTECTED",
      "PROFILE_RUNNING" => "PROFILE_RUNNING",
      "PROFILE_MISSING_SALT" => "PROFILE_MISSING_SALT",
      "PROFILE_LOCKED" => "PROFILE_LOCKED",
      "INVALID_PROFILE_ID" => "INVALID_PROFILE_ID",
      "PASSWORD_TOO_SHORT" => "PASSWORD_TOO_SHORT",
      "INTERNAL_ERROR" => "INTERNAL_ERROR",
      _ => return None,
    })
  }

  fn parse_err_param(err: &str, key: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(err).ok()?;
    Some(v.get("params")?.get(key)?.as_str()?.to_string())
  }

  fn fresh_test_state(id: &uuid::Uuid) {
    drop_cached_key(id);
    let _ = LAUNCH_SNAPSHOTS.lock().map(|mut g| g.remove(id));
    let _ = POPULATED_EPHEMERAL.lock().map(|mut g| g.remove(id));
    crate::browser::ephemeral_dirs::remove_ephemeral_dir(&id.to_string());
  }

  fn profile_full_path(profile: &BrowserProfile, profiles_dir: &Path) -> PathBuf {
    profiles_dir.join(profile.id.to_string()).join("profile")
  }

  #[test]
  #[serial_test::serial]
  fn integration_set_password_encrypts_dir() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());

    let mut profile = make_profile("test-set");
    let profiles_dir = ProfileManager::instance().get_profiles_dir();
    let plain_dir = profile_full_path(&profile, &profiles_dir);
    populate_plaintext_dir(&plain_dir);
    ProfileManager::instance().save_profile(&profile).unwrap();

    fresh_test_state(&profile.id);

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(set_profile_password(
      profile.id.to_string(),
      "hunter2!".into(),
    ))
    .unwrap();

    profile = ProfileManager::instance()
      .list_profiles()
      .unwrap()
      .into_iter()
      .find(|p| p.id == profile.id)
      .unwrap();
    assert!(profile.password_protected);
    assert!(profile.encryption_salt.is_some());

    // No plaintext filenames should remain on disk
    let names: Vec<String> = std::fs::read_dir(&plain_dir)
      .unwrap()
      .filter_map(|e| e.ok())
      .map(|e| e.file_name().to_string_lossy().into_owned())
      .collect();
    for n in &names {
      assert!(!n.contains("Cookies"), "plaintext name leaked: {n}");
      assert!(!n.contains("Bookmarks"));
      assert!(!n.contains("Local State"));
    }

    fresh_test_state(&profile.id);
  }

  #[test]
  #[serial_test::serial]
  fn integration_full_lifecycle_persists_data() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());

    let profile = make_profile("test-lifecycle");
    let profiles_dir = ProfileManager::instance().get_profiles_dir();
    let plain_dir = profile_full_path(&profile, &profiles_dir);
    populate_plaintext_dir(&plain_dir);
    ProfileManager::instance().save_profile(&profile).unwrap();

    fresh_test_state(&profile.id);

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(set_profile_password(
      profile.id.to_string(),
      "hunter2!".into(),
    ))
    .unwrap();

    let mut profile = ProfileManager::instance()
      .list_profiles()
      .unwrap()
      .into_iter()
      .find(|p| p.id == profile.id)
      .unwrap();

    // Simulate launch: prepare_for_launch decrypts to ephemeral
    let ephemeral = prepare_for_launch(&profile).unwrap();
    assert_eq!(
      std::fs::read(ephemeral.join("Default/Cookies")).unwrap(),
      b"sqlite-data"
    );

    // Simulate user activity: modify Cookies, leave Bookmarks alone
    std::thread::sleep(std::time::Duration::from_millis(1100));
    std::fs::write(ephemeral.join("Default/Cookies"), b"sqlite-modified").unwrap();

    // Capture pre-quit ciphertext for the unchanged Bookmarks file
    let key = get_cached_key(&profile.id).unwrap();
    let bookmarks_name = crate::profile::encryption::hmac_filename(&key, "Default/Bookmarks");
    let bookmarks_cipher_before = std::fs::read(plain_dir.join(&bookmarks_name)).unwrap();

    // Simulate quit (purge=true): re-encrypts and clears cached key + ephemeral
    let n = complete_after_quit_blocking(&profile, false);
    assert!(n.is_some(), "should have re-encrypted at least one file");
    assert!(
      get_cached_key(&profile.id).is_none(),
      "key should be dropped"
    );
    assert!(
      crate::browser::ephemeral_dirs::get_ephemeral_dir(&profile.id.to_string()).is_none(),
      "ephemeral should be purged"
    );

    // Unchanged file's ciphertext should be byte-identical
    let bookmarks_cipher_after = std::fs::read(plain_dir.join(&bookmarks_name)).unwrap();
    assert_eq!(
      bookmarks_cipher_before, bookmarks_cipher_after,
      "unchanged file's ciphertext should be stable across quit"
    );

    // Wrong password rejected
    let r = rt.block_on(unlock_profile(profile.id.to_string(), "wrong".into()));
    assert!(r.is_err());

    // Correct password unlocks
    rt.block_on(unlock_profile(profile.id.to_string(), "hunter2!".into()))
      .unwrap();

    // Re-launch and verify the modification persisted
    profile = ProfileManager::instance()
      .list_profiles()
      .unwrap()
      .into_iter()
      .find(|p| p.id == profile.id)
      .unwrap();
    let ephemeral2 = prepare_for_launch(&profile).unwrap();
    assert_eq!(
      std::fs::read(ephemeral2.join("Default/Cookies")).unwrap(),
      b"sqlite-modified",
      "modification should persist across the encrypt/decrypt cycle"
    );
    assert_eq!(
      std::fs::read(ephemeral2.join("Default/Bookmarks")).unwrap(),
      b"{\"x\":1}",
      "unchanged file should still be present"
    );

    fresh_test_state(&profile.id);
  }

  #[test]
  #[serial_test::serial]
  fn integration_keep_decrypted_keeps_ephemeral_but_still_re_encrypts() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());

    let profile = make_profile("test-keep");
    let profiles_dir = ProfileManager::instance().get_profiles_dir();
    let plain_dir = profile_full_path(&profile, &profiles_dir);
    populate_plaintext_dir(&plain_dir);
    ProfileManager::instance().save_profile(&profile).unwrap();

    fresh_test_state(&profile.id);

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(set_profile_password(
      profile.id.to_string(),
      "hunter2!".into(),
    ))
    .unwrap();

    let profile = ProfileManager::instance()
      .list_profiles()
      .unwrap()
      .into_iter()
      .find(|p| p.id == profile.id)
      .unwrap();
    let ephemeral = prepare_for_launch(&profile).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1100));
    std::fs::write(ephemeral.join("Default/Cookies"), b"new-bytes").unwrap();

    // keep_decrypted=true: ephemeral stays, key stays cached
    let n = complete_after_quit_blocking(&profile, true);
    assert!(n.is_some());
    assert!(
      get_cached_key(&profile.id).is_some(),
      "key should still be cached"
    );
    assert!(
      crate::browser::ephemeral_dirs::get_ephemeral_dir(&profile.id.to_string()).is_some(),
      "ephemeral should be preserved"
    );

    // The on-disk encrypted dir was still updated
    let key = get_cached_key(&profile.id).unwrap();
    let cookies_name = crate::profile::encryption::hmac_filename(&key, "Default/Cookies");
    let cipher = std::fs::read(plain_dir.join(&cookies_name)).unwrap();
    let (path, content) = crate::profile::encryption::decrypt_profile_file(&key, &cipher).unwrap();
    assert_eq!(path, "Default/Cookies");
    assert_eq!(content, b"new-bytes");

    fresh_test_state(&profile.id);
  }

  #[test]
  #[serial_test::serial]
  fn integration_change_and_remove_password() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());

    let profile = make_profile("test-change");
    let profiles_dir = ProfileManager::instance().get_profiles_dir();
    let plain_dir = profile_full_path(&profile, &profiles_dir);
    populate_plaintext_dir(&plain_dir);
    ProfileManager::instance().save_profile(&profile).unwrap();

    fresh_test_state(&profile.id);
    let rt = tokio::runtime::Runtime::new().unwrap();

    rt.block_on(set_profile_password(
      profile.id.to_string(),
      "hunter2!".into(),
    ))
    .unwrap();
    let salt_v1 = ProfileManager::instance()
      .list_profiles()
      .unwrap()
      .into_iter()
      .find(|p| p.id == profile.id)
      .unwrap()
      .encryption_salt
      .clone()
      .unwrap();

    // Wrong old password should fail
    let r = rt.block_on(change_profile_password(
      profile.id.to_string(),
      "wrong".into(),
      "newpassword!".into(),
    ));
    assert!(r.is_err());

    // Correct old password works, salt should change
    rt.block_on(change_profile_password(
      profile.id.to_string(),
      "hunter2!".into(),
      "newpassword!".into(),
    ))
    .unwrap();
    let salt_v2 = ProfileManager::instance()
      .list_profiles()
      .unwrap()
      .into_iter()
      .find(|p| p.id == profile.id)
      .unwrap()
      .encryption_salt
      .clone()
      .unwrap();
    assert_ne!(salt_v1, salt_v2, "salt should rotate on password change");

    // Old password rejected, new accepted
    assert!(rt
      .block_on(unlock_profile(profile.id.to_string(), "hunter2!".into()))
      .is_err());
    rt.block_on(unlock_profile(
      profile.id.to_string(),
      "newpassword!".into(),
    ))
    .unwrap();

    // Remove password: data should be plaintext again
    rt.block_on(remove_profile_password(
      profile.id.to_string(),
      "newpassword!".into(),
    ))
    .unwrap();

    let final_profile = ProfileManager::instance()
      .list_profiles()
      .unwrap()
      .into_iter()
      .find(|p| p.id == profile.id)
      .unwrap();
    assert!(!final_profile.password_protected);
    assert!(final_profile.encryption_salt.is_none());
    assert_eq!(
      std::fs::read(plain_dir.join("Default/Cookies")).unwrap(),
      b"sqlite-data"
    );

    fresh_test_state(&profile.id);
  }

  #[test]
  #[serial_test::serial]
  fn integration_empty_profile_session_survives_restart() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());

    // Mimic a freshly created profile with no browser data yet
    let profile = make_profile("test-empty");
    let profiles_dir = ProfileManager::instance().get_profiles_dir();
    let plain_dir = profile_full_path(&profile, &profiles_dir);
    std::fs::create_dir_all(&plain_dir).unwrap();
    ProfileManager::instance().save_profile(&profile).unwrap();
    fresh_test_state(&profile.id);

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(set_profile_password(
      profile.id.to_string(),
      "hunter2!".into(),
    ))
    .unwrap();

    // After encrypting an empty profile, only the verifier file lives on disk
    let on_disk_count = std::fs::read_dir(&plain_dir).unwrap().count();
    assert_eq!(
      on_disk_count, 1,
      "fresh encrypted profile should have only the verifier file"
    );

    let profile = ProfileManager::instance()
      .list_profiles()
      .unwrap()
      .into_iter()
      .find(|p| p.id == profile.id)
      .unwrap();

    // Launch — ephemeral starts empty (only the verifier in encrypted, which is skipped)
    let ephemeral = prepare_for_launch(&profile).unwrap();
    assert!(
      std::fs::read_dir(&ephemeral).unwrap().next().is_none(),
      "ephemeral should start empty for a fresh encrypted profile"
    );

    // Simulate the browser writing a session
    std::fs::create_dir_all(ephemeral.join("Default")).unwrap();
    std::fs::write(ephemeral.join("Default/Cookies"), b"session-cookies").unwrap();
    std::fs::write(ephemeral.join("Default/places.sqlite"), b"places-data").unwrap();
    std::fs::write(ephemeral.join("prefs.js"), b"user_pref(\"x\", 1);").unwrap();

    // Browser exits — re-encrypt back to disk
    let n = complete_after_quit_blocking(&profile, false);
    assert!(
      matches!(n, Some(rewrote) if rewrote >= 3),
      "expected at least 3 files re-encrypted, got {n:?}"
    );

    // Encrypted dir should now have verifier + 3 user files
    let on_disk_count = std::fs::read_dir(&plain_dir).unwrap().count();
    assert!(
      on_disk_count >= 4,
      "encrypted dir should contain session data + verifier, got {on_disk_count} files"
    );

    // Simulate full app restart: drop key, drop ephemeral tracking, remove ephemeral
    fresh_test_state(&profile.id);

    // Unlock with same password
    rt.block_on(unlock_profile(profile.id.to_string(), "hunter2!".into()))
      .unwrap();

    // Re-launch — session must come back
    let ephemeral2 = prepare_for_launch(&profile).unwrap();
    assert_eq!(
      std::fs::read(ephemeral2.join("Default/Cookies")).unwrap(),
      b"session-cookies",
      "Cookies should survive across encrypt/quit/restart/unlock cycle"
    );
    assert_eq!(
      std::fs::read(ephemeral2.join("Default/places.sqlite")).unwrap(),
      b"places-data"
    );
    assert_eq!(
      std::fs::read(ephemeral2.join("prefs.js")).unwrap(),
      b"user_pref(\"x\", 1);"
    );

    fresh_test_state(&profile.id);
  }

  #[test]
  #[serial_test::serial]
  fn integration_progressive_backoff_on_wrong_password() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());

    let profile = make_profile("test-backoff");
    let profiles_dir = ProfileManager::instance().get_profiles_dir();
    let plain_dir = profile_full_path(&profile, &profiles_dir);
    populate_plaintext_dir(&plain_dir);
    ProfileManager::instance().save_profile(&profile).unwrap();
    fresh_test_state(&profile.id);
    clear_failed_attempts(&profile.id);

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(set_profile_password(
      profile.id.to_string(),
      "hunter2!".into(),
    ))
    .unwrap();
    drop_cached_key(&profile.id);

    // First 4 wrong attempts produce the INCORRECT_PASSWORD code
    for _ in 0..4 {
      let err = rt
        .block_on(unlock_profile(profile.id.to_string(), "wrong".into()))
        .unwrap_err();
      assert_eq!(parse_err_code(&err), Some("INCORRECT_PASSWORD"));
    }

    // 5th wrong attempt also returns the code, but the next one will be locked out
    let err = rt
      .block_on(unlock_profile(profile.id.to_string(), "wrong".into()))
      .unwrap_err();
    assert_eq!(parse_err_code(&err), Some("INCORRECT_PASSWORD"));

    // 6th attempt is rate-limited regardless of password correctness
    let err = rt
      .block_on(unlock_profile(profile.id.to_string(), "hunter2!".into()))
      .unwrap_err();
    assert_eq!(parse_err_code(&err), Some("LOCKED_OUT"));
    let secs = parse_err_param(&err, "seconds")
      .and_then(|v| v.parse::<u64>().ok())
      .unwrap();
    assert!(secs > 0 && secs <= 60, "expected 1m countdown, got {secs}s");

    // Bypass the timer by manually expiring last_failed_at past the lockout
    if let Ok(mut guard) = FAILED_ATTEMPTS.lock() {
      if let Some(record) = guard.get_mut(&profile.id) {
        record.last_failed_at_secs = now_epoch_secs().saturating_sub(120);
      }
    }
    if let Some(record) = FAILED_ATTEMPTS
      .lock()
      .ok()
      .and_then(|g| g.get(&profile.id).copied())
    {
      persist_record(&profile.id, &record);
    }

    // Correct password now succeeds, clearing the failure history
    rt.block_on(unlock_profile(profile.id.to_string(), "hunter2!".into()))
      .unwrap();
    let post = FAILED_ATTEMPTS
      .lock()
      .map(|g| g.contains_key(&profile.id))
      .unwrap_or(true);
    assert!(!post, "successful unlock should clear failure record");

    fresh_test_state(&profile.id);
    clear_failed_attempts(&profile.id);
  }

  #[test]
  #[serial_test::serial]
  fn integration_lockout_survives_restart() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());

    let profile = make_profile("test-restart");
    let profiles_dir = ProfileManager::instance().get_profiles_dir();
    let plain_dir = profile_full_path(&profile, &profiles_dir);
    populate_plaintext_dir(&plain_dir);
    ProfileManager::instance().save_profile(&profile).unwrap();
    fresh_test_state(&profile.id);
    clear_failed_attempts(&profile.id);

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(set_profile_password(
      profile.id.to_string(),
      "hunter2!".into(),
    ))
    .unwrap();
    drop_cached_key(&profile.id);

    // 5 wrong attempts to trigger lockout
    for _ in 0..5 {
      let _ = rt.block_on(unlock_profile(profile.id.to_string(), "wrong".into()));
    }

    // Sidecar file should now exist
    let sidecar = lockout_sidecar_path(&profile.id);
    assert!(sidecar.exists(), "sidecar should be persisted to disk");

    // Simulate app restart by clearing the in-memory cache (but NOT the sidecar)
    if let Ok(mut g) = FAILED_ATTEMPTS.lock() {
      g.clear();
    }

    // Lockout should still apply because state was loaded from disk
    let err = rt
      .block_on(unlock_profile(profile.id.to_string(), "hunter2!".into()))
      .unwrap_err();
    assert_eq!(
      parse_err_code(&err),
      Some("LOCKED_OUT"),
      "expected lockout to persist across restart, got: {err}"
    );

    fresh_test_state(&profile.id);
    clear_failed_attempts(&profile.id);
  }

  #[test]
  fn lockout_schedule_progression() {
    use std::time::Duration;
    assert_eq!(lockout_for_count(0), None);
    assert_eq!(lockout_for_count(4), None);
    assert_eq!(lockout_for_count(5), Some(Duration::from_secs(60)));
    assert_eq!(lockout_for_count(6), Some(Duration::from_secs(5 * 60)));
    assert_eq!(lockout_for_count(7), Some(Duration::from_secs(15 * 60)));
    assert_eq!(lockout_for_count(8), Some(Duration::from_secs(60 * 60)));
    assert_eq!(lockout_for_count(9), Some(Duration::from_secs(2 * 3600)));
    assert_eq!(lockout_for_count(10), Some(Duration::from_secs(4 * 3600)));
    assert_eq!(lockout_for_count(11), Some(Duration::from_secs(8 * 3600)));
    assert_eq!(lockout_for_count(12), Some(Duration::from_secs(24 * 3600)));
    assert_eq!(lockout_for_count(50), Some(Duration::from_secs(24 * 3600)));
  }

  #[test]
  #[serial_test::serial]
  fn integration_lock_drops_key() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());

    let profile = make_profile("test-lock");
    let profiles_dir = ProfileManager::instance().get_profiles_dir();
    let plain_dir = profile_full_path(&profile, &profiles_dir);
    populate_plaintext_dir(&plain_dir);
    ProfileManager::instance().save_profile(&profile).unwrap();
    fresh_test_state(&profile.id);

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(set_profile_password(
      profile.id.to_string(),
      "hunter2!".into(),
    ))
    .unwrap();
    assert!(get_cached_key(&profile.id).is_some());
    assert!(!rt
      .block_on(is_profile_locked(profile.id.to_string()))
      .unwrap());

    rt.block_on(lock_profile(profile.id.to_string())).unwrap();
    assert!(get_cached_key(&profile.id).is_none());
    assert!(rt
      .block_on(is_profile_locked(profile.id.to_string()))
      .unwrap());

    fresh_test_state(&profile.id);
  }
}
