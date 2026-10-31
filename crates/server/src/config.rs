//! Configuration read from the environment and validated at startup.
//!
//! Error messages name the variable but never echo its value, so a
//! misconfigured secret cannot leak into the logs.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

const DEFAULT_PORT: u16 = 8080;
const DEFAULT_WEB_DIR: &str = "web/dist";

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub addr: SocketAddr,
    pub log_format: LogFormat,
    pub web_dir: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    Text,
    Json,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("missing required environment variable {0}")]
    Missing(&'static str),
    #[error("invalid environment variable {name}: expected {expected}")]
    Invalid {
        name: &'static str,
        expected: &'static str,
    },
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Builds the configuration from any variable source, so tests do not
    /// have to mutate the process environment.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let var = |name: &str| lookup(name).filter(|value| !value.is_empty());

        let database_url = var("DATABASE_URL").ok_or(ConfigError::Missing("DATABASE_URL"))?;

        let host = match var("HOST") {
            Some(value) => value.parse().map_err(|_| ConfigError::Invalid {
                name: "HOST",
                expected: "an IP address",
            })?,
            None => IpAddr::V4(Ipv4Addr::LOCALHOST),
        };

        let port = match var("PORT") {
            Some(value) => value.parse().map_err(|_| ConfigError::Invalid {
                name: "PORT",
                expected: "a port number",
            })?,
            None => DEFAULT_PORT,
        };

        let log_format = match var("LOG_FORMAT").as_deref() {
            None | Some("text") => LogFormat::Text,
            Some("json") => LogFormat::Json,
            Some(_) => {
                return Err(ConfigError::Invalid {
                    name: "LOG_FORMAT",
                    expected: "text or json",
                });
            }
        };

        let web_dir = var("WEB_DIR").map_or_else(|| PathBuf::from(DEFAULT_WEB_DIR), PathBuf::from);

        Ok(Self {
            database_url,
            addr: SocketAddr::new(host, port),
            log_format,
            web_dir,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup<'a>(vars: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| {
            vars.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).to_owned())
        }
    }

    #[test]
    fn defaults_apply_when_only_the_database_is_set() {
        let config = Config::from_lookup(lookup(&[("DATABASE_URL", "postgres://db")])).unwrap();
        assert_eq!(config.addr, "127.0.0.1:8080".parse().unwrap());
        assert_eq!(config.log_format, LogFormat::Text);
        assert_eq!(config.web_dir, PathBuf::from("web/dist"));
    }

    #[test]
    fn a_missing_database_url_is_refused() {
        let error = Config::from_lookup(lookup(&[])).unwrap_err();
        assert_eq!(error, ConfigError::Missing("DATABASE_URL"));
    }

    #[test]
    fn an_empty_variable_counts_as_missing() {
        let error = Config::from_lookup(lookup(&[("DATABASE_URL", "")])).unwrap_err();
        assert_eq!(error, ConfigError::Missing("DATABASE_URL"));
    }

    #[test]
    fn an_invalid_value_is_refused_without_echoing_it() {
        let error = Config::from_lookup(lookup(&[
            ("DATABASE_URL", "postgres://db"),
            ("PORT", "secret-looking-value"),
        ]))
        .unwrap_err();
        assert!(!error.to_string().contains("secret-looking-value"));
        assert_eq!(
            error,
            ConfigError::Invalid {
                name: "PORT",
                expected: "a port number"
            }
        );
    }

    #[test]
    fn overrides_are_read() {
        let config = Config::from_lookup(lookup(&[
            ("DATABASE_URL", "postgres://db"),
            ("HOST", "0.0.0.0"),
            ("PORT", "3000"),
            ("LOG_FORMAT", "json"),
            ("WEB_DIR", "/app/web"),
        ]))
        .unwrap();
        assert_eq!(config.addr, "0.0.0.0:3000".parse().unwrap());
        assert_eq!(config.log_format, LogFormat::Json);
        assert_eq!(config.web_dir, PathBuf::from("/app/web"));
    }
}
