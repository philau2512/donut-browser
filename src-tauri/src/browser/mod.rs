#[allow(clippy::module_inception)]
pub mod browser;
pub mod browser_runner;
pub mod browser_version_manager;
pub mod camoufox;
pub mod camoufox_manager;
pub mod default_browser;
pub mod downloaded_browsers_registry;
pub mod downloader;
pub mod ephemeral_dirs;
pub mod extension_manager;
pub mod extraction;
pub mod human_typing;
pub mod platform_browser;
pub mod wayfern_launch_args;
pub mod wayfern_manager;
pub mod wayfern_terms;

pub use self::browser::*;
