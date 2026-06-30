
#[tokio::test]
async fn test_batch_presign_upload() {
  ensure_sync_server_available().await;
  let client = TestClient::new();
  let profile_id = uuid::Uuid::new_v4().to_string();

  let items = vec![
    json!({
      "key": format!("profiles/{}/files/file1.txt", profile_id),
      "contentType": "text/plain"
    }),
    json!({
      "key": format!("profiles/{}/files/file2.txt", profile_id),
      "contentType": "text/plain"
    }),
    json!({
      "key": format!("profiles/{}/files/subdir/file3.txt", profile_id),
      "contentType": "text/plain"
    }),
  ];

  let response = client
    .client
    .post(client.url("presign-upload-batch"))
    .header("Authorization", format!("Bearer {}", client.token))
    .json(&json!({ "items": items }))
    .send()
    .await
    .unwrap();

  assert!(response.status().is_success());

  let result: serde_json::Value = response.json().await.unwrap();
  let items_result = result["items"].as_array().unwrap();

  assert_eq!(items_result.len(), 3);
  for item in items_result {
    assert!(item["url"].as_str().is_some());
    assert!(item["key"].as_str().is_some());
  }
}

#[tokio::test]
async fn test_batch_presign_download() {
  ensure_sync_server_available().await;
  let client = TestClient::new();
  let profile_id = uuid::Uuid::new_v4().to_string();

  // First upload some files
  let file_keys = vec![
    format!("profiles/{}/files/file1.txt", profile_id),
    format!("profiles/{}/files/file2.txt", profile_id),
  ];

  for key in &file_keys {
    let presign = client.presign_upload(key, "text/plain").await.unwrap();
    client
      .upload_bytes(&presign.url, b"test content", "text/plain")
      .await
      .unwrap();
  }

  // Now test batch download presign
  let response = client
    .client
    .post(client.url("presign-download-batch"))
    .header("Authorization", format!("Bearer {}", client.token))
    .json(&json!({ "keys": file_keys }))
    .send()
    .await
    .unwrap();

  assert!(response.status().is_success());

  let result: serde_json::Value = response.json().await.unwrap();
  let items_result = result["items"].as_array().unwrap();

  assert_eq!(items_result.len(), 2);
  for item in items_result {
    assert!(item["url"].as_str().is_some());
    assert!(item["key"].as_str().is_some());
  }

  // Cleanup
  for key in &file_keys {
    client.delete(key, None).await.unwrap();
  }
}

#[tokio::test]
async fn test_delete_prefix() {
  ensure_sync_server_available().await;
  let client = TestClient::new();
  let profile_id = uuid::Uuid::new_v4().to_string();
  let prefix = format!("profiles/{}/", profile_id);

  // Upload multiple files under the profile prefix
  let file_keys = vec![
    format!("profiles/{}/manifest.json", profile_id),
    format!("profiles/{}/metadata.json", profile_id),
    format!("profiles/{}/files/file1.txt", profile_id),
    format!("profiles/{}/files/subdir/file2.txt", profile_id),
  ];

  for key in &file_keys {
    let content_type = if key.ends_with(".json") {
      "application/json"
    } else {
      "text/plain"
    };
    let presign = client.presign_upload(key, content_type).await.unwrap();
    client
      .upload_bytes(&presign.url, b"test content", content_type)
      .await
      .unwrap();
  }

  // Verify all files exist
  for key in &file_keys {
    let stat = client.stat(key).await.unwrap();
    assert!(stat.exists, "File should exist before delete: {}", key);
  }

  // Delete with prefix
  let tombstone_key = format!("tombstones/profiles/{}.json", profile_id);
  let response = client
    .client
    .post(client.url("delete-prefix"))
    .header("Authorization", format!("Bearer {}", client.token))
    .json(&json!({
      "prefix": prefix,
      "tombstoneKey": tombstone_key
    }))
    .send()
    .await
    .unwrap();

  assert!(response.status().is_success());

  let result: serde_json::Value = response.json().await.unwrap();
  assert_eq!(result["deletedCount"].as_u64().unwrap(), 4);
  assert!(result["tombstoneCreated"].as_bool().unwrap());

  // Verify all files are deleted
  for key in &file_keys {
    let stat = client.stat(key).await.unwrap();
    assert!(
      !stat.exists,
      "File should be deleted after delete-prefix: {}",
      key
    );
  }

  // Verify tombstone exists
  let tombstone_stat = client.stat(&tombstone_key).await.unwrap();
  assert!(tombstone_stat.exists, "Tombstone should exist");

  // Cleanup tombstone
  client.delete(&tombstone_key, None).await.unwrap();
}

#[tokio::test]
async fn test_delta_sync_only_changed_files() {
  ensure_sync_server_available().await;
  let client = TestClient::new();
  let profile_id = uuid::Uuid::new_v4().to_string();

  // Simulate initial upload of 3 files
  let file1_key = format!("profiles/{}/files/file1.txt", profile_id);
  let file2_key = format!("profiles/{}/files/file2.txt", profile_id);
  let file3_key = format!("profiles/{}/files/file3.txt", profile_id);

  let presign1 = client
    .presign_upload(&file1_key, "text/plain")
    .await
    .unwrap();
  client
    .upload_bytes(&presign1.url, b"content1", "text/plain")
    .await
    .unwrap();

  let presign2 = client
    .presign_upload(&file2_key, "text/plain")
    .await
    .unwrap();
  client
    .upload_bytes(&presign2.url, b"content2", "text/plain")
    .await
    .unwrap();

  let presign3 = client
    .presign_upload(&file3_key, "text/plain")
    .await
    .unwrap();
  client
    .upload_bytes(&presign3.url, b"content3", "text/plain")
    .await
    .unwrap();

  // Get initial stats
  let stat1_before = client.stat(&file1_key).await.unwrap();
  let stat2_before = client.stat(&file2_key).await.unwrap();
  let stat3_before = client.stat(&file3_key).await.unwrap();

  // Wait a moment for timestamp differentiation
  tokio::time::sleep(std::time::Duration::from_secs(1)).await;

  // Simulate delta sync: only update file2
  let presign2_update = client
    .presign_upload(&file2_key, "text/plain")
    .await
    .unwrap();
  client
    .upload_bytes(&presign2_update.url, b"content2-updated", "text/plain")
    .await
    .unwrap();

  // Check that file2's metadata changed
  let stat2_after = client.stat(&file2_key).await.unwrap();
  assert_ne!(
    stat2_before.size, stat2_after.size,
    "File2 size should have changed"
  );

  // Verify file1 and file3 are unchanged (same size)
  let stat1_after = client.stat(&file1_key).await.unwrap();
  let stat3_after = client.stat(&file3_key).await.unwrap();
  assert_eq!(
    stat1_before.size, stat1_after.size,
    "File1 should be unchanged"
  );
  assert_eq!(
    stat3_before.size, stat3_after.size,
    "File3 should be unchanged"
  );

  // Cleanup
  client.delete(&file1_key, None).await.unwrap();
  client.delete(&file2_key, None).await.unwrap();
  client.delete(&file3_key, None).await.unwrap();
}

#[tokio::test]
async fn test_profile_bypass_rules_sync() {
  ensure_sync_server_available().await;
  let client = TestClient::new();
  let temp_dir = TempDir::new().unwrap();
  let profile_id = uuid::Uuid::new_v4().to_string();
  let test_key = format!("profiles/{}.tar.gz", profile_id);

  let bypass_rules = vec!["example.com", "192.168.1.0/24", ".*\\.internal\\.net"];

  let bundle = create_test_profile_bundle_with_bypass_rules(temp_dir.path(), &bypass_rules);

  let presign = client
    .presign_upload(&test_key, "application/gzip")
    .await
    .unwrap();
  client
    .upload_bytes(&presign.url, &bundle, "application/gzip")
    .await
    .unwrap();

  let stat = client.stat(&test_key).await.unwrap();
  assert!(stat.exists);

  // Download and verify bypass rules survive the round-trip
  let download_presign = client.presign_download(&test_key).await.unwrap();
  let downloaded = client.download_bytes(&download_presign.url).await.unwrap();
  assert_eq!(downloaded.len(), bundle.len());

  let extract_dir = temp_dir.path().join("extracted");
  fs::create_dir_all(&extract_dir).unwrap();
  let metadata = extract_bundle(&downloaded, &extract_dir);

  assert_eq!(metadata["name"], "Bypass Rules Profile");
  assert_eq!(metadata["browser"], "camoufox");

  let synced_rules = metadata["proxy_bypass_rules"]
    .as_array()
    .expect("proxy_bypass_rules should be an array");
  assert_eq!(synced_rules.len(), 3);
  assert_eq!(synced_rules[0], "example.com");
  assert_eq!(synced_rules[1], "192.168.1.0/24");
  assert_eq!(synced_rules[2], ".*\\.internal\\.net");

  // Also verify empty bypass rules are handled correctly
  let empty_bundle = create_test_profile_bundle_with_bypass_rules(temp_dir.path(), &[]);
  let empty_key = format!("profiles/{}.tar.gz", uuid::Uuid::new_v4());

  let presign2 = client
    .presign_upload(&empty_key, "application/gzip")
    .await
    .unwrap();
  client
    .upload_bytes(&presign2.url, &empty_bundle, "application/gzip")
    .await
    .unwrap();

  let download_presign2 = client.presign_download(&empty_key).await.unwrap();
  let downloaded2 = client.download_bytes(&download_presign2.url).await.unwrap();

  let extract_dir2 = temp_dir.path().join("extracted2");
  fs::create_dir_all(&extract_dir2).unwrap();
  let metadata2 = extract_bundle(&downloaded2, &extract_dir2);

  let empty_rules = metadata2["proxy_bypass_rules"]
    .as_array()
    .expect("proxy_bypass_rules should be an array");
  assert!(empty_rules.is_empty());

  // Cleanup
  client.delete(&test_key, None).await.unwrap();
  client.delete(&empty_key, None).await.unwrap();
}

#[tokio::test]
async fn test_encrypted_profile_sync() {
  use donutbrowser_lib::sync::encryption::{
    decrypt_bytes, derive_profile_key, encrypt_bytes, generate_salt,
  };

  ensure_sync_server_available().await;
  let client = TestClient::new();
  let temp_dir = TempDir::new().unwrap();
  let profile_id = uuid::Uuid::new_v4().to_string();
  let test_key = format!("profiles/{}.tar.gz.enc", profile_id);

  let bundle = create_test_profile_bundle(temp_dir.path());

  let salt = generate_salt();
  let password = "test-e2e-encryption-password";
  let key = derive_profile_key(password, &salt).unwrap();

  let encrypted = encrypt_bytes(&key, &bundle).unwrap();
  assert_ne!(
    encrypted, bundle,
    "Encrypted data should differ from plaintext"
  );
  assert!(
    encrypted.len() > bundle.len(),
    "Encrypted data includes nonce + auth tag overhead"
  );

  let presign = client
    .presign_upload(&test_key, "application/octet-stream")
    .await
    .unwrap();
  client
    .upload_bytes(&presign.url, &encrypted, "application/octet-stream")
    .await
    .unwrap();

  let stat = client.stat(&test_key).await.unwrap();
  assert!(stat.exists);
  assert_eq!(stat.size, Some(encrypted.len() as u64));

  let download_presign = client.presign_download(&test_key).await.unwrap();
  let downloaded = client.download_bytes(&download_presign.url).await.unwrap();
  assert_eq!(downloaded.len(), encrypted.len());

  let decrypted = decrypt_bytes(&key, &downloaded).unwrap();
  assert_eq!(
    decrypted, bundle,
    "Decrypted content should match original bundle"
  );

  let extract_dir = temp_dir.path().join("extracted");
  fs::create_dir_all(&extract_dir).unwrap();
  let metadata = extract_bundle(&decrypted, &extract_dir);

  assert_eq!(metadata["id"], "test-profile-id");
  assert_eq!(metadata["name"], "Test Profile");
  assert_eq!(metadata["browser"], "chromium");
  assert_eq!(metadata["version"], "120.0.0");
  assert!(metadata["sync_enabled"].as_bool().unwrap());
  let tags = metadata["tags"].as_array().unwrap();
  assert_eq!(tags.len(), 2);
  assert_eq!(tags[0], "test");
  assert_eq!(tags[1], "e2e");

  let test_file = extract_dir.join("profile").join("test_file.txt");
  assert!(test_file.exists());
  assert_eq!(fs::read_to_string(test_file).unwrap(), "test content");

  let wrong_key = derive_profile_key("wrong-password", &salt).unwrap();
  assert!(
    decrypt_bytes(&wrong_key, &downloaded).is_err(),
    "Decryption with wrong key should fail"
  );

  let different_salt = generate_salt();
  let wrong_salt_key = derive_profile_key(password, &different_salt).unwrap();
  assert!(
    decrypt_bytes(&wrong_salt_key, &downloaded).is_err(),
    "Decryption with key derived from wrong salt should fail"
  );

  client.delete(&test_key, None).await.unwrap();
  let final_stat = client.stat(&test_key).await.unwrap();
  assert!(!final_stat.exists);
}

#[tokio::test]
async fn test_encrypted_delta_sync() {
  use donutbrowser_lib::sync::encryption::{
    decrypt_bytes, derive_profile_key, encrypt_bytes, generate_salt,
  };

  ensure_sync_server_available().await;
  let client = TestClient::new();
  let profile_id = uuid::Uuid::new_v4().to_string();

  let salt = generate_salt();
  let password = "delta-sync-test-password";
  let key = derive_profile_key(password, &salt).unwrap();

  let file1_key = format!("profiles/{}/files/file1.txt.enc", profile_id);
  let file2_key = format!("profiles/{}/files/file2.txt.enc", profile_id);
  let file3_key = format!("profiles/{}/files/file3.txt.enc", profile_id);

  let content1 = b"file one content";
  let content2 = b"file two content";
  let content3 = b"file three content";

  let encrypted1 = encrypt_bytes(&key, content1).unwrap();
  let encrypted2 = encrypt_bytes(&key, content2).unwrap();
  let encrypted3 = encrypt_bytes(&key, content3).unwrap();

  let presign1 = client
    .presign_upload(&file1_key, "application/octet-stream")
    .await
    .unwrap();
  client
    .upload_bytes(&presign1.url, &encrypted1, "application/octet-stream")
    .await
    .unwrap();

  let presign2 = client
    .presign_upload(&file2_key, "application/octet-stream")
    .await
    .unwrap();
  client
    .upload_bytes(&presign2.url, &encrypted2, "application/octet-stream")
    .await
    .unwrap();

  let presign3 = client
    .presign_upload(&file3_key, "application/octet-stream")
    .await
    .unwrap();
  client
    .upload_bytes(&presign3.url, &encrypted3, "application/octet-stream")
    .await
    .unwrap();

  for (file_key, expected_content) in [
    (&file1_key, content1.as_slice()),
    (&file2_key, content2.as_slice()),
    (&file3_key, content3.as_slice()),
  ] {
    let dl_presign = client.presign_download(file_key).await.unwrap();
    let downloaded = client.download_bytes(&dl_presign.url).await.unwrap();
    let decrypted = decrypt_bytes(&key, &downloaded).unwrap();
    assert_eq!(
      decrypted, expected_content,
      "Decrypted content mismatch for {file_key}"
    );
  }

  let stat1_before = client.stat(&file1_key).await.unwrap();
  let stat2_before = client.stat(&file2_key).await.unwrap();
  let stat3_before = client.stat(&file3_key).await.unwrap();

  tokio::time::sleep(std::time::Duration::from_secs(1)).await;

  let updated_content2 = b"file two content -- updated with new data";
  let encrypted2_updated = encrypt_bytes(&key, updated_content2).unwrap();

  let presign2_update = client
    .presign_upload(&file2_key, "application/octet-stream")
    .await
    .unwrap();
  client
    .upload_bytes(
      &presign2_update.url,
      &encrypted2_updated,
      "application/octet-stream",
    )
    .await
    .unwrap();

  let stat2_after = client.stat(&file2_key).await.unwrap();
  assert_ne!(
    stat2_before.size, stat2_after.size,
    "File2 size should have changed after update"
  );

  let stat1_after = client.stat(&file1_key).await.unwrap();
  let stat3_after = client.stat(&file3_key).await.unwrap();
  assert_eq!(
    stat1_before.size, stat1_after.size,
    "File1 should be unchanged"
  );
  assert_eq!(
    stat3_before.size, stat3_after.size,
    "File3 should be unchanged"
  );

  let dl_presign2 = client.presign_download(&file2_key).await.unwrap();
  let downloaded2 = client.download_bytes(&dl_presign2.url).await.unwrap();
  let decrypted2 = decrypt_bytes(&key, &downloaded2).unwrap();
  assert_eq!(
    decrypted2,
    updated_content2.to_vec(),
    "Updated file2 should decrypt to new content"
  );

  client.delete(&file1_key, None).await.unwrap();
  client.delete(&file2_key, None).await.unwrap();
  client.delete(&file3_key, None).await.unwrap();
}
