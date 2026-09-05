# SRTP 本地 CLI 检测与选择设计

## 背景与唯一目标

SRTP 是 Electron + Remotion 的自然语言视频剪辑应用。未来会让本地 CLI 将自然语言转换为精确剪辑指令，并交由 Remotion 渲染；那一链路不属于本阶段。

本阶段的唯一目标是：在 SRTP 桌面端发现本机实际可用的 Codex CLI、Claude Code 与 Gemini CLI，让用户可手动选定其中一个作为全局本地默认值，并在该选择以后失效时要求重新选择。CLI 是可选增强能力，任何检测结果或未选择状态都不得阻止用户进入软件。

## 阶段冻结

1. **唯一目的**：只完成三种固定 CLI 的本机发现、展示、手动选择与默认值失效处理。
2. **可见成果**：环境检测页有本地 CLI 区域，显示实际扫描成功的项、可手动重新扫描、可保存用户的明确选择，并在原选择消失时清除它。
3. **明确不做**：不调用 CLI，不执行自然语言，不生成命令，不执行 Remotion；不做安装、登录或登录检测；不支持 DeepSeek Harness、OpenCode、Zcode 或其他 CLI；不做自定义注册表、模型枚举、认证、SSE、通用代理平台或自动选择。
4. **投入与范围上限**：只增加一个固定三项的扫描器、主进程持久化与 IPC 白名单、环境页的展示/选择，以及对应测试。不得重构现有 AI、编辑器、`cli:exec` 兼容接口或环境安装体系。
5. **退出条件**：本规格的验收标准全部满足即结束；任何额外 CLI、安装、认证或执行能力均留待独立阶段。

## 用户流程与界面行为

本期在现有 `app/环境检测.html` 的环境信息后增加“本地 CLI”区域；不新增首启门禁或独立设置页。区域固定展示一句说明：`目前仅支持 Codex CLI、Claude Code 和 Gemini CLI。`

1. 页面进入 Electron 桌面端后请求当前扫描结果与已保存选择；扫描期间区域显示“正在扫描本地 CLI…”。
2. 扫描完成后，仅为成功验证的 CLI 渲染可选择卡片，卡片只显示名称与“可用”。不得为未安装、验证失败或不支持的 CLI 渲染灰卡、错误卡或安装入口。
3. 没有成功项时，结果区域只显示精确文案：`未扫描到可用本地 CLI`。说明文字和“重新扫描”按钮仍可见。
4. 有成功项但尚无默认值时，卡片均未选中；页面不得替用户选中第一项，也不得把“可用”解释为“已设为默认”。
5. 用户点击可用卡片后，页面调用专用选择接口保存该项；成功后仅该卡片显示“已选为默认”。选择动作可被后来的显式选择覆盖。
6. “重新扫描”只能重新执行固定扫描。它不选择任何 CLI；若保存项仍在本次成功结果中，则保持选择；若不在结果中，则主进程先清除保存项，页面显示未选择状态。空结果仍使用上述精确空状态文案。
7. 本区域没有“安装”“登录”“检测登录”“模型”“运行”“测试命令”按钮或提示。用户可在任意扫描/空/错误状态继续进入主页与编辑器。

若整次 IPC 请求失败，区域显示“本地 CLI 扫描失败，请重新扫描。”与“重新扫描”按钮；它不是“未扫描到可用本地 CLI”，且不展示任何 CLI 卡片。

## 固定 CLI 定义

扫描目录、名称、探测参数和显示名均为内部固定定义，不从页面、配置文件或用户输入读取：

| id | 显示名 | 主命令名 | 版本探测参数 |
| --- | --- | --- | --- |
| `codex` | Codex CLI | `codex` | `['--version']` |
| `claude` | Claude Code | `claude` | `['--version']` |
| `gemini` | Gemini CLI | `gemini` | `['--version']` |

“可用”的定义是：扫描器找到该定义对应的候选可执行文件，文件验证通过，且以该文件和固定 `--version` 参数完成一次短超时、零退出码的探测。版本输出只作为成功证据，不解析、存储或展示版本号；本期不校验登录、账户、套餐、模型或实际功能。

## 模块边界

### 主进程扫描器

新增独立的 CLI 扫描器模块，输入仅为平台、进程环境、文件系统和固定的进程运行器，输出仅为成功项。它负责：生成固定候选路径、安全解析符号链接后的文件验证、固定 `--version` 探测、去重与稳定排序（按上表顺序）。它不读取 renderer 参数，不写持久化，不执行用户给出的程序或参数。运行器分为原生可执行文件路径与 Windows 批处理包装路径；后者只接受扫描器传入的绝对 `.cmd`/`.bat` 路径和固定版本参数，不能被任何其他模块调用。

扫描器每次扫描三个定义，单项失败不影响其余项；重复发现同一 CLI 时只返回一个结果。对同一 id，按候选路径优先级选择第一个成功验证者。成功项的顺序始终为 Codex、Claude、Gemini，与文件系统返回顺序无关。

### 主进程选择存储与 IPC

主进程在 Electron `app.getPath('userData')` 下维护一个专用 JSON 偏好文件，唯一字段为 `selectedCliId`，取值只能是 `null`、`codex`、`claude` 或 `gemini`。写入采用临时同目录文件后原子替换；文件缺失、不可读、不是对象或字段非法时视为 `null`，不得中断启动。

每次 `getLocalCliState`、`rescanLocalCli` 和 `selectLocalCli(id)` 都先执行一次完整扫描，再以该次成功结果复核保存字段；已保存 id 不在成功项中时，立即将其写为 `null`。`selectLocalCli(id)` 只在该次成功结果内接受固定 id；非字符串、未知 id、未扫描成功 id 一律拒绝并且不得改变其他有效选择。主进程不得接受路径、命令、参数或任意配置对象。

`main.js` 只注册三个新 handler：

```js
'local-cli:get-state'       // 返回已扫描状态和当前有效选择
'local-cli:rescan'          // 强制重新扫描，再复核并返回状态
'local-cli:select'          // 接收一个 id，验证后保存并返回状态
```

现有 `environment:detect`、安装 handler、AI handler 和 `cli:exec` 都不是本期调用链；本期不会扩展或复用 `cli:exec`。

### preload 白名单

`preload.js` 在既有 `window.srtAPI` 上仅新增：

```js
getLocalCliState: () => ipcRenderer.invoke('local-cli:get-state'),
rescanLocalCli: () => ipcRenderer.invoke('local-cli:rescan'),
selectLocalCli: (id) => ipcRenderer.invoke('local-cli:select', id)
```

Renderer 永远不获得 Node、文件系统、环境变量、实际路径、版本输出、进程对象或通用命令执行能力。preload 不增加 `exec`、`spawn`、命令字符串或参数数组接口。

### renderer

`app/env-check.js` 只负责调用以上三项 `window.srtAPI` 方法、维护加载/成功/空/错误状态、按返回项渲染卡片及发起显式选择。UI 以返回的 `id` 作为卡片键，但显示名只使用主进程返回的固定 `label`。页面不缓存可用性或绕过主进程直接保存选择；全局默认值来自主进程状态。

## 扫描算法

扫描只检查进程 `PATH` 与下列少数固定目录，绝不递归扫描全盘、家目录、应用目录或任意用户选定路径。

1. 从进程环境中读取路径变量：macOS 使用键名 `PATH`；Windows 以大小写不敏感方式找到 `Path`/`PATH`。按平台分隔符分割、移除空项、保留原有先后顺序并去重。
2. 在 PATH 后按顺序追加固定目录：
   - macOS：`/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`、`$HOME/.local/bin`、`/Applications/Codex.app/Contents/Resources/codex`、`$HOME/Applications/Codex.app/Contents/Resources/codex`。
   - Windows：`%APPDATA%\\npm`、`%LOCALAPPDATA%\\Programs\\nodejs`、`%ProgramFiles%\\nodejs`、`%ProgramFiles(x86)%\\nodejs`。
   `HOME`、`APPDATA`、`LOCALAPPDATA`、`ProgramFiles` 或 `ProgramFiles(x86)` 缺失时，跳过相应目录，不能猜测替代家目录。
3. 对普通目录候选拼接主命令名；macOS 只尝试裸命令名。Windows 只按进程 `PATHEXT` 中的受支持扩展名（以分号分割、大小写不敏感后与 `.COM`、`.EXE`、`.BAT`、`.CMD` 取交集）尝试候选；若 `PATHEXT` 缺失，使用这四个默认扩展名。其他 PATHEXT 类型不属于本期；不尝试 Windows 无扩展名文件。这保证 `.cmd` 包装器可被发现。Codex.app 的两个固定条目是文件候选，只对 `codex` 检查该文件本身，绝不将其他 CLI 拼入 app bundle。
4. 所有候选先用 `lstat` 判断；若是符号链接，使用 `realpath` 解析最终目标并对最终目标 `stat`。只有最终目标为普通文件才可继续：有效的可执行符号链接被接受，悬空链接以及最终指向目录、设备或 FIFO 的链接都拒绝。macOS 对解析后的最终目标再用 `fs.access(path, X_OK)` 验证。Windows 只接受最终为普通文件且扩展名是本次受支持 `PATHEXT` 项的候选；目录、设备、FIFO、悬空链接和无扩展名候选都拒绝。`realpath` 与 `stat` 仅用于验证；扫描器保留最初发现的、已绝对化的候选路径作为探测入口，绝不以最终目标路径替换它。
5. 对验证候选执行固定 `--version`，每次最多 3 秒，stdout 与 stderr 总计最多 64 KiB。原生 Windows `.exe`/`.com` 和 macOS 文件以最初发现且已验证的绝对候选路径及 `['--version']` 通过 `execFile` 或等价 `spawn` 执行，`shell: false`；符号链接入口也必须以入口路径传给运行器。Windows `.cmd`/`.bat` 绝不直接交给 `execFile`：运行器以已解析的 `ComSpec` 或 `cmd.exe` 为绝对程序，固定参数前缀 `['/d', '/s', '/c']`，并以 `windowsVerbatimArguments: true` 传入一个受控命令尾部。

   批处理命令尾部遵循 OpenDesign 的最小单参数引用模式。对原始绝对候选路径与固定 `--version` 分别调用 `quoteCmdArgument(value)`：仅当值包含空白或 `"&<>|^%` 中任一字符时才加双引号；内部双引号加倍；百分号替换为 `"^%"`，以断开百分号并阻止环境变量展开。Windows 文件名本身不允许双引号，但 helper 仍按同一固定算法处理。将两个引用后的值以一个空格连接为 `inner`，并把第四个参数构造为 `"${inner}"`；实际调用参数严格为 `['/d', '/s', '/c', "${inner}"]`。Node `shell` 选项仍为 `false`。这条受控包装仅使可发现的批处理包装器能够启动；它不接受 renderer 或用户的路径、命令、参数或环境变量，不能形成通用 shell 接口。

   退出码为零即成功；超时、启动失败、非零退出和输出超限都只视作该候选不可用，不向 UI 暴露诊断文本。
6. 同一 CLI 的一个候选成功后不再尝试其后的候选；所有定义完成后返回成功项。扫描器绝不以命令名调用 shell，也不调用 CLI 的其他子命令。

macOS 的 Codex.app 支持是上述两个固定 bundle 内可执行文件候选；它独立于 PATH，因此 Finder 安装但未写入 shell PATH 时仍可被发现。Gemini 的固定定义由 SRTP 自行制定，不能声称来源于 OpenDesign。

## 最小数据契约

所有 CLI 状态 IPC 返回同一形状：

```js
{
  available: [
    { id: 'codex', label: 'Codex CLI' }
  ],
  selectedCliId: 'codex' // 或 null
}
```

`available` 只含三个固定 id 的成功项且按固定顺序排列；`selectedCliId` 必为 `null` 或 `available` 中的一个 id。没有 `path`、`command`、`args`、`version`、`stdout`、`stderr`、`environment`、认证、安装、模型、执行、账户、令牌或诊断字段。选择被拒绝时 IPC 以固定错误码 `LOCAL_CLI_NOT_AVAILABLE` 拒绝；renderer 仅显示“所选 CLI 当前不可用，请重新扫描。”并重新读取状态。

## 状态变化与持久化

| 事件 | `available` | `selectedCliId` | UI |
| --- | --- | --- | --- |
| 首次扫描且有可用项 | 成功项 | `null` | 显示未选中的可用卡片 |
| 用户选择成功项 | 不变 | 所选 id | 该卡片显示“已选为默认” |
| 重新扫描，已选项仍成功 | 最新成功项 | 原 id | 保持已选状态 |
| 重新扫描，已选项不再成功 | 最新成功项 | `null`，并持久化 | 清除高亮，要求用户自行重新选择 |
| 重新扫描为空 | `[]` | `null`，并持久化 | 仅显示“未扫描到可用本地 CLI” |
| 本次扫描 IPC 失败 | 不更新已保存文件 | 不使用失败结果改变选择 | 显示扫描失败与重试入口 |

“要求重新选择”只意味着不再提供默认 CLI；它不跳转、不弹出阻断对话框、不自动切换、更不阻止进入软件。

## 错误处理与最低充分安全

扫描器默认使用 Node 的 `child_process.execFile` 或等价的绝对路径 `spawn` 封装；原生程序必须满足 `shell: false`、最初发现且已验证的固定程序路径、固定参数、短超时及输出上限。验证符号链接时，最终目标仅供 `realpath`/`stat`/`X_OK` 检查，运行仍从原始入口路径开始。不得使用 `exec`、`execSync`、shell 字符串拼接或现有 `cli:exec`。Windows `.cmd`/`.bat` 是唯一例外：只能使用上一节规定的固定 `ComSpec`/`cmd.exe /d /s /c` 包装与 `quoteCmdArgument` 的单参数引用规则，同时仍保持 Node `shell: false` 和 `windowsVerbatimArguments: true`。输入 id 只是固定枚举键，绝不参与路径拼接或进程参数。

单项文件检查或版本探测出错只让该项不出现在结果中；不把错误信息、绝对路径、PATH、环境变量或版本输出发送到 renderer。偏好文件写失败时，选择接口返回固定错误码 `LOCAL_CLI_PERSIST_FAILED`，页面显示“无法保存本地 CLI 默认值，请重试。”，并保留主进程最后成功保存的状态。读取偏好文件失败仅按无选择继续。

本期不把“已发现”当作已认证、已授权或可以执行任务的承诺。

## TDD 与端到端测试范围

先写测试，再实现。测试替换的只应是文件系统、进程环境、`execFile`/运行器与 Electron 用户数据目录；不能 mock 掉扫描器、选择存储、IPC 或 renderer 的业务边界。

单元测试至少覆盖：

1. 三项固定定义、稳定排序、只返回成功验证项，以及不自动选择第一项。
2. PATH 优先级、固定目录补充、无递归扫描、macOS 两个 Codex.app 候选。
3. 有效可执行符号链接被接受；悬空链接及最终指向目录、设备或 FIFO 的链接被拒绝；macOS 最终目标必须通过 `X_OK`，但运行器收到的仍是原始符号链接入口绝对路径。
4. Windows 大小写不敏感 `Path`、`PATHEXT` 与 `.cmd`/`.bat` 候选；PATHEXT 缺失时的默认扩展名，且无扩展名候选不被尝试。
5. 原生程序的 3 秒超时、64 KiB 上限、最初发现且已验证的固定绝对入口路径与 `['--version']`、`shell: false`；任意失败不产生可用项。
6. Windows `.cmd` 探测能实际启动：带空格、`%`、`&`、`^` 的固定候选路径按 `quoteCmdArgument` 构造结果并执行；调用固定 `ComSpec`/`cmd.exe /d /s /c`、`windowsVerbatimArguments: true` 与 Node `shell: false`，且除了固定 `--version` 没有其他可变参数。
7. 选择只接受当前成功的固定 id；持久化、覆盖选择、非法偏好恢复、已选项消失时清除且绝不自动切换。
8. IPC/preload 仅公开三项 CLI 方法，并且 renderer 不能获得路径、版本、认证、安装、模型或命令执行字段。

Electron 端到端测试至少覆盖：

1. 有两个成功项时只显示两个卡片，首次没有默认项；继续进入主页无需选择。
2. 用户选择 Claude Code 后关闭并重开 Electron，仍显示 Claude Code 为默认。
3. 已选 Claude Code 在重扫中消失、Codex CLI 仍存在时，Claude 选择被清除且 Codex 不会自动选中。
4. 三项均失败时，结果区域精确显示“未扫描到可用本地 CLI”，没有灰卡、安装或登录入口，仍能进入主页。
5. renderer 点击重新扫描只走 `local-cli:rescan`，版本探测使用固定 `--version`，不调用现有 `cli:exec`、AI 或安装接口。

## 非目标与后续阶段

本期停止于“发现并选择”。后续自然语言到精确剪辑指令、对选中 CLI 的实际调用、Remotion 执行、执行许可、错误反馈、模型能力、认证、安装和更多 CLI 必须分别立项、单独设计与验收。它们不得借本期 API 字段、通用命令接口或隐藏按钮预埋。

## 可核验验收标准

- 仅 Codex CLI、Claude Code、Gemini CLI 三种固定定义参与扫描；未安装/失败项不显示灰卡。
- UI 包含“目前仅支持 Codex CLI、Claude Code 和 Gemini CLI。”，空结果区域精确为“未扫描到可用本地 CLI”。
- 用户未点击卡片时无默认 CLI；永远不会自动选择第一个可用项或在已选项失效时自动切换。
- 默认选择存于 Electron 用户数据目录、重启后保持；失效扫描会清除它并持久化。
- macOS 支持 PATH、固定目录、两个固定 Codex.app 内置候选及安全解析后的可执行符号链接；悬空或非文件目标不通过，成功探测仍从原始符号链接入口路径启动。
- Windows 仅按 `Path` 与有效 `PATHEXT` 处理原生程序、`.cmd`/`.bat`，不尝试无扩展名文件；批处理经固定 `ComSpec`/`cmd.exe /d /s /c`、受控引用与 `windowsVerbatimArguments: true` 启动，Node `shell` 仍为 `false`。
- 扫描不递归全盘；所有探测均为验证后的固定路径加 `--version`，3 秒超时和 64 KiB 输出上限。原生程序不用 shell，批处理包装不接受任何用户命令或参数。
- IPC 返回不包含路径、版本、环境、认证、安装、模型、执行或秘密字段；不存在可复用的任意命令执行接口。
- 空、失败和未选择状态均可继续进入软件。
- 上述单元及 Electron 端到端测试通过；完成后不扩展范围。

## 参考依据：OpenDesign 源码及差异

OpenDesign 在其研究时 HEAD `50e305dff2b64d9dc0220e5dfa5d8c98ba4364e3` 中提供了可借鉴的固定运行时定义、PATH/PATHEXT 与少量常见目录、可执行文件检查、短超时 `--version` 探测、手动重检和显式选择思路：

- [runtime registry](https://github.com/nexu-io/open-design/blob/50e305dff2b64d9dc0220e5dfa5d8c98ba4364e3/apps/daemon/src/runtimes/registry.ts)
- [executables](https://github.com/nexu-io/open-design/blob/50e305dff2b64d9dc0220e5dfa5d8c98ba4364e3/apps/daemon/src/runtimes/executables.ts)
- [detection](https://github.com/nexu-io/open-design/blob/50e305dff2b64d9dc0220e5dfa5d8c98ba4364e3/apps/daemon/src/runtimes/detection.ts)
- [agents route](https://github.com/nexu-io/open-design/blob/50e305dff2b64d9dc0220e5dfa5d8c98ba4364e3/apps/daemon/src/routes/static-resource.ts#L444-L495)

SRTP 不照搬其约 27 个 runtime 定义及通用检测/执行/模型/auth 体系。本规格严格限定三个 CLI、仅返回成功扫描结果、无 profiles、无模型列表、无认证、无安装、无执行、无诊断/fix-action、无 SSE、无自动选择，也不显示不可用项。OpenDesign 当前代码没有 Gemini runtime 定义；SRTP 的 Gemini CLI 定义是独立定义，不能宣称复制自 OpenDesign。
