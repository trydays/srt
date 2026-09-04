# 三天remotion (srt)

用自然语言操控 FFmpeg 的视频剪辑桌面工具。
导入视频 → 说出你想要的效果 → 导出。

## 快速开始

```bash
npx create-srt
```

首次运行会自动下载并安装，之后双击桌面图标即可使用。

## 功能

- 自然语言描述 → 自动生成 FFmpeg 命令
- 24 种内置视频特效（淡入、黑白、加速、暗角、反相、色调、像素化…）
- Whisper 语音转字幕
- AI 翻译（支持 Ollama 本地模型 / Claude / OpenAI）
- 时间轴编辑器 + 实时预览

## 安装方式

| 方式 | 命令 | 适合 |
|------|------|------|
| 🔥 npx（推荐） | `npx create-srt` | 任何有 Node.js 的电脑 |
| 📦 便携版 | [GitHub Releases](https://github.com/trydays/srt/releases) 下载 zip 解压即用 | 不装 Node 的用户 |
| 🛠 开发 | `git clone` → `npm install` → `node server.js` | 开发者 |

## 系统要求

- Windows 10+（macOS / Linux 待支持）
- 如果使用安装包：无需任何前置依赖
- 如果使用 npx：需要 Node.js 20+

## Windows 与 macOS 环境检测

桌面版首次启动时会检测 Windows 或 macOS 的硬件与本机工具，并用三档状态说明结果：`满足` 表示当前可用，`可用但受限` 表示可以继续但部分能力受影响，`不满足` 表示对应能力暂不可用。硬件结果只提供建议，不会阻止“继续进入主页”。

缺少可自动安装的工具时，应用会先展示下载量、安装位置、耗时与步骤；只有用户确认后才会执行安装。开发时可运行：

```bash
npm test
npm run test:e2e
```

当前发布打包仍仅面向 Windows，不代表已经提供签名的 macOS 安装包。

## 项目结构

```
srt/
├── main.js           # Electron 主进程
├── server.js         # 开发模式服务器
├── app/              # 渲染进程页面
├── resources/tools/  # 捆绑工具（构建时下载）
├── tests/            # 测试套件（26 tests）
└── .github/workflows # CI/CD 自动构建
```

## 开发

```bash
git clone https://github.com/trydays/srt.git
cd srt
npm install
node server.js          # 开发模式 → http://localhost:3456
node --test tests/      # 运行测试
```

## 技术栈

Electron + FFmpeg 8.x + Node.js 20.x + Whisper large-v3

## License

MIT
