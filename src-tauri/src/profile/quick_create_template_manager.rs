//! Quick Create templates + bulk lazy profile creation.
//!
//! Templates store reusable browser defaults. Bulk create writes only
//! `metadata.json` (no profile data dir) and emits progress events.

use crate::browser::camoufox_manager::CamoufoxConfig;
use crate::browser::wayfern_manager::WayfernConfig;
use crate::events;
use crate::profile::manager::ProfileManager;
use crate::profile::types::BrowserProfile;
use rand::seq::IndexedRandom;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;

// ---------------------------------------------------------------------------
// Random profile names — Firstname Lastname
// ---------------------------------------------------------------------------

const FIRST_NAMES: &[&str] = &[
  "James",
  "Mary",
  "John",
  "Patricia",
  "Robert",
  "Jennifer",
  "Michael",
  "Linda",
  "William",
  "Elizabeth",
  "David",
  "Barbara",
  "Richard",
  "Susan",
  "Joseph",
  "Jessica",
  "Thomas",
  "Sarah",
  "Charles",
  "Karen",
  "Christopher",
  "Nancy",
  "Daniel",
  "Lisa",
  "Matthew",
  "Betty",
  "Anthony",
  "Margaret",
  "Mark",
  "Sandra",
  "Donald",
  "Ashley",
  "Steven",
  "Kimberly",
  "Paul",
  "Emily",
  "Andrew",
  "Donna",
  "Joshua",
  "Michelle",
  "Kenneth",
  "Dorothy",
  "Kevin",
  "Carol",
  "Brian",
  "Amanda",
  "George",
  "Melissa",
  "Timothy",
  "Deborah",
  "Ronald",
  "Stephanie",
  "Edward",
  "Rebecca",
  "Jason",
  "Sharon",
  "Jeffrey",
  "Laura",
  "Ryan",
  "Cynthia",
  "Jacob",
  "Kathleen",
  "Gary",
  "Amy",
  "Nicholas",
  "Angela",
  "Eric",
  "Shirley",
  "Jonathan",
  "Anna",
  "Stephen",
  "Brenda",
  "Larry",
  "Pamela",
  "Justin",
  "Emma",
  "Scott",
  "Nicole",
  "Brandon",
  "Helen",
  "Benjamin",
  "Samantha",
  "Samuel",
  "Katherine",
  "Raymond",
  "Christine",
  "Gregory",
  "Debra",
  "Frank",
  "Rachel",
  "Alexander",
  "Carolyn",
  "Patrick",
  "Janet",
  "Jack",
  "Catherine",
  "Dennis",
  "Maria",
  "Jerry",
  "Heather",
  "Tyler",
  "Diane",
  "Aaron",
  "Ruth",
  "Jose",
  "Julie",
  "Adam",
  "Olivia",
  "Nathan",
  "Joyce",
  "Henry",
  "Virginia",
  "Douglas",
  "Victoria",
  "Zachary",
  "Kelly",
  "Peter",
  "Lauren",
  "Kyle",
  "Christina",
  "Noah",
  "Joan",
  "Ethan",
  "Evelyn",
  "Jeremy",
  "Judith",
  "Walter",
  "Megan",
  "Christian",
  "Andrea",
  "Keith",
  "Cheryl",
  "Roger",
  "Hannah",
  "Terry",
  "Jacqueline",
  "Austin",
  "Martha",
  "Sean",
  "Gloria",
  "Gerald",
  "Teresa",
  "Carl",
  "Ann",
  "Dylan",
  "Sara",
  "Harold",
  "Madison",
  "Jordan",
  "Frances",
  "Jesse",
  "Kathryn",
  "Bryan",
  "Janice",
  "Billy",
  "Jean",
  "Bruce",
  "Abigail",
  "Gabriel",
  "Alice",
  "Joe",
  "Judy",
  "Logan",
  "Sophia",
  "Alan",
  "Grace",
  "Juan",
  "Denise",
  "Albert",
  "Amber",
  "Willie",
  "Doris",
  "Elijah",
  "Marilyn",
  "Wayne",
  "Danielle",
  "Randy",
  "Beverly",
  "Vincent",
  "Isabella",
  "Philip",
  "Theresa",
  "Liam",
  "Diana",
  "Bobby",
  "Natalie",
  "Johnny",
  "Brittany",
  "Bradley",
  "Charlotte",
  "Russell",
];

const LAST_NAMES: &[&str] = &[
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Hernandez",
  "Lopez",
  "Gonzalez",
  "Wilson",
  "Anderson",
  "Thomas",
  "Taylor",
  "Moore",
  "Jackson",
  "Martin",
  "Lee",
  "Perez",
  "Thompson",
  "White",
  "Harris",
  "Sanchez",
  "Clark",
  "Ramirez",
  "Lewis",
  "Robinson",
  "Walker",
  "Young",
  "Allen",
  "King",
  "Wright",
  "Scott",
  "Torres",
  "Nguyen",
  "Hill",
  "Flores",
  "Green",
  "Adams",
  "Nelson",
  "Baker",
  "Hall",
  "Rivera",
  "Campbell",
  "Mitchell",
  "Carter",
  "Roberts",
  "Gomez",
  "Phillips",
  "Evans",
  "Turner",
  "Diaz",
  "Parker",
  "Cruz",
  "Edwards",
  "Collins",
  "Reyes",
  "Stewart",
  "Morris",
  "Morales",
  "Murphy",
  "Cook",
  "Rogers",
  "Gutierrez",
  "Ortiz",
  "Morgan",
  "Cooper",
  "Peterson",
  "Bailey",
  "Reed",
  "Kelly",
  "Howard",
  "Ramos",
  "Kim",
  "Cox",
  "Ward",
  "Richardson",
  "Watson",
  "Brooks",
  "Chavez",
  "Wood",
  "James",
  "Bennett",
  "Gray",
  "Mendoza",
  "Ruiz",
  "Hughes",
  "Price",
  "Alvarez",
  "Castillo",
  "Sanders",
  "Patel",
  "Myers",
  "Long",
  "Ross",
  "Foster",
  "Jimenez",
  "Powell",
  "Jenkins",
  "Perry",
  "Russell",
  "Sullivan",
  "Bell",
  "Coleman",
  "Butler",
  "Henderson",
  "Barnes",
  "Gonzales",
  "Fisher",
  "Vasquez",
  "Simmons",
  "Romero",
  "Jordan",
  "Patterson",
  "Alexander",
  "Hamilton",
  "Graham",
  "Reynolds",
  "Griffin",
  "Wallace",
  "Moreno",
  "West",
  "Cole",
  "Hayes",
  "Bryant",
  "Herrera",
  "Gibson",
  "Ellis",
  "Tran",
  "Medina",
  "Aguilar",
  "Stevens",
  "Murray",
  "Ford",
  "Castro",
  "Marshall",
  "Owens",
  "Harrison",
  "Fernandez",
  "McDonald",
  "Woods",
  "Washington",
  "Kennedy",
  "Wells",
  "Vargas",
  "Henry",
  "Chen",
  "Freeman",
  "Webb",
  "Tucker",
  "Guzman",
  "Burns",
  "Crawford",
  "Olson",
  "Simpson",
  "Porter",
  "Hunter",
  "Gordon",
  "Mendez",
  "Silva",
  "Shaw",
  "Snyder",
  "Mason",
  "Dixon",
  "Munoz",
  "Hunt",
  "Hicks",
  "Holmes",
  "Palmer",
  "Wagner",
  "Black",
  "Robertson",
  "Boyd",
  "Rose",
  "Stone",
  "Salazar",
  "Fox",
  "Warren",
  "Mills",
  "Meyer",
  "Rice",
  "Schmidt",
  "Garza",
  "Daniels",
  "Ferguson",
  "Nichols",
  "Stephens",
  "Soto",
  "Weaver",
  "Ryan",
  "Gardner",
  "Payne",
  "Grant",
  "Dunn",
  "Kelley",
  "Spencer",
  "Hawkins",
  "Arnold",
  "Pierce",
  "Vazquez",
  "Hansen",
  "Peters",
  "Santos",
  "Hart",
  "Bradley",
  "Knight",
  "Elliott",
  "Cunningham",
  "Duncan",
  "Armstrong",
  "Hudson",
];

/// Generate `"Firstname Lastname"`, unique against `taken` (case-insensitive).
pub fn generate_unique_profile_name(taken: &mut HashSet<String>) -> String {
  let mut rng = rand::rng();
  for _ in 0..200 {
    let first = FIRST_NAMES.choose(&mut rng).copied().unwrap_or("Alex");
    let last = LAST_NAMES.choose(&mut rng).copied().unwrap_or("Smith");
    let name = format!("{first} {last}");
    if taken.insert(name.to_lowercase()) {
      return name;
    }
  }
  // Extremely unlikely fallback
  let fallback = format!("Profile {}", uuid::Uuid::new_v4());
  taken.insert(fallback.to_lowercase());
  fallback
}

// ---------------------------------------------------------------------------
// Template types + persistence
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QuickCreateTemplate {
  pub id: String,
  pub name: String,
  pub browser: String,
  pub version: String,
  #[serde(default = "default_release_type")]
  pub release_type: String,
  #[serde(default)]
  pub proxy_id: Option<String>,
  #[serde(default)]
  pub vpn_id: Option<String>,
  #[serde(default)]
  pub camoufox_config: Option<CamoufoxConfig>,
  #[serde(default)]
  pub wayfern_config: Option<WayfernConfig>,
  #[serde(default)]
  pub extension_group_id: Option<String>,
  #[serde(default)]
  pub dns_blocklist: Option<String>,
  #[serde(default)]
  pub launch_hook: Option<String>,
  #[serde(default)]
  pub tags: Vec<String>,
  #[serde(default)]
  pub profile_status: Option<String>,
  #[serde(default)]
  pub created_at: u64,
  #[serde(default)]
  pub updated_at: u64,
}

fn default_release_type() -> String {
  "stable".to_string()
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct TemplatesData {
  templates: Vec<QuickCreateTemplate>,
}

#[derive(Debug, Serialize, Clone)]
struct QuickCreateProgress {
  total: usize,
  completed: usize,
  index: usize,
  name: String,
  /// "creating" | "created" | "failed" | "done"
  status: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  error: Option<String>,
}

fn now_secs() -> u64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0)
}

fn emit_progress(
  total: usize,
  completed: usize,
  index: usize,
  name: &str,
  status: &str,
  error: Option<String>,
) {
  let _ = events::emit(
    "quick-create-progress",
    &QuickCreateProgress {
      total,
      completed,
      index,
      name: name.to_string(),
      status: status.to_string(),
      error,
    },
  );
}

pub struct QuickCreateTemplateManager;

impl Default for QuickCreateTemplateManager {
  fn default() -> Self {
    Self::new()
  }
}

impl QuickCreateTemplateManager {
  pub fn new() -> Self {
    Self
  }

  fn file_path(&self) -> std::path::PathBuf {
    crate::settings::app_dirs::data_subdir().join("quick_create_templates.json")
  }

  fn load(&self) -> Result<TemplatesData, Box<dyn std::error::Error>> {
    let path = self.file_path();
    if !path.exists() {
      return Ok(TemplatesData::default());
    }
    let content = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content)?)
  }

  fn save(&self, data: &TemplatesData) -> Result<(), Box<dyn std::error::Error>> {
    let path = self.file_path();
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(data)?;
    fs::write(path, json)?;
    Ok(())
  }

  pub fn list(&self) -> Result<Vec<QuickCreateTemplate>, Box<dyn std::error::Error>> {
    Ok(self.load()?.templates)
  }

  pub fn get(&self, id: &str) -> Result<QuickCreateTemplate, Box<dyn std::error::Error>> {
    self
      .load()?
      .templates
      .into_iter()
      .find(|t| t.id == id)
      .ok_or_else(|| format!("Template '{id}' not found").into())
  }

  pub fn upsert(
    &self,
    mut template: QuickCreateTemplate,
  ) -> Result<QuickCreateTemplate, Box<dyn std::error::Error>> {
    let name = template.name.trim().to_string();
    if name.is_empty() {
      return Err("Template name is required".into());
    }
    if template.browser.trim().is_empty() {
      return Err("Browser is required".into());
    }
    if template.version.trim().is_empty() {
      return Err("Version is required".into());
    }

    template.name = name;
    let ts = now_secs();
    let mut data = self.load()?;

    if template.id.is_empty() {
      template.id = uuid::Uuid::new_v4().to_string();
      template.created_at = ts;
      template.updated_at = ts;
      // Strip stored fingerprints — bulk create always regenerates
      sanitize_template_configs(&mut template);
      data.templates.push(template.clone());
    } else {
      let idx = data
        .templates
        .iter()
        .position(|t| t.id == template.id)
        .ok_or_else(|| format!("Template '{}' not found", template.id))?;
      template.created_at = data.templates[idx].created_at;
      template.updated_at = ts;
      sanitize_template_configs(&mut template);
      data.templates[idx] = template.clone();
    }

    self.save(&data)?;
    Ok(template)
  }

  pub fn delete(&self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
    let mut data = self.load()?;
    let before = data.templates.len();
    data.templates.retain(|t| t.id != id);
    if data.templates.len() == before {
      return Err(format!("Template '{id}' not found").into());
    }
    self.save(&data)?;
    Ok(())
  }
}

/// Clear fingerprints so each bulk-created profile gets a unique one.
fn sanitize_template_configs(template: &mut QuickCreateTemplate) {
  if let Some(ref mut cfg) = template.wayfern_config {
    cfg.fingerprint = None;
    cfg.proxy = None;
    cfg.geo_proxy_signature = None;
  }
  if let Some(ref mut cfg) = template.camoufox_config {
    cfg.fingerprint = None;
    cfg.proxy = None;
  }
}

/// Prepare config clone for one profile: clear fingerprint so create regenerates.
fn config_for_create(
  template: &QuickCreateTemplate,
) -> (Option<CamoufoxConfig>, Option<WayfernConfig>) {
  let mut camoufox = template.camoufox_config.clone();
  let mut wayfern = template.wayfern_config.clone();
  if let Some(ref mut cfg) = wayfern {
    cfg.fingerprint = None;
    cfg.proxy = None;
    cfg.geo_proxy_signature = None;
  }
  if let Some(ref mut cfg) = camoufox {
    cfg.fingerprint = None;
    cfg.proxy = None;
  }
  // Ensure defaults exist for anti-detect browsers so fingerprint gen runs
  if template.browser == "wayfern" && wayfern.is_none() {
    wayfern = Some(WayfernConfig::default());
  }
  if template.browser == "camoufox" && camoufox.is_none() {
    camoufox = Some(CamoufoxConfig::default());
  }
  (camoufox, wayfern)
}

lazy_static::lazy_static! {
  pub static ref QUICK_CREATE_TEMPLATE_MANAGER: std::sync::Mutex<QuickCreateTemplateManager> =
    std::sync::Mutex::new(QuickCreateTemplateManager::new());
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_quick_create_templates() -> Result<Vec<QuickCreateTemplate>, String> {
  QUICK_CREATE_TEMPLATE_MANAGER
    .lock()
    .map_err(|e| e.to_string())?
    .list()
    .map_err(|e| format!("Failed to list templates: {e}"))
}

#[tauri::command]
pub fn save_quick_create_template(
  template: QuickCreateTemplate,
) -> Result<QuickCreateTemplate, String> {
  QUICK_CREATE_TEMPLATE_MANAGER
    .lock()
    .map_err(|e| e.to_string())?
    .upsert(template)
    .map_err(|e| format!("Failed to save template: {e}"))
}

#[tauri::command]
pub fn delete_quick_create_template(id: String) -> Result<(), String> {
  QUICK_CREATE_TEMPLATE_MANAGER
    .lock()
    .map_err(|e| e.to_string())?
    .delete(&id)
    .map_err(|e| format!("Failed to delete template: {e}"))
}

/// Bulk-create profiles from a template (lazy disk).
///
/// - Random unique names (`Firstname Lastname`)
/// - Unique fingerprint per profile
/// - Only `metadata.json` on disk until first open
/// - Emits `quick-create-progress` events
#[tauri::command]
pub async fn quick_create_profiles(
  app_handle: tauri::AppHandle,
  template_id: String,
  count: u32,
  group_id: Option<String>,
) -> Result<Vec<BrowserProfile>, String> {
  let count = count.clamp(1, 100) as usize;

  let template = {
    let mgr = QUICK_CREATE_TEMPLATE_MANAGER
      .lock()
      .map_err(|e| e.to_string())?;
    mgr
      .get(&template_id)
      .map_err(|e| format!("Failed to load template: {e}"))?
  };

  // Validate fingerprint OS entitlement once
  let fingerprint_os = template
    .camoufox_config
    .as_ref()
    .and_then(|c| c.os.as_deref())
    .or_else(|| {
      template
        .wayfern_config
        .as_ref()
        .and_then(|c| c.os.as_deref())
    });

  if !crate::api::cloud_auth::CLOUD_AUTH
    .is_fingerprint_os_allowed(fingerprint_os)
    .await
  {
    return Err("Fingerprint OS spoofing requires an active Pro subscription".to_string());
  }

  crate::validate_profile_network(template.proxy_id.as_deref(), template.vpn_id.as_deref()).await?;

  let profile_manager = ProfileManager::instance();
  let mut taken: HashSet<String> = profile_manager
    .list_profiles()
    .map_err(|e| format!("Failed to list profiles: {e}"))?
    .into_iter()
    .map(|p| p.name.to_lowercase())
    .collect();

  let mut created = Vec::with_capacity(count);

  for i in 0..count {
    let name = generate_unique_profile_name(&mut taken);
    emit_progress(count, created.len(), i, &name, "creating", None);

    let (camoufox_config, wayfern_config) = config_for_create(&template);

    match profile_manager
      .create_profile_with_group(
        &app_handle,
        &name,
        &template.browser,
        &template.version,
        &template.release_type,
        template.proxy_id.clone(),
        template.vpn_id.clone(),
        camoufox_config,
        wayfern_config,
        group_id.clone(),
        false, // not ephemeral
        template.dns_blocklist.clone(),
        template.launch_hook.clone(),
        true, // skip_data_dir — lazy materialize on first open
      )
      .await
    {
      Ok(mut profile) => {
        // Tags
        if !template.tags.is_empty() {
          if let Ok(updated) = profile_manager.update_profile_tags(
            &app_handle,
            &profile.id.to_string(),
            template.tags.clone(),
          ) {
            profile = updated;
          }
        }

        // Status
        if template.profile_status.is_some() {
          if let Ok(updated) = profile_manager.update_profile_status(
            &app_handle,
            &profile.id.to_string(),
            template.profile_status.clone(),
          ) {
            profile = updated;
          }
        }

        // Extension group
        if let Some(ref ext_group_id) = template.extension_group_id {
          match profile_manager
            .update_profile_extension_group(&profile.id.to_string(), Some(ext_group_id.clone()))
          {
            Ok(updated) => profile = updated,
            Err(e) => {
              log::warn!(
                "Failed to assign extension group to quick-created profile {}: {e}",
                profile.name
              );
            }
          }
        }

        created.push(profile);
        emit_progress(count, created.len(), i, &name, "created", None);
      }
      Err(e) => {
        let err = e.to_string();
        log::error!("Quick create failed for '{name}': {err}");
        emit_progress(count, created.len(), i, &name, "failed", Some(err.clone()));
        // Fail the whole batch so UI can show a clear error; partials already
        // exist and will appear after profiles-changed.
        emit_progress(
          count,
          created.len(),
          i,
          &name,
          "done",
          Some(format!(
            "Created {} of {count}; failed on '{name}': {err}",
            created.len()
          )),
        );
        return Err(format!(
          "Created {} of {count}; failed on '{name}': {err}",
          created.len()
        ));
      }
    }
  }

  emit_progress(
    count,
    created.len(),
    count.saturating_sub(1),
    "",
    "done",
    None,
  );
  Ok(created)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::profile::manager::ProfileManager;
  use crate::profile::types::BrowserProfile;
  use tempfile::TempDir;

  fn sample_template(name: &str) -> QuickCreateTemplate {
    QuickCreateTemplate {
      id: String::new(),
      name: name.to_string(),
      browser: "wayfern".to_string(),
      version: "1.0.0".to_string(),
      release_type: "stable".to_string(),
      proxy_id: None,
      vpn_id: None,
      camoufox_config: None,
      wayfern_config: Some(WayfernConfig {
        fingerprint: Some("secret-fp".into()),
        proxy: Some("http://user:pass@1.2.3.4:8080".into()),
        geo_proxy_signature: Some("sig".into()),
        os: Some("windows".into()),
        ..Default::default()
      }),
      extension_group_id: None,
      dns_blocklist: None,
      launch_hook: None,
      tags: vec!["bulk".into()],
      profile_status: Some("New".into()),
      created_at: 0,
      updated_at: 0,
    }
  }

  #[test]
  fn random_names_are_unique_and_spaced() {
    let mut taken = HashSet::new();
    let mut names = HashSet::new();
    for _ in 0..50 {
      let name = generate_unique_profile_name(&mut taken);
      assert!(name.contains(' '), "expected space in '{name}'");
      let parts: Vec<_> = name.split_whitespace().collect();
      assert_eq!(parts.len(), 2, "expected Firstname Lastname, got '{name}'");
      assert!(names.insert(name.clone()), "duplicate '{name}'");
    }
  }

  #[test]
  fn random_names_respect_preexisting_taken() {
    let mut taken = HashSet::new();
    // Fill with many generated names then ensure still unique
    for _ in 0..100 {
      let _ = generate_unique_profile_name(&mut taken);
    }
    assert_eq!(taken.len(), 100);
    let next = generate_unique_profile_name(&mut taken);
    assert!(!next.is_empty());
    assert_eq!(taken.len(), 101);
  }

  #[test]
  #[serial_test::serial]
  fn template_crud_roundtrip() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    let mgr = QuickCreateTemplateManager::new();

    assert!(mgr.list().unwrap().is_empty());

    let saved = mgr.upsert(sample_template("  Alpha Config  ")).unwrap();
    assert!(!saved.id.is_empty());
    assert_eq!(saved.name, "Alpha Config"); // trimmed
                                            // Fingerprints / secrets stripped on save
    let wc = saved.wayfern_config.as_ref().unwrap();
    assert!(wc.fingerprint.is_none());
    assert!(wc.proxy.is_none());
    assert!(wc.geo_proxy_signature.is_none());
    assert_eq!(wc.os.as_deref(), Some("windows"));

    let listed = mgr.list().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, saved.id);

    let got = mgr.get(&saved.id).unwrap();
    assert_eq!(got.name, "Alpha Config");

    let mut updated = got.clone();
    updated.name = "Beta Config".into();
    updated.version = "2.0.0".into();
    let after = mgr.upsert(updated).unwrap();
    assert_eq!(after.id, saved.id);
    assert_eq!(after.name, "Beta Config");
    assert_eq!(after.version, "2.0.0");
    assert_eq!(after.created_at, saved.created_at);
    assert!(after.updated_at >= saved.updated_at);

    mgr.delete(&saved.id).unwrap();
    assert!(mgr.list().unwrap().is_empty());
    assert!(mgr.get(&saved.id).is_err());
    assert!(mgr.delete(&saved.id).is_err());
  }

  #[test]
  #[serial_test::serial]
  fn template_validation_rejects_empty_fields() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    let mgr = QuickCreateTemplateManager::new();

    let mut t = sample_template("");
    assert!(mgr.upsert(t.clone()).is_err());

    t.name = "ok".into();
    t.browser = "  ".into();
    assert!(mgr.upsert(t.clone()).is_err());

    t.browser = "wayfern".into();
    t.version = "".into();
    assert!(mgr.upsert(t).is_err());
  }

  #[test]
  fn config_for_create_strips_fingerprint_and_defaults() {
    let mut tpl = sample_template("cfg");
    // With existing wayfern config
    let (cam, way) = config_for_create(&tpl);
    assert!(cam.is_none());
    let w = way.unwrap();
    assert!(w.fingerprint.is_none());
    assert!(w.proxy.is_none());
    assert_eq!(w.os.as_deref(), Some("windows"));

    // Missing wayfern config → default injected
    tpl.wayfern_config = None;
    let (_, way2) = config_for_create(&tpl);
    assert!(way2.is_some());

    // Camoufox path
    tpl.browser = "camoufox".into();
    tpl.camoufox_config = None;
    let (cam2, _) = config_for_create(&tpl);
    assert!(cam2.is_some());
  }

  #[test]
  fn sanitize_clears_secrets_on_both_engines() {
    let mut tpl = sample_template("s");
    tpl.camoufox_config = Some(CamoufoxConfig {
      fingerprint: Some("cfp".into()),
      proxy: Some("socks5://x".into()),
      os: Some("linux".into()),
      ..Default::default()
    });
    sanitize_template_configs(&mut tpl);
    assert!(tpl.wayfern_config.as_ref().unwrap().fingerprint.is_none());
    assert!(tpl.camoufox_config.as_ref().unwrap().fingerprint.is_none());
    assert!(tpl.camoufox_config.as_ref().unwrap().proxy.is_none());
  }

  #[test]
  fn create_profile_directories_lazy_skips_data_dir() {
    let temp = TempDir::new().unwrap();
    let uuid_dir = temp.path().join("uuid-1");
    let data_dir = uuid_dir.join("profile");

    ProfileManager::create_profile_directories(&uuid_dir, &data_dir, false, true).unwrap();
    assert!(uuid_dir.is_dir());
    assert!(
      !data_dir.exists(),
      "lazy create must not make profile/ data dir"
    );

    // First open materializes
    std::fs::create_dir_all(&data_dir).unwrap();
    assert!(data_dir.is_dir());
  }

  #[test]
  fn create_profile_directories_eager_creates_data_dir() {
    let temp = TempDir::new().unwrap();
    let uuid_dir = temp.path().join("uuid-2");
    let data_dir = uuid_dir.join("profile");

    ProfileManager::create_profile_directories(&uuid_dir, &data_dir, false, false).unwrap();
    assert!(uuid_dir.is_dir());
    assert!(data_dir.is_dir());
  }

  #[test]
  fn create_profile_directories_ephemeral_skips_data_dir() {
    let temp = TempDir::new().unwrap();
    let uuid_dir = temp.path().join("uuid-3");
    let data_dir = uuid_dir.join("profile");

    ProfileManager::create_profile_directories(&uuid_dir, &data_dir, true, false).unwrap();
    assert!(uuid_dir.is_dir());
    assert!(!data_dir.exists());
  }

  #[test]
  #[serial_test::serial]
  fn lazy_profile_metadata_lists_without_data_dir() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());

    let id = uuid::Uuid::new_v4();
    let profiles_dir = ProfileManager::instance().get_profiles_dir();
    let uuid_dir = profiles_dir.join(id.to_string());
    let data_dir = uuid_dir.join("profile");

    ProfileManager::create_profile_directories(&uuid_dir, &data_dir, false, true).unwrap();

    let profile = BrowserProfile {
      id,
      name: "Lazy User".into(),
      browser: "wayfern".into(),
      version: "1.0.0".into(),
      wayfern_config: Some(WayfernConfig {
        os: Some("windows".into()),
        ..Default::default()
      }),
      host_os: Some("windows".into()),
      created_at: Some(1),
      updated_at: Some(1),
      ..Default::default()
    };

    ProfileManager::instance().save_profile(&profile).unwrap();
    assert!(!data_dir.exists());

    let listed = ProfileManager::instance().list_profiles().unwrap();
    let found = listed.iter().find(|p| p.id == id).expect("listed");
    assert_eq!(found.name, "Lazy User");
    assert!(!found.get_profile_data_path(&profiles_dir).exists());

    // Materialize (launch path)
    std::fs::create_dir_all(found.get_profile_data_path(&profiles_dir)).unwrap();
    assert!(found.get_profile_data_path(&profiles_dir).is_dir());
  }

  #[test]
  fn count_clamp_bounds() {
    // Mirrors quick_create_profiles clamp
    assert_eq!(0u32.clamp(1, 100), 1);
    assert_eq!(1u32.clamp(1, 100), 1);
    assert_eq!(50u32.clamp(1, 100), 50);
    assert_eq!(100u32.clamp(1, 100), 100);
    assert_eq!(999u32.clamp(1, 100), 100);
  }

  #[test]
  fn template_serde_roundtrip() {
    let tpl = sample_template("Serde");
    let json = serde_json::to_string(&tpl).unwrap();
    let back: QuickCreateTemplate = serde_json::from_str(&json).unwrap();
    assert_eq!(back.name, "Serde");
    assert_eq!(back.browser, "wayfern");
    assert_eq!(back.tags, vec!["bulk".to_string()]);
  }

  // --- Smoke: multi-template, commands, progress payload, missing template ---

  #[test]
  #[serial_test::serial]
  fn smoke_multi_template_persistence() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    let mgr = QuickCreateTemplateManager::new();

    let a = mgr.upsert(sample_template("Config A")).unwrap();
    let b = mgr.upsert(sample_template("Config B")).unwrap();
    let list = mgr.list().unwrap();
    assert_eq!(list.len(), 2);
    assert!(list.iter().any(|t| t.id == a.id && t.name == "Config A"));
    assert!(list.iter().any(|t| t.id == b.id && t.name == "Config B"));

    // tags / status survive reload
    let reloaded = mgr.get(&a.id).unwrap();
    assert_eq!(reloaded.tags, vec!["bulk".to_string()]);
    assert_eq!(reloaded.profile_status.as_deref(), Some("New"));
  }

  #[test]
  #[serial_test::serial]
  fn smoke_tauri_commands_list_save_delete() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());

    assert!(list_quick_create_templates().unwrap().is_empty());

    let saved = save_quick_create_template(sample_template("Cmd Config")).unwrap();
    assert!(!saved.id.is_empty());
    assert_eq!(list_quick_create_templates().unwrap().len(), 1);

    let mut updated = saved.clone();
    updated.name = "Cmd Config Renamed".into();
    let after = save_quick_create_template(updated).unwrap();
    assert_eq!(after.id, saved.id);
    assert_eq!(after.name, "Cmd Config Renamed");

    delete_quick_create_template(saved.id.clone()).unwrap();
    assert!(list_quick_create_templates().unwrap().is_empty());
    assert!(delete_quick_create_template(saved.id).is_err());
  }

  #[test]
  #[serial_test::serial]
  fn smoke_get_missing_template_errors() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    let mgr = QuickCreateTemplateManager::new();
    assert!(mgr.get("does-not-exist").is_err());
  }

  #[test]
  fn smoke_progress_payload_serializes() {
    let p = QuickCreateProgress {
      total: 5,
      completed: 2,
      index: 1,
      name: "Jane Doe".into(),
      status: "creating".into(),
      error: None,
    };
    let v = serde_json::to_value(&p).unwrap();
    assert_eq!(v["total"], 5);
    assert_eq!(v["completed"], 2);
    assert_eq!(v["name"], "Jane Doe");
    assert_eq!(v["status"], "creating");
    assert!(v.get("error").is_none() || v["error"].is_null());
  }

  #[test]
  fn smoke_template_preserves_optional_fields() {
    let mut tpl = sample_template("Full");
    tpl.extension_group_id = Some("ext-g1".into());
    tpl.dns_blocklist = Some("ads\ntrackers".into());
    tpl.launch_hook = Some("https://example.com/hook".into());
    tpl.proxy_id = Some("proxy-1".into());

    // Sanitize keeps non-secret fields
    sanitize_template_configs(&mut tpl);
    assert_eq!(tpl.extension_group_id.as_deref(), Some("ext-g1"));
    assert_eq!(tpl.dns_blocklist.as_deref(), Some("ads\ntrackers"));
    assert_eq!(tpl.launch_hook.as_deref(), Some("https://example.com/hook"));
    assert_eq!(tpl.proxy_id.as_deref(), Some("proxy-1"));
    assert!(tpl.wayfern_config.as_ref().unwrap().fingerprint.is_none());
  }

  #[test]
  fn smoke_name_parts_look_like_real_names() {
    let mut taken = HashSet::new();
    for _ in 0..20 {
      let name = generate_unique_profile_name(&mut taken);
      let parts: Vec<_> = name.split(' ').collect();
      assert_eq!(parts.len(), 2);
      assert!(parts[0].chars().next().unwrap().is_uppercase());
      assert!(parts[1].chars().next().unwrap().is_uppercase());
      assert!(!parts[0].chars().any(|c| c.is_ascii_digit()));
    }
  }
}
