use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

const DEFAULT_URL: &str = "https://api.deepseek.com";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionConfig {
    pub model: String,
    pub base_url: String,
}

impl Default for ConnectionConfig {
    fn default() -> Self {
        Self {
            model: "deepseek-flash".into(),
            base_url: DEFAULT_URL.into(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub configured: bool,
    pub model: String,
    pub base_url: String,
    pub key_hint: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configure {
    pub key: Option<String>,
    pub model: String,
    pub base_url: String,
}

pub fn validate(config: &mut ConnectionConfig) -> Result<(), String> {
    config.model = config.model.trim().to_owned();
    if config.model.is_empty()
        || config.model.len() > 100
        || !config
            .model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err("模型名称不合法，请填写 DeepSeek 模型名称。".into());
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
        return Err(
            "DeepSeek 连接地址必须为 HTTPS，且不能包含用户名、密码、查询参数或片段。".into(),
        );
    }
    config.base_url = url.as_str().trim_end_matches('/').to_owned();
    Ok(())
}

pub fn load(directory: &Path) -> Result<ConnectionConfig, String> {
    match fs::read(directory.join("deepseek.json")) {
        Ok(bytes) => {
            if bytes.len() > 4096 {
                return Err("AI 连接配置过大，请重新配置。".into());
            }
            let mut config: ConnectionConfig =
                serde_json::from_slice(&bytes).map_err(|_| "AI 连接配置无法读取，请重新配置。")?;
            validate(&mut config)?;
            Ok(config)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(ConnectionConfig::default()),
        Err(_) => Err("无法读取 AI 连接配置，请检查用户配置目录。".into()),
    }
}

fn target(config: &ConnectionConfig, directory: &Path) -> String {
    let mut hash = Sha256::new();
    hash.update(directory.to_string_lossy().as_bytes());
    hash.update([0]);
    hash.update(config.base_url.as_bytes());
    format!("Noterion/DeepSeek/{:x}", hash.finalize())
}

pub fn key(config: &ConnectionConfig, directory: &Path) -> Result<Option<String>, String> {
    #[cfg(debug_assertions)]
    if let Ok(value) = std::env::var("NOTERION_DEEPSEEK_KEY") {
        if !value.trim().is_empty() {
            return Ok(Some(value));
        }
    }
    platform::read(&target(config, directory))
}

pub fn settings(directory: &Path) -> Result<Settings, String> {
    let config = load(directory)?;
    let secret = key(&config, directory)?;
    Ok(Settings {
        configured: secret.is_some(),
        model: config.model,
        base_url: config.base_url,
        key_hint: secret
            .map(|s| {
                if s.chars().count() <= 4 {
                    "已保存".into()
                } else {
                    format!(
                        "••••{}",
                        s.chars()
                            .rev()
                            .take(4)
                            .collect::<Vec<_>>()
                            .into_iter()
                            .rev()
                            .collect::<String>()
                    )
                }
            })
            .unwrap_or_default(),
    })
}

pub fn configure(directory: &Path, input: Configure) -> Result<Settings, String> {
    use std::io::Write;
    // Serialize saves within this process so a failed save cannot roll back a
    // later successful request's credential.
    static SAVING: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _saving = SAVING
        .lock()
        .map_err(|_| "AI 配置保存状态不可用，请重启后重试。")?;
    let mut config = ConnectionConfig {
        model: input.model,
        base_url: input.base_url,
    };
    validate(&mut config)?;
    let requested_key = input.key.map(|value| value.trim().to_owned());
    if requested_key
        .as_ref()
        .is_some_and(|secret| secret.len() > 2000 || secret.chars().any(char::is_control))
    {
        return Err("密钥格式不合法。".into());
    }
    let config_path = directory.join("deepseek.json");
    let read_config = || match fs::read(&config_path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("无法读取当前 AI 连接配置，配置与密钥均未修改。".to_owned()),
    };
    // Keep malformed existing settings repairable: preserve the original bytes
    // rather than requiring the old JSON to decode before replacing it.
    let original_config = read_config()?;
    let credential_target = target(&config, directory);
    // Restore the actual system credential, never a debug environment override.
    let original_key = if requested_key.is_some() {
        platform::read(&credential_target)?
    } else {
        None
    };
    let bytes = serde_json::to_vec_pretty(&config).map_err(|_| "无法整理 AI 连接配置。")?;
    // Finish and sync all fallible temporary-file I/O before changing a key.
    let temporary = directory.join(format!("deepseek-{}.tmp", uuid::Uuid::new_v4()));
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
            "无法准备或同步 AI 连接配置，请检查配置目录写权限与磁盘；配置与密钥均未修改。".into(),
        );
    }
    match read_config() {
        Ok(current) if current == original_config => {}
        _ => {
            let _ = fs::remove_file(&temporary);
            return Err("当前 AI 连接配置在保存期间已变动或不可读；本次配置与密钥均未修改，请重新打开设置。".into());
        }
    }
    let key_changed = requested_key.as_ref().is_some_and(|secret| {
        if secret.is_empty() {
            original_key.is_some()
        } else {
            original_key.as_deref() != Some(secret.as_str())
        }
    });
    let restore_key = || match original_key.as_deref() {
        Some(secret) => platform::write(&credential_target, secret),
        None => platform::delete(&credential_target),
    };
    if key_changed {
        let changed = match requested_key.as_deref() {
            Some("") => platform::delete(&credential_target),
            Some(secret) => platform::write(&credential_target, secret),
            None => unreachable!(),
        };
        if let Err(error) = changed {
            let _ = fs::remove_file(&temporary);
            return match restore_key() {
                Ok(()) => Err(format!("AI 连接配置未保存，密钥修改失败，原系统凭据已恢复：{error}")),
                Err(restore_error) => Err(format!("AI 连接配置未保存，密钥修改和原凭据恢复均失败；系统凭据状态无法确认，请重新设置密钥。修改错误：{error}；恢复错误：{restore_error}")),
            };
        }
    }
    if let Err(error) = replace(&temporary, &config_path) {
        let _ = fs::remove_file(&temporary);
        if key_changed {
            return match restore_key() {
                Ok(()) => Err(format!("AI 连接配置未保存，原系统凭据已恢复：{error}")),
                Err(restore_error) => Err(format!("AI 连接配置未保存，且原系统凭据恢复失败；系统密钥可能已更改，请重新设置密钥。配置错误：{error}；恢复错误：{restore_error}")),
            };
        }
        return Err(format!("AI 连接配置未保存，系统密钥未修改：{error}"));
    }
    settings(directory).map_err(|error| {
        format!("AI 连接配置已保存，但无法读取保存后的凭据状态，请重新打开设置核对：{error}")
    })
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
