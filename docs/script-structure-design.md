# 剧本结构设计:导演级镜头字段(Express / Pro)

> 版本 v1(待站长审) · 2026-09-24 · 状态:**仅设计,未动代码**
> 核心问题(站长):AI 生成剧本时不知道需要 motionPrompt / shotDuration / 首尾帧 / 角色绑定——每次生成的剧本都缺导演级镜头语言,全靠人在工作台手补。

---

## 0. 根因与设计原则

**根因**:块模型只有 `content`(+事后补的 `imagePrompt`);四类生成入口(FROM_PROMPT / CONTINUE / Alt+S / Alt+G)的 prompt 契约里**根本没有导演字段的定义**,模型自然不输出;解析器(`acceptAISuggestion` / `scriptParse`)也不认识它们。

**五条设计原则**:
1. **字段上块**:新字段全部挂 `ScriptBlock`,随导出/云同步/导入自然携带,不建 screenplay 级新表。
2. **行标签可解析**:AI 仍输出 `[TAG]` 行格式(现有解析器复用),不用 JSON 块——行格式与 `parseTypedLines` / `acceptAISuggestion` 的容错路径兼容,JSON 极易碎。
3. **缺省可推导**:每个新字段有确定性默认值(`blockDirectorFill` 后处理),任何来源(旧稿/AI/导入)读入即合法;AI 输出缺字段不是错误。
4. **模式分层**:Express 四字段进所有生成契约;Pro 增量(speaker/graybox 对齐/SHOT_LIST)只进 Pro 侧 prompt 与校验。解析器一律接受全部字段——多余字段存着不丢。
5. **schema 显式化**:`screenplay.schemaVersion`(旧稿=1,新稿=2);v1 不做一次性迁移,消费方惰性兜底(§5)。

## 1. Express 块 schema(新增四字段)

```ts
interface ScriptBlock {
  // ……现有字段不变(content/type/imagePrompt/graybox/imageResult/dubEmotion)
  motionPrompt?: string;    // 画面内什么在动——I2V 的运动提示
  shotDuration?: number;    // 镜头总时长(秒);H3 窗口 clamp 4–15;Pro 被 TTS 下限抬升
  firstFrameDesc?: string;  // 首帧瞬间描述(首帧生成的画面前提)
  lastFrameDesc?: string;   // 尾帧瞬间描述(空=由 motionPrompt 隐式承担)
}
```

**消费方(写完就要有人用,不做死字段)**:

| 字段 | 消费点 | 现状 → 改后 |
|---|---|---|
| motionPrompt | ExpressWorkbench I2V prompt | 用 imagePrompt → **motionPrompt 优先**,imagePrompt 兜底 |
| shotDuration | 工作台片段时长 | 全局固定 5s 选择 → **逐镜头**,全局选择退为缺省兜底 |
| firstFrameDesc | 首帧生成 prompt | 仅 imagePrompt → **imagePrompt(构图/风格)+ firstFrameDesc(瞬间)** 组合 |
| lastFrameDesc | v1 存储;Pro 一致性校验/未来尾帧图 | 无 |

**AI 输出行格式(Express)**——新增四个标签,附着到最近的可生成块(ACTION / CHARACTER / SCENE_HEADING):

```
[SCENE] 内. 茶馆 - 夜
[ACTION] 00:00-00:03。刀客推门而入,雨声灌进屋
[MOTION] 门扇急摆,雨水顺檐滴落,刀客收伞甩水,灯火在水洼里晃
[DURATION] 3
[FIRST] 刀客立于门口,伞尖点地,水洼倒映灯火
[LAST] 刀客三步进店,门在身后合拢
[CHARACTER] 刀客
[DIALOGUE] 你的刀很快。
[PARENTHETICAL] (冷冷地)
```

标签映射:`[MOTION]→motionPrompt`、`[DURATION]→shotDuration`、`[FIRST]→firstFrameDesc`、`[LAST]→lastFrameDesc`。

**默认值规则(defaultFiller,确定性、零 AI)**:

| 字段 | 缺省推导 |
|---|---|
| motionPrompt | content 去时间戳前缀后的首句动词短语;仍无 → imagePrompt;再无 → content |
| shotDuration | 节拍时间戳宽度(`00:00-00:03`→3);无时间戳 → 5 |
| firstFrameDesc | imagePrompt;无 imagePrompt → content + StyleHead 场景词 |
| lastFrameDesc | 不填(空是合法状态——单向运动由 motionPrompt 隐式表达) |

## 2. Pro 增量

### 2.1 refBindings 分类对齐(命名统一,不改模型)
站长口径「主 / 变体 / PROP / SCENE」与现有 RefImage v4 身份模型一一对应,**只统一 UI/文档命名**:

| 站长口径 | 现有模型 |
|---|---|
| 主(角) | kind=character,无 variant |
| 变体 | kind=character + variant(战损/浴袍…),sceneOverride 可覆盖 |
| PROP | kind=prop |
| SCENE | kind=environment(+sceneKey) |
| (第五类)风格 | StyleHead,全局生效,已有 |

### 2.2 speaker 字段(DIALOGUE 必标说话人)
- 块新增 `speaker?: string`(base name;画外=`名(画外)`)。
- 生成契约:DIALOGUE 上方必须 `[CHARACTER]` cue(现有规则),解析时**自动回填** speaker= 最近 cue。
- 后处理校验:DIALOGUE 无 speaker → `warning`(列表提示补 cue),不阻塞、不猜人。

### 2.3 TRANSITION 块类型
- `BlockType.TRANSITION` **已存在**(模板/解析器均支持)——本设计只补语义:可选 `transitionTo?: string`(目标,如「夜 – 次日」/「CUT TO: 内. 浴室」)。
- FROM_PROMPT / CONTINUE 契约:场景跳切/时间跳跃处输出 `[TRANSITION]`,硬切可省(省=隐式切)。

### 2.4 SHOT_LIST(纯推导,零存储)
新增只读视图 `deriveShotList(screenplay): ShotListEntry[]`,供音轨面板/导出/未来 H3 提交复用:

```
ShotListEntry = {
  shot, blockIds, sceneHeading,
  cast: string[],                     // ← beatCast(现有)
  refs: { sheets, variants, sceneEnv }, // ← resolveSegmentRefs(现有)
  motionPrompt, duration(shotDuration 或时间戳), frames: { first, last },
  graybox?: GrayboxData,              // ← 段级 graybox(现有,Pro)
}
```
= Express 字段 + Pro 绑定的汇编,**不新增持久化**。

## 3. AI 生成侧改造

### 3.1 输出契约共享化
新增常量 `DIRECTOR_SCHEMA_RULES`(一份,四处拼接,杜绝漂移):标签表 + 语义(motionPrompt=画面内运动而非画面描述;firstFrameDesc=第一个可辨瞬间;lastFrameDesc=收束瞬间)+ 完整块组 few-shot 一个。

### 3.2 各入口改造
| 入口 | 改造 |
|---|---|
| **Alt+S**(STORYBOARD) | 输出从单条 imagePrompt 扩为四元组:imagePrompt(现有六要素不变)+ [MOTION] + [FIRST] + [LAST];写回处分别落四个字段(现在只写 imagePrompt) |
| **Alt+G**(GRAYBOX) | 运镜约束对齐:block graybox `movement.duration` 与块 shotDuration 一致;段级 graybox duration=Σ shotDuration |
| **FROM_PROMPT** | 规则 2 块格式追加四个标签(输入有则转写、无则省略→后处理补);时间戳与 [DURATION] 并存时**时间戳为准**;[CHARACTER] cue 后 DIALOGUE 保持 verbatim(规则 7 不动) |
| **CONTINUE** | 续写块跟随同一契约;上下文窗口里的既有块已带字段,模型自然模仿 |

### 3.3 后处理管线(新 `utils/blockDirectorFill.ts`)

```
parseTypedLines(扩展:[MOTION]/[DURATION]/[FIRST]/[LAST] 附着最近可生成块)
 → 台词自动拆分:ACTION/CHARACTER 行匹配 ^(NAME|[NAME（…）]):\s*(.+)$ 且 NAME∈collectCharacterNames
    → 拆为 [CHARACTER] + [DIALOGUE](站长指定项)
 → speaker 回填(最近 cue)
 → defaultFiller(§1 默认值规则)
 → sanitizeParsedBlocks(现有,保持最后)
```

接入点:`acceptAISuggestion`(CONTINUE/FROM_PROMPT 插入路径)、`screenplayFromPrompt`、Alt+S 写回处。

## 4. 迁移与兼容

- 旧稿 = schemaVersion 缺失:**不迁移文件**;消费方惰性兜底(工作台读 `motionPrompt ?? derive(content)`)。
- `schemaVersion: 2` 在新生成/新保存时写入。
- 设置页提供「补全导演字段」按钮(**v2**,先纯默认值后可选 AI 补全)——开放问题 §6.3。
- 云同步/导出:字段随 JSON 自然携带;旧客户端忽略新字段(向前兼容)。

## 5. 分阶段实施(审后执行,每步门禁照旧)

1. **数据+解析层**:types 四字段+speaker/transitionTo/schemaVersion;parseTypedLines 扩展;blockDirectorFill(拆分/回填/defaultFiller);单测(解析/拆分/填充)。
2. **生成侧**:DIRECTOR_SCHEMA_RULES + 四入口注入;Alt+S 写回四字段;FROM_PROMPT/CONTINUE 契约更新。
3. **消费侧**:ExpressWorkbench 改读 motionPrompt/shotDuration/firstFrameDesc;deriveShotList util + ProAudioPanel 展示 SHOT_LIST;DIALOGUE speaker 校验列表。
4. **(可选)v2**:lastFrameDesc 双图一致性校验;「AI 补全导演字段」按钮。

## 6. 开放问题(请站长拍板)

1. `[DURATION]` 允许小数秒吗?(建议:允许,提交时由 fitSegmentSeconds 拟合取整)
2. lastFrameDesc 非空时,v1 是否做首尾帧一致性校验(两图生成+比对)?(建议:v1 仅存字段,校验 v2)
3. 旧稿补全:纯默认值即可,还是提供「AI 补全导演字段」入口?(建议:先纯默认,AI 补全后置)
4. speaker 是否需要编辑器 UI(对白行徽章显示说话人)?(建议:先数据层+校验列表,行内 UI 后置)

---
*设计:Claude Code agent · 2026-09-24*

---

## 实施状态(2026-09-24,站长批准后执行)

| 阶段 | 状态 | 内容 |
|---|---|---|
| §5-1 数据+解析层 | ✅ | types 四字段+speaker/transitionTo/schemaVersion;parseLabeledLine/attachDirectorTag/parseLabeledScript;blockDirectorFill(台词自动拆分[站长指定项]/speaker 回填/defaultFiller);20 个新单测。顺带修复继承缺陷:ALL-CAPS cue 启发式要求拉丁字母(CJK 对 toUpperCase 恒等,短中文动作行被误判) |
| §5-2 生成侧 | ✅ | DIRECTOR_SCHEMA_RULES 共享契约注入四入口;FROM_PROMPT 规则 2 扩展四标签(缺省省略);Alt+S ACTION 输出九行 + splitImagePromptParts 分离四字段写回(schemaVersion 2);Alt+G durationHint 钉住块 shotDuration |
| §5-3 消费侧 | ✅ | ExpressWorkbench:I2V 用 motionPrompt、时长用 shotDuration、首帧组合 firstFrameDesc;deriveShotList + ProAudioPanel SHOT_LIST 分区;speaker 缺失校验列表 |
| §6 开放问题 | 按建议口径 | DURATION 允许小数;lastFrameDesc v1 仅存;旧稿纯默认值;speaker 先数据层 |

**遗留**:lastFrameDesc 双图一致性校验(v2)、「AI 补全导演字段」按钮(v2)、speaker 行内 UI(v2)。
