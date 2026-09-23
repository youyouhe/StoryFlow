# 数据同步与隐私合理性 Review

> 日期:2026-09-23 · 基线:`refactor/split-app @ 773d848`(与 main @ e4deae0 在本议题相关代码上一致)
> 范围:services/{gallery,apiClient,syncEngine,auth4a,assetCloud,debugLog,minimaxService,falService,comfyService,geminiService} · hooks/useGallerySync.ts · 相关 UI 文案
> 方法:全量源码通读 + 触发链追踪。只 review,未改任何功能代码。

---

## 结论速览(直接回答站长两问)

**Q1:首次打开就好几个剧本,哪来的?**
最可能的机制链:**SSO 静默登录 → 全量拉取云端剧本**。设备上只要存在 4A `sso_token`(localStorage 残留、URL `?sso_token=` 捕获、或 smartbid 家族共享父域 cookie 回退),应用启动即自动换发画廊会话,随后 `syncEngine.onSignedIn() → pullAll()` 把该账号云端**全部剧本全文**下载到本地并写入侧边栏——全程零提示。Tauri 的 WebView localStorage 永久持久化,登录过一次,以后每次启动都静默复登。次要来源:多设备编辑产生的自动冲突分叉会以「xxx (云端冲突副本)」标题**静默新增本地剧本**。

**Q2:「没同意就同步、没登录就同步」成立吗?**
**成立,且是三个独立缺陷的叠加**:
1. **同步无同意门**:云同步(P1 上线起)从未有过开关或首启同意弹窗,登录即全自动(拉+推);
2. **「没登录」多数是错觉**:4A 跨产品共享 cookie 回退 + localStorage token 意味着用户可能已被静默登录(UI 只有侧边栏小徽章变化);真未登录时引擎不会上传(`markDirty` 对 never-synced 剧本不入队),但登出后 `sync_outbox` **不清空**,一旦(哪怕是静默)重新认证,排队内容即刻全部外发;
3. **静默程度高**:自动拉取/推送/冲突分叉没有任何 toast、首次提示或确认。

---

## 发现清单(每条:现状 / 风险 / 建议)

### F1 · SSO 静默自动登录(严重)
- **现状**:`auth4a.initSSO()` 每次启动从 URL → localStorage → **smartbid 父域共享 cookie** 三级恢复 token;`useGallerySync` 挂载即 `handleSSOExchange()` 换发画廊会话。用户在家族任一产品登录过,打开 StoryFlow 即为已登录态,无需任何操作。
- **风险**:跨产品身份联通未经本产品明示同意;用户「以为没登录」而实际已登录,直接导致 F2 的全量拉取。审计意义上属于未授权的身份使用。
- **建议**:保留 cookie 回退,但**不自动换发**——检测到 token 后弹「检测到 4A 账号(xxx@…),是否登录 StoryFlow 云同步?」一键确认;`sso_logged_out` 抑制逻辑保留。

### F2 · 登录后全量静默拉取 + 静默推送(严重)
- **现状**:`useGallerySync` 挂载 effect:已认证 → `syncEngine.onSignedIn()` = `pullAll()`(下载云端**全部**剧本全文,含 imagePrompt/graybox/sourcePrompt/服装绑定等完整 JSON)+ `flush()`(把 outbox 全部推上去)。无任何提示、进度或确认。
- **风险**:首次打开看到「凭空出现」的剧本即由此来;用户对哪些数据上了云、哪些被拉下来完全无感知;公共/共享设备上会把整库拉到本地。
- **建议**:首拉改为**询问式**——「云端发现 N 个剧本,拉取到本机?」(全部拉/只看不拉/取消);`flush()` 的自动推送仅对「用户曾显式点过同步的剧本」生效(现状已对 never-synced 如此,保持),首次推送任何剧本前给一次性 toast。

### F3 · 会话跨启动持久化 + 静默重连(中)
- **现状**:`gallery_auth`(含 refresh token)存 localStorage;`GalleryClient` 构造即恢复;token 失效自动单飞刷新。登出仅在用户点登出时发生。
- **风险**:「登录态」可以无限期跨启动延续,配合 F1/F2 构成持续静默同步;用户无「每次启动是否连接云端」的控制。
- **建议**:与 P0-1(同步总开关)联动:开关关闭时不恢复会话;或在设置中提供「退出登录并清除本机凭据」。
- 

### F4 · 登出不清 `sync_outbox`(中)
- **现状**:`clearToken()` 只删 sso token + cookie + 置登出标记;`sync_outbox`、`gallery_auth` 由 `galleryClient.logout()` 删,但 **outbox 保留**。重新认证后 `flush()` 立即补推登出期间排队的全部内容。
- **风险**:「登出了还在同步」的直接来源——数据在用户认为已断开的窗口期被暂存,并在其后的任一次静默登录(F1)时外发。
- **建议**:登出时清空 outbox(或弹「有 N 条待同步修改,登出将丢弃/保留?」);同时清 `gallery_auth` 的动作已有,保留。

### F5 · `shipLog` 无条件外发运行日志(中)
- **现状**:`debugLog.shipLog` 在**所有构建**里向同源 `/api/debug-log` POST:启动 ping(UA、屏幕分辨率、时间戳)+ 各功能区 warn/error(消息 + detail ≤500 字符,可能含 AI 返回的错误正文/内容片段)。生产同源部署(deploy.yaml)下这些请求打到画廊服务器(404 但载荷已送达);开发者注释自称「生产 404 静默忽略」,但**请求仍然发生**。Tauri 下该请求失败,无泄露。
- **风险**:未经同意的遥测;错误正文可能带用户内容片段;给生产服务器制造无主垃圾流量。
- **建议**:构建期开关(`import.meta.env.PROD` 直接短路,或 `VITE_ENABLE_SHIPLOG` 显式开启);生产默认零外发。

### F6 · AI 出站内容边界:产品固有,但 UI 零说明(中)
- **现状**(出站内容清单):
  - 文本 AI(Gemini/DeepSeek,BYOK):剧本块上下文(可配置窗口)→ Google/DeepSeek;
  - 生图(MiniMax image-01 或 FAL):分镜/角色提示词(含风格头、剧本文本派生)→ 对应服务商;FAL 默认模型 `openai/gpt-image-2.5/flare` → 内容经 fal.ai 到达 **OpenAI 下游**;
  - H3 视频(MiniMax):完整提示词 + **白模视频** + ≤9 张角色参考图 → MiniMax 云;ComfyUI 路径 → 用户自己的 pod(用户配置的第三方 GPU 云);
  - 以上全部 BYOK(key 存 localStorage `screenplay_app_settings`,浏览器直连,服务端不存 key)。
- **风险**:BYOK「用户自己填了 key」可视为对出站的隐含同意,但**设置页与生成按钮没有任何「内容将上传至 X」的说明**;普通用户(非站长)不了解 Fal→OpenAI 这条二跳。
- **建议**:Settings → AI 区加一段固定说明文案(「启用 AI 生成即表示知晓:相关文本/图像/白模视频将发送至所选服务商用于生成」);首次使用每个后端前一次性提示。

### F7 · 冲突自动分叉静默新增剧本(低)
- **现状**:推送 409 时本地自动创建「(云端冲突副本)」剧本,仅 emit 事件(useGallerySync 只刷新徽章,无用户提示)。
- **风险**:侧边栏「多出一个剧本」的第二来源,用户不知其来历。
- **建议**:分叉时 toast 说明「检测到云端更新,已保留副本《xxx (云端冲突副本)》」。

### F8 · Mock 后端也接受 SSO 换发(低,仅开发态)
- **现状**:未配置 `VITE_GALLERY_URL` 时用 `MockGalleryApi`,它也会用 sso_token 换出「4A Dev User」会话并存 localStorage。
- **风险**:开发/未部署构建里出现「已登录」假象,混淆排查(站长在 Windows 包里看到的登录态若来自 mock,云端其实不存在)。
- **建议**:mock 后端直接不实现 ssoExchange(抛错),设置页已展示后端类型,保留即可。

### F9 · 登出审计请求(低)
- **现状**:`clearToken()` 向同源 `/api/auth/logout` 发 Bearer 审计请求;Tauri 下同源无此路由,静默失败。
- **风险**:极低;仅为说明完整性列出。
- **建议**:无需处理,或加 `VITE_DISABLE_SSO` 同级的 Tauri 判定短路。

### F10 · 无「删除我的云端数据」入口(中)
- **现状**:云端数据只能逐剧本删(侧边栏删除会同时 soft-delete 云端副本);无「删除云端全部/导出全部」;参考图云资产(P3)可逐个删,无批量。
- **风险**:合规与信任面:用户无法一键收回数据。
- **建议**:账号面板加「导出云端全部 / 删除云端全部(二次确认)」。

---

## 数据边界总表(谁、发什么、到哪、何时)

| 通道 | 内容 | 目的地 | 触发 | 同意状态 |
|---|---|---|---|---|
| 云同步-推 | 剧本完整 JSON(含 AI 提示词/灰盒/源提示词/绑定) | 画廊服务器(BY 会话) | 已云化剧本编辑后 1.5s debounce;手动同步;重登 flush | 无门(F2/F4) |
| 云同步-拉 | 云端全部剧本全文 | 本机 | 启动且已认证 | 无门(F1/F2) |
| 资产云(P3) | 参考图原图+缩略图(sha256 去重) | 画廊服务器 | 用户在资产库显式点击 | ✅ 用户触发 |
| 文本 AI | 剧本块上下文 | Google / DeepSeek | 用户触发生成 | 隐含(BYOK),无文案(F6) |
| 生图 | 提示词 | MiniMax 或 fal.ai(→OpenAI 下游) | 用户触发生成 | 隐含,无文案(F6) |
| H3 视频 | 提示词+白模视频+参考图 | MiniMax 云 | 用户提交任务 | 隐含,无文案(F6) |
| 运行日志 | 启动 ping(UA/屏幕)、warn/error+detail≤500 | 同源 /api/debug-log | 无条件 | 无(F5) |
| 4A | sso_token 换发、登出审计 | 画廊 /auth、/api/auth/logout | 启动/登出 | 无明示(F1/F9) |

**设备标识**:无独立设备 ID。身份 = 4A `sso_token`(localStorage `sso_access_token` + 父域 cookie);本地键:`gallery_auth`(会话对)、`sync_{id}`(同步状态)、`sync_outbox`(待推队列)、`asset_cloud_map`(资产映射)、`sso_logged_out`(登出抑制,sessionStorage)。

**登出后的数据**:本地剧本/资产/H3 任务全保留;`sync_outbox` **保留**(见 F4);云端副本不动(仅删剧本时 soft-delete);`logoutEverywhere` 撤销全部 token。

---

## 最小整改方案(不改架构,按优先级)

**P0(本次必须)**
1. **同步总开关 + 首启同意**:Settings 加「云同步」开关(默认**关**);首次开启时弹窗明示三件事(拉取云端剧本到本机 / 已同步剧本的编辑将自动上传 / 登录方式为 4A 账号)。开关关闭时:`initSSO` 不做 cookie 回退、不换发、不恢复会话、不 pullAll、不 flush。
2. **pullAll 询问式**:首次检测到云端 N 个剧本时询问「拉取到本机?」(全部/取消),记住选择。
3. **shipLog 生产短路**:`import.meta.env.PROD` 下直接 return;需要生产日志时用显式构建开关。

**P1(紧随)**
4. 登出清空 `sync_outbox`(或征询保留)。
5. Settings → AI 区固定说明 + 各生成后端首次使用一次性提示(F6 文案)。
6. SSO cookie 回退改为「检测到账号,点击登录」确认式(F1)。

**P2(排期)**
7. 冲突分叉 toast;首次自动推送 toast。
8. 账号面板「导出/删除云端全部」。
9. mock 后端禁用 ssoExchange(F8)。

---

*Review:Claude Code agent · 2026-09-23 · 只读,未改功能代码;commit 仅本文档。*
