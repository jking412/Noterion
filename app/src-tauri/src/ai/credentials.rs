use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::Path, sync::Mutex};

static SETTINGS_LOCK: Mutex<()> = Mutex::new(());
const CONFIG_FILE: &str = "model-connections.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    Deepseek,
    Openai,
    Anthropic,
}
impl ProviderKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Deepseek => "DeepSeek",
            Self::Openai => "OpenAI 兼容",
            Self::Anthropic => "Anthropic 兼容",
        }
    }
    fn defaults(self) -> ConnectionConfig {
        let (base_url, model) = match self {
            Self::Deepseek => ("https://api.deepseek.com", "deepseek-flash"),
            Self::Openai => ("https://api.openai.com/v1", ""),
            Self::Anthropic => ("https://api.anthropic.com/v1", ""),
        };
        ConnectionConfig {
            provider: self,
            model: model.into(),
            base_url: base_url.into(),
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionConfig {
    pub provider: ProviderKind,
    pub model: String,
    pub base_url: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Configuration {
    version: u8,
    active_provider: ProviderKind,
    connections: Vec<ConnectionConfig>,
}
impl Default for Configuration {
    fn default() -> Self {
        Self {
            version: 1,
            active_provider: ProviderKind::Deepseek,
            connections: [
                ProviderKind::Deepseek,
                ProviderKind::Openai,
                ProviderKind::Anthropic,
            ]
            .into_iter()
            .map(ProviderKind::defaults)
            .collect(),
        }
    }
}
impl Configuration {
    fn connection(&self, provider: ProviderKind) -> &ConnectionConfig {
        self.connections
            .iter()
            .find(|c| c.provider == provider)
            .expect("validated providers")
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    provider: ProviderKind,
    configured: bool,
    model: String,
    base_url: String,
    key_hint: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    active_provider: ProviderKind,
    connections: Vec<ConnectionStatus>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configure {
    pub provider: ProviderKind,
    pub key: Option<String>,
    pub model: String,
    pub base_url: String,
    pub activate: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckInput {
    pub provider: ProviderKind,
    pub key: Option<String>,
    pub model: String,
    pub base_url: String,
}

pub fn validate(config: &mut ConnectionConfig) -> Result<(), String> {
    config.model = config.model.trim().to_owned();
    // Full service model IDs can include namespaces, dates, colons, and slashes.
    if config.model.len() > 256
        || config
            .model
            .chars()
            .any(|c| c.is_control() || c.is_whitespace())
    {
        return Err("模型名称不合法，请填写服务商提供的完整模型 ID（不含空白）。".into());
    }
    let url = reqwest::Url::parse(config.base_url.trim()).map_err(|_| "连接地址不是有效 URL。")?;
    let allowed = url.scheme() == "https";
    #[cfg(debug_assertions)]
    let allowed = allowed
        || (url.scheme() == "http"
            && matches!(
                url.host_str(),
                Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
            ));
    if !allowed
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("连接地址必须为 HTTPS，且不能包含用户名、密码、查询参数或片段。".into());
    }
    let normalized = url.as_str().trim_end_matches('/');
    if normalized.ends_with("/chat/completions") || normalized.ends_with("/messages") {
        return Err(
            "请填写 API 根地址（可包含 /v1），不要包含 /chat/completions 或 /messages。".into(),
        );
    }
    config.base_url = normalized.to_owned();
    Ok(())
}
fn require_model(config: &ConnectionConfig) -> Result<(), String> {
    if config.model.is_empty() {
        Err("请填写服务商提供的完整模型 ID。".into())
    } else {
        Ok(())
    }
}
fn requested_key(value: Option<String>) -> Result<Option<String>, String> {
    let value = value.map(|s| s.trim().to_owned());
    if value
        .as_ref()
        .is_some_and(|s| s.len() > 2000 || s.chars().any(char::is_control))
    {
        return Err("密钥格式不合法。".into());
    }
    Ok(value)
}
fn read_optional(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("无法读取模型配置，请检查用户配置目录；已有配置未修改。".into()),
    }
}
fn prepare(directory: &Path, config: &Configuration) -> Result<std::path::PathBuf, String> {
    let bytes = serde_json::to_vec_pretty(config).map_err(|_| "无法整理模型连接配置。")?;
    let temporary = directory.join(format!("models-{}.tmp", uuid::Uuid::new_v4()));
    let prepared = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()
    })();
    if prepared.is_err() {
        let _ = fs::remove_file(&temporary);
        return Err(
            "无法准备或同步模型配置，请检查配置目录写权限与磁盘；配置与密钥均未修改。".into(),
        );
    }
    Ok(temporary)
}
fn load_unlocked(directory: &Path) -> Result<Configuration, String> {
    if let Some(bytes) = read_optional(&directory.join(CONFIG_FILE))? {
        if bytes.len() > 16_384 {
            return Err("模型配置过大，请恢复有效的配置文件。".into());
        }
        let mut config: Configuration = serde_json::from_slice(&bytes)
            .map_err(|_| "模型配置无法读取；请恢复有效的配置文件，已有内容未修改。")?;
        if config.version != 1
            || config.connections.len() != 3
            || [
                ProviderKind::Deepseek,
                ProviderKind::Openai,
                ProviderKind::Anthropic,
            ]
            .iter()
            .any(|p| {
                config
                    .connections
                    .iter()
                    .filter(|c| c.provider == *p)
                    .count()
                    != 1
            })
        {
            return Err("模型配置版本或连接类型无效，已有内容未修改。".into());
        }
        for connection in &mut config.connections {
            validate(connection)?;
        }
        return Ok(config);
    }
    let mut config = Configuration::default();
    // DeepSeek keeps its original credential target. No secret is copied and the
    // legacy JSON remains intact, including if migration cannot commit.
    if let Some(bytes) = read_optional(&directory.join("deepseek.json"))? {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Legacy {
            model: String,
            base_url: String,
        }
        if bytes.len() > 4096 {
            return Err("旧 DeepSeek 配置过大，迁移未执行，原配置已保留。".into());
        }
        let legacy: Legacy = serde_json::from_slice(&bytes)
            .map_err(|_| "旧 DeepSeek 配置无法读取，迁移未执行，原配置已保留。")?;
        let mut connection = ConnectionConfig {
            provider: ProviderKind::Deepseek,
            model: legacy.model,
            base_url: legacy.base_url,
        };
        validate(&mut connection)?;
        config.connections[0] = connection;
    }
    let temporary = prepare(directory, &config)?;
    if let Err(error) = replace(&temporary, &directory.join(CONFIG_FILE)) {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "模型配置初始化或迁移未保存，原配置和密钥已保留：{error}"
        ));
    }
    Ok(config)
}
fn target(config: &ConnectionConfig, directory: &Path) -> String {
    let mut hash = Sha256::new();
    hash.update(directory.to_string_lossy().as_bytes());
    hash.update([0]);
    hash.update(config.base_url.as_bytes());
    let namespace = match config.provider {
        ProviderKind::Deepseek => "DeepSeek", // preserves original Windows entry
        ProviderKind::Openai => "OpenAI",
        ProviderKind::Anthropic => "Anthropic",
    };
    format!("Noterion/{namespace}/{:x}", hash.finalize())
}
fn key(config: &ConnectionConfig, directory: &Path) -> Result<Option<String>, String> {
    // Only explicit, fully bound test overrides are supported in debug builds.
    // A generic DeepSeek environment key must never follow an edited target.
    #[cfg(debug_assertions)]
    if std::env::var("NOTERION_TEST_BASE_URL").ok().as_deref() == Some(config.base_url.as_str())
        && std::env::var("NOTERION_TEST_PROVIDER").ok().as_deref()
            == Some(match config.provider {
                ProviderKind::Deepseek => "deepseek",
                ProviderKind::Openai => "openai",
                ProviderKind::Anthropic => "anthropic",
            })
    {
        if let Ok(value) = std::env::var("NOTERION_TEST_KEY") {
            if !value.trim().is_empty() {
                return Ok(Some(value));
            }
        }
    }
    platform::read(&target(config, directory))
}
fn settings_unlocked(directory: &Path, config: &Configuration) -> Result<Settings, String> {
    let mut connections = Vec::new();
    for connection in &config.connections {
        let secret = key(connection, directory)?;
        connections.push(ConnectionStatus {
            provider: connection.provider,
            configured: secret.is_some(),
            model: connection.model.clone(),
            base_url: connection.base_url.clone(),
            key_hint: if secret.is_some() {
                "已保存到 Windows 凭据".into()
            } else {
                String::new()
            },
        });
    }
    Ok(Settings {
        active_provider: config.active_provider,
        connections,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::current_dir()
                .unwrap()
                .join("target/model-settings-tests")
                .join(uuid::Uuid::new_v4().to_string());
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            for provider in [
                ProviderKind::Deepseek,
                ProviderKind::Openai,
                ProviderKind::Anthropic,
            ] {
                let _ = platform::delete(&target(&provider.defaults(), &self.0));
            }
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn input(provider: ProviderKind, secret: Option<&str>, activate: bool) -> Configure {
        let mut config = provider.defaults();
        if config.model.is_empty() {
            config.model = "vendor/model:2026-11".into();
        }
        Configure {
            provider,
            model: config.model,
            base_url: config.base_url,
            key: secret.map(str::to_owned),
            activate,
        }
    }
    #[test]
    fn validates_full_model_ids_and_rejects_unsafe_or_full_endpoint_urls() {
        let mut config = ProviderKind::Openai.defaults();
        config.model = "org/model:free-2026".into();
        validate(&mut config).unwrap();
        for url in [
            "http://untrusted.invalid/v1",
            "https://user:key@example.com/v1",
            "https://example.com/v1?key=secret",
            "https://example.com/v1#fragment",
            "https://example.com/v1/chat/completions",
            "https://example.com/v1/messages",
        ] {
            config.base_url = url.into();
            assert!(validate(&mut config).is_err(), "{url}");
        }
    }
    #[test]
    fn credential_targets_are_isolated_by_protocol_directory_and_full_api_root() {
        let config = ProviderKind::Deepseek.defaults();
        let mut other = config.clone();
        other.provider = ProviderKind::Openai;
        assert_ne!(
            target(&config, Path::new("a")),
            target(&other, Path::new("a"))
        );
        other = config.clone();
        other.base_url.push_str("/v1");
        assert_ne!(
            target(&config, Path::new("a")),
            target(&other, Path::new("a"))
        );
        assert_ne!(
            target(&config, Path::new("a")),
            target(&config, Path::new("b"))
        );
        let mut hash = Sha256::new();
        hash.update(b"a");
        hash.update([0]);
        hash.update(config.base_url.as_bytes());
        assert_eq!(
            target(&config, Path::new("a")),
            format!("Noterion/DeepSeek/{:x}", hash.finalize())
        );
    }
    #[test]
    fn corrupt_legacy_settings_fail_without_overwriting_configuration_or_knowledge() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("deepseek.json"), b"broken").unwrap();
        fs::write(fixture.0.join("facts.sqlite"), b"untouched").unwrap();
        assert!(settings(&fixture.0).is_err());
        assert_eq!(
            fs::read(fixture.0.join("deepseek.json")).unwrap(),
            b"broken"
        );
        assert_eq!(
            fs::read(fixture.0.join("facts.sqlite")).unwrap(),
            b"untouched"
        );
        assert!(!fixture.0.join(CONFIG_FILE).exists());
    }
    #[test]
    #[cfg(windows)]
    fn legacy_windows_key_migrates_and_three_saved_connections_remain_independent() {
        let fixture = Fixture::new();
        let legacy = ProviderKind::Deepseek.defaults();
        platform::write(&target(&legacy, &fixture.0), "synthetic-legacy-secret").unwrap();
        let bytes = br#"{"model":"deepseek-flash","baseUrl":"https://api.deepseek.com"}"#;
        fs::write(fixture.0.join("deepseek.json"), bytes).unwrap();
        let migrated = settings(&fixture.0).unwrap();
        assert!(migrated.connections[0].configured);
        assert_eq!(active(&fixture.0).unwrap().1, "synthetic-legacy-secret");
        configure(
            &fixture.0,
            input(ProviderKind::Openai, Some("synthetic-openai-secret"), true),
        )
        .unwrap();
        configure(
            &fixture.0,
            input(
                ProviderKind::Anthropic,
                Some("synthetic-anthropic-secret"),
                true,
            ),
        )
        .unwrap();
        assert_eq!(active(&fixture.0).unwrap().1, "synthetic-anthropic-secret");
        configure(&fixture.0, input(ProviderKind::Deepseek, None, true)).unwrap();
        assert_eq!(active(&fixture.0).unwrap().1, "synthetic-legacy-secret");
        assert_eq!(fs::read(fixture.0.join("deepseek.json")).unwrap(), bytes);
        assert!(settings(&fixture.0)
            .unwrap()
            .connections
            .iter()
            .all(|c| c.configured));
        let serialized = fs::read_to_string(fixture.0.join(CONFIG_FILE)).unwrap();
        assert!(!serialized.contains("secret"));
        let mut changed = input(ProviderKind::Deepseek, None, false);
        changed.base_url = "https://new-target.invalid/v1".into();
        let result = configure(&fixture.0, changed).unwrap();
        assert!(!result.connections[0].configured);
        assert!(active(&fixture.0).is_err());
        assert!(for_check(
            &fixture.0,
            CheckInput {
                provider: ProviderKind::Openai,
                model: "another-model".into(),
                base_url: "https://new-target.invalid/v1".into(),
                key: None
            }
        )
        .is_err());
        configure(&fixture.0, input(ProviderKind::Deepseek, None, true)).unwrap();
        assert_eq!(active(&fixture.0).unwrap().1, "synthetic-legacy-secret");
        configure(&fixture.0, input(ProviderKind::Deepseek, Some(""), false)).unwrap();
        assert!(active(&fixture.0).is_err());
        assert!(platform::read(&target(&legacy, &fixture.0))
            .unwrap()
            .is_none());
    }
    #[test]
    #[cfg(windows)]
    fn failed_config_replace_restores_original_windows_credential_and_selected_model() {
        use std::os::windows::fs::OpenOptionsExt;
        let fixture = Fixture::new();
        configure(
            &fixture.0,
            input(ProviderKind::Deepseek, Some("synthetic-original"), true),
        )
        .unwrap();
        let original = fs::read(fixture.0.join(CONFIG_FILE)).unwrap();
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(fixture.0.join(CONFIG_FILE))
            .unwrap();
        let result = configure(
            &fixture.0,
            input(ProviderKind::Deepseek, Some("synthetic-replacement"), true),
        );
        assert!(result.is_err());
        assert_eq!(fs::read(fixture.0.join(CONFIG_FILE)).unwrap(), original);
        assert_eq!(active(&fixture.0).unwrap().1, "synthetic-original");
        drop(held);
    }
}
pub fn settings(directory: &Path) -> Result<Settings, String> {
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| "模型设置暂时不可用，请重启后重试。")?;
    let config = load_unlocked(directory)?;
    settings_unlocked(directory, &config)
}
pub fn active(directory: &Path) -> Result<(ConnectionConfig, String), String> {
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| "模型设置暂时不可用，请重启后重试。")?;
    let configuration = load_unlocked(directory)?;
    let config = configuration
        .connection(configuration.active_provider)
        .clone();
    require_model(&config)?;
    let secret = key(&config, directory)?.ok_or("当前模型尚未配置密钥，请打开模型设置。")?;
    Ok((config, secret))
}
pub fn for_check(
    directory: &Path,
    input: CheckInput,
) -> Result<(ConnectionConfig, String), String> {
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| "模型设置暂时不可用，请重启后重试。")?;
    let mut config = ConnectionConfig {
        provider: input.provider,
        model: input.model,
        base_url: input.base_url,
    };
    validate(&mut config)?;
    require_model(&config)?;
    let configuration = load_unlocked(directory)?;
    let requested = requested_key(input.key)?;
    let secret = match requested {
        Some(secret) if !secret.is_empty() => Some(secret),
        Some(_) => None,
        None if configuration.connection(config.provider).base_url == config.base_url => {
            key(&config, directory)?
        }
        None => None,
    }
    .ok_or("此连接目标尚未配置密钥，请输入该服务的密钥后检查。")?;
    Ok((config, secret))
}
pub fn configure(directory: &Path, input: Configure) -> Result<Settings, String> {
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| "模型设置暂时不可用，请重启后重试。")?;
    let mut config = ConnectionConfig {
        provider: input.provider,
        model: input.model,
        base_url: input.base_url,
    };
    validate(&mut config)?;
    let requested = requested_key(input.key)?;
    let mut configuration = load_unlocked(directory)?;
    let config_path = directory.join(CONFIG_FILE);
    let original_config = read_optional(&config_path)?;
    let credential_target = target(&config, directory);
    let original_key = platform::read(&credential_target)?;
    // Changing a target never copies a previous target's secret.
    let has_key = requested
        .as_ref()
        .map_or(original_key.is_some(), |s| !s.is_empty());
    if input.activate {
        require_model(&config)?;
        if !has_key {
            return Err("此连接尚未配置密钥，请先输入该服务的密钥再启用。".into());
        }
        configuration.active_provider = config.provider;
    }
    let index = configuration
        .connections
        .iter()
        .position(|c| c.provider == config.provider)
        .expect("validated providers");
    configuration.connections[index] = config;
    let temporary = prepare(directory, &configuration)?;
    match read_optional(&config_path) {
        Ok(current) if current == original_config => {}
        _ => {
            let _ = fs::remove_file(&temporary);
            return Err(
                "模型配置在保存期间已变动；本次配置与密钥均未修改，请重新打开设置。".into(),
            );
        }
    }
    let changed = requested.as_ref().is_some_and(|s| {
        original_key.as_deref() != Some(s.as_str()) && (!s.is_empty() || original_key.is_some())
    });
    let restore = || match original_key.as_deref() {
        Some(secret) => platform::write(&credential_target, secret),
        None => platform::delete(&credential_target),
    };
    if changed {
        let result = match requested.as_deref() {
            Some("") => platform::delete(&credential_target),
            Some(secret) => platform::write(&credential_target, secret),
            None => unreachable!(),
        };
        if let Err(error) = result {
            let _ = fs::remove_file(&temporary);
            return match restore() {
                Ok(()) => Err(format!("模型配置未保存，原凭据已恢复：{error}")),
                Err(_) => Err(format!(
                    "模型配置未保存，原凭据恢复失败，请重新设置此连接密钥：{error}"
                )),
            };
        }
    }
    if let Err(error) = replace(&temporary, &config_path) {
        let _ = fs::remove_file(&temporary);
        return if changed && restore().is_err() {
            Err(format!(
                "模型配置未保存，原凭据恢复失败，请重新设置此连接密钥：{error}"
            ))
        } else {
            Err(format!("模型配置未保存，原配置与凭据已保留：{error}"))
        };
    }
    settings_unlocked(directory, &configuration)
        .map_err(|error| format!("配置已保存，但凭据状态读取失败，请重新打开设置核对：{error}"))
}

#[cfg(windows)]
fn replace(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(source: *const u16, target: *const u16, flags: u32) -> i32;
    }
    let source: Vec<_> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<_> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 1 | 8) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
fn replace(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(source, target)
}

#[cfg(windows)]
mod platform {
    use std::ptr;
    #[repr(C)]
    struct Credential {
        flags: u32,
        kind: u32,
        target: *mut u16,
        comment: *mut u16,
        last_written: [u32; 2],
        blob_size: u32,
        blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut std::ffi::c_void,
        target_alias: *mut u16,
        username: *mut u16,
    }
    #[link(name = "Advapi32")]
    unsafe extern "system" {
        fn CredReadW(
            target: *const u16,
            kind: u32,
            flags: u32,
            credential: *mut *mut Credential,
        ) -> i32;
        fn CredWriteW(credential: *const Credential, flags: u32) -> i32;
        fn CredDeleteW(target: *const u16, kind: u32, flags: u32) -> i32;
        fn CredFree(buffer: *mut std::ffi::c_void);
    }
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }
    pub fn read(name: &str) -> Result<Option<String>, String> {
        let name = wide(name);
        let mut credential = ptr::null_mut();
        if unsafe { CredReadW(name.as_ptr(), 1, 0, &mut credential) } == 0 {
            return if std::io::Error::last_os_error().raw_os_error() == Some(1168) {
                Ok(None)
            } else {
                Err("无法读取 Windows 凭据，请检查当前用户的凭据管理器。".into())
            };
        }
        let result = unsafe {
            if credential.is_null() {
                Err("Windows 凭据读取为空。".into())
            } else {
                let c = &*credential;
                if c.blob_size == 0 || c.blob_size > 4000 || c.blob.is_null() {
                    Err("已保存凭据格式无效，请重新配置。".into())
                } else {
                    String::from_utf8(
                        std::slice::from_raw_parts(c.blob, c.blob_size as usize).to_vec(),
                    )
                    .map(Some)
                    .map_err(|_| "已保存凭据格式无效，请重新配置。".into())
                }
            }
        };
        if !credential.is_null() {
            unsafe { CredFree(credential.cast()) };
        }
        result
    }
    pub fn write(name: &str, value: &str) -> Result<(), String> {
        let mut name = wide(name);
        let mut user = wide("Noterion");
        let credential = Credential {
            flags: 0,
            kind: 1,
            target: name.as_mut_ptr(),
            comment: ptr::null_mut(),
            last_written: [0; 2],
            blob_size: value.len() as u32,
            blob: value.as_ptr() as *mut u8,
            persist: 2,
            attribute_count: 0,
            attributes: ptr::null_mut(),
            target_alias: ptr::null_mut(),
            username: user.as_mut_ptr(),
        };
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            Err("密钥未能写入 Windows 凭据管理器。".into())
        } else {
            Ok(())
        }
    }
    pub fn delete(name: &str) -> Result<(), String> {
        let name = wide(name);
        if unsafe { CredDeleteW(name.as_ptr(), 1, 0) } == 0
            && std::io::Error::last_os_error().raw_os_error() != Some(1168)
        {
            Err("无法从 Windows 凭据管理器移除密钥。".into())
        } else {
            Ok(())
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn read(_: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    pub fn write(_: &str, _: &str) -> Result<(), String> {
        Err("此版本仅在 Windows 凭据管理器中保存密钥。".into())
    }
    pub fn delete(_: &str) -> Result<(), String> {
        Ok(())
    }
}
