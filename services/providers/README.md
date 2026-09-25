# Providers — 接入一个新服务商（P4）

三层契约（`types.ts`）：

- **Model** = 请求语义 + 边界（越界 `supports()` **拒绝并说明**，绝不静默钳制）
- **Provider** = 一个服务商如何履约（HTTP 映射 / ComfyUI 图…）
- **Endpoint** = 配置实例（地址 + 凭证引用 + 容量），由 `storyflow.runtime.json` 绑定能力

## 五步接入

1. 复制 `testing.ts` 为 `my-service.ts`，声明 `id / label / capabilities / deployment`；
2. 实现能力方法（`submitVideo`/`pollVideo`/`generateImage`/`chat`/`transcribe` 按需）；
3. `supports()` 写清模型边界——拒绝要给理由（例：`H3 单段输出 4–15s，收到 20s`）；
4. 在 `index.ts` 的 `defaultRegistry()` 注册（项目自有 Provider 在项目包里注册）；
5. `storyflow.runtime.json` 里配置 endpoint 并绑定能力：

```json
{
  "format": "storyflow.runtime@1",
  "endpoints": {
    "minimax.intl": { "use": "minimax", "config": { "baseUrl": "https://api.minimax.io" }, "credential": { "slot": "minimax" } }
  },
  "bindings": { "video.generate": "minimax.intl" }
}
```

换服务商 = 改这个文件，**代码零改动**。同一能力两个 endpoint 不绑定 → 提交被拒并指名二者；请求失败不自动改道。

## 密钥

`credential.slot` 指向会话凭证库（`services/credentials.ts`）的命名槽位——**Profile 永不含密钥值**。
密钥只存会话内存；跨会话用口令加密的凭证文件导入/导出。日志经 `redactSecrets` 脱敏。

## deployment 声明（CORS 研究落点）

| 值 | 含义 | 例子 |
|---|---|---|
| `direct` | 浏览器直连可用 | MiniMax、FAL、Gemini、DeepSeek、Groq ASR |
| `proxy` | 需代理（浏览器 CORS 受限） | *（预留：经网关的服务）* |
| `self-hosted` | 自托管服务 | ComfyUI |

把实测结论写进 `deploymentNote`（哪个域、何时验证、走什么代理）。
