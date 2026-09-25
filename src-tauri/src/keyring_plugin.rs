use serde::Deserialize;

/// Tauri 2 desktop plugin — OS keyring commands (Hypit 尾声 ③,issue #4)。
///
/// P4 的第二密钥库("Tauri's OS keychain")的 Rust 侧:三个 command,配
/// services/desktop.ts 的 `createKeyringStore`(同形契约:keyring_get /
/// keyring_set / keyring_delete,slot ∈ minimax/fal/gemini/deepseek/asr)。
///
/// ⚠️ 本文件**有意未接线**:本开发机无 rustc/cargo,无法编译验证——按
/// 「拒绝而非钳制」,不把编译不过的代码静默塞进构建。激活(在有 Rust 工具链
/// 的环境,三步):
///   1. src-tauri/Cargo.toml 追加依赖:
///        keyring = "3"
///   2. src-tauri/src/main.rs 声明模块并在 invoke_handler 挂上:
///        mod keyring_plugin;
///        .invoke_handler(tauri::generate_handler![
///            /* …existing…, */
///            keyring_plugin::keyring_get,
///            keyring_plugin::keyring_set,
///            keyring_plugin::keyring_delete,
///        ])
///   3. 前端在 Tauri 运行时用 services/desktop.ts 的
///      resolveCredentialStore(invoke, sessionStore) 选用 keyring 后端;
///      浏览器路径零改动(session fallback 自动兜底)。
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
