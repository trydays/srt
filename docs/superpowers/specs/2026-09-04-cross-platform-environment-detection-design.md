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
- 本轮不重写桌面端现有的媒体命令执行链。
- 本轮不建设通用安装平台、极端并发/恢复机制、新 CI 矩阵或 macOS 签名发布链。

## 本阶段范围冻结

1. **唯一目的**：让 SRTP 在 Windows 与 macOS 上正确展示剪辑必要环境，并以受限安装流程补齐缺失工具。
2. **可见成果**：真实 Electron 页面可查看当前设备，可查看/取消/确认安装计划，并能继续进入主页和编辑器。
3. **明确不做**：不借机重写编辑器、媒体执行、AI 翻译、更新、构建发布或通用基础设施。
4. **工作上限**：实施限为六个纵向切片，只新增一个核心环境模块、一个 Node 适配器和必要的测试支架；任一支撑切片超过两倍预估就停止并报告。
5. **立即结束条件**：下方验收标准全部通过后即结束，不再因“还可以更完善”继续扩展。

新需求只在“不做则无法验收”、“不做会带来现实安全/数据损失”或“用户了解成本后明确批准”时进入本阶段，否则记入延期清单。

## 产品行为

### 系统与硬件

统一报告包含：

- 操作系统名称、版本与架构。
- 芯片或 CPU 型号、逻辑核心数。
- 总内存。
- 应用数据目录所在磁盘的总量与可用空间；未来打开具体项目后，可优先显示项目目录所在磁盘。
- macOS 的 Metal 支持与 Apple Silicon/Intel 类型。
- Windows 的 GPU 名称；CUDA 只作为可选加速能力展示。

每项同时包含三级 `status` 与机器可读的 `reason`。`reason` 用于区分 `absent`、`incompatible`、`probe_error` 和 `unsupported`；页面不会把检测失败误写成未安装。芯片不按核心数设置门槛，只根据架构是否受支持提示。

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
- 若应用管理的 Python 环境存在则优先使用；否则 macOS 依次识别 `python3` 与 `python`，Windows 依次识别 `py -3` 与 `python`。Whisper 必须使用同一个已选 Python 进行探测。
- Electron 进程显式补充常见 Homebrew 路径，包括 Apple Silicon 的 `/opt/homebrew/bin` 与 Intel Mac 的 `/usr/local/bin`，避免图形应用没有继承登录 shell PATH 时误报。

页面先展示硬件概览，再展示三种功能模式的就绪状态。单个工具缺失时，文案直接说明受影响的功能，而不是把整台设备判定为不可用。

三种功能模式只是能力状态，不新增选择或存储字段；现有 `cli`/`browser` 选择器及 `RENDER_MODE` 保持原行为。

## 架构

### 统一检测核心

新增一个深模块，对调用者只暴露 `detectEnvironment()`、`describeInstall(toolId)` 和 `installTool({ toolId, confirmationId })` 三个方法。系统采集、工具探测、三档评估和一次性确认都留在该模块内部，不拆成一组浅层转发模块。

另有一个 Node 适配器负责真实 `os`/文件系统/进程调用。核心模块只接收注入的系统边界；测试替换最外层边界，但必须穿过真实检测、评估和安装实现。

### 公共数据契约

环境报告使用以下稳定形状：

```js
{
  platform: { os: 'darwin', version: '15.6', arch: 'arm64' },
  hardware: {
    chip: { name: 'Apple M-series', cores: 10, status: 'ready', reason: 'ok' },
    memory: { totalGB: 16, status: 'ready', reason: 'ok', message: '' },
    disk: { path: '/app-data', freeGB: 177, totalGB: 460, status: 'ready', reason: 'ok' },
    graphics: { name: 'Apple GPU', metal: true, status: 'ready', reason: 'ok' }
  },
  tools: {
    ffmpeg: { installed: true, version: '8.0.1', status: 'ready', reason: 'ok' },
    node: { installed: true, version: '26.4.0', status: 'ready', reason: 'ok' },
    npm: { installed: true, version: '11.17.0', status: 'ready', reason: 'ok' },
    python: { installed: true, command: 'python3', version: '3.14.6', status: 'limited', reason: 'incompatible' },
    whisper: { installed: false, status: 'missing', reason: 'absent' }
  },
  modes: {
    ffmpeg: { status: 'ready', reason: 'ok', blockers: [] },
    remotion: { status: 'ready', reason: 'ok', blockers: [] },
    subtitles: { status: 'limited', reason: 'absent', blockers: ['whisper'] }
  },
  canContinue: true
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

已有视频渲染能力不得复用安装接口。环境页不再依赖 `/api/exec`；开发服务器改为只绑定 `127.0.0.1` 并移除公开的 `/api/exec` 与 `/api/install`。浏览器预览不再执行本机命令；桌面端现有媒体执行链暂作为兼容路径保留，后续作为独立安全任务处理。

## 白名单安装流程

1. 用户点击缺失工具的“查看安装方式”。
2. 页面调用 `describeInstall(toolId)`，显示下载量、安装位置、固定动作和可能需要的时间。
3. 用户在模态框中明确确认。
4. 页面只提交 `toolId` 与一次性 `confirmationId`。
5. 主进程重新校验后执行动作，页面显示不确定进度状态；本轮不新增日志流或通用进度通道。
6. 完成后执行一次完整环境重检，以统一刷新该工具和受影响的模式。
7. 失败时展示可复制的手动指引，不自动重试、不请求管理员密码。

macOS 策略：

- 已有 Homebrew 时，FFmpeg、Node.js 和指定 Python 可使用固定的 `brew install` 参数数组。
- 没有 Homebrew 时，只展示 Homebrew 官方安装入口和手动安装指引，不自动安装 Homebrew。
- Whisper 安装到应用管理的 Python 3.12 虚拟环境，避免污染系统 Python。

Windows 安装包中已随应用提供且校验通过的工具直接标为 `ready`，不复制、不删除，也不触发安装确认；缺失时才进入白名单安装流程。

Windows 策略：

- 可用时通过固定的 `winget` 包标识安装 FFmpeg、Node.js LTS 和 Python 3.12。
- Whisper 安装到应用管理的 Python 虚拟环境。
- 所有程序均使用 `spawn(program, args, { shell: false })`；不拼接 shell 字符串。

## 页面设计

保留现有环境检测页的整体视觉语言，但替换静态 Windows 数据：

- 顶部显示当前系统与芯片摘要。
- 磁盘卡默认显示应用数据目录所在磁盘，未来打开具体项目后可改为项目目录；不再显示虚构盘符。
- 硬件区展示芯片、内存、磁盘和图形能力。
- 工具区展示 FFmpeg、Node.js/npm、Python 3 与 Whisper。
- 模式区分别显示基础剪辑、Remotion 和字幕是否就绪。
- `ready` 使用成功样式，`limited` 使用警告样式，`missing` 使用缺失样式。
- 每条警告必须包含实际影响和下一步，而不是只显示“未安装”。
- “继续”按钮始终可用；页面保存检测已完成状态后进入主页，并保留现有 `cli`/`browser` 选择与 `RENDER_MODE` 存储行为。

## 错误处理

- 单项探测超时、命令缺失或解析失败只影响该项，不使整份报告失败。
- 报告区分“未安装”“版本不兼容”“检测失败”，页面不得把三者都显示为未安装。
- 系统命令设置短超时并限制输出大小。
- 安装结果不得回传环境变量、用户主目录明文、令牌或完整诊断日志。
- 安装中断后保留已完成工具的状态，并提供重新检测按钮。
- 不支持的平台返回明确的 `unsupported` 平台信息，页面仍可进入基础界面。
- 安装确认标识绑定工具且只能使用一次；本地单用户应用不新增过期、恢复或并发协调机制。

## TDD 公共边界

测试只针对以下公共接口和可见行为：

1. 环境深模块的 `detectEnvironment()`：macOS/Windows 边界返回统一报告、三档状态和模式评估。
2. 同一模块的 `describeInstall(toolId)` 与 `installTool(request)`：只接受白名单工具，要求一次性确认，并产生固定程序与参数。
3. Node 适配器：真实进程始终以参数数组且 `shell: false` 运行，并补充 macOS GUI 常见 PATH。
4. `window.srtAPI`：Electron 页面可以调用三个环境/安装方法，但不能提交任意安装命令。
5. 环境检测页面：根据报告显示系统、硬件、工具、三级状态、安装确认和继续入口。

外部系统边界可以替换：操作系统命令、文件系统、真实包管理器和下载网络。项目自己的检测、评估、IPC 与页面逻辑不得用内部 mock 互相替代。

## 端到端测试

Electron 端到端测试使用真实窗口、预加载层和环境核心模块；只替换最外层 OS/进程调用，不伪造三个公共方法。四条场景足以覆盖必要链路：

1. macOS 就绪：首次启动显示 Apple/Metal/应用数据磁盘和 Node.js/Python，继续进入主页，上传测试视频并打开编辑器。
2. Windows 就绪：同一份页面显示 Windows CPU/GPU/盘符语义，没有 Apple/Metal 必需项。
3. FFmpeg 缺失：查看计划后取消不执行；再次生成计划并确认时，只执行白名单动作一次，然后全量重检。
4. 低配置且存在检测失败：区分“不满足”与“检测失败”，继续按钮仍可进入主页。

未知工具、伪造确认和命令字符串拒绝由核心模块行为测试覆盖，不为每个细分异常再启动 Electron。真实当前 Mac 另跑一次只读烟雾测试，直接调用 `window.srtAPI.detectEnvironment()` 确认 Homebrew PATH、`python3`、磁盘和 Metal。

## 验收标准

- 当前 Mac 上已经安装的 Node.js 与 Python 3 不再误报为缺失。
- macOS 页面不出现 `C:`/`D:` 盘符、`wmic`、CUDA 必需项或 `AppData` 路径。
- Windows 页面仍能检测硬件、磁盘与工具。
- 所有硬件等级只提示，不阻止继续。
- 任意安装都先展示计划并等待用户确认。
- 安装 API 无法执行页面传入的任意命令。
- 环境核心模块的三个公共方法和页面行为均有测试。
- 四条 Electron 端到端场景与当前 Mac 只读烟雾测试通过，失败时保存截图与错误摘要。
- 现有配置加载、特效映射和工具版本测试继续通过。
- 以上条件满足后立即结束本阶段；延期清单不得阻塞交付。
