# API 直连调研：火山方舟（Seedance 2.5）vs MiniMax H3 —— BYOK 浏览器直连可行性

调研日期：2026-09-01/02 · 方法：官方文档多镜像交叉验证（Ark 文档为 JS 渲染 SPA 无法直读，经 BytePlus 同编号文档、Apifox/API易/302.AI/Zenlayer 等转载核对）+ **CORS 直接实测**（OPTIONS 预检 + 无鉴权请求观察响应头；未调用任何付费接口）。

## 结论速览

| 平台 | 浏览器直连 | 关键依据 |
|---|---|---|
| **MiniMax H3** | ✅ **可行** | 实测三个关键端点（创建/查询/上传）实际响应均带 ACAO 且允许 Authorization 头；参考视频可 base64 或 `/v1/files/upload` 直传，全链路无需后端 |
| **火山方舟 Seedance 2.5** | ❌ **需代理** | 实测预检通过但实际响应无 ACAO（社区证据一致：NextChat #5069、one-api #1436 等）；且参考视频**只收公网 URL**——本地白模视频还需对象存储中转 |
| 即梦消费端 | 无官方 API | API 通道即 Ark（dreamina-* 模型）；GitHub 逆向反代违反 ToS 不采用 |

## 核心参数对比

| 维度 | Ark Seedance 2.5 | MiniMax H3 |
|---|---|---|
| 参考视频 | `role: reference_video`，仅公网 URL | `role: reference_video`，URL/base64/`mm_file://` 三选一 |
| 参考图 | ≤30 张（URL/base64） | ≤9 张；混合素材总上限 12 文件 |
| 视频限制 | ≤10 段（2.5 分档细节未公开；2.0 为单段 2–15s 总 ≤15s） | ≤3 段、单文件 ≤50MB、单段 2–15s、总 ≤15s、MP4/MOV |
| 输出 | 4–30s / 480–1080p / 24fps | 4–15s / 768P·2K / 24fps 原生双声道 |
| 异步 | `POST contents/generations/tasks` → 轮询 `tasks/{id}`；结果 URL 24h 有效 | `POST /v2/video_generation` → 轮询 `/v2/query/...`（10s 间隔） |
| 鉴权 | `Bearer ARK_API_KEY`（cn-beijing；海外 BytePlus 不互通） | `Bearer key`（CN api.minimaxi.com / 国际 api.minimax.io） |
| 定价 | token 计费：含视频输入 42 元/M tokens；720p ≈ 1.51 元/s | 768P 0.50 元/s、2K 0.80 元/s；**输入视频按同价计费**；图 >5 张 0.20 元/张 |
| 延迟 | 720p/5s 约 90–140s | 官方 H3 5s/768p 约 1.5 分钟；2K 数分钟 |

## 对 StoryFlow 的落地判定

1. **H3 通道可以做成真浏览器 BYOK**：用户填 Key → `/v1/files/upload` 传白模视频（≤50MB，拿 `mm_file://{file_id}`）→ `POST /v2/video_generation`（提示词用现有 H3 模板）→ 10s 轮询 → 下载 `content.url`。注意事项：输入视频按秒计费（768P 档 0.5 元/s，一段 5s 白模≈2.5 元输入成本）；请求体 base64 会膨胀 33%，走上传端点更稳。
2. **Seedance 2.5 维持现有手动工作流**：`storyflow_generate_video_prompt` 出提示词 + 用户手动上传即梦——这正是当前实现，调研证明它是无后端架构下的正解。未来若提供可选自建代理（nginx 反代 Ark + 对象存储），再升级为直连。
3. **模型 ID 待控制台核对**：`doubao-seedance-2-5-260628` 为多源二手信息，接入前在方舟「开通管理」页核实；2.5 公测档或需企业认证（个人开发者可用 2.0 系列）。

## 主要证据

- Ark：[创建任务](https://www.volcengine.com/docs/82379/1520757) · [查询](https://www.volcengine.com/docs/82379/1521309) · [Seedance 2.5 教程](https://www.volcengine.com/docs/82379/2607688) · [Key 管理](https://www.volcengine.com/docs/82379/1541594) · [定价](https://www.volcengine.com/docs/82379/1544106) · [ByteDance 发布博客（白模参考）](https://seed.bytedance.com/zh/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5) · [BytePlus 镜像](https://docs.byteplus.com/en/docs/ModelArk/1520757)
- CORS 佐证：[NextChat #5069](https://github.com/ChatGPTNextWeb/NextChat/issues/5069) · [知乎 Seedream 代理实践](https://zhuanlan.zhihu.com/p/1955592234406768773) · [one-api #1436](https://github.com/songquanpeng/one-api/issues/1436)
- MiniMax：[创建 API（OpenAPI 原文）](https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create) · [视频生成指南](https://platform.minimaxi.com/docs/guides/video-generation) · [文件上传](https://platform.minimaxi.com/docs/api-reference/file-management-upload) · [按量定价](https://platform.minimaxi.com/docs/guides/pricing-paygo)
- 延迟实测：[什么值得买 H3-Max](https://post.smzdm.com/p/arz65grz)

**残留不确定性**：① Ark 2xx 成功响应是否补发 ACAO 未付费验证（社区一致指向需代理）；② Seedance 2.5 参考视频逐段时长上限无公开文档；③ Ark 模型 ID 待控制台核对。
