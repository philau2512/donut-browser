#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Write;

  /// Build an upstream URL with `urlencoding::encode`-d user/pass,
  /// mirroring what `proxy_manager::build_proxy_url` actually emits
  fn parse_encoded_upstream(scheme: &str, user: &str, pass: &str) -> Url {
    let s = format!(
      "{}://{}:{}@127.0.0.1:1080",
      scheme,
      urlencoding::encode(user),
      urlencoding::encode(pass),
    );
    Url::parse(&s).unwrap()
  }

  #[test]
  fn upstream_userpass_handles_plain_ascii() {
    let u = parse_encoded_upstream("socks5", "alice", "secret123");
    assert_eq!(upstream_userpass(&u), ("alice".into(), "secret123".into()));
  }

  #[test]
  fn upstream_userpass_decodes_special_chars() {
    // These characters all get percent-encoded by build_proxy_url before
    // landing in the URL, and must be decoded back to the original literal
    // before being handed off to the upstream
    let cases = [
      ("alice", "p@ssw0rd"),
      ("alice", "p:assw0rd"),
      ("alice", "p ass word"),
      ("alice", "abc/d+e=f"),
      ("alice", "100%off!"),
      ("alice", "测试密码"),
      ("u@name", "v@lue"),
    ];
    for (user, pass) in cases {
      let u = parse_encoded_upstream("socks5", user, pass);
      assert_eq!(
        upstream_userpass(&u),
        (user.to_string(), pass.to_string()),
        "decode failed: user={user:?} pass={pass:?}"
      );
    }
  }

  #[test]
  fn upstream_userpass_empty_when_no_credentials() {
    let u = Url::parse("socks5://127.0.0.1:1080").unwrap();
    assert_eq!(upstream_userpass(&u), (String::new(), String::new()));
  }

  #[test]
  fn upstream_userpass_handles_username_only() {
    let s = format!("socks5://{}@127.0.0.1:1080", urlencoding::encode("u@name"));
    let u = Url::parse(&s).unwrap();
    assert_eq!(upstream_userpass(&u), ("u@name".into(), String::new()));
  }

  #[test]
  fn test_blocklist_exact_match() {
    let mut matcher = BlocklistMatcher::new();
    let mut domains = HashSet::new();
    domains.insert("example.com".to_string());
    domains.insert("tracker.net".to_string());
    matcher.domains = Arc::new(domains);

    assert!(matcher.is_blocked("example.com"));
    assert!(matcher.is_blocked("tracker.net"));
    assert!(!matcher.is_blocked("safe.com"));
  }

  #[test]
  fn test_blocklist_subdomain_match() {
    let mut matcher = BlocklistMatcher::new();
    let mut domains = HashSet::new();
    domains.insert("example.com".to_string());
    matcher.domains = Arc::new(domains);

    assert!(matcher.is_blocked("foo.example.com"));
    assert!(matcher.is_blocked("bar.baz.example.com"));
    assert!(matcher.is_blocked("a.b.c.example.com"));
  }

  #[test]
  fn test_blocklist_no_false_positives() {
    let mut matcher = BlocklistMatcher::new();
    let mut domains = HashSet::new();
    domains.insert("example.com".to_string());
    matcher.domains = Arc::new(domains);

    // "notexample.com" should NOT match "example.com"
    assert!(!matcher.is_blocked("notexample.com"));
    assert!(!matcher.is_blocked("myexample.com"));
    // But subdomain should
    assert!(matcher.is_blocked("sub.example.com"));
  }

  #[test]
  fn test_blocklist_empty_blocks_nothing() {
    let matcher = BlocklistMatcher::new();
    assert!(!matcher.is_blocked("anything.com"));
    assert!(!matcher.is_blocked("example.com"));
  }

  #[test]
  fn test_blocklist_case_insensitive() {
    let mut matcher = BlocklistMatcher::new();
    let mut domains = HashSet::new();
    domains.insert("example.com".to_string());
    matcher.domains = Arc::new(domains);

    assert!(matcher.is_blocked("EXAMPLE.COM"));
    assert!(matcher.is_blocked("Example.Com"));
    assert!(matcher.is_blocked("FOO.EXAMPLE.COM"));
  }

  #[test]
  fn test_blocklist_from_file() {
    let mut tmpfile = tempfile::NamedTempFile::new().unwrap();
    writeln!(tmpfile, "# This is a comment").unwrap();
    writeln!(tmpfile).unwrap();
    writeln!(tmpfile, "tracker.example.com").unwrap();
    writeln!(tmpfile, "ads.network.com").unwrap();
    writeln!(tmpfile, "# Another comment").unwrap();
    writeln!(tmpfile, "malware.site").unwrap();
    tmpfile.flush().unwrap();

    let matcher = BlocklistMatcher::from_file(tmpfile.path().to_str().unwrap()).unwrap();

    assert!(matcher.is_blocked("tracker.example.com"));
    assert!(matcher.is_blocked("ads.network.com"));
    assert!(matcher.is_blocked("malware.site"));
    assert!(matcher.is_blocked("sub.malware.site"));
    assert!(!matcher.is_blocked("safe.com"));
    // Comments and empty lines should be skipped: 3 domains loaded
    assert_eq!(matcher.domains.len(), 3);
  }

  #[test]
  fn test_blocklist_comments_skipped() {
    let mut tmpfile = tempfile::NamedTempFile::new().unwrap();
    writeln!(tmpfile, "# Title: HaGeZi's Light DNS Blocklist").unwrap();
    writeln!(tmpfile, "# Description: test").unwrap();
    writeln!(tmpfile, "# Version: 2026.0330.0928.01").unwrap();
    writeln!(tmpfile).unwrap();
    writeln!(tmpfile, "domain1.com").unwrap();
    writeln!(tmpfile, "domain2.com").unwrap();
    tmpfile.flush().unwrap();

    let matcher = BlocklistMatcher::from_file(tmpfile.path().to_str().unwrap()).unwrap();
    assert_eq!(matcher.domains.len(), 2);
    assert!(matcher.is_blocked("domain1.com"));
    assert!(matcher.is_blocked("domain2.com"));
  }
}
