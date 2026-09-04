# SRTP 跨平台环境检测设计

## 背景

SRTP 当前的环境检测页主要按 Windows 编写：磁盘列表是静态的 `C:`/`D:`/`E:`/`F:`，CPU 与内存依赖 `wmic`，GPU 只检测 CUDA，Python 只调用 `python`，安装指引依赖 `winget`，工具目录写死为 `AppData`。Electron 预加载脚本公开的是 `window.srtAPI`，页面公共脚本却读取 `window.electronAPI`，导致 Electron 内运行时退回开发服务器或静态 JSON，并把已经安装的 macOS 工具误报为缺失。

本设计把检测逻辑从页面移入一个可测试的跨平台检测核心，同时保留 Windows 支持并增加 macOS 支持。缺失工具采用“先展示安装计划、用户明确确认、再运行白名单安装动作”的流程。硬件结果只给出三级提示，不阻止用户进入编辑器。

## 目标

1. 自动识别 Windows 与 macOS，并返回统一、稳定的环境报告。
2. 正确检测平台、芯片/CPU、架构、内存、可用磁盘、图形能力、FFmpeg、Node.js、npm、Python 3、Whisper 与 AI 配置。
3. 将每项结果标为“满足”“可用但受限”或“不满足”，同时说明影响和建议。
4. 按使用模式计算要求：基础 FFmpeg 剪辑、Remotion 渲染、Whisper 字幕各自只要求真正需要的工具。
5. 安装前显示系统对应的操作说明；只有用户确认后才执行白名单动作。
6. 不向页面暴露通用 shell 安装接口，不允许页面提交任意安装命令。
7. 使用 TDD 实现，并用 Electron 端到端测试覆盖首次启动至进入编辑器的完整链路。

## 非目标

- 本轮不支持 Linux。
- 本轮不检测电池健康、温度、风扇或外接硬盘健康。
- 本轮不重写视频时间轴、AI 翻译或导出算法。
- 本轮不自动安装 Homebrew，也不使用 `sudo`。
- 本轮不把 CUDA 设为 Windows 的硬性要求，也不把独立显卡设为 macOS 的硬性要求。

## 产品行为

### 系统与硬件

统一报告包含：

- 操作系统名称、版本与架构。
- 芯片或 CPU 型号、逻辑核心数。
- 总内存。
- 当前工作目录所在磁盘的总量与可用空间。
- macOS 的 Metal 支持与 Apple Silicon/Intel 类型。
- Windows 的 GPU 名称；CUDA 只作为可选加速能力展示。

默认等级规则：

| 项目 | 满足 | 可用但受限 | 不满足 |
|---|---|---|---|
| 内存 | 16 GB 及以上 | 8–15 GB | 低于 8 GB |
| 可用磁盘 | 30 GB 及以上 | 10–29 GB | 低于 10 GB |
| 架构 | macOS `arm64` 或 `x64`；Windows `x64` | 已识别但性能受限的平台 | 未支持的架构 |
| 图形能力 | macOS 支持 Metal；Windows 检测到可用 GPU | 只能使用 CPU 渲染 | 无法识别图形能力 |

“不满足”是风险提示，不是导航门禁。用户始终可以继续进入编辑器。

### 工具与模式

- 基础 FFmpeg 剪辑要求 FFmpeg；其他工具不影响进入基础模式。
- Remotion 渲染要求 Node.js 20 及以上与 npm。
- Whisper 字幕要求受支持的 Python 3 与 `faster-whisper`；优先建议项目管理的 Python 3.12 环境，不把系统 Python 当作唯一选择。
- AI 配置与 Ollama 均为可选能力，不降低基础模式的可用等级。
- macOS 同时识别 `python3` 与 `python`，优先使用 `python3`；Windows 同时识别 `py -3` 与 `python`。
- Electron 进程显式补充常见 Homebrew 路径，包括 Apple Silicon 的 `/opt/homebrew/bin` 与 Intel Mac 的 `/usr/local/bin`，避免图形应用没有继承登录 shell PATH 时误报。

页面先展示硬件概览，再展示三种功能模式的就绪状态。单个工具缺失时，文案直接说明受影响的功能，而不是把整台设备判定为不可用。

## 架构

### 统一检测核心

新增独立的 CommonJS 环境模块，由 Electron 主进程和安全的开发服务器适配层共同调用。模块包含四个职责清晰的单元：

1. 系统采集器：读取操作系统、CPU、内存、磁盘和 GPU/Metal 信息。
2. 工具探测器：以参数数组运行固定探测程序，解析版本并返回结构化结果。
3. 就绪度评估器：将原始数据映射为三级状态和模式可用性。
4. 安装服务：根据平台和工具标识生成安装计划，并在确认后执行白名单动作。

所有系统调用都通过可注入的执行器边界完成。测试使用固定夹具替代真实系统命令，但不模拟模块内部协作。

### 公共数据契约

环境报告使用以下稳定形状：

```js
{
  platform: { os: 'darwin', version: '15.6', arch: 'arm64' },
  hardware: {
    chip: { name: 'Apple M-series', cores: 10, status: 'ready' },
    memory: { totalGB: 16, status: 'ready', message: '' },
    disk: { path: '/project', freeGB: 177, totalGB: 460, status: 'ready' },
    graphics: { name: 'Apple GPU', metal: true, status: 'ready' }
  },
  tools: {
    ffmpeg: { installed: true, version: '8.0.1', status: 'ready' },
    node: { installed: true, version: '26.4.0', status: 'ready' },
    npm: { installed: true, version: '11.17.0', status: 'ready' },
    python: { installed: true, command: 'python3', version: '3.14.6', status: 'limited' },
    whisper: { installed: false, status: 'missing' }
  },
  modes: {
    ffmpeg: { status: 'ready', blockers: [] },
    remotion: { status: 'ready', blockers: [] },
    subtitles: { status: 'limited', blockers: ['whisper'] }
  }
}
```

内部状态值固定为 `ready`、`limited`、`missing`；页面中文文案集中映射，避免业务逻辑依赖显示文本。

### Electron 接口

预加载层只公开以下环境与安装接口，并统一使用 `window.srtAPI`：

```js
detectEnvironment()
describeInstall(toolId)
installTool(toolId, confirmationId)
```

- `detectEnvironment()` 返回完整环境报告。
- `describeInstall(toolId)` 返回工具名、下载量估计、系统安装方式、用户可读步骤和一次性确认标识。
- `installTool(toolId, confirmationId)` 在主进程再次校验平台、工具白名单和确认标识后执行固定动作。
- 页面永远不能把命令字符串传给安装接口。

已有视频渲染能力不得复用安装接口。开发服务器绑定 `127.0.0.1`，环境检测改用专用只读端点，安装端点沿用同一白名单服务；删除环境页对 `/api/exec` 的依赖。通用命令执行接口不再用于环境检测或安装，并从开发服务器公共 API 中移除。若编辑器仍需要执行 FFmpeg，应使用独立的媒体执行边界，只接受允许的程序与参数，不经过 shell。

## 白名单安装流程

1. 用户点击缺失工具的“查看安装方式”。
2. 页面调用 `describeInstall(toolId)`，显示下载量、安装位置、固定动作和可能需要的时间。
3. 用户在模态框中明确确认。
4. 页面只提交 `toolId` 与一次性 `confirmationId`。
5. 主进程重新校验后执行动作，并流式展示有限、脱敏的进度。
6. 完成后只重新检测该工具及受影响的模式。
7. 失败时展示可复制的手动指引，不自动重试、不请求管理员密码。

macOS 策略：

- 已有 Homebrew 时，FFmpeg、Node.js 和指定 Python 可使用固定的 `brew install` 参数数组。
- 没有 Homebrew 时，只展示 Homebrew 官方安装入口和手动安装指引，不自动安装 Homebrew。
- Whisper 安装到应用管理的 Python 3.12 虚拟环境，避免污染系统 Python。

Windows 策略：

- 可用时通过固定的 `winget` 包标识安装 FFmpeg、Node.js LTS 和 Python 3.12。
- Whisper 安装到应用管理的 Python 虚拟环境。
- 所有程序均使用 `spawn(program, args, { shell: false })`；不拼接 shell 字符串。

## 页面设计

保留现有环境检测页的整体视觉语言，但替换静态 Windows 数据：

- 顶部显示当前系统与芯片摘要。
- 磁盘卡只显示当前工作目录所在磁盘，不再显示虚构盘符。
- 硬件区展示芯片、内存、磁盘和图形能力。
- 工具区展示 FFmpeg、Node.js/npm、Python 3 与 Whisper。
- 模式区分别显示基础剪辑、Remotion 和字幕是否就绪。
- `ready` 使用成功样式，`limited` 使用警告样式，`missing` 使用缺失样式。
- 每条警告必须包含实际影响和下一步，而不是只显示“未安装”。
- “继续”按钮始终可用；页面保存检测摘要与用户选择的模式后进入主页。

## 错误处理

- 单项探测超时、命令缺失或解析失败只影响该项，不使整份报告失败。
- 报告区分“未安装”“版本不兼容”“检测失败”，页面不得把三者都显示为未安装。
- 系统命令设置短超时并限制输出大小。
- 安装结果不得回传环境变量、用户主目录明文、令牌或完整诊断日志。
- 安装中断后保留已完成工具的状态，并提供重新检测按钮。
- 不支持的平台返回明确的 `unsupported` 平台信息，页面仍可进入基础界面。

## TDD 公共边界

测试只针对以下已确认的公共边界：

1. `detectEnvironment(dependencies)`：给定 macOS 或 Windows 系统边界返回统一报告与三级状态。
2. `evaluateReadiness(report)`：给定独立的已知样例，返回三种模式的固定可用性结果。
3. `describeInstall(platform, toolId)` 与 `installTool(request, dependencies)`：只接受白名单工具，要求有效确认标识，并产生固定程序与参数。
4. `window.srtAPI`：Electron 页面可以调用三个环境/安装接口，但不能提交任意命令字符串。
5. 环境检测页面：根据报告显示系统、硬件、工具、三级状态、安装确认和继续入口。

外部系统边界可以替换：操作系统命令、文件系统、真实包管理器和下载网络。项目自己的检测、评估、IPC 与页面逻辑不得用内部 mock 互相替代。

## 端到端测试

Electron 端到端测试使用真实窗口和预加载层，通过测试专用依赖注入提供确定性的 macOS/Windows 报告与安装结果。测试专用入口仅在测试环境启用，生产构建不能读取任意夹具路径。

覆盖以下完整链路：

1. macOS 首次启动：自动进入环境检测页，显示 Apple 芯片、Metal、真实磁盘语义和已安装的 `python3`/Node.js，三级状态正确。
2. Windows 首次启动：显示 Windows CPU/GPU/盘符语义，原有能力不退化。
3. 工具缺失：点击查看安装方式，出现系统对应计划；取消不会执行安装。
4. 确认安装：有效确认标识触发白名单动作，完成后该工具和模式状态更新。
5. 非法安装请求：未知工具、过期确认标识或命令字符串均被拒绝。
6. 低配置设备：页面显示“可用但受限”或“不满足”，继续按钮仍可进入主页。
7. 全部满足：选择模式、确认环境、进入主页，再打开一个编辑项目入口，证明导航链路完整。

单元与集成测试在 macOS、Windows CI 矩阵运行；Electron 端到端测试至少覆盖一个 macOS runner 和一个 Windows runner。真实当前设备另跑一次不注入夹具的烟雾测试，确认 Homebrew PATH、`python3`、磁盘和 Metal 均能被实际识别。

## 验收标准

- 当前 Mac 上已经安装的 Node.js 与 Python 3 不再误报为缺失。
- macOS 页面不出现 `C:`/`D:` 盘符、`wmic`、CUDA 必需项或 `AppData` 路径。
- Windows 页面仍能检测硬件、磁盘与工具。
- 所有硬件等级只提示，不阻止继续。
- 任意安装都先展示计划并等待用户确认。
- 安装 API 无法执行页面传入的任意命令。
- 已确认的五个 TDD 公共边界都有行为测试。
- 七条 Electron 端到端场景通过，并保存失败截图与日志供排查。
- 现有配置加载、特效映射和工具版本测试继续通过。

