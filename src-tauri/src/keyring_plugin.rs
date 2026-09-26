use serde::Deserialize;

/// Tauri 2 desktop plugin — OS keyring commands (Hypit 尾声 ③,issue #4)。
///
/// P4 的第二密钥库("Tauri's OS keychain")的 Rust 侧:三个 command,配
/// services/desktop.ts 的 `createKeyringStore`(同形契约:keyring_get /
/// keyring_set / keyring_delete,slot ∈ minimax/fal/gemini/deepseek/asr)。
///
/// 接线(issue #9 三档方案,档位①):main.rs 已 `mod keyring_plugin` 并在
/// invoke_handler 挂上三 command;Cargo.toml 已加 keyring = "3"。前端经
/// services/desktop.ts 的 createKeyringStore(invoke) 调用——命令名
/// keyring_get/set/delete 与 desktop.ts 契约一致。
///
/// ⚠️ 编译验证:开发机无 rustc/cargo,keyring = "3" 的 API 面(set_password
/// upsert 语义、delete_credential、Error::NoEntry)按 v3 文档写定;首次
/// cargo build 若有签名出入按编译器提示对齐即可——逻辑面已由
/// services/__tests__/desktop.test.ts 以命令契约锁定。
///
/// 安全口径(P4 不变):值只进 OS keyring,永不落 app 配置/日志;slot 名即
/// 服务身份,不含机密;错误如实上抛(调用侧降级到 session,不猜)。

#[derive(Deserialize)]
pub struct KeyringGetArgs {
    pub slot: String,
}

#[derive(Deserialize)]
pub struct KeyringSetArgs {
    pub slot: String,
    pub value: String,
}

#[derive(Deserialize)]
pub struct KeyringDeleteArgs {
    pub slot: String,
}

/// keyring crate 的 service 名——StoryFlow 命名空间,与 slot 二元组唯一。
const SERVICE: &str = "storyflow";

fn entry(slot: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, slot).map_err(|e| format!("keyring entry: {e}"))
}

#[tauri::command]
pub fn keyring_get(args: KeyringGetArgs) -> Result<Option<String>, String> {
    match entry(&args.slot)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring get {}: {e}", args.slot)),
    }
}

#[tauri::command]
pub fn keyring_set(args: KeyringSetArgs) -> Result<(), String> {
    let e = entry(&args.slot)?;
    // set_password 在已有条目上语义即 upsert(keyring v3);NoEntry 分支仅为
    // 兼容个别平台后端返回错误的情形。
    match e.set_password(&args.value) {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => e
            .set_password(&args.value)
            .map_err(|err| format!("keyring set {}: {err}", args.slot)),
        Err(err) => Err(format!("keyring set {}: {err}", args.slot)),
    }
}

#[tauri::command]
pub fn keyring_delete(args: KeyringDeleteArgs) -> Result<(), String> {
    match entry(&args.slot)?.delete_credential() {
        Ok(()) => Ok(()),
        // 删不存在的条目 = 已达目的,不是错误
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring delete {}: {e}", args.slot)),
    }
}
