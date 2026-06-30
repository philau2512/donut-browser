impl CookieManager {
  /// Public API: Read cookies from a profile
  pub fn read_cookies(profile_id: &str) -> Result<CookieReadResult, String> {
    let profile_manager = ProfileManager::instance();
    let profiles_dir = profile_manager.get_profiles_dir();
    let profiles = profile_manager
      .list_profiles()
      .map_err(|e| format!("Failed to list profiles: {e}"))?;

    let profile = profiles
      .iter()
      .find(|p| p.id.to_string() == profile_id)
      .ok_or_else(|| format!("Profile not found: {profile_id}"))?;

    let db_path = Self::get_cookie_db_path(profile, &profiles_dir)?;

    let cookies = match profile.browser.as_str() {
      "camoufox" => Self::read_firefox_cookies(&db_path)?,
      "wayfern" => {
        let key = Self::get_chrome_encryption_key(profile, &profiles_dir);
        Self::read_chrome_cookies(&db_path, key.as_ref())?
      }
      _ => return Err(format!("Unsupported browser type: {}", profile.browser)),
    };

    let mut domain_map: HashMap<String, Vec<UnifiedCookie>> = HashMap::new();

    for cookie in cookies {
      domain_map
        .entry(cookie.domain.clone())
        .or_default()
        .push(cookie);
    }

    let mut domains: Vec<DomainCookies> = domain_map
      .into_iter()
      .map(|(domain, cookies)| DomainCookies {
        domain,
        cookie_count: cookies.len(),
        cookies,
      })
      .collect();

    domains.sort_by(|a, b| a.domain.cmp(&b.domain));

    let total_count = domains.iter().map(|d| d.cookie_count).sum();

    Ok(CookieReadResult {
      profile_id: profile_id.to_string(),
      browser_type: profile.browser.clone(),
      domains,
      total_count,
    })
  }

  /// Open the cookie SQLite database read-only without acquiring any lock.
  ///
  /// `immutable=1` tells SQLite the file will not change during the read,
  /// which causes it to skip all locking. That lets us read metadata even
  /// while the browser holds an exclusive lock on the cookies database —
  /// the trade-off is that we may see a slightly stale snapshot, which is
  /// acceptable for the badge/preview use cases this powers.
  fn open_cookie_db_readonly(db_path: &Path) -> Result<Connection, String> {
    let path_str = db_path.to_string_lossy();
    if path_str.contains('?') || path_str.contains('#') {
      return Err(
        serde_json::json!({
          "code": "COOKIE_DB_UNAVAILABLE",
          "params": { "detail": "profile path contains a reserved URI character" }
        })
        .to_string(),
      );
    }
    let uri = format!("file:{path_str}?mode=ro&immutable=1");
    Connection::open_with_flags(
      &uri,
      OpenFlags::SQLITE_OPEN_READ_ONLY
        | OpenFlags::SQLITE_OPEN_URI
        | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| {
      let code = if e.to_string().to_lowercase().contains("locked") {
        "COOKIE_DB_LOCKED"
      } else {
        "COOKIE_DB_UNAVAILABLE"
      };
      serde_json::json!({
        "code": code,
        "params": { "detail": e.to_string() }
      })
      .to_string()
    })
  }

  /// Public API: read lightweight stats (total count + top 5 domains) for a
  /// profile's cookie store. Reads from a snapshot view of the SQLite file
  /// without holding a lock, so this works while the browser is running.
  pub fn read_stats(profile_id: &str) -> Result<CookieStats, String> {
    let profile_manager = ProfileManager::instance();
    let profiles_dir = profile_manager.get_profiles_dir();
    let profiles = profile_manager.list_profiles().map_err(|e| {
      serde_json::json!({
        "code": "COOKIE_DB_UNAVAILABLE",
        "params": { "detail": e.to_string() }
      })
      .to_string()
    })?;

    let profile = profiles
      .iter()
      .find(|p| p.id.to_string() == profile_id)
      .ok_or_else(|| serde_json::json!({ "code": "PROFILE_NOT_FOUND" }).to_string())?;

    let db_path = Self::get_cookie_db_path(profile, &profiles_dir).map_err(|e| {
      serde_json::json!({
        "code": "COOKIE_DB_UNAVAILABLE",
        "params": { "detail": e }
      })
      .to_string()
    })?;

    let conn = Self::open_cookie_db_readonly(&db_path)?;

    let (count_sql, domain_sql) = match profile.browser.as_str() {
      "camoufox" => (
        "SELECT COUNT(*) FROM moz_cookies",
        "SELECT host, COUNT(*) FROM moz_cookies GROUP BY host ORDER BY COUNT(*) DESC, host ASC",
      ),
      "wayfern" => (
        "SELECT COUNT(*) FROM cookies",
        "SELECT host_key, COUNT(*) FROM cookies GROUP BY host_key ORDER BY COUNT(*) DESC, host_key ASC",
      ),
      _ => {
        return Err(
          serde_json::json!({
            "code": "COOKIE_DB_UNAVAILABLE",
            "params": { "detail": format!("unsupported browser: {}", profile.browser) }
          })
          .to_string(),
        )
      }
    };

    let total_count: usize = conn
      .query_row(count_sql, [], |row| row.get::<_, i64>(0))
      .map_err(|e| {
        serde_json::json!({
          "code": "COOKIE_DB_UNAVAILABLE",
          "params": { "detail": e.to_string() }
        })
        .to_string()
      })? as usize;

    let mut stmt = conn.prepare(domain_sql).map_err(|e| {
      serde_json::json!({
        "code": "COOKIE_DB_UNAVAILABLE",
        "params": { "detail": e.to_string() }
      })
      .to_string()
    })?;
    let domains: Vec<DomainCount> = stmt
      .query_map([], |row| {
        Ok(DomainCount {
          domain: row.get::<_, String>(0)?,
          count: row.get::<_, i64>(1)? as usize,
        })
      })
      .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
      .map_err(|e| {
        serde_json::json!({
          "code": "COOKIE_DB_UNAVAILABLE",
          "params": { "detail": e.to_string() }
        })
        .to_string()
      })?;

    Ok(CookieStats {
      profile_id: profile_id.to_string(),
      browser_type: profile.browser.clone(),
      total_count,
      domains,
    })
  }

  /// Public API: Copy cookies between profiles
  pub async fn copy_cookies(
    app_handle: &AppHandle,
    request: CookieCopyRequest,
  ) -> Result<Vec<CookieCopyResult>, String> {
    let profile_manager = ProfileManager::instance();
    let profiles_dir = profile_manager.get_profiles_dir();
    let profiles = profile_manager
      .list_profiles()
      .map_err(|e| format!("Failed to list profiles: {e}"))?;

    let source = profiles
      .iter()
      .find(|p| p.id.to_string() == request.source_profile_id)
      .ok_or_else(|| format!("Source profile not found: {}", request.source_profile_id))?;

    let source_db_path = Self::get_cookie_db_path(source, &profiles_dir)?;
    let all_cookies = match source.browser.as_str() {
      "camoufox" => Self::read_firefox_cookies(&source_db_path)?,
      "wayfern" => {
        let key = Self::get_chrome_encryption_key(source, &profiles_dir);
        Self::read_chrome_cookies(&source_db_path, key.as_ref())?
      }
      _ => return Err(format!("Unsupported browser type: {}", source.browser)),
    };

    let cookies_to_copy: Vec<UnifiedCookie> = if request.selected_cookies.is_empty() {
      all_cookies
    } else {
      all_cookies
        .into_iter()
        .filter(|c| {
          request.selected_cookies.iter().any(|s| {
            if s.name.is_empty() {
              c.domain == s.domain
            } else {
              c.domain == s.domain && c.name == s.name
            }
          })
        })
        .collect()
    };

    let mut results = Vec::new();

    for target_id in &request.target_profile_ids {
      let target = match profiles.iter().find(|p| p.id.to_string() == *target_id) {
        Some(p) => p,
        None => {
          results.push(CookieCopyResult {
            target_profile_id: target_id.clone(),
            cookies_copied: 0,
            cookies_replaced: 0,
            errors: vec![format!("Profile not found: {target_id}")],
          });
          continue;
        }
      };

      let is_running = profile_manager
        .check_browser_status(app_handle.clone(), target)
        .await
        .unwrap_or(false);

      if is_running {
        results.push(CookieCopyResult {
          target_profile_id: target_id.clone(),
          cookies_copied: 0,
          cookies_replaced: 0,
          errors: vec![format!("Browser is running for profile: {}", target.name)],
        });
        continue;
      }

      // Target may be a brand-new profile that has never been launched, so
      // its Cookies DB file doesn't exist yet. Create an empty one on demand.
      let target_db_path = match Self::ensure_cookie_db_path(target, &profiles_dir) {
        Ok(p) => p,
        Err(e) => {
          results.push(CookieCopyResult {
            target_profile_id: target_id.clone(),
            cookies_copied: 0,
            cookies_replaced: 0,
            errors: vec![e],
          });
          continue;
        }
      };

      let write_result = match target.browser.as_str() {
        "camoufox" => Self::write_firefox_cookies(&target_db_path, &cookies_to_copy),
        "wayfern" => Self::write_chrome_cookies(&target_db_path, &cookies_to_copy),
        _ => {
          results.push(CookieCopyResult {
            target_profile_id: target_id.clone(),
            cookies_copied: 0,
            cookies_replaced: 0,
            errors: vec![format!("Unsupported browser: {}", target.browser)],
          });
          continue;
        }
      };

      match write_result {
        Ok((copied, replaced)) => {
          results.push(CookieCopyResult {
            target_profile_id: target_id.clone(),
            cookies_copied: copied,
            cookies_replaced: replaced,
            errors: vec![],
          });
        }
        Err(e) => {
          results.push(CookieCopyResult {
            target_profile_id: target_id.clone(),
            cookies_copied: 0,
            cookies_replaced: 0,
            errors: vec![e],
          });
        }
      }
    }

    Ok(results)
  }

  /// Parse Netscape format cookies from text content
  fn parse_netscape_cookies(content: &str) -> (Vec<UnifiedCookie>, Vec<String>) {
    let mut cookies = Vec::new();
    let mut errors = Vec::new();
    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap()
      .as_secs() as i64;

    for (i, line) in content.lines().enumerate() {
      let line = line.trim();
      if line.is_empty() || line.starts_with('#') {
        continue;
      }

      let fields: Vec<&str> = line.split('\t').collect();
      if fields.len() < 7 {
        errors.push(format!(
          "Line {}: expected 7 tab-separated fields, got {}",
          i + 1,
          fields.len()
        ));
        continue;
      }

      let domain = fields[0].to_string();
      let path = fields[2].to_string();
      let is_secure = fields[3].eq_ignore_ascii_case("TRUE");
      let expires = fields[4].parse::<i64>().unwrap_or(0);
      let name = fields[5].to_string();
      let value = fields[6].to_string();

      cookies.push(UnifiedCookie {
        name,
        value,
        domain,
        path,
        expires,
        is_secure,
        is_http_only: false,
        same_site: 0,
        creation_time: now,
        last_accessed: now,
      });
    }

    (cookies, errors)
  }

  /// Parse JSON format cookies (array of cookie objects, e.g. from browser extensions)
  fn parse_json_cookies(content: &str) -> (Vec<UnifiedCookie>, Vec<String>) {
    let mut cookies = Vec::new();
    let mut errors = Vec::new();
    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap()
      .as_secs() as i64;

    let arr: Vec<Value> = match serde_json::from_str(content) {
      Ok(v) => v,
      Err(e) => {
        errors.push(format!("Failed to parse JSON: {e}"));
        return (cookies, errors);
      }
    };

    for (i, obj) in arr.iter().enumerate() {
      let name = match obj.get("name").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => {
          errors.push(format!("Cookie {}: missing 'name' field", i + 1));
          continue;
        }
      };
      let value = obj
        .get("value")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
      let domain = match obj.get("domain").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => {
          errors.push(format!("Cookie {}: missing 'domain' field", i + 1));
          continue;
        }
      };
      let path = obj
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("/")
        .to_string();
      let is_secure = obj.get("secure").and_then(|v| v.as_bool()).unwrap_or(false);
      let is_http_only = obj
        .get("httpOnly")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
      let is_session = obj
        .get("session")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
      let expires = if is_session {
        0
      } else {
        obj
          .get("expirationDate")
          .and_then(|v| v.as_f64())
          .map(|f| f as i64)
          .unwrap_or(0)
      };
      let same_site = obj
        .get("sameSite")
        .and_then(|v| v.as_str())
        .map(|s| match s {
          "lax" => 1,
          "strict" => 2,
          _ => 0, // "no_restriction" or unrecognized
        })
        .unwrap_or(0);

      cookies.push(UnifiedCookie {
        name,
        value,
        domain,
        path,
        expires,
        is_secure,
        is_http_only,
        same_site,
        creation_time: now,
        last_accessed: now,
      });
    }

    (cookies, errors)
  }

  /// Auto-detect cookie format and parse
  fn parse_cookies(content: &str) -> (Vec<UnifiedCookie>, Vec<String>) {
    let trimmed = content.trim();
    if trimmed.starts_with('[') && serde_json::from_str::<Vec<Value>>(trimmed).is_ok() {
      return Self::parse_json_cookies(trimmed);
    }
    Self::parse_netscape_cookies(content)
  }

  /// Format cookies as Netscape TXT
  pub fn format_netscape_cookies(cookies: &[UnifiedCookie]) -> String {
    let mut lines = Vec::new();
    lines.push("# Netscape HTTP Cookie File".to_string());
    for cookie in cookies {
      let flag = if cookie.domain.starts_with('.') {
        "TRUE"
      } else {
        "FALSE"
      };
      let secure = if cookie.is_secure { "TRUE" } else { "FALSE" };
      lines.push(format!(
        "{}\t{}\t{}\t{}\t{}\t{}\t{}",
        cookie.domain, flag, cookie.path, secure, cookie.expires, cookie.name, cookie.value
      ));
    }
    lines.join("\n")
  }

  /// Format cookies as JSON
  pub fn format_json_cookies(cookies: &[UnifiedCookie]) -> String {
    let arr: Vec<Value> = cookies
      .iter()
      .map(|c| {
        let same_site_str = match c.same_site {
          1 => "lax",
          2 => "strict",
          _ => "no_restriction",
        };
        serde_json::json!({
          "name": c.name,
          "value": c.value,
          "domain": c.domain,
          "path": c.path,
          "secure": c.is_secure,
          "httpOnly": c.is_http_only,
          "sameSite": same_site_str,
          "expirationDate": c.expires,
          "session": c.expires == 0,
          "hostOnly": !c.domain.starts_with('.'),
        })
      })
      .collect();
    serde_json::to_string_pretty(&arr).unwrap_or_else(|_| "[]".to_string())
  }

  /// Public API: Import cookies with auto-format detection
  pub async fn import_cookies(
    app_handle: &AppHandle,
    profile_id: &str,
    content: &str,
  ) -> Result<CookieImportResult, String> {
    let profile_manager = ProfileManager::instance();
    let profiles_dir = profile_manager.get_profiles_dir();
    let profiles = profile_manager
      .list_profiles()
      .map_err(|e| format!("Failed to list profiles: {e}"))?;

    let profile = profiles
      .iter()
      .find(|p| p.id.to_string() == profile_id)
      .ok_or_else(|| format!("Profile not found: {profile_id}"))?;

    let is_running = profile_manager
      .check_browser_status(app_handle.clone(), profile)
      .await
      .unwrap_or(false);

    if is_running {
      return Err(format!(
        "Cannot import cookies while browser is running for profile: {}",
        profile.name
      ));
    }

    let (cookies, parse_errors) = Self::parse_cookies(content);

    if cookies.is_empty() {
      return Err("No valid cookies found in the file".to_string());
    }

    // Profile may have never been launched yet — create an empty DB on demand.
    let db_path = Self::ensure_cookie_db_path(profile, &profiles_dir)?;

    let write_result = match profile.browser.as_str() {
      "camoufox" => Self::write_firefox_cookies(&db_path, &cookies),
      "wayfern" => Self::write_chrome_cookies(&db_path, &cookies),
      _ => return Err(format!("Unsupported browser type: {}", profile.browser)),
    };

    match write_result {
      Ok((imported, replaced)) => Ok(CookieImportResult {
        cookies_imported: imported,
        cookies_replaced: replaced,
        errors: parse_errors,
      }),
      Err(e) => Err(format!("Failed to write cookies: {e}")),
    }
  }

  /// Public API: Export cookies from a profile in the specified format
  pub fn export_cookies(profile_id: &str, format: &str) -> Result<String, String> {
    let result = Self::read_cookies(profile_id)?;
    let all_cookies: Vec<UnifiedCookie> =
      result.domains.into_iter().flat_map(|d| d.cookies).collect();

    match format {
      "json" => Ok(Self::format_json_cookies(&all_cookies)),
      "netscape" => Ok(Self::format_netscape_cookies(&all_cookies)),
      _ => Err(format!("Unsupported export format: {format}")),
    }
  }
}
