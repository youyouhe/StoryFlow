<div align="center">
  <h1>StoryFlow</h1>
  <p>AI 驱动的影视剧本与脚本编辑器</p>
</div>

[English](README.md) | [简体中文](README.zh-CN.md)

一款智能剧本编辑器，支持多种剧本格式，可通过 Gemini 或 DeepSeek API 获取 AI 辅助。

## 功能特性

- **多种剧本格式**
  - 好莱坞标准格式
  - 情景喜剧、舞台剧、商业广告
  - 短视频格式
  - 中文题材：耽美、玄幻、武侠等

- **AI 辅助创作**
  - 从任意位置续写剧情
  - 生成创意灵感
  - 重写现有段落
  - 支持 Gemini 和 DeepSeek 两种 AI 服务

- **双语支持**
  - 中英文界面
  - 双语剧本模式

- **专业排版**
  - 适配打印的分页功能（US Letter / A4）
  - 智能识别段落类型
  - 标准剧本页边距和行距

## 界面截图

### 英文界面
<img src="public/demo-en.png" alt="英文界面" width="800"/>

### 中文界面
<img src="public/demo-zh.png" alt="中文界面" width="800"/>

## 环境要求

- Node.js 18+

## 安装

```bash
# 克隆仓库
git clone https://github.com/youyouhe/StoryFlow.git
cd StoryFlow

# 安装依赖
npm install
```

## 配置

在项目根目录创建 `.env.local` 文件：

```bash
# Gemini API（默认）
GEMINI_API_KEY=你的_gemini_api_key

# 或使用 DeepSeek
DEEPSEEK_API_KEY=你的_deepseek_api_key
```

也可以在应用设置界面中配置 API 密钥。

## 使用

```bash
# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览生产版本
npm run preview
```

打开 [http://localhost:5173](http://localhost:5173) 开始创作。

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Tab` / `Shift+Tab` | 切换段落类型 |
| `Enter` | 创建新段落 |
| `Backspace`（段落开头） | 与上一段落合并 |
| `Ctrl/Meta + 方向键` | 在段落间导航 |

AI 相关快捷键可在设置中自定义。

## 项目结构

```
StoryFlow/
├── App.tsx                  # 主应用程序，包含状态管理
├── types.ts                 # TypeScript 类型定义
├── constants.ts             # 模板、翻译、提示词
├── components/
│   ├── EditorBlock.tsx      # 单个剧本段落编辑器
│   ├── Sidebar.tsx          # 剧本列表和导航
│   ├── Toolbar.tsx          # 段落类型选择器
│   └── SettingsModal.tsx    # 设置界面
├── services/
│   └── geminiService.ts     # AI API 集成
└── utils/
    └── pagination.ts        # 分页计算
```

## 剧本存储

剧本使用 localStorage 存储在本地浏览器中：
- `script_index`：所有剧本的列表
- `script_{id}`：完整的剧本数据

## 桌面版下载

前往 [Releases](https://github.com/youyouhe/StoryFlow/releases) 页面下载 Windows 桌面版安装包。

## 许可证

MIT

---

使用 React + TypeScript + Vite 构建
