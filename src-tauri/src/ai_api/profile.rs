use reqwest::Url;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

pub type ApiResult<T> = Result<T, &'static str>;

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Protocol { Chat, Responses, Anthropic }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub protocol: Protocol,
    /// A complete user-selected endpoint, not a URL suggested by a model.
    pub endpoint: String,
    pub model: String,
    pub stream: bool,
    pub tools: bool,
    pub include_usage: bool,
    pub chat_token_field: String,
    pub max_tokens: u32,
    pub timeout_seconds: u32,
    pub allow_local_http: bool,
}
impl Settings {
    pub fn validate(&self) -> ApiResult<Url> {
        if self.endpoint.len() > 1024 || self.model.is_empty() || self.model.len() > 128
            || self.model.chars().any(char::is_control)
            || !(128..=1_000_000).contains(&self.max_tokens) || !(15..=3600).contains(&self.timeout_seconds)
            || !["max_tokens", "max_completion_tokens"].contains(&self.chat_token_field.as_str()) {
            return Err("invalid_configuration");
        }
        let url = Url::parse(&self.endpoint).map_err(|_| "invalid_endpoint")?;
        if !url.username().is_empty() || url.password().is_some() || url.query().is_some()
            || url.fragment().is_some() || url.host_str().is_none() {
            return Err("invalid_endpoint");
        }
        if url.scheme() != "https" {
            // HTTP is only an explicit local/private-address choice, never an
            // automatic TLS downgrade or a hostname whose DNS can later change.
            let host = url.host_str().unwrap_or("").trim_matches(['[', ']']);
            let local = host == "localhost" || host.parse::<std::net::IpAddr>().is_ok_and(|ip| match ip {
                std::net::IpAddr::V4(v) => v.is_loopback() || v.is_private(),
                std::net::IpAddr::V6(v) => v.is_loopback() || v.is_unique_local(),
            });
            if url.scheme() != "http" || !self.allow_local_http || !local { return Err("insecure_endpoint"); }
        }
        Ok(url)
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredProfile { pub settings: Settings, pub key: String }
impl Drop for StoredProfile { fn drop(&mut self) { self.key.zeroize(); } }
impl StoredProfile {
    pub fn validate(&self) -> ApiResult<()> {
        self.settings.validate()?;
        if self.key.len() > 2048 || !self.key.bytes().all(|b| (33..=126).contains(&b)) { return Err("invalid_api_key"); }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileView {
    pub revision: String, pub settings: Settings, pub has_key: bool, pub remembered: bool,
}

/// An entire profile is one OS credential: URL/protocol and secret cannot be
/// separated by a partial metadata write. No plaintext fallback or file paths.
pub trait Vault: Send + Sync {
    fn load(&self) -> ApiResult<Option<StoredProfile>>;
    fn save(&self, value: Option<&StoredProfile>) -> ApiResult<()>;
}
pub struct OsVault(pub String);
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedProfile { version: u8, profile: StoredProfile }
pub fn encode_saved(profile: &StoredProfile) -> ApiResult<Zeroizing<String>> {
    profile.validate()?;
    let text = Zeroizing::new(serde_json::to_string(&PersistedProfile { version: 1, profile: profile.clone() }).map_err(|_| "invalid_configuration")?);
    if text.len() > 2400 { return Err("secure_storage_capacity"); } Ok(text)
}
pub fn decode_saved(text: &str) -> ApiResult<StoredProfile> {
    if text.len() > 2400 { return Err("secure_storage_invalid"); }
    let value: PersistedProfile = serde_json::from_str(text).map_err(|_| "secure_storage_invalid")?;
    if value.version != 1 { return Err("secure_storage_invalid"); }
    value.profile.validate()?; Ok(value.profile)
}
impl OsVault {
    fn entry(&self) -> ApiResult<keyring::Entry> {
        // keyring's fallback on unsupported targets is a mock, NOT persistence.
        if !cfg!(any(target_os = "macos", target_os = "windows")) { return Err("secure_storage_unavailable"); }
        keyring::Entry::new(&format!("{}.ai-api", self.0), "active-profile-v1").map_err(|_| "secure_storage_unavailable")
    }
}
impl Vault for OsVault {
    fn load(&self) -> ApiResult<Option<StoredProfile>> {
        match self.entry()?.get_password() {
            Ok(text) => {
                let text = Zeroizing::new(text);
                Ok(Some(decode_saved(&text)?))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("secure_storage_unavailable"),
        }
    }
    fn save(&self, value: Option<&StoredProfile>) -> ApiResult<()> {
        if let Some(profile) = value {
            let text = encode_saved(profile)?;
            // Also fits Windows Credential Manager's per-credential blob limit.
            if text.len() > 2400 { return Err("secure_storage_capacity"); }
            self.entry()?.set_password(&text).map_err(|_| "secure_storage_unavailable")
        } else {
            if !cfg!(any(target_os = "macos", target_os = "windows")) { return Ok(()); }
            match self.entry()?.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => Ok(()), Err(_) => Err("secure_storage_unavailable") }
        }
    }
}
