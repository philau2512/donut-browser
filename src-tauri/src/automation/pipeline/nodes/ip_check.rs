use crate::automation::pipeline::context::ExecutionContext;
use crate::automation::pipeline::types::{AutomationErrorCode, IpCheckNodeConfig};
use crate::automation::pipeline::{AutomationNode, NodeResult};
use async_trait::async_trait;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct IpApiResponse {
  #[serde(rename = "countryCode")]
  country_code: Option<String>,
  #[serde(default)]
  fraud_score: u8,
}

pub struct IpCheckNode {
  config: IpCheckNodeConfig,
}

impl IpCheckNode {
  pub fn new(config: IpCheckNodeConfig) -> Self {
    Self { config }
  }

  /// Check IP using ip-api.com service
  async fn check_ip(
    &self,
    context: &ExecutionContext,
  ) -> Result<IpApiResponse, (AutomationErrorCode, String)> {
    let mut client_builder = reqwest::Client::builder()
      .timeout(std::time::Duration::from_secs(self.config.timeout_seconds));

    // Configure proxy if requested and available
    if self.config.use_proxy {
      if let Some(ref proxy_settings) = context.dynamic_proxy {
        let proxy_url = proxy_settings.to_url();
        log::info!(
          "[AUTOMATION] [IP_CHECK] Using proxy for IP check: {}",
          proxy_url
        );

        let proxy = reqwest::Proxy::all(&proxy_url).map_err(|e| {
          (
            AutomationErrorCode::IpCheckRequestFailed,
            format!("Invalid proxy configuration: {}", e),
          )
        })?;

        client_builder = client_builder.proxy(proxy);
      } else {
        return Err((
          AutomationErrorCode::IpCheckRequestFailed,
          "use_proxy=true but no dynamic proxy available in context".to_string(),
        ));
      }
    }

    let client = client_builder.build().map_err(|e| {
      (
        AutomationErrorCode::IpCheckRequestFailed,
        format!("Failed to create HTTP client: {}", e),
      )
    })?;

    log::info!("[AUTOMATION] [IP_CHECK] Checking IP address");

    // Use ip-api.com (free, no auth required)
    let url = "http://ip-api.com/json/?fields=countryCode";
    let response = client.get(url).send().await.map_err(|e| {
      if e.is_timeout() {
        (
          AutomationErrorCode::IpCheckRequestFailed,
          format!("Request timeout after {}s", self.config.timeout_seconds),
        )
      } else {
        (
          AutomationErrorCode::IpCheckRequestFailed,
          format!("HTTP request failed: {}", e),
        )
      }
    })?;

    if !response.status().is_success() {
      return Err((
        AutomationErrorCode::IpCheckRequestFailed,
        format!("IP check API returned HTTP {}", response.status()),
      ));
    }

    let body = response.text().await.map_err(|e| {
      (
        AutomationErrorCode::IpCheckRequestFailed,
        format!("Failed to read response: {}", e),
      )
    })?;

    let ip_data: IpApiResponse = serde_json::from_str(&body).map_err(|e| {
      (
        AutomationErrorCode::IpCheckInvalidResponse,
        format!("Invalid JSON response: {}", e),
      )
    })?;

    Ok(ip_data)
  }

  /// Validate IP data against configuration
  fn validate_ip_data(&self, ip_data: &IpApiResponse) -> Result<(), (AutomationErrorCode, String)> {
    // Check country code
    if !self.config.allowed_countries.is_empty() {
      let country = ip_data.country_code.as_deref().unwrap_or("UNKNOWN");
      if !self.config.allowed_countries.contains(&country.to_string()) {
        return Err((
          AutomationErrorCode::IpCheckCountryBlocked,
          format!(
            "Country '{}' not in allowed list: {:?}",
            country, self.config.allowed_countries
          ),
        ));
      }
      log::info!("[AUTOMATION] [IP_CHECK] Country check passed: {}", country);
    }

    // Check fraud score
    if ip_data.fraud_score > self.config.max_fraud_score {
      return Err((
        AutomationErrorCode::IpCheckFraudScoreHigh,
        format!(
          "Fraud score {} exceeds maximum {}",
          ip_data.fraud_score, self.config.max_fraud_score
        ),
      ));
    }

    log::info!(
      "[AUTOMATION] [IP_CHECK] Fraud score check passed: {} (max: {})",
      ip_data.fraud_score,
      self.config.max_fraud_score
    );

    Ok(())
  }
}

#[async_trait]
impl AutomationNode for IpCheckNode {
  async fn execute(&self, context: &mut ExecutionContext) -> NodeResult {
    log::info!("[AUTOMATION] [IP_CHECK] Executing: {}", self.config.label);

    // Check IP
    let ip_data = self.check_ip(context).await?;

    // Validate
    self.validate_ip_data(&ip_data)?;

    // Store results in context
    if let Some(country) = &ip_data.country_code {
      context.set_variable("ip_country", country.clone());
    }
    context.set_variable("ip_fraud_score", ip_data.fraud_score.to_string());

    log::info!(
      "[AUTOMATION] [IP_CHECK] IP check passed: country={}, fraud_score={}",
      ip_data.country_code.as_deref().unwrap_or("UNKNOWN"),
      ip_data.fraud_score
    );

    Ok(())
  }

  fn label(&self) -> &str {
    &self.config.label
  }

  fn node_type(&self) -> &str {
    "IP_CHECK"
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_node_creation() {
    let config = IpCheckNodeConfig {
      label: "Test IP Check".to_string(),
      allowed_countries: vec!["US".to_string(), "GB".to_string()],
      max_fraud_score: 50,
      use_proxy: true,
      timeout_seconds: 30,
      max_attempts: 3,
      retry_delay_ms: 1000,
      backoff_multiplier: 2.0,
    };

    let node = IpCheckNode::new(config);
    assert_eq!(node.label(), "Test IP Check");
    assert_eq!(node.node_type(), "IP_CHECK");
  }

  #[test]
  fn test_validate_country_allowed() {
    let config = IpCheckNodeConfig {
      label: "Test".to_string(),
      allowed_countries: vec!["US".to_string(), "GB".to_string()],
      max_fraud_score: 100,
      use_proxy: false,
      timeout_seconds: 30,
      max_attempts: 1,
      retry_delay_ms: 1000,
      backoff_multiplier: 1.0,
    };

    let node = IpCheckNode::new(config);
    let ip_data = IpApiResponse {
      country_code: Some("US".to_string()),
      fraud_score: 10,
    };

    assert!(node.validate_ip_data(&ip_data).is_ok());
  }

  #[test]
  fn test_validate_country_blocked() {
    let config = IpCheckNodeConfig {
      label: "Test".to_string(),
      allowed_countries: vec!["US".to_string()],
      max_fraud_score: 100,
      use_proxy: false,
      timeout_seconds: 30,
      max_attempts: 1,
      retry_delay_ms: 1000,
      backoff_multiplier: 1.0,
    };

    let node = IpCheckNode::new(config);
    let ip_data = IpApiResponse {
      country_code: Some("CN".to_string()),
      fraud_score: 10,
    };

    let result = node.validate_ip_data(&ip_data);
    assert!(result.is_err());
    let (code, _) = result.unwrap_err();
    assert!(matches!(code, AutomationErrorCode::IpCheckCountryBlocked));
  }

  #[test]
  fn test_validate_fraud_score() {
    let config = IpCheckNodeConfig {
      label: "Test".to_string(),
      allowed_countries: vec![],
      max_fraud_score: 50,
      use_proxy: false,
      timeout_seconds: 30,
      max_attempts: 1,
      retry_delay_ms: 1000,
      backoff_multiplier: 1.0,
    };

    let node = IpCheckNode::new(config);
    let ip_data = IpApiResponse {
      country_code: Some("US".to_string()),
      fraud_score: 75,
    };

    let result = node.validate_ip_data(&ip_data);
    assert!(result.is_err());
    let (code, _) = result.unwrap_err();
    assert!(matches!(code, AutomationErrorCode::IpCheckFraudScoreHigh));
  }
}
