#[cfg(test)]
mod tests2 {
  use super::*;

  fn create_chrome_cookies_db(path: &Path) {
    let conn = Connection::open(path).unwrap();
    conn
      .execute_batch(
        "CREATE TABLE cookies (
          creation_utc INTEGER NOT NULL,
          host_key TEXT NOT NULL,
          top_frame_site_key TEXT NOT NULL,
          name TEXT NOT NULL,
          value TEXT NOT NULL,
          encrypted_value BLOB NOT NULL DEFAULT '',
          path TEXT NOT NULL,
          expires_utc INTEGER NOT NULL,
          is_secure INTEGER NOT NULL,
          is_httponly INTEGER NOT NULL,
          last_access_utc INTEGER NOT NULL,
          has_expires INTEGER NOT NULL DEFAULT 1,
          is_persistent INTEGER NOT NULL DEFAULT 1,
          priority INTEGER NOT NULL DEFAULT 1,
          samesite INTEGER NOT NULL DEFAULT -1,
          source_scheme INTEGER NOT NULL DEFAULT 0,
          source_port INTEGER NOT NULL DEFAULT -1,
          last_update_utc INTEGER NOT NULL DEFAULT 0,
          source_type INTEGER NOT NULL DEFAULT 0,
          has_cross_site_ancestor INTEGER NOT NULL DEFAULT 0
        );",
      )
      .unwrap();
  }

  fn create_firefox_cookies_db(path: &Path) {
    let conn = Connection::open(path).unwrap();
    conn
      .execute_batch(
        "CREATE TABLE moz_cookies (
          id INTEGER PRIMARY KEY,
          originAttributes TEXT NOT NULL DEFAULT '',
          name TEXT,
          value TEXT,
          host TEXT,
          path TEXT,
          expiry INTEGER,
          lastAccessed INTEGER,
          creationTime INTEGER,
          isSecure INTEGER,
          isHttpOnly INTEGER,
          inBrowserElement INTEGER DEFAULT 0,
          sameSite INTEGER DEFAULT 0,
          rawSameSite INTEGER DEFAULT 0,
          schemeMap INTEGER DEFAULT 0,
          CONSTRAINT moz_uniqueid UNIQUE (name, host, path, originAttributes)
        );",
      )
      .unwrap();
  }

  #[test]
  fn test_write_chrome_cookies_replaces_existing() {
    let tmp = std::env::temp_dir().join(format!("donut_cookie_test_{}.db", uuid::Uuid::new_v4()));
    create_chrome_cookies_db(&tmp);

    let cookie = UnifiedCookie {
      name: "token".to_string(),
      value: "v1".to_string(),
      domain: ".example.com".to_string(),
      path: "/".to_string(),
      expires: 1800000000,
      is_secure: true,
      is_http_only: false,
      same_site: 1,
      creation_time: 1700000000,
      last_accessed: 1700000000,
    };

    let (inserted, _) =
      CookieManager::write_chrome_cookies(&tmp, std::slice::from_ref(&cookie)).unwrap();
    assert_eq!(inserted, 1);

    let mut updated = cookie.clone();
    updated.value = "v2".to_string();
    let (inserted, replaced) =
      CookieManager::write_chrome_cookies(&tmp, std::slice::from_ref(&updated)).unwrap();
    assert_eq!(inserted, 0);
    assert_eq!(replaced, 1);

    let conn = Connection::open(&tmp).unwrap();
    let (value, encrypted): (String, Vec<u8>) = conn
      .query_row(
        "SELECT value, encrypted_value FROM cookies WHERE name = ?1",
        params!["token"],
        |row| Ok((row.get(0)?, row.get(1)?)),
      )
      .unwrap();
    assert_eq!(value, "v2");
    assert!(encrypted.is_empty());

    let _ = std::fs::remove_file(&tmp);
  }

  /// Wayfern → Camoufox: write cookies to a Chrome DB, read them back, and
  /// verify they land in a Firefox DB with values intact, correct schemeMap,
  /// and non-expired timestamps. This is the path exercised by the
  /// "copy cookies between profiles of different browser types" feature.
  #[test]
  fn test_wayfern_cookies_transfer_to_camoufox() {
    let chrome_db =
      std::env::temp_dir().join(format!("donut_xbrowser_chrome_{}.db", uuid::Uuid::new_v4()));
    let ff_db = std::env::temp_dir().join(format!("donut_xbrowser_ff_{}.db", uuid::Uuid::new_v4()));
    create_chrome_cookies_db(&chrome_db);
    create_firefox_cookies_db(&ff_db);

    // Simulate cookies in a Wayfern profile: a persistent cookie and a
    // session cookie, both from a real-world HTTPS site.
    let source_cookies = vec![
      UnifiedCookie {
        name: "c_user".to_string(),
        value: "100012345678".to_string(),
        domain: ".facebook.com".to_string(),
        path: "/".to_string(),
        expires: 1900000000, // persistent, far in the future
        is_secure: true,
        is_http_only: true,
        same_site: 0,
        creation_time: 1700000000,
        last_accessed: 1700000000,
      },
      UnifiedCookie {
        name: "xs".to_string(),
        value: "sessionvalue".to_string(),
        domain: ".facebook.com".to_string(),
        path: "/".to_string(),
        expires: 0, // session cookie
        is_secure: true,
        is_http_only: true,
        same_site: 1,
        creation_time: 1700000000,
        last_accessed: 1700000000,
      },
    ];
    CookieManager::write_chrome_cookies(&chrome_db, &source_cookies).unwrap();

    // Read back from the Chrome DB (as if reading from the Wayfern profile).
    let from_chrome = CookieManager::read_chrome_cookies(&chrome_db, None).unwrap();
    assert_eq!(from_chrome.len(), 2);
    let c_user_src = from_chrome.iter().find(|c| c.name == "c_user").unwrap();
    assert_eq!(c_user_src.value, "100012345678");
    let xs_src = from_chrome.iter().find(|c| c.name == "xs").unwrap();
    assert_eq!(xs_src.value, "sessionvalue");

    // Write them into the Camoufox (Firefox) DB.
    let (inserted, replaced) = CookieManager::write_firefox_cookies(&ff_db, &from_chrome).unwrap();
    assert_eq!(inserted, 2);
    assert_eq!(replaced, 0);

    // Read back from Firefox and verify values survived the round trip.
    let from_ff = CookieManager::read_firefox_cookies(&ff_db).unwrap();
    assert_eq!(from_ff.len(), 2);
    let c_user = from_ff.iter().find(|c| c.name == "c_user").unwrap();
    assert_eq!(c_user.value, "100012345678");
    assert_eq!(c_user.domain, ".facebook.com");
    assert!(c_user.is_secure);
    assert!(c_user.is_http_only);
    let xs = from_ff.iter().find(|c| c.name == "xs").unwrap();
    assert_eq!(xs.value, "sessionvalue");

    // Raw DB checks against the Firefox schema — these would catch the bugs
    // that caused issue #265 on the Chrome path (plaintext, correct expiry,
    // correct schemeMap).
    let conn = Connection::open(&ff_db).unwrap();
    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap()
      .as_secs() as i64;

    let (c_user_expiry, c_user_scheme): (i64, i32) = conn
      .query_row(
        "SELECT expiry, schemeMap FROM moz_cookies WHERE name = ?1",
        params!["c_user"],
        |row| Ok((row.get(0)?, row.get(1)?)),
      )
      .unwrap();
    assert!(
      c_user_expiry > now,
      "persistent cookie must not be expired in firefox (expiry={c_user_expiry}, now={now})"
    );
    assert_eq!(c_user_scheme, 2, "HTTPS cookie must have schemeMap=2");

    let (xs_expiry, xs_scheme): (i64, i32) = conn
      .query_row(
        "SELECT expiry, schemeMap FROM moz_cookies WHERE name = ?1",
        params!["xs"],
        |row| Ok((row.get(0)?, row.get(1)?)),
      )
      .unwrap();
    assert!(
      xs_expiry > now,
      "session cookie must be rewritten to a future expiry (got {xs_expiry}, now={now})"
    );
    assert_eq!(xs_scheme, 2);

    let _ = std::fs::remove_file(&chrome_db);
    let _ = std::fs::remove_file(&ff_db);
  }

  /// Camoufox → Wayfern: the reverse direction. Ensures the Chrome writer
  /// still produces plaintext values / empty encrypted_value when fed cookies
  /// that originated in Firefox.
  #[test]
  fn test_camoufox_cookies_transfer_to_wayfern() {
    let ff_db =
      std::env::temp_dir().join(format!("donut_xbrowser_rev_ff_{}.db", uuid::Uuid::new_v4()));
    let chrome_db = std::env::temp_dir().join(format!(
      "donut_xbrowser_rev_chrome_{}.db",
      uuid::Uuid::new_v4()
    ));
    create_firefox_cookies_db(&ff_db);
    create_chrome_cookies_db(&chrome_db);

    let source_cookies = vec![UnifiedCookie {
      name: "sessionid".to_string(),
      value: "abc123def456".to_string(),
      domain: ".example.com".to_string(),
      path: "/".to_string(),
      expires: 1900000000,
      is_secure: true,
      is_http_only: false,
      same_site: 1,
      creation_time: 1700000000,
      last_accessed: 1700000000,
    }];
    CookieManager::write_firefox_cookies(&ff_db, &source_cookies).unwrap();

    let from_ff = CookieManager::read_firefox_cookies(&ff_db).unwrap();
    assert_eq!(from_ff.len(), 1);
    assert_eq!(from_ff[0].value, "abc123def456");

    CookieManager::write_chrome_cookies(&chrome_db, &from_ff).unwrap();

    let from_chrome = CookieManager::read_chrome_cookies(&chrome_db, None).unwrap();
    assert_eq!(from_chrome.len(), 1);
    assert_eq!(from_chrome[0].value, "abc123def456");

    // Verify the raw DB state on the Chrome side — plaintext value, empty
    // encrypted_value, persistent, HTTPS.
    let conn = Connection::open(&chrome_db).unwrap();
    let (value, encrypted, is_persistent, source_scheme): (String, Vec<u8>, i32, i32) = conn
      .query_row(
        "SELECT value, encrypted_value, is_persistent, source_scheme
         FROM cookies WHERE name = ?1",
        params!["sessionid"],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
      )
      .unwrap();
    assert_eq!(value, "abc123def456");
    assert!(encrypted.is_empty());
    assert_eq!(is_persistent, 1);
    assert_eq!(source_scheme, 2);

    let _ = std::fs::remove_file(&ff_db);
    let _ = std::fs::remove_file(&chrome_db);
  }

  /// Regression: decrypting a real v10-encrypted Chromium cookie with the
  /// correct PBKDF2 iterations and the `SHA-256(host_key)` integrity-prefix
  /// strip. Captured from a real Wayfern profile:
  ///   host_key = ".github.com"
  ///   name     = "_octo"
  ///   password = "OSfgzI5GUqy/pK4ANrYugw=="   (contents of os_crypt_key)
  ///   value    = "GH1.1.2077424036.1774792325"
  ///
  /// If PBKDF2 iterations or the host-hash prefix handling ever regress,
  /// this test fails and we instantly know why all copied cookies end up
  /// with empty values — which is exactly the bug that shipped and made
  /// issue-265-style silent failures reappear.
  #[test]
  #[cfg(target_os = "macos")]
  fn test_decrypt_v10_cookie_with_real_vector() {
    let profile_dir =
      std::env::temp_dir().join(format!("donut_decrypt_vector_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&profile_dir).unwrap();
    std::fs::write(
      profile_dir.join("os_crypt_key"),
      b"OSfgzI5GUqy/pK4ANrYugw==",
    )
    .unwrap();

    let key = chrome_decrypt::get_encryption_key(&profile_dir)
      .expect("should derive key from os_crypt_key file");

    let encrypted_hex = "76313077ad5b27e78f685a6ccc7b92a8a242e279e54b8d2ba8e55b433ca7e2421bec52369e29a57b593c02c839f50962245da3ed8617dce142fff67778950a271d2c07";
    let encrypted: Vec<u8> = (0..encrypted_hex.len())
      .step_by(2)
      .map(|i| u8::from_str_radix(&encrypted_hex[i..i + 2], 16).unwrap())
      .collect();

    let decrypted = chrome_decrypt::decrypt(&encrypted, ".github.com", &key)
      .expect("decryption must succeed with correct key and host");
    assert_eq!(decrypted, "GH1.1.2077424036.1774792325");

    let _ = std::fs::remove_dir_all(&profile_dir);
  }

  /// Sanity: decrypting with the wrong host_key (hash mismatch) must not
  /// return a half-garbage value — it should fall back to the full
  /// decrypted bytes, which for a modern cookie includes the 32-byte hash
  /// prefix and therefore won't be valid UTF-8 → `None`.
  #[test]
  #[cfg(target_os = "macos")]
  fn test_decrypt_with_wrong_host_returns_none_or_raw() {
    let profile_dir =
      std::env::temp_dir().join(format!("donut_decrypt_wrong_host_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&profile_dir).unwrap();
    std::fs::write(
      profile_dir.join("os_crypt_key"),
      b"OSfgzI5GUqy/pK4ANrYugw==",
    )
    .unwrap();

    let key = chrome_decrypt::get_encryption_key(&profile_dir).unwrap();
    let encrypted_hex = "76313077ad5b27e78f685a6ccc7b92a8a242e279e54b8d2ba8e55b433ca7e2421bec52369e29a57b593c02c839f50962245da3ed8617dce142fff67778950a271d2c07";
    let encrypted: Vec<u8> = (0..encrypted_hex.len())
      .step_by(2)
      .map(|i| u8::from_str_radix(&encrypted_hex[i..i + 2], 16).unwrap())
      .collect();

    // Wrong host: the prefix won't match, so we fall through to
    // `String::from_utf8(full_decrypted)` which fails on the binary hash
    // bytes and returns `None`. Either way, we must NOT return the real
    // value "GH1.1.2077424036.1774792325".
    let result = chrome_decrypt::decrypt(&encrypted, ".facebook.com", &key);
    assert!(
      result.as_deref() != Some("GH1.1.2077424036.1774792325"),
      "decrypt must not return the real cookie value when host_key is wrong"
    );

    let _ = std::fs::remove_dir_all(&profile_dir);
  }

  /// Regression: a brand-new Wayfern profile has no `Default/Cookies` file
  /// yet (Chromium only writes it on first launch). Copying/importing into
  /// such a profile must create the file on demand.
  #[test]
  fn test_create_empty_chrome_cookies_db_then_write() {
    let dir = std::env::temp_dir().join(format!("donut_empty_chrome_{}", uuid::Uuid::new_v4()));
    let db_path = dir.join("Default").join("Cookies");
    assert!(!db_path.exists());

    CookieManager::create_empty_chrome_cookies_db(&db_path).unwrap();
    assert!(db_path.exists());

    // Round-trip: write a cookie into the freshly created DB, read it back.
    let cookies = vec![UnifiedCookie {
      name: "auth".to_string(),
      value: "token123".to_string(),
      domain: ".example.com".to_string(),
      path: "/".to_string(),
      expires: 1900000000,
      is_secure: true,
      is_http_only: true,
      same_site: 0,
      creation_time: 1700000000,
      last_accessed: 1700000000,
    }];
    let (inserted, replaced) = CookieManager::write_chrome_cookies(&db_path, &cookies).unwrap();
    assert_eq!(inserted, 1);
    assert_eq!(replaced, 0);

    let read = CookieManager::read_chrome_cookies(&db_path, None).unwrap();
    assert_eq!(read.len(), 1);
    assert_eq!(read[0].value, "token123");

    // Schema sanity: `meta` table with version row exists so Chromium's
    // cookie store migration code can upgrade this on first launch.
    let conn = Connection::open(&db_path).unwrap();
    let version: String = conn
      .query_row("SELECT value FROM meta WHERE key = 'version'", [], |row| {
        row.get(0)
      })
      .unwrap();
    assert!(!version.is_empty());

    let _ = std::fs::remove_dir_all(&dir);
  }

  /// Same regression, Firefox side: a fresh Camoufox profile has no
  /// `cookies.sqlite` until the browser launches.
  #[test]
  fn test_create_empty_firefox_cookies_db_then_write() {
    let dir = std::env::temp_dir().join(format!("donut_empty_ff_{}", uuid::Uuid::new_v4()));
    let db_path = dir.join("cookies.sqlite");
    assert!(!db_path.exists());

    CookieManager::create_empty_firefox_cookies_db(&db_path).unwrap();
    assert!(db_path.exists());

    let cookies = vec![UnifiedCookie {
      name: "sid".to_string(),
      value: "ff-session".to_string(),
      domain: ".example.org".to_string(),
      path: "/".to_string(),
      expires: 1900000000,
      is_secure: true,
      is_http_only: false,
      same_site: 1,
      creation_time: 1700000000,
      last_accessed: 1700000000,
    }];
    let (inserted, _) = CookieManager::write_firefox_cookies(&db_path, &cookies).unwrap();
    assert_eq!(inserted, 1);

    let read = CookieManager::read_firefox_cookies(&db_path).unwrap();
    assert_eq!(read.len(), 1);
    assert_eq!(read[0].value, "ff-session");

    let _ = std::fs::remove_dir_all(&dir);
  }
}
