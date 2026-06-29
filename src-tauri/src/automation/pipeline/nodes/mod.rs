//! Automation node implementations.
//!
//! Each node type implements the AutomationNode trait and provides
//! specific functionality for the profile automation pipeline.

pub mod cleanup;
pub mod dynamic_proxy;
pub mod ip_check;
pub mod local_command;
pub mod telegram_alert;
pub mod webhook;

pub use cleanup::CleanupNode;
pub use dynamic_proxy::DynamicProxyNode;
pub use ip_check::IpCheckNode;
pub use local_command::LocalCommandNode;
pub use telegram_alert::TelegramAlertNode;
pub use webhook::WebhookNode;
