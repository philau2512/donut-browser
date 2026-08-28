#[utoipa::path(
  put,
  path = "/v1/profiles/{id}",
  params(
    ("id" = String, Path, description = "Profile ID")
  ),
  request_body = UpdateProfileRequest,
  responses(
    (status = 200, description = "Profile updated successfully", body = ApiProfileResponse),
    (status = 400, description = "Bad request"),
    (status = 401, description = "Unauthorized"),
    (status = 404, description = "Profile not found"),
    (status = 500, description = "Internal server error")
  ),
  security(
    ("bearer_auth" = [])
  ),
  tag = "profiles"
)]
async fn update_profile(
  Path(id): Path<String>,
  State(state): State<ApiServerState>,
  Json(request): Json<UpdateProfileRequest>,
) -> Result<Json<ApiProfileResponse>, StatusCode> {
  let profile_manager = ProfileManager::instance();

  if request.proxy_id.as_deref().is_some_and(|s| !s.is_empty())
    && request.vpn_id.as_deref().is_some_and(|s| !s.is_empty())
  {
    return Err(StatusCode::BAD_REQUEST);
  }

  // Update profile fields
  if let Some(new_name) = request.name {
    if profile_manager
      .rename_profile(&state.app_handle, &id, &new_name)
      .is_err()
    {
      return Err(StatusCode::BAD_REQUEST);
    }
  }

  if let Some(version) = request.version {
    if profile_manager
      .update_profile_version(&state.app_handle, &id, &version)
      .is_err()
    {
      return Err(StatusCode::BAD_REQUEST);
    }
  }

  if let Some(proxy_id) = request.proxy_id {
    if profile_manager
      .update_profile_proxy(state.app_handle.clone(), &id, Some(proxy_id))
      .await
      .is_err()
    {
      return Err(StatusCode::BAD_REQUEST);
    }
  }

  if let Some(vpn_id) = request.vpn_id {
    let normalized = if vpn_id.is_empty() {
      None
    } else {
      Some(vpn_id)
    };
    if profile_manager
      .update_profile_vpn(state.app_handle.clone(), &id, normalized)
      .await
      .is_err()
    {
      return Err(StatusCode::BAD_REQUEST);
    }
  }

  if let Some(launch_hook) = request.launch_hook {
    let normalized = if launch_hook.trim().is_empty() {
      None
    } else {
      Some(launch_hook)
    };

    if profile_manager
      .update_profile_launch_hook(&state.app_handle, &id, normalized)
      .is_err()
    {
      return Err(StatusCode::BAD_REQUEST);
    }
  }

  if let Some(camoufox_config) = request.camoufox_config {
    // Same-host fingerprint edits are free. Cross-OS OS spoofing remains paid.
    let config: Result<CamoufoxConfig, _> = serde_json::from_value(camoufox_config);
    match config {
      Ok(config) => {
        if !crate::api::cloud_auth::CLOUD_AUTH
          .is_fingerprint_os_allowed(config.os.as_deref())
          .await
        {
          return Err(StatusCode::PAYMENT_REQUIRED);
        }
        if profile_manager
          .update_camoufox_config(state.app_handle.clone(), &id, config)
          .await
          .is_err()
        {
          return Err(StatusCode::BAD_REQUEST);
        }
      }
      Err(_) => return Err(StatusCode::BAD_REQUEST),
    }
  }

  if let Some(group_id) = request.group_id {
    if profile_manager
      .assign_profiles_to_group(&state.app_handle, vec![id.clone()], Some(group_id))
      .is_err()
    {
      return Err(StatusCode::BAD_REQUEST);
    }
  }

  if let Some(tags) = request.tags {
    if profile_manager
      .update_profile_tags(&state.app_handle, &id, tags)
      .is_err()
    {
      return Err(StatusCode::BAD_REQUEST);
    }

    // Update tag manager with new tags from all profiles
    if let Ok(profiles) = profile_manager.list_profiles() {
      let _ = crate::profile::tag_manager::TAG_MANAGER
        .lock()
        .map(|manager| manager.rebuild_from_profiles(&profiles));
    }
  }

  if let Some(extension_group_id) = request.extension_group_id {
    let ext_group = if extension_group_id.is_empty() {
      None
    } else {
      Some(extension_group_id)
    };
    if profile_manager
      .update_profile_extension_group(&id, ext_group)
      .is_err()
    {
      return Err(StatusCode::BAD_REQUEST);
    }
  }

  if let Some(proxy_bypass_rules) = request.proxy_bypass_rules {
    if profile_manager
      .update_profile_proxy_bypass_rules(&state.app_handle, &id, proxy_bypass_rules)
      .is_err()
    {
      return Err(StatusCode::BAD_REQUEST);
    }
  }

  if let Some(sync_mode) = request.sync_mode {
    if crate::sync::set_profile_sync_mode(state.app_handle.clone(), id.clone(), sync_mode)
      .await
      .is_err()
    {
      return Err(StatusCode::BAD_REQUEST);
    }
  }

  if let Some(clear_on_close) = request.clear_on_close {
    if profile_manager
      .update_profile_clear_on_close(&state.app_handle, &id, clear_on_close)
      .is_err()
    {
      return Err(StatusCode::BAD_REQUEST);
    }
  }

  // Return updated profile
  get_profile(Path(id), State(state)).await
}

#[utoipa::path(
  delete,
  path = "/v1/profiles/{id}",
  params(
    ("id" = String, Path, description = "Profile ID")
  ),
  responses(
    (status = 204, description = "Profile deleted successfully"),
    (status = 400, description = "Bad request"),
    (status = 401, description = "Unauthorized"),
    (status = 500, description = "Internal server error")
  ),
  security(
    ("bearer_auth" = [])
  ),
  tag = "profiles"
)]
async fn delete_profile(
  Path(id): Path<String>,
  State(state): State<ApiServerState>,
) -> Result<StatusCode, StatusCode> {
  let profile_manager = ProfileManager::instance();
  match profile_manager.delete_profile(&state.app_handle, &id) {
    Ok(_) => Ok(StatusCode::NO_CONTENT),
    Err(_) => Err(StatusCode::BAD_REQUEST),
  }
}

// Detect importable Chromium-family browser profiles on this machine, or scan
// a custom folder. Free: importing is not gated behind browser automation.
#[utoipa::path(
  get,
  path = "/v1/profiles/import/detect",
  params(
    ("folder" = Option<String>, Query, description = "Optional folder to scan instead of the default browser locations. Accepts a single profile dir, a Chromium user-data dir, or a folder holding one profile dir per child.")
  ),
  responses(
    (status = 200, description = "Detected importable profiles", body = DetectedProfilesResponse),
    (status = 401, description = "Unauthorized"),
    (status = 404, description = "Folder not found"),
    (status = 500, description = "Internal server error")
  ),
  security(
    ("bearer_auth" = [])
  ),
  tag = "profiles"
)]
async fn detect_import_profiles(
  Query(query): Query<DetectImportQuery>,
  State(_state): State<ApiServerState>,
) -> Result<Json<DetectedProfilesResponse>, (StatusCode, String)> {
  let importer = crate::profile::profile_importer::ProfileImporter::instance();
  let profiles = match query.folder.as_deref() {
    Some(folder) => importer.scan_folder(std::path::Path::new(folder)),
    None => importer.detect_existing_profiles(),
  }
  .map_err(manager_error_response)?;
  let total = profiles.len();
  Ok(Json(DetectedProfilesResponse { profiles, total }))
}

// Bulk-import browser profiles from on-disk profile folders.
// Free (parity with create_profile); only fingerprint OS spoofing is Pro.
// Items are isolated — one failure doesn't stop the rest.
#[utoipa::path(
  post,
  path = "/v1/profiles/import",
  request_body = ImportProfilesRequest,
  responses(
    (status = 200, description = "Batch import completed; inspect per-item results", body = crate::profile::profile_importer::ProfileImportBatchResult),
    (status = 400, description = "No items, or invalid input"),
    (status = 401, description = "Unauthorized"),
    (status = 402, description = "Fingerprint OS spoofing requires an active Pro subscription"),
    (status = 404, description = "Group not found"),
    (status = 500, description = "Internal server error")
  ),
  security(
    ("bearer_auth" = [])
  ),
  tag = "profiles"
)]
async fn import_profiles_api(
  State(state): State<ApiServerState>,
  Json(request): Json<ImportProfilesRequest>,
) -> Result<Json<crate::profile::profile_importer::ProfileImportBatchResult>, (StatusCode, String)>
{
  let wayfern_config: Option<crate::browser::wayfern_manager::WayfernConfig> = request
    .wayfern_config
    .as_ref()
    .and_then(|config| serde_json::from_value(config.clone()).ok());

  // Pro gate for fingerprint OS spoofing lives inside import_profiles.
  let importer = crate::profile::profile_importer::ProfileImporter::instance();
  importer
    .import_profiles(
      &state.app_handle,
      request.items,
      request.group_id,
      request.duplicate_strategy.unwrap_or_default(),
      wayfern_config,
    )
    .await
    .map(Json)
    .map_err(manager_error_response)
}

// API Handlers - Groups
#[utoipa::path(
  get,
  path = "/v1/groups",
  responses(
    (status = 200, description = "List of all groups", body = Vec<ApiGroupResponse>),
    (status = 401, description = "Unauthorized"),
    (status = 500, description = "Internal server error")
  ),
  security(
    ("bearer_auth" = [])
  ),
  tag = "groups"
)]
async fn get_groups(
  State(_state): State<ApiServerState>,
) -> Result<Json<Vec<ApiGroupResponse>>, StatusCode> {
  match GROUP_MANAGER.lock() {
    Ok(manager) => {
      match manager.get_all_groups() {
        Ok(groups) => {
          let api_groups = groups
            .into_iter()
            .map(|group| ApiGroupResponse {
              id: group.id,
              name: group.name,
              profile_count: 0, // Would need profile list to calculate this
            })
            .collect();
          Ok(Json(api_groups))
        }
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
      }
    }
    Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
  }
}

#[utoipa::path(
  get,
  path = "/v1/groups/{id}",
  params(
    ("id" = String, Path, description = "Group ID")
  ),
  responses(
    (status = 200, description = "Group details", body = ApiGroupResponse),
    (status = 401, description = "Unauthorized"),
    (status = 404, description = "Group not found"),
    (status = 500, description = "Internal server error")
  ),
  security(
    ("bearer_auth" = [])
  ),
  tag = "groups"
)]
async fn get_group(
  Path(id): Path<String>,
  State(_state): State<ApiServerState>,
) -> Result<Json<ApiGroupResponse>, StatusCode> {
  match GROUP_MANAGER.lock() {
    Ok(manager) => match manager.get_all_groups() {
      Ok(groups) => {
        if let Some(group) = groups.into_iter().find(|g| g.id == id) {
          Ok(Json(ApiGroupResponse {
            id: group.id,
            name: group.name,
            profile_count: 0,
          }))
        } else {
          Err(StatusCode::NOT_FOUND)
        }
      }
      Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    },
    Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
  }
}

#[utoipa::path(
  post,
  path = "/v1/groups",
  request_body = CreateGroupRequest,
  responses(
    (status = 200, description = "Group created successfully", body = ApiGroupResponse),
    (status = 400, description = "Bad request"),
    (status = 401, description = "Unauthorized"),
    (status = 500, description = "Internal server error")
  ),
  security(
    ("bearer_auth" = [])
  ),
  tag = "groups"
)]
async fn create_group(
  State(state): State<ApiServerState>,
  Json(request): Json<CreateGroupRequest>,
) -> Result<Json<ApiGroupResponse>, StatusCode> {
  match GROUP_MANAGER.lock() {
    Ok(manager) => match manager.create_group(&state.app_handle, request.name) {
      Ok(group) => Ok(Json(ApiGroupResponse {
        id: group.id,
        name: group.name,
        profile_count: 0,
      })),
      Err(_) => Err(StatusCode::BAD_REQUEST),
    },
    Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
  }
}

#[utoipa::path(
  put,
  path = "/v1/groups/{id}",
  params(
    ("id" = String, Path, description = "Group ID")
  ),
  request_body = UpdateGroupRequest,
  responses(
    (status = 200, description = "Group updated successfully", body = ApiGroupResponse),
    (status = 400, description = "Bad request"),
    (status = 401, description = "Unauthorized"),
    (status = 404, description = "Group not found"),
    (status = 500, description = "Internal server error")
  ),
  security(
    ("bearer_auth" = [])
  ),
  tag = "groups"
)]
async fn update_group(
  Path(id): Path<String>,
  State(state): State<ApiServerState>,
  Json(request): Json<UpdateGroupRequest>,
) -> Result<Json<ApiGroupResponse>, StatusCode> {
  match GROUP_MANAGER.lock() {
    Ok(manager) => match manager.update_group(&state.app_handle, id.clone(), request.name) {
      Ok(group) => Ok(Json(ApiGroupResponse {
        id: group.id,
        name: group.name,
        profile_count: 0,
      })),
      Err(_) => Err(StatusCode::BAD_REQUEST),
    },
    Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
  }
}

#[utoipa::path(
  delete,
  path = "/v1/groups/{id}",
  params(
    ("id" = String, Path, description = "Group ID")
  ),
  responses(
    (status = 204, description = "Group deleted successfully"),
    (status = 400, description = "Bad request"),
    (status = 401, description = "Unauthorized"),
    (status = 500, description = "Internal server error")
  ),
  security(
    ("bearer_auth" = [])
  ),
  tag = "groups"
)]
async fn delete_group(
  Path(id): Path<String>,
  State(state): State<ApiServerState>,
) -> Result<StatusCode, StatusCode> {
  match GROUP_MANAGER.lock() {
    Ok(manager) => match manager.delete_group(&state.app_handle, id.clone()) {
      Ok(_) => Ok(StatusCode::NO_CONTENT),
      Err(_) => Err(StatusCode::BAD_REQUEST),
    },
    Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
  }
}

// API Handlers - Tags
#[utoipa::path(
  get,
  path = "/v1/tags",
  responses(
    (status = 200, description = "List of all tags", body = Vec<String>),
    (status = 401, description = "Unauthorized"),
    (status = 500, description = "Internal server error")
  ),
  security(
    ("bearer_auth" = [])
  ),
  tag = "tags"
)]
async fn get_tags(State(_state): State<ApiServerState>) -> Result<Json<Vec<String>>, StatusCode> {
  match TAG_MANAGER.lock() {
    Ok(manager) => match manager.get_all_tags() {
      Ok(tags) => Ok(Json(tags)),
      Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    },
    Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
  }
}

// API Handlers - Proxies
