# 灰模解析结果 — Untitled_穿越_历史_2026-08-30 (3).json

剧本: Untitled 穿越 / 历史  | 模板: timetravel  | 语言: zh

灰模总数: 31 (scene: 10, shot: 21)

## 方向1 — 同标题 scene 灰模一致性

- `内. 宫廷寝殿 - 古代` ×1  对象数=11  布局一致=True
- `INT. 宫廷寝殿 - 日` ×9  对象数=11  布局一致=True
  - block idx=7  labels=[None, None, None, None, None, '床', '桌', '凳', '屏风', '门', '窗']
  - block idx=19  labels=[None, None, None, None, None, '床', '桌', '凳', '屏风', '门', '窗']
  - block idx=25  labels=[None, None, None, None, None, '床', '桌', '凳', '屏风', '门', '窗']
  - block idx=31  labels=[None, None, None, None, None, '床', '桌', '凳', '屏风', '门', '窗']
  - block idx=37  labels=[None, None, None, None, None, '床', '桌', '凳', '屏风', '门', '窗']
  - block idx=43  labels=[None, None, None, None, None, '床', '桌', '凳', '屏风', '门', '窗']
  - block idx=49  labels=[None, None, None, None, None, '床', '桌', '凳', '屏风', '门', '窗']
  - block idx=55  labels=[None, None, None, None, None, '床', '桌', '凳', '屏风', '门', '窗']
  - block idx=61  labels=[None, None, None, None, None, '床', '桌', '凳', '屏风', '门', '窗']

## 方向A+B — shot 运镜/景别分布

shot 总数: 21
运镜: {'tilt': 3, 'dolly': 10, 'handheld': 1, 'static': 5, 'orbit': 1, 'tracking': 1}  → dolly 10/21 (48%)
景别: {'close-up': 9, 'over-the-shoulder': 6, 'medium': 4, 'pov': 1, 'extreme-close-up': 1}

## 逐块灰模详情 (仅有灰模的块, 按剧本顺序)

### block idx=0  type=SCENE_HEADING
**内容**: 内. 宫廷寝殿 - 古代
**kind**: scene  **error**: 无

**布局对象** (11):

| # | type | role | label | position | size |
|---|------|------|-------|----------|------|
| 0 | plane | floor | — | (0, 0, 0) | (8, 0.01, 6) |
| 1 | plane | ceiling | — | (0, 3.5, 0) | (8, 0.01, 6) |
| 2 | box | wall | — | (0, 1.75, -2.9) | (8, 3.5, 0.2) |
| 3 | box | wall | — | (0, 1.75, 2.9) | (8, 3.5, 0.2) |
| 4 | box | wall | — | (3.9, 1.75, 0) | (0.2, 3.5, 6) |
| 5 | box | wall | — | (-3.9, 1.75, 0) | (0.2, 3.5, 6) |
| 6 | box | furniture | 龙床 | (0, 0.3, -1.8) | (3, 0.6, 2.5) |
| 7 | box | furniture | 屏风 | (2.8, 1, -1.5) | (0.1, 2, 1.8) |
| 8 | box | furniture | 案几 | (0, 0.25, 0.8) | (1.2, 0.5, 0.8) |
| 9 | cylinder | prop | 烛台 | (1, 0.45, 0.8) | (0.2, 0.9, 0.2) |
| 10 | plane | prop | 地毯 | (0, 0.01, 0.3) | (4, 0.01, 3) |

**角色走位**: 无

---

### block idx=1  type=ACTION
**内容**: 萧萧头痛欲裂地醒来。她看着自己的手——纤细，戴着玉镯。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: close-up
- position: (0.8, 1, -1.5)
- lookAt: (0, 0.5, -1.9)
- focus: 萧萧的手
- movement.type: tilt
- movement.duration: 3s
- movement.path (机身轨迹): (0.8, 1, -1.5) → (0.8, 1, -1.5)
- movement.lookPath (镜头轨迹): (0, 0.5, -1.9) → (0.3, 0.5, -1.3)

---

### block idx=3  type=DIALOGUE
**内容**: 公主！您终于醒了！皇上在等您。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: over-the-shoulder
- position: (-0.2, 1, -2)
- lookAt: (0.3, 1.6, -0.8)
- focus: 侍女
- movement.type: dolly
- movement.duration: 2.5s
- movement.path (机身轨迹): (-0.2, 1, -2) → (-0.2, 1, -1.5)
- movement.lookPath (镜头轨迹): —

---

### block idx=6  type=DIALOGUE
**内容**: 皇上？我刚才还在开董事会...
**kind**: shot  **error**: 无

**摄影机**:
- shotType: close-up
- position: (0.8, 1.2, -0.9)
- lookAt: (0, 1.2, -1.8)
- focus: 萧萧
- movement.type: dolly
- movement.duration: 3s
- movement.path (机身轨迹): (0.8, 1.2, -0.9) → (0.3, 1.2, -1.3)
- movement.lookPath (镜头轨迹): —

---

### block idx=7  type=SCENE_HEADING
**内容**: INT. 宫廷寝殿 - 日
**kind**: scene  **error**: 无

**布局对象** (11):

| # | type | role | label | position | size |
|---|------|------|-------|----------|------|
| 0 | box | floor | — | (0, 0, 0) | (10, 0.1, 10) |
| 1 | box | wall | — | (0, 1.5, -5) | (10, 3, 0.2) |
| 2 | box | wall | — | (0, 1.5, 5) | (10, 3, 0.2) |
| 3 | box | wall | — | (-5, 1.5, 0) | (0.2, 3, 10) |
| 4 | box | wall | — | (5, 1.5, 0) | (0.2, 3, 10) |
| 5 | box | furniture | 床 | (0, 0.25, -3) | (2, 0.5, 3) |
| 6 | box | furniture | 桌 | (0, 0.15, 0.5) | (1, 0.3, 1) |
| 7 | box | furniture | 凳 | (-1, 0.2, 0.5) | (0.4, 0.4, 0.4) |
| 8 | box | furniture | 屏风 | (-2, 1.2, -2) | (2, 2.4, 0.1) |
| 9 | box | door | 门 | (0, 1.5, 4.9) | (1.5, 3, 0.1) |
| 10 | box | window | 窗 | (4.9, 1.5, 0) | (0.1, 1.5, 1) |

**角色走位**: 无

---

### block idx=8  type=ACTION
**内容**: 萧萧猛地坐起身，环顾四周。雕花木梁、纱帐、青铜香炉——完全陌生的环境。她捏了一下自己的脸颊，疼。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: medium
- position: (1.2, 1.2, -1.8)
- lookAt: (0, 1.1, -3)
- focus: 萧萧
- movement.type: handheld
- movement.duration: 6s
- movement.path (机身轨迹): (1.2, 1.2, -1.8) → (1.22, 1.21, -1.79) → (1.18, 1.2, -1.82) → (1.2, 1.2, -1.8)
- movement.lookPath (镜头轨迹): (0, 1.1, -3) → (0, 2.5, -4) → (4.9, 1.5, 0) → (-2, 1.2, -2) → (0.5, 1, -2.9)

---

### block idx=10  type=DIALOGUE
**内容**: 不是做梦...这布局风格，根本不是我那个写字楼的顶楼会议室。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: close-up
- position: (0, 1.2, -1.5)
- lookAt: (0, 1.2, -2.8)
- focus: 萧萧
- movement.type: dolly
- movement.duration: 4s
- movement.path (机身轨迹): (0, 1.2, -1.5) → (0, 1.2, -2)
- movement.lookPath (镜头轨迹): —

---

### block idx=19  type=SCENE_HEADING
**内容**: INT. 宫廷寝殿 - 日
**kind**: scene  **error**: 无

**布局对象** (11):

| # | type | role | label | position | size |
|---|------|------|-------|----------|------|
| 0 | box | floor | — | (0, 0, 0) | (10, 0.1, 10) |
| 1 | box | wall | — | (0, 1.5, -5) | (10, 3, 0.2) |
| 2 | box | wall | — | (0, 1.5, 5) | (10, 3, 0.2) |
| 3 | box | wall | — | (-5, 1.5, 0) | (0.2, 3, 10) |
| 4 | box | wall | — | (5, 1.5, 0) | (0.2, 3, 10) |
| 5 | box | furniture | 床 | (0, 0.25, -3) | (2, 0.5, 3) |
| 6 | box | furniture | 桌 | (0, 0.15, 0.5) | (1, 0.3, 1) |
| 7 | box | furniture | 凳 | (-1, 0.2, 0.5) | (0.4, 0.4, 0.4) |
| 8 | box | furniture | 屏风 | (-2, 1.2, -2) | (2, 2.4, 0.1) |
| 9 | box | door | 门 | (0, 1.5, 4.9) | (1.5, 3, 0.1) |
| 10 | box | window | 窗 | (4.9, 1.5, 0) | (0.1, 1.5, 1) |

**角色走位**: 无

---

### block idx=20  type=ACTION
**内容**: 萧萧深吸一口气，强行压下慌乱。她赤脚走到铜镜前，看到镜中一张陌生却精致的脸，眉间带着一丝与她本人相似的倔强。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: pov
- position: (-1, 1.6, 1)
- lookAt: (-4.9, 1.4, 0)
- focus: Xiao Xiao
- movement.type: dolly
- movement.duration: 4s
- movement.path (机身轨迹): (-1, 1.6, 1) → (-4, 1.6, 0)
- movement.lookPath (镜头轨迹): —

---

### block idx=23  type=DIALOGUE
**内容**: 穿越？还是综艺整蛊？先确认朝代，再确认身份。我不能慌。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: over-the-shoulder
- position: (0.5, 1.5, -1.2)
- lookAt: (0, 1.5, 0.5)
- focus: Xiao Xiao
- movement.type: static
- movement.duration: 3s
- movement.path (机身轨迹): (0.5, 1.5, -1.2)
- movement.lookPath (镜头轨迹): —

---

### block idx=25  type=SCENE_HEADING
**内容**: INT. 宫廷寝殿 - 日
**kind**: scene  **error**: 无

**布局对象** (11):

| # | type | role | label | position | size |
|---|------|------|-------|----------|------|
| 0 | box | floor | — | (0, 0, 0) | (10, 0.1, 10) |
| 1 | box | wall | — | (0, 1.5, -5) | (10, 3, 0.2) |
| 2 | box | wall | — | (0, 1.5, 5) | (10, 3, 0.2) |
| 3 | box | wall | — | (-5, 1.5, 0) | (0.2, 3, 10) |
| 4 | box | wall | — | (5, 1.5, 0) | (0.2, 3, 10) |
| 5 | box | furniture | 床 | (0, 0.25, -3) | (2, 0.5, 3) |
| 6 | box | furniture | 桌 | (0, 0.15, 0.5) | (1, 0.3, 1) |
| 7 | box | furniture | 凳 | (-1, 0.2, 0.5) | (0.4, 0.4, 0.4) |
| 8 | box | furniture | 屏风 | (-2, 1.2, -2) | (2, 2.4, 0.1) |
| 9 | box | door | 门 | (0, 1.5, 4.9) | (1.5, 3, 0.1) |
| 10 | box | window | 窗 | (4.9, 1.5, 0) | (0.1, 1.5, 1) |

**角色走位**: 无

---

### block idx=26  type=ACTION
**内容**: 萧萧转身，目光如面试官般锐利，盯着跪地的侍女连珠炮发问。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: over-the-shoulder
- position: (1, 0.8, -0.5)
- lookAt: (-1, 1.6, 0.5)
- focus: 萧萧
- movement.type: static
- movement.duration: 3s
- movement.path (机身轨迹): (1, 0.8, -0.5)
- movement.lookPath (镜头轨迹): —

---

### block idx=28  type=DIALOGUE
**内容**: 现在是什么年号？皇帝的名讳是什么？我——我是谁？
**kind**: shot  **error**: 无

**摄影机**:
- shotType: close-up
- position: (1, 1.5, 0)
- lookAt: (0, 1.6, -1)
- focus: 萧萧
- movement.type: dolly
- movement.duration: 3s
- movement.path (机身轨迹): (1, 1.5, 0) → (0.8, 1.55, -0.2) → (0.6, 1.6, -0.5)
- movement.lookPath (镜头轨迹): —

---

### block idx=31  type=SCENE_HEADING
**内容**: INT. 宫廷寝殿 - 日
**kind**: scene  **error**: 无

**布局对象** (11):

| # | type | role | label | position | size |
|---|------|------|-------|----------|------|
| 0 | box | floor | — | (0, 0, 0) | (10, 0.1, 10) |
| 1 | box | wall | — | (0, 1.5, -5) | (10, 3, 0.2) |
| 2 | box | wall | — | (0, 1.5, 5) | (10, 3, 0.2) |
| 3 | box | wall | — | (-5, 1.5, 0) | (0.2, 3, 10) |
| 4 | box | wall | — | (5, 1.5, 0) | (0.2, 3, 10) |
| 5 | box | furniture | 床 | (0, 0.25, -3) | (2, 0.5, 3) |
| 6 | box | furniture | 桌 | (0, 0.15, 0.5) | (1, 0.3, 1) |
| 7 | box | furniture | 凳 | (-1, 0.2, 0.5) | (0.4, 0.4, 0.4) |
| 8 | box | furniture | 屏风 | (-2, 1.2, -2) | (2, 2.4, 0.1) |
| 9 | box | door | 门 | (0, 1.5, 4.9) | (1.5, 3, 0.1) |
| 10 | box | window | 窗 | (4.9, 1.5, 0) | (0.1, 1.5, 1) |

**角色走位**: 无

---

### block idx=32  type=ACTION
**内容**: 侍女吓得脸色苍白，以为公主落水后伤了头脑。她慌忙抬头，眼眶泛红。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: close-up
- position: (0, 0.9, -1.2)
- lookAt: (0, 1, -2)
- focus: 侍女
- movement.type: tilt
- movement.duration: 1s
- movement.path (机身轨迹): (0, 0.9, -1.2)
- movement.lookPath (镜头轨迹): (0, 1, -2) → (0, 1.4, -2)

---

### block idx=34  type=DIALOGUE
**内容**: 公主您别吓奴婢！您是明月公主，圣上最宠的女儿。今年是景和三年啊！
**kind**: shot  **error**: 无

**摄影机**:
- shotType: over-the-shoulder
- position: (-0.4, 1.2, -3.5)
- lookAt: (0, 0.9, -2.5)
- focus: 侍女
- movement.type: dolly
- movement.duration: 3s
- movement.path (机身轨迹): (-0.4, 1.2, -3.5) → (-0.2, 1.2, -3.1)
- movement.lookPath (镜头轨迹): —

---

### block idx=37  type=SCENE_HEADING
**内容**: INT. 宫廷寝殿 - 日
**kind**: scene  **error**: 无

**布局对象** (11):

| # | type | role | label | position | size |
|---|------|------|-------|----------|------|
| 0 | box | floor | — | (0, 0, 0) | (10, 0.1, 10) |
| 1 | box | wall | — | (0, 1.5, -5) | (10, 3, 0.2) |
| 2 | box | wall | — | (0, 1.5, 5) | (10, 3, 0.2) |
| 3 | box | wall | — | (-5, 1.5, 0) | (0.2, 3, 10) |
| 4 | box | wall | — | (5, 1.5, 0) | (0.2, 3, 10) |
| 5 | box | furniture | 床 | (0, 0.25, -3) | (2, 0.5, 3) |
| 6 | box | furniture | 桌 | (0, 0.15, 0.5) | (1, 0.3, 1) |
| 7 | box | furniture | 凳 | (-1, 0.2, 0.5) | (0.4, 0.4, 0.4) |
| 8 | box | furniture | 屏风 | (-2, 1.2, -2) | (2, 2.4, 0.1) |
| 9 | box | door | 门 | (0, 1.5, 4.9) | (1.5, 3, 0.1) |
| 10 | box | window | 窗 | (4.9, 1.5, 0) | (0.1, 1.5, 1) |

**角色走位**: 无

---

### block idx=38  type=ACTION
**内容**: 萧萧内心翻江倒海。景和三年——她读过那么多史书，这个年号在正史里根本不存在。她终于确认了自己掉进了真正的异时空。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: close-up
- position: (0, 1.6, 1.8)
- lookAt: (0, 1.6, 1)
- focus: 萧萧
- movement.type: dolly
- movement.duration: 4s
- movement.path (机身轨迹): (0, 1.6, 1.8) → (0, 1.6, 1.4)
- movement.lookPath (镜头轨迹): —

---

### block idx=41  type=DIALOGUE
**内容**: 景和三年...查无此年。我不仅换了时空，还掉进了一个正史野史都没记载的平行世界。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: extreme-close-up
- position: (0.2, 1.65, 1.5)
- lookAt: (0, 1.6, 1)
- focus: 萧萧
- movement.type: static
- movement.duration: 3s
- movement.path (机身轨迹): (0.2, 1.65, 1.5)
- movement.lookPath (镜头轨迹): —

---

### block idx=43  type=SCENE_HEADING
**内容**: INT. 宫廷寝殿 - 日
**kind**: scene  **error**: 无

**布局对象** (11):

| # | type | role | label | position | size |
|---|------|------|-------|----------|------|
| 0 | box | floor | — | (0, 0, 0) | (10, 0.1, 10) |
| 1 | box | wall | — | (0, 1.5, -5) | (10, 3, 0.2) |
| 2 | box | wall | — | (0, 1.5, 5) | (10, 3, 0.2) |
| 3 | box | wall | — | (-5, 1.5, 0) | (0.2, 3, 10) |
| 4 | box | wall | — | (5, 1.5, 0) | (0.2, 3, 10) |
| 5 | box | furniture | 床 | (0, 0.25, -3) | (2, 0.5, 3) |
| 6 | box | furniture | 桌 | (0, 0.15, 0.5) | (1, 0.3, 1) |
| 7 | box | furniture | 凳 | (-1, 0.2, 0.5) | (0.4, 0.4, 0.4) |
| 8 | box | furniture | 屏风 | (-2, 1.2, -2) | (2, 2.4, 0.1) |
| 9 | box | door | 门 | (0, 1.5, 4.9) | (1.5, 3, 0.1) |
| 10 | box | window | 窗 | (4.9, 1.5, 0) | (0.1, 1.5, 1) |

**角色走位**: 无

---

### block idx=44  type=ACTION
**内容**: 萧萧垂下眼帘，突然想起自己公司去年立项的那款架空历史游戏——这里的服饰、年号，竟与游戏设定高度重合。她眼中闪过一丝光亮。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: close-up
- position: (0.8, 1.6, 1.2)
- lookAt: (0, 1.6, 0)
- focus: 萧萧
- movement.type: dolly
- movement.duration: 3s
- movement.path (机身轨迹): (0.8, 1.6, 1.2) → (0.6, 1.6, 0.8)
- movement.lookPath (镜头轨迹): —

---

### block idx=47  type=DIALOGUE
**内容**: 等一下。如果这是那款游戏的世界线...那剧情走向、关键人物、谁是幕后黑手，我可都记得一清二楚。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: medium
- position: (1.73, 1.5, -1.8)
- lookAt: (0, 1.5, -2.8)
- focus: 萧萧
- movement.type: orbit
- movement.duration: 5s
- movement.path (机身轨迹): (1.73, 1.5, -1.8) → (0, 1.5, -0.8) → (-1.73, 1.5, -1.8)
- movement.lookPath (镜头轨迹): —

---

### block idx=49  type=SCENE_HEADING
**内容**: INT. 宫廷寝殿 - 日
**kind**: scene  **error**: 无

**布局对象** (11):

| # | type | role | label | position | size |
|---|------|------|-------|----------|------|
| 0 | box | floor | — | (0, 0, 0) | (10, 0.1, 10) |
| 1 | box | wall | — | (0, 1.5, -5) | (10, 3, 0.2) |
| 2 | box | wall | — | (0, 1.5, 5) | (10, 3, 0.2) |
| 3 | box | wall | — | (-5, 1.5, 0) | (0.2, 3, 10) |
| 4 | box | wall | — | (5, 1.5, 0) | (0.2, 3, 10) |
| 5 | box | furniture | 床 | (0, 0.25, -3) | (2, 0.5, 3) |
| 6 | box | furniture | 桌 | (0, 0.15, 0.5) | (1, 0.3, 1) |
| 7 | box | furniture | 凳 | (-1, 0.2, 0.5) | (0.4, 0.4, 0.4) |
| 8 | box | furniture | 屏风 | (-2, 1.2, -2) | (2, 2.4, 0.1) |
| 9 | box | door | 门 | (0, 1.5, 4.9) | (1.5, 3, 0.1) |
| 10 | box | window | 窗 | (4.9, 1.5, 0) | (0.1, 1.5, 1) |

**角色走位**: 无

---

### block idx=50  type=ACTION
**内容**: 门外传来太监尖细的催促声，打破了寝殿的寂静。萧萧的眉头拧起，但已从慌乱中迅速挣脱，开始盘算对策。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: close-up
- position: (0, 1.6, 3.5)
- lookAt: (0, 1.6, 1)
- focus: 萧萧
- movement.type: dolly
- movement.duration: 3s
- movement.path (机身轨迹): (0, 1.6, 3.5) → (0, 1.6, 2)
- movement.lookPath (镜头轨迹): —

---

### block idx=52  type=DIALOGUE
**内容**: 公主殿下，皇上那儿催着呢，说若是醒了，即刻去御书房相见，有要事相商。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: medium
- position: (1.2, 1.6, 0.8)
- lookAt: (0, 1.6, -2)
- focus: 萧萧
- movement.type: tilt
- movement.duration: 4s
- movement.path (机身轨迹): —
- movement.lookPath (镜头轨迹): (0, 1, -2) → (0, 1.6, -2)

---

### block idx=55  type=SCENE_HEADING
**内容**: INT. 宫廷寝殿 - 日
**kind**: scene  **error**: 无

**布局对象** (11):

| # | type | role | label | position | size |
|---|------|------|-------|----------|------|
| 0 | box | floor | — | (0, 0, 0) | (10, 0.1, 10) |
| 1 | box | wall | — | (0, 1.5, -5) | (10, 3, 0.2) |
| 2 | box | wall | — | (0, 1.5, 5) | (10, 3, 0.2) |
| 3 | box | wall | — | (-5, 1.5, 0) | (0.2, 3, 10) |
| 4 | box | wall | — | (5, 1.5, 0) | (0.2, 3, 10) |
| 5 | box | furniture | 床 | (0, 0.25, -3) | (2, 0.5, 3) |
| 6 | box | furniture | 桌 | (0, 0.15, 0.5) | (1, 0.3, 1) |
| 7 | box | furniture | 凳 | (-1, 0.2, 0.5) | (0.4, 0.4, 0.4) |
| 8 | box | furniture | 屏风 | (-2, 1.2, -2) | (2, 2.4, 0.1) |
| 9 | box | door | 门 | (0, 1.5, 4.9) | (1.5, 3, 0.1) |
| 10 | box | window | 窗 | (4.9, 1.5, 0) | (0.1, 1.5, 1) |

**角色走位**: 无

---

### block idx=56  type=ACTION
**内容**: 萧萧快速整理衣襟，对着铜镜中陌生的脸露出一个职业化的微笑。她低声对自己说了一句现代职场格言，然后挺直脊背，眼神从惊慌转为掌控。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: close-up
- position: (1, 1.6, 1)
- lookAt: (0, 1.4, 0.5)
- focus: 萧萧
- movement.type: dolly
- movement.duration: 4s
- movement.path (机身轨迹): (1, 1.6, 1) → (0.3, 1.6, 0.6)
- movement.lookPath (镜头轨迹): (0, 1.4, 0.5) → (0, 1.6, 0.5)

---

### block idx=59  type=DIALOGUE
**内容**: 既然穿都穿了，就当换了个项目组。项目代号——保命。目标——弄清楚这个世界的规则。这局游戏，我接了。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: over-the-shoulder
- position: (0.3, 1.6, -1.2)
- lookAt: (0, 1.6, 0.8)
- focus: 萧萧
- movement.type: static
- movement.duration: 5s
- movement.path (机身轨迹): (0.3, 1.6, -1.2)
- movement.lookPath (镜头轨迹): —

---

### block idx=61  type=SCENE_HEADING
**内容**: INT. 宫廷寝殿 - 日
**kind**: scene  **error**: 无

**布局对象** (11):

| # | type | role | label | position | size |
|---|------|------|-------|----------|------|
| 0 | box | floor | — | (0, 0, 0) | (10, 0.1, 10) |
| 1 | box | wall | — | (0, 1.5, -5) | (10, 3, 0.2) |
| 2 | box | wall | — | (0, 1.5, 5) | (10, 3, 0.2) |
| 3 | box | wall | — | (-5, 1.5, 0) | (0.2, 3, 10) |
| 4 | box | wall | — | (5, 1.5, 0) | (0.2, 3, 10) |
| 5 | box | furniture | 床 | (0, 0.25, -3) | (2, 0.5, 3) |
| 6 | box | furniture | 桌 | (0, 0.15, 0.5) | (1, 0.3, 1) |
| 7 | box | furniture | 凳 | (-1, 0.2, 0.5) | (0.4, 0.4, 0.4) |
| 8 | box | furniture | 屏风 | (-2, 1.2, -2) | (2, 2.4, 0.1) |
| 9 | box | door | 门 | (0, 1.5, 4.9) | (1.5, 3, 0.1) |
| 10 | box | window | 窗 | (4.9, 1.5, 0) | (0.1, 1.5, 1) |

**角色走位**: 无

---

### block idx=62  type=ACTION
**内容**: 她转身走向门口，宽大的裙裾扫过石板地面。阳光从门缝里射进来，照在她脸上——那是属于现代职场精英的、胸有成竹的表情。侍女神色惶惶，亦步亦趋地跟上。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: medium
- position: (2, 1.5, 0)
- lookAt: (0, 1.6, -1)
- focus: 她
- movement.type: tracking
- movement.duration: 6s
- movement.path (机身轨迹): (2, 1.5, 0) → (1, 1.5, 4.5)
- movement.lookPath (镜头轨迹): (0, 1.6, -1) → (0, 1.6, 4.5)

---

### block idx=65  type=DIALOGUE
**内容**: 对了，往后在没旁人的时候，别叫我公主。叫我——萧总。
**kind**: shot  **error**: 无

**摄影机**:
- shotType: over-the-shoulder
- position: (0, 1.5, 2.5)
- lookAt: (0, 1.6, 4.6)
- focus: 萧萧
- movement.type: static
- movement.duration: 3s
- movement.path (机身轨迹): (0, 1.5, 2.5)
- movement.lookPath (镜头轨迹): (0, 1.6, 4.6)

---

## 每场 shot 序列 (节奏对比)

**S00** `内. 宫廷寝殿 - 古代` shots=3 运镜种类=2 seq=['tilt', 'dolly', 'dolly']

  - ACTI close-up / tilt | 萧萧头痛欲裂地醒来。她看着自己的手——纤细，
  - DIAL over-the-shoulder / dolly | 公主！您终于醒了！皇上在等您。
  - DIAL close-up / dolly | 皇上？我刚才还在开董事会...

**S01** `INT. 宫廷寝殿 - 日` shots=2 运镜种类=2 seq=['handheld', 'dolly']

  - ACTI medium / handheld | 萧萧猛地坐起身，环顾四周。雕花木梁、纱帐、青
  - DIAL close-up / dolly | 不是做梦...这布局风格，根本不是我那个写字

**S03** `INT. 宫廷寝殿 - 日` shots=2 运镜种类=2 seq=['dolly', 'static']

  - ACTI pov / dolly | 萧萧深吸一口气，强行压下慌乱。她赤脚走到铜镜
  - DIAL over-the-shoulder / static | 穿越？还是综艺整蛊？先确认朝代，再确认身份。

**S04** `INT. 宫廷寝殿 - 日` shots=2 运镜种类=2 seq=['static', 'dolly']

  - ACTI over-the-shoulder / static | 萧萧转身，目光如面试官般锐利，盯着跪地的侍女
  - DIAL close-up / dolly | 现在是什么年号？皇帝的名讳是什么？我——我是

**S05** `INT. 宫廷寝殿 - 日` shots=2 运镜种类=2 seq=['tilt', 'dolly']

  - ACTI close-up / tilt | 侍女吓得脸色苍白，以为公主落水后伤了头脑。她
  - DIAL over-the-shoulder / dolly | 公主您别吓奴婢！您是明月公主，圣上最宠的女儿

**S06** `INT. 宫廷寝殿 - 日` shots=2 运镜种类=2 seq=['dolly', 'static']

  - ACTI close-up / dolly | 萧萧内心翻江倒海。景和三年——她读过那么多史
  - DIAL extreme-close-up / static | 景和三年...查无此年。我不仅换了时空，还掉

**S07** `INT. 宫廷寝殿 - 日` shots=2 运镜种类=2 seq=['dolly', 'orbit']

  - ACTI close-up / dolly | 萧萧垂下眼帘，突然想起自己公司去年立项的那款
  - DIAL medium / orbit | 等一下。如果这是那款游戏的世界线...那剧情

**S08** `INT. 宫廷寝殿 - 日` shots=2 运镜种类=2 seq=['dolly', 'tilt']

  - ACTI close-up / dolly | 门外传来太监尖细的催促声，打破了寝殿的寂静。
  - DIAL medium / tilt | 公主殿下，皇上那儿催着呢，说若是醒了，即刻去

**S09** `INT. 宫廷寝殿 - 日` shots=2 运镜种类=2 seq=['dolly', 'static']

  - ACTI close-up / dolly | 萧萧快速整理衣襟，对着铜镜中陌生的脸露出一个
  - DIAL over-the-shoulder / static | 既然穿都穿了，就当换了个项目组。项目代号——

**S10** `INT. 宫廷寝殿 - 日` shots=2 运镜种类=2 seq=['tracking', 'static']

  - ACTI medium / tracking | 她转身走向门口，宽大的裙裾扫过石板地面。阳光
  - DIAL over-the-shoulder / static | 对了，往后在没旁人的时候，别叫我公主。叫我—
