#[allow(clippy::module_inception)]
pub mod browser;
pub mod browser_runner;
pub mod browser_version_manager;
pub mod camoufox;
pub mod camoufox_manager;
pub mod downloaded_browsers_registry;
pub mod downloader;
pub mod ephemeral_dirs;
pub mod platform_browser;
pub mod wayfern_manager;
pub mod wayfern_terms;

pub use self::browser::*;
