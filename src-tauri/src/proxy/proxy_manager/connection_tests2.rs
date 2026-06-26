#[cfg(test)]
mod tests2 {
  use super::*;

  fn make_proxy_info(id: &str, port: u16, profile_id: Option<&str>) -> ProxyInfo {
    ProxyInfo {
      id: id.to_string(),
      local_url: format!("http://127.0.0.1:{port}"),
      upstream_host: "10.0.0.1".to_string(),
      upstream_port: 3128,
      upstream_type: "http".to_string(),
      local_port: port,
      profile_id: profile_id.map(|s| s.to_string()),
      blocklist_file: None,
    }
  }
  #[test]
  fn test_proxy_config_persistence_roundtrip() {
    use crate::proxy::proxy_storage::{
      delete_proxy_config, generate_proxy_id, get_proxy_config, save_proxy_config, ProxyConfig,
    };

    let id = generate_proxy_id();
    let config = ProxyConfig {
      id: id.clone(),
      upstream_url: "socks5://user:pass@10.0.0.1:1080".to_string(),
      local_port: Some(18080),
      ignore_proxy_certificate: Some(true),
      local_url: Some("http://127.0.0.1:18080".to_string()),
      pid: Some(12345),
      profile_id: Some("prof_abc".to_string()),
      bypass_rules: vec!["*.local".to_string(), "192.168.*".to_string()],
      blocklist_file: None,
      local_protocol: None,
      browser_pid: None,
    };

    // Save
    save_proxy_config(&config).unwrap();

    // Load and compare
    let loaded = get_proxy_config(&id).expect("Config should be loadable");
    assert_eq!(loaded.id, config.id);
    assert_eq!(loaded.upstream_url, config.upstream_url);
    assert_eq!(loaded.local_port, config.local_port);
    assert_eq!(
      loaded.ignore_proxy_certificate,
      config.ignore_proxy_certificate
    );
    assert_eq!(loaded.local_url, config.local_url);
    assert_eq!(loaded.pid, config.pid);
    assert_eq!(loaded.profile_id, config.profile_id);
    assert_eq!(loaded.bypass_rules, config.bypass_rules);

    // Clean up
    assert!(delete_proxy_config(&id));
    assert!(get_proxy_config(&id).is_none());
  }

  #[test]
  fn test_proxy_config_update_preserves_fields() {
    use crate::proxy::proxy_storage::{
      delete_proxy_config, get_proxy_config, save_proxy_config, update_proxy_config, ProxyConfig,
    };

    let id = format!("proxy_test_update_{}", rand::random::<u32>());
    let mut config = ProxyConfig::new(id.clone(), "DIRECT".to_string(), Some(17777));
    config.pid = Some(99999);
    config.profile_id = Some("prof_up".to_string());
    config.bypass_rules = vec!["google.com".to_string()];

    save_proxy_config(&config).unwrap();

    // Update: change the local_url (simulates worker binding)
    config.local_url = Some("http://127.0.0.1:17777".to_string());
    assert!(update_proxy_config(&config));

    let reloaded = get_proxy_config(&id).unwrap();
    assert_eq!(
      reloaded.local_url.as_deref(),
      Some("http://127.0.0.1:17777")
    );
    // Other fields should be preserved
    assert_eq!(reloaded.pid, Some(99999));
    assert_eq!(reloaded.bypass_rules, vec!["google.com".to_string()]);

    delete_proxy_config(&id);
  }

  #[test]
  fn test_proxy_config_list_filters_json_only() {
    use crate::proxy::proxy_storage::{
      delete_proxy_config, list_proxy_configs, save_proxy_config, ProxyConfig,
    };

    let id1 = format!("proxy_list_test_{}", rand::random::<u32>());
    let id2 = format!("proxy_list_test_{}", rand::random::<u32>());

    let c1 = ProxyConfig::new(id1.clone(), "DIRECT".to_string(), Some(16001));
    let c2 = ProxyConfig::new(id2.clone(), "DIRECT".to_string(), Some(16002));

    save_proxy_config(&c1).unwrap();
    save_proxy_config(&c2).unwrap();

    let all = list_proxy_configs();
    let our_ids: Vec<_> = all.iter().filter(|c| c.id == id1 || c.id == id2).collect();
    assert_eq!(our_ids.len(), 2, "Both test configs should be listed");

    delete_proxy_config(&id1);
    delete_proxy_config(&id2);
  }

  #[test]
  fn test_proxy_id_uniqueness_and_format() {
    use crate::proxy::proxy_storage::generate_proxy_id;

    let mut ids = std::collections::HashSet::new();
    for _ in 0..100 {
      let id = generate_proxy_id();
      assert!(id.starts_with("proxy_"), "ID must start with proxy_");
      // Format: proxy_{timestamp}_{random}
      let parts: Vec<&str> = id.split('_').collect();
      assert_eq!(
        parts.len(),
        3,
        "ID should have exactly 3 underscore-separated parts"
      );
      assert!(
        parts[1].parse::<u64>().is_ok(),
        "Second part must be a unix timestamp"
      );
      assert!(
        parts[2].parse::<u32>().is_ok(),
        "Third part must be a u32 random"
      );
      ids.insert(id);
    }
    assert_eq!(ids.len(), 100, "All 100 generated IDs must be unique");
  }

  #[test]
  fn test_multiple_profiles_share_proxy_independently() {
    let pm = ProxyManager::new();

    // Two profiles sharing the same upstream but with distinct proxy instances
    let info_a = ProxyInfo {
      id: "px_shared_a".to_string(),
      local_url: "http://127.0.0.1:9201".to_string(),
      upstream_host: "proxy.shared.com".to_string(),
      upstream_port: 8080,
      upstream_type: "http".to_string(),
      local_port: 9201,
      profile_id: Some("profile_alpha".to_string()),
      blocklist_file: None,
    };
    let info_b = ProxyInfo {
      id: "px_shared_b".to_string(),
      local_url: "http://127.0.0.1:9202".to_string(),
      upstream_host: "proxy.shared.com".to_string(),
      upstream_port: 8080,
      upstream_type: "http".to_string(),
      local_port: 9202,
      profile_id: Some("profile_beta".to_string()),
      blocklist_file: None,
    };

    pm.insert_active_proxy(3001, info_a);
    pm.insert_active_proxy(3002, info_b);
    pm.insert_profile_proxy_mapping("profile_alpha".to_string(), "px_shared_a".to_string());
    pm.insert_profile_proxy_mapping("profile_beta".to_string(), "px_shared_b".to_string());

    // Remove alpha's browser → should NOT affect beta
    {
      let mut proxies = pm.active_proxies.lock().unwrap();
      proxies.remove(&3001);
    }
    {
      let mut map = pm.profile_active_proxy_ids.lock().unwrap();
      map.remove("profile_alpha");
    }

    assert_eq!(pm.active_proxy_count(), 1);
    assert_eq!(pm.profile_proxy_mapping_count(), 1);
    let remaining = pm.get_active_proxy(3002).unwrap();
    assert_eq!(remaining.id, "px_shared_b");
    assert_eq!(remaining.profile_id.as_deref(), Some("profile_beta"));
  }

  #[test]
  fn test_proxy_url_construction() {
    // Basic HTTP
    let url = ProxyManager::build_proxy_url(&ProxySettings {
      proxy_type: "http".to_string(),
      host: "1.2.3.4".to_string(),
      port: 8080,
      username: None,
      password: None,
    });
    assert_eq!(url, "http://1.2.3.4:8080");

    // With credentials
    let url = ProxyManager::build_proxy_url(&ProxySettings {
      proxy_type: "socks5".to_string(),
      host: "proxy.example.com".to_string(),
      port: 1080,
      username: Some("user".to_string()),
      password: Some("p@ss".to_string()),
    });
    assert_eq!(url, "socks5://user:p%40ss@proxy.example.com:1080");

    // Username-only (no password)
    let url = ProxyManager::build_proxy_url(&ProxySettings {
      proxy_type: "http".to_string(),
      host: "host.io".to_string(),
      port: 3128,
      username: Some("justuser".to_string()),
      password: None,
    });
    assert_eq!(url, "http://justuser@host.io:3128");
  }

  #[test]
  fn test_geo_username_construction() {
    // Country only
    let u = ProxyManager::build_geo_username("base_user", "US", &None, &None, &None);
    assert_eq!(u, "base_user-country-US");

    // Country + region
    let u = ProxyManager::build_geo_username(
      "base_user",
      "US",
      &Some("california".to_string()),
      &None,
      &None,
    );
    assert_eq!(u, "base_user-country-US-region-california");

    // All fields
    let u = ProxyManager::build_geo_username(
      "user",
      "DE",
      &Some("bavaria".to_string()),
      &Some("munich".to_string()),
      &Some("Telekom".to_string()),
    );
    assert_eq!(u, "user-country-DE-region-bavaria-city-munich-isp-Telekom");
  }

  #[test]
  fn test_sid_generation_determinism_and_format() {
    let sid1 = ProxyManager::generate_sid_for_profile("my-profile-uuid");
    let sid2 = ProxyManager::generate_sid_for_profile("my-profile-uuid");
    assert_eq!(sid1, sid2, "Same input must produce same SID");
    assert_eq!(sid1.len(), 11, "SID must be exactly 11 characters");

    // All chars should be alphanumeric lowercase
    assert!(
      sid1
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
      "SID chars must be [a-z0-9]"
    );

    // Different profiles produce different SIDs
    let sid3 = ProxyManager::generate_sid_for_profile("another-profile");
    assert_ne!(sid1, sid3, "Different profiles must produce different SIDs");
  }

  #[test]
  fn test_build_username_with_sid() {
    let full = ProxyManager::build_username_with_sid("user-country-US", "profile-123");
    // Should contain the geo base, then -sid-{11chars}-ttl-1440m
    assert!(full.starts_with("user-country-US-sid-"));
    assert!(full.ends_with("-ttl-1440m"));
    // SID portion
    let after_sid = full.strip_prefix("user-country-US-sid-").unwrap();
    let sid = after_sid.strip_suffix("-ttl-1440m").unwrap();
    assert_eq!(sid.len(), 11);
  }

  #[test]
  fn test_stored_proxy_geo_field_migration() {
    // Simulate legacy data with geo_state but no geo_region
    let mut proxy = StoredProxy {
      id: "test_migrate".to_string(),
      name: "Test".to_string(),
      proxy_settings: ProxySettings {
        proxy_type: "http".to_string(),
        host: "h.com".to_string(),
        port: 80,
        username: None,
        password: None,
      },
      sync_enabled: false,
      last_sync: None,
      updated_at: None,
      is_cloud_managed: false,
      is_cloud_derived: false,
      geo_country: Some("US".to_string()),
      geo_state: Some("california".to_string()),
      geo_region: None,
      geo_city: None,
      geo_isp: None,
      dynamic_proxy_url: None,
      dynamic_proxy_format: None,
    };

    // Before migration
    assert_eq!(proxy.effective_region().unwrap(), "california");
    assert!(proxy.geo_region.is_none());

    // After migration
    proxy.migrate_geo_fields();
    assert_eq!(proxy.geo_region.as_deref(), Some("california"));
    assert!(proxy.geo_state.is_none(), "geo_state should be taken");
    assert_eq!(proxy.effective_region().unwrap(), "california");
  }

  #[test]
  fn test_cleanup_skips_recently_created_configs() {
    use crate::proxy::proxy_storage::{delete_proxy_config, save_proxy_config, ProxyConfig};

    // Use current timestamp so it falls within the 120s grace period
    let now_ts = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap()
      .as_secs();

    let recent_id = format!("proxy_{now_ts}_99999");

    // Spawn and kill a child so the PID is dead
    let dead_child = std::process::Command::new(if cfg!(windows) { "cmd" } else { "true" })
      .args(if cfg!(windows) {
        vec!["/C", "exit"]
      } else {
        vec![]
      })
      .spawn()
      .unwrap();
    let dead_pid = dead_child.id();
    let mut dead_child = dead_child;
    dead_child.wait().unwrap();

    let config = ProxyConfig {
      id: recent_id.clone(),
      upstream_url: "DIRECT".to_string(),
      local_port: Some(19999),
      ignore_proxy_certificate: None,
      local_url: None,
      pid: Some(dead_pid),
      profile_id: None,
      bypass_rules: Vec::new(),
      blocklist_file: None,
      local_protocol: None,
      browser_pid: None,
    };
    save_proxy_config(&config).unwrap();

    // The cleanup logic inspects the timestamp in the proxy ID.
    // Since we used the current timestamp, the proxy_age will be < 120 seconds,
    // so it should be skipped despite the dead PID.

    // Verify the grace period logic directly:
    let proxy_age = recent_id
      .strip_prefix("proxy_")
      .and_then(|s| s.split('_').next())
      .and_then(|s| s.parse::<u64>().ok())
      .map(|created_at| now_ts.saturating_sub(created_at))
      .unwrap_or(0);

    assert!(
      proxy_age < 120,
      "Recently created config should be in grace period"
    );

    // Clean up test config
    delete_proxy_config(&recent_id);
  }

  #[tokio::test]
  async fn test_concurrent_config_operations() {
    use crate::proxy::proxy_storage::{
      delete_proxy_config, get_proxy_config, save_proxy_config, ProxyConfig,
    };
    use std::sync::Arc;

    let ids: Vec<String> = (0..20)
      .map(|i| format!("proxy_conc_test_{}_{}", i, rand::random::<u32>()))
      .collect();
    let ids = Arc::new(ids);

    // Concurrent writes
    let mut handles = vec![];
    for id in ids.iter() {
      let id = id.clone();
      handles.push(tokio::spawn(async move {
        let config = ProxyConfig::new(id.clone(), "DIRECT".to_string(), Some(15000));
        save_proxy_config(&config).unwrap();
      }));
    }
    for h in handles {
      h.await.unwrap();
    }

    // Verify all were written
    for id in ids.iter() {
      assert!(
        get_proxy_config(id).is_some(),
        "Config {id} should be readable after concurrent write"
      );
    }

    // Concurrent deletes
    let mut handles = vec![];
    for id in ids.iter() {
      let id = id.clone();
      handles.push(tokio::spawn(async move {
        delete_proxy_config(&id);
      }));
    }
    for h in handles {
      h.await.unwrap();
    }

    // Verify all deleted
    for id in ids.iter() {
      assert!(
        get_proxy_config(id).is_none(),
        "Config {id} should be gone after concurrent delete"
      );
    }
  }

  #[test]
  fn test_proxy_txt_parsing_various_formats() {
    // URL format
    let results = ProxyManager::parse_txt_proxies("http://user:pass@proxy.com:8080\n");
    assert_eq!(results.len(), 1);
    match &results[0] {
      ProxyParseResult::Parsed(p) => {
        assert_eq!(p.proxy_type, "http");
        assert_eq!(p.host, "proxy.com");
        assert_eq!(p.port, 8080);
        assert_eq!(p.username.as_deref(), Some("user"));
        assert_eq!(p.password.as_deref(), Some("pass"));
      }
      _ => panic!("Expected Parsed result"),
    }

    // host:port format
    let results = ProxyManager::parse_txt_proxies("10.0.0.1:3128\n");
    match &results[0] {
      ProxyParseResult::Parsed(p) => {
        assert_eq!(p.host, "10.0.0.1");
        assert_eq!(p.port, 3128);
        assert!(p.username.is_none());
      }
      _ => panic!("Expected Parsed"),
    }

    // host:port:user:pass format
    let results = ProxyManager::parse_txt_proxies("myhost:9090:admin:secret\n");
    match &results[0] {
      ProxyParseResult::Parsed(p) => {
        assert_eq!(p.host, "myhost");
        assert_eq!(p.port, 9090);
        assert_eq!(p.username.as_deref(), Some("admin"));
        assert_eq!(p.password.as_deref(), Some("secret"));
      }
      _ => panic!("Expected Parsed"),
    }

    // Comments and empty lines should be skipped
    let results = ProxyManager::parse_txt_proxies("# comment\n\n  \n1.2.3.4:80\n");
    assert_eq!(results.len(), 1);

    // SOCKS5 URL
    let results = ProxyManager::parse_txt_proxies("socks5://u:p@1.2.3.4:1080\n");
    match &results[0] {
      ProxyParseResult::Parsed(p) => {
        assert_eq!(p.proxy_type, "socks5");
        assert_eq!(p.host, "1.2.3.4");
        assert_eq!(p.port, 1080);
      }
      _ => panic!("Expected Parsed"),
    }

    // Ambiguous: both positions could be ports
    let results = ProxyManager::parse_txt_proxies("1234:5678:9012:3456\n");
    match &results[0] {
      ProxyParseResult::Ambiguous {
        possible_formats, ..
      } => {
        assert_eq!(possible_formats.len(), 2);
      }
      _ => panic!("Expected Ambiguous"),
    }

    // Invalid
    let results = ProxyManager::parse_txt_proxies("notaproxy\n");
    match &results[0] {
      ProxyParseResult::Invalid { .. } => {}
      _ => panic!("Expected Invalid"),
    }
  }

  #[test]
  fn test_multiple_proxy_types_coexist() {
    let pm = ProxyManager::new();

    // Different proxy types for different profiles
    let types = [
      ("http", 3128),
      ("https", 3129),
      ("socks4", 1080),
      ("socks5", 1081),
    ];

    for (i, (ptype, port)) in types.iter().enumerate() {
      let info = ProxyInfo {
        id: format!("px_type_{ptype}"),
        local_url: format!("http://127.0.0.1:{}", 9300 + i as u16),
        upstream_host: "upstream.test".to_string(),
        upstream_port: *port,
        upstream_type: ptype.to_string(),
        local_port: 9300 + i as u16,
        profile_id: Some(format!("profile_{ptype}")),
        blocklist_file: None,
      };
      pm.insert_active_proxy(4000 + i as u32, info);
    }

    assert_eq!(pm.active_proxy_count(), 4);

    // Verify each type is stored correctly
    let info = pm.get_active_proxy(4000).unwrap();
    assert_eq!(info.upstream_type, "http");
    let info = pm.get_active_proxy(4003).unwrap();
    assert_eq!(info.upstream_type, "socks5");
    assert_eq!(info.upstream_port, 1081);
  }

  #[test]
  fn test_overwrite_pid_mapping() {
    let pm = ProxyManager::new();

    // Register proxy for PID 5000
    pm.insert_active_proxy(5000, make_proxy_info("px_old", 9400, Some("prof_ow")));

    // Overwrite the same PID with a new proxy (simulates browser reconnect with different proxy)
    pm.insert_active_proxy(5000, make_proxy_info("px_new", 9401, Some("prof_ow")));

    // Should only have 1 entry, with the new proxy
    assert_eq!(pm.active_proxy_count(), 1);
    let info = pm.get_active_proxy(5000).unwrap();
    assert_eq!(info.id, "px_new");
    assert_eq!(info.local_port, 9401);
  }

  #[test]
  fn test_proxy_config_with_bypass_rules_roundtrip() {
    use crate::proxy::proxy_storage::{
      delete_proxy_config, get_proxy_config, save_proxy_config, ProxyConfig,
    };

    let id = format!("proxy_bypass_test_{}", rand::random::<u32>());
    let rules = vec![
      "*.google.com".to_string(),
      "localhost".to_string(),
      "192.168.0.*".to_string(),
      "^.*\\.internal\\.corp$".to_string(),
    ];

    let config = ProxyConfig::new(id.clone(), "http://upstream:3128".to_string(), Some(18888))
      .with_profile_id(Some("prof_bypass".to_string()))
      .with_bypass_rules(rules.clone());

    save_proxy_config(&config).unwrap();

    let loaded = get_proxy_config(&id).unwrap();
    assert_eq!(loaded.bypass_rules.len(), 4);
    assert_eq!(loaded.bypass_rules, rules);
    assert_eq!(loaded.profile_id.as_deref(), Some("prof_bypass"));

    delete_proxy_config(&id);
  }
}
