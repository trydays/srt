# 重点文字与毛玻璃素材卡片 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement the selected cycle task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 原计划已进入执行；完成情况以末尾阶段结果及研发日志为准。

**Goal:** 以用户视频 14–28 秒的重点文字、2–10 秒的素材卡片为参考，交付可调整的重点文字和粉色毛玻璃卡片，并让自然语言请求最终能够从语音内容提炼要点、按时间应用。

**Architecture:** 继续使用 `ProjectEditing → EditDocument → RenderGraph → SrtComposition`，同一个 Remotion 场景服务 Player 和 MP4。扩展现有文字、底板、组合子层和本地素材接入；要点提炼复用本地识别及 CLI，最终仍输出现有 `instruction.steps` 并整次提交。

**Tech Stack:** 现有 Electron、JavaScript、React、Remotion 4.0.522、SVG/HTML、现有本地语音识别与 CLI。FFmpeg/ffprobe 负责素材准备和媒体核验；画面合成继续由 Remotion 负责。

## Global Constraints

- 当前基线：`e4dd71de5b87e6b7e2baa3d462d76de9a523cff8`；实际工作树 `/Users/mac/Documents/Codex/SRTP-worktrees/subtitle-export-cycle0`，制定计划时工作树干净。
- 原始计划按周期推进；2026-09-09 用户已批准 R5 外观，并授权继续正式接入和自动提炼。每周期以可播放或可操作结果验收，不扩展效果平台。
- 用户要求的粉色用于试做视频中的卡片；软件界面配色和布局沿用现状。
- 参考原片 `/Users/mac/Downloads/37875025116-1-192.mp4`；对照片段 `/tmp/srt-reference-inspect/02-10-exact.mp4`、`/tmp/srt-reference-inspect/14-28-exact.mp4` 已分别核验为 8 秒、14 秒。
- 第一周期产物是明确标记的视觉试做；固定配方通过、真正模型推导通过、用户观感通过分别记录。不能把已有参考片中的烧录效果当作新渲染成果。
- 圆角、透明度、辉光、字重、位置、素材引用与时段属于可组合参数；不建立效果名称到固定配方的查表。演示文案和粉色数值只进入试做配置。
- 现有单主视频、主视频原声音、一次请求整次撤销和追加编辑语义保留。内嵌视频本轮默认静音；字幕仍单独置于最上层。
- 现有能力与旧存档必须继续可读。无需新增顶层项目格式；新增可省略的样式参数使用中性默认值。
- 不在本计划加入字体平台、任意代码执行、云素材库、联网搜素材、自动训练、多轨音频、三维或无限时长的分段理解系统。简单图标可作为普通图片素材插入，不另建图标平台。
- 只运行与本次改变有关的行为测试；合并前必要完整回归跑一次，未改变代码且没有新疑点时不重复全套。Git 提交/推送按后续用户指令进行。

## 现状核对与缺口

| 已核实的现状 | 对本计划的影响 |
| --- | --- |
| `src/visual-layers.js` 已有圆角、边框、填充透明度；文字只有内容、位置、字号、颜色 | 复用已有底板；补足字重、标签字距、轻阴影及玻璃/辉光所需参数 |
| `src/visual-group.js` 只接受 shape/text，共享 opacity/scale；坐标相对整个画幅 | 延续坐标和动画语义，新增媒体子层，不引入嵌套时间轴 |
| `app/components-data.js` 已列出“毛玻璃面板”“边框光晕” | 展示页按类别生成统一 CSS 示意动画，这些名称目前不能证明成片能力已接通 |
| `app/remotion/layers.jsx` 使用 SVG；主视频有源效果时先绘入 Canvas | 毛玻璃跨容器、组透明度和 Canvas 的实际取样必须先在 Player 与成片中验证 |
| `src/remotion-assets.js` 当前一个会话只服务一个本地视频 | 需要图片 MIME、素材 ID 索引、所引用素材的会话准备；复用已有文件读取/Range/关闭方式 |
| `app/editor-project-editing.js` 已有 Player 时复用旧 `input.assets` | 新素材必须触发资产集合更新，单改图层 schema 会出现找不到素材 |
| 语音服务只返回带时间的 segments，应用字幕在另一层完成 | 可以读取语音而不添加字幕轨 |
| 现有 AI 字幕摘要在两处截断为前 500 段、每段 80 字 | 要点提炼需要独立完整 transcript 输入，不能拿现有摘要冒充完整视频内容 |

## 周期、时间与退出条件

### 2026-09-09 用户批准的简化执行边界（优先于下方原始估算）

- 按三次交付推进：R5 两段效果试做 → R6/R7 合并为正式样式与素材接入 → R8 自动提炼；保留原任务编号便于追踪。
- R5 目标 30–45 分钟、硬止损 60 分钟；30 分钟检查首份可播放草稿，45 分钟检查两段画面。预览入口/脚本等纯支撑工作初始额度 15 分钟，超出先报告；不把绘制效果和实际画面检验计为纯支撑。
- R6/R7 合计 90–120 分钟、R8 45–60 分钟仅为待 R5 实测后校准的目标，不是已验证承诺；撤回将原上限合计或 3–4 小时描述为确定工期的含义。
- R5 只完成视觉试做及共享组件，不接正式 AI 参数、素材管理或自动提炼；成片与差异交给用户检查后，再推进正式接入。
- 本轮取消竖版必过项；跨项目技能自动重新选择素材移到以后。稳定素材 ID、未知/旧项目 ID 拒绝、缺失提示及既有技能行为保留。
- 执行开始 2026-09-09 11:22（Asia/Shanghai）；基线定向检查 14 项通过、1 项需真实浏览器的检查跳过。仅开发当前 R5，不提交或推送 Git。

时间为本机开发和必要验证的初步预算，包含工具等待；并非保证。第一周期之后用实测结果收紧后续估计。上限是停下来报告的阈值，不能自动续期。

| 周期 | 唯一目标 | 可直接查看的交付 | 初估 / 上限 | 半程必须出现 | 退出条件 |
| --- | --- | --- | --- | --- | --- |
| R5：视觉复刻 | 确认两种效果的外观和 Remotion 可行性 | 8 秒玻璃素材卡片＋14 秒重点文字的两个预览 MP4，同配置 Player | 45–90 分钟 / 90 分钟 | 45 分钟前至少一份可播放成片 | 两段可播放，关键效果成立，列出与参考的视觉差异供用户验收 |
| R6：文字与玻璃接入 | 样式从 AI 参数贯通到正式编辑器 | 一条请求生成带样式文字/底板，保存、重开、撤销、导出可用 | 60–120 分钟 / 120 分钟 | 60 分钟前在正式编辑器看到新样式 | 新样式正式闭环通过，旧项目外观不变 |
| R7：素材卡片接入 | 卡片能引用用户的本地图片/视频 | 导入素材→自然语言放入卡片→播放/重开/导出 | 90–150 分钟 / 150 分钟 | 75 分钟前图片卡片完成桌面预览和导出 | 图片与静音视频均能按指定时段显示、导出及撤销 |
| R8：自动提炼要点 | 用户一句话得到与语音对应的重点文字 | 一条请求自动取得文本、提炼要点、按时段生成文字并导出 | 60–120 分钟 / 120 分钟 | 60 分钟前出现一份由真实模型推导的重点文字结果 | 有字幕/无字幕两种输入成立，整次撤销和后续请求不重做旧结果 |

初估合计 **4 小时 15 分–8 小时**，分四次交付；其中第一份视觉成果预计 45 分钟内可看。不能把上限合计当作实际工期。R8 的纯文字要点依赖 R6，不依赖 R7；默认顺序保持 R5→R6→R7→R8，必要时可先完成文字自动化。

每周期记录实际开始、可见成果、结束时间及偏差。支撑性工作接近本周期投入 25% 时检查；达到预算 50% 仍无可见成果、单个支撑模块超过原估两倍、或需要更换渲染核心时立即停下报告。样式检查、素材实际解码和原音保留是此次用户成果的直接验收，不借机扩大到极端故障平台。

## R5：两段可以播放的视觉复刻

### Task 1：共享视觉实现及对照预览

**Files（拟新增）：**

- `app/remotion/glass-surface.jsx`：玻璃底板、裁切、柔和边缘光的共同实现；本周期由试做入口调用。
- `app/remotion/styled-text.jsx`：有字号层级、字重、字距及轻阴影的文字绘制；后续正式图层复用。
- `previews/reference-effects/entry.jsx`：注册两个试做 Composition 和 Player，调用上述组件及既有组采样。
- `previews/reference-effects/scenes.mjs`：两段试做的人工配置、文案和时间，不进入产品提示词。
- `scripts/render-reference-effects.mjs`：调用本机已安装的 Remotion bundler/renderer，产出两段 MP4 和关键帧，视频文件保存在临时目录。

**Interfaces（新增）：** `GlassSurface({geometry, frameStyle})` 与 `StyledText({geometry, frameStyle})`。`geometry` 使用像素坐标、宽高或文字行信息；`frameStyle` 提供当前帧的 opacity、scale、固定 pivot。透明度/缩放值来自既有 `visualGroup.sample()`。CSS 合成层如何摆放由本周期验证，不能简单给父容器加 opacity 后就认定背景模糊成立。

**明确画面：**

- 玻璃片段：粉色初值 `#F6AACB`，填充 alpha 约 0.22，圆角、细边和柔和辉光；背景使用有纹理的运动画面以看清模糊。卡片中间先展示图片、再展示视频，两种素材都保持清晰。整体淡入约 0.3 秒、淡出约 0.3 秒，轻缩放 0.96→1；这是可调整的试做初值。
- 文字片段：围绕参考中“大团队”与“一个人”的两处语义，展示大标题、短副标题、小标签的分级与错时出现；位置预留主体中部和底部字幕空间。初版以淡入/缩放及错时组合作为弹出动效，不把“滑入”或“逐字揭示”声称为已实现。
- 原参考只作对照。优先使用干净底片；若原视频没有合适干净区域，使用合成底片配已授权视频截取的内嵌素材，并明确标注。不能将原片本来就存在的卡片裁出来，作为本轮新卡片的生成证明。

- [ ] 用本机 Remotion 对一个有纹理的运动背景同时生成 Player 和 MP4；先验证局部背景模糊、透明淡入和嵌入素材清晰。沿用现有工具，不安装新引擎。
- [ ] 试验点包含普通视频背景和已调色的 Canvas 背景，检查反向跳转/暂停时卡片采到当前帧；模糊采样包含实际位于卡片后面的内容。若 CSS 路径受合成隔离影响，定位到当前 DOM/SVG 结构；预算内不能解决即报告证据，不用灰色透明矩形冒充毛玻璃。
- [ ] 检查发光出现在卡片边缘，未被卡片裁切截掉；中间素材的圆角裁切与外部辉光分开处理。
- [ ] 完成两段横版 1280×720 配置，导出 `glass-card-preview.mp4`（8 秒）、`keypoint-text-preview.mp4`（14 秒）；采用 30fps 的试做时间轴，原片约 30fps 只作参考。
- [ ] 对比入场、停留、退场三类时点：毛玻璃真实可见、文字清晰、素材播放、透明度整体一致。本周期只验收参考横版画幅，不增加竖版检查。
- [ ] 打开两段成片，记录视觉差异及确认后的参数/合成方式，写入本计划的 R5 结果栏；此时只完成视觉层，不宣布正式软件或自动提炼完成。

执行入口（本任务新增脚本，参数含义在脚本实现中固定）：

```sh
node scripts/render-reference-effects.mjs --scene glass --out /tmp/srt-reference-effects/glass-card-preview.mp4
node scripts/render-reference-effects.mjs --scene keypoints --out /tmp/srt-reference-effects/keypoint-text-preview.mp4
```

脚本创建临时输出目录，输出路径若已存在则使用新的运行子目录，不覆盖用户文件。首轮不为视觉试做编写大量单元测试；以真实画面和 seek/导出检查为证据。

## R6：把确认的文字与玻璃样式接入软件

### Task 2：沿现有图层贯通样式

**Files：** 修改 `src/visual-layers.js`、`src/visual-group.js`、`src/edit-capabilities.js`、`app/remotion/layers.jsx`、`app/remotion/SrtComposition.jsx`；复用 R5 两个 JSX 组件。测试落入 `tests/visual-layers.test.js`、`tests/instruction-capabilities.test.js`、`tests/project-editing.test.js`、`tests/remotion-scene.test.js`，新增 `tests/e2e/remotion-glass-text-flow.spec.js`。历史渲染校验入口仅在实际兼容测试暴露需求时作窄修改。

**Interfaces：** 沿用 `normalizeParams(kind,params,requireExplicit)`、`geometry(kind,params,width,height)`、`visual.group@1` 和 `applyRecipe({projectId,expectedRevision,requestId,recipe})`。所有新增样式字段可省略，派生数据补默认值，原存档加载不写回。

以下是计划用的参数约定；R5 若证明某参数不必要，应在开 R6 前删除该项并记录理由，不能持续添加属性：

| 归属 | 参数 | 范围 / 默认 | 单位与用途 |
| --- | --- | --- | --- |
| shape | backdropBlur | 0–0.08 / 0 | 画幅高度比例，转换为像素，只模糊背后画面 |
| shape | glowBlur | 0–0.08 / 0 | 画幅高度比例，控制边缘光柔和范围 |
| shape | glowColor / glowOpacity | #RRGGBB / #FFFFFF；0–1 / 0 | 发光颜色和强度；默认不发光 |
| text | fontWeight | 400、600、700、800 / 400 | 大标题字重；同步修改字体加载等待的字重声明 |
| text | letterSpacing | 0–0.5 / 0 | 当前字号比例，用于短标签字距 |
| text | shadowBlur | 0–1 / 0 | 当前字号比例，用于轻微文字阴影 |
| text | shadowColor / shadowOpacity | #RRGGBB / #000000；0–1 / 0 | 默认无阴影 |

几何转换示意（新增字段在规范化之后转换）：

```js
const backdropBlurPx = shape.backdropBlur * canvasHeight;
const glowBlurPx = shape.glowBlur * canvasHeight;
const letterSpacingPx = text.letterSpacing * fontSizePx;
const shadowBlurPx = text.shadowBlur * fontSizePx;
```

- [ ] 先补一条能区分真实行为的测试：带新样式的组经真实解析器、项目保存/重开后仍保留参数；旧组缺少字段时外观中性、原存储内容不变；未知字段和超范围值拒绝。
- [ ] 扩展现有 schema/geometry，由注册表自动提供给 AI；正式 `VisualLayer`/`GroupLayer` 复用 R5 经过验证的绘制。混合 DOM/SVG 时保持全画幅比例坐标、原 pivot、组透明度合成以及字幕最后绘制。
- [ ] 用一条明确固定的测试翻译经正式输入框，生成玻璃底板及标题/说明/标签；不需要 R7 的导入素材即可完成这一周期的独立验收。
- [ ] 验证重开和整次撤销、真正 MP4、主声音保留，以及既有圆角/普通文字不被改变。用真实模型一条明确新建样式的请求确认参数可被推导，记录模型失败与渲染失败的区别。
- [ ] 核对 AI 目录只暴露已经接通的新参数；已有组件展示页的条目不能作为能力通过证据。将真实预览放入组件展示页列为后续展示优化，不阻挡本次正式编辑闭环。
- [ ] 定向测试和画面通过后更新研发日志，报告能力与本周期耗时，停止 R6。

```sh
node --test tests/visual-layers.test.js tests/instruction-capabilities.test.js tests/project-editing.test.js tests/remotion-scene.test.js
npm run build:remotion
npx playwright test tests/e2e/remotion-glass-text-flow.spec.js --workers=1
```

## R7：让用户自己的图片和视频进入卡片

### Task 3：本地素材引用与完整编辑闭环

**Files（新增）：** `src/project-assets.js` 保存每项目的本地素材索引；`src/visual-media.js` 负责 image/video 子层参数和时间几何；`app/remotion/media-layer.jsx` 负责共同绘制；`app/editor-assets.js` 负责一个轻量导入入口及已导入素材选择。

**Files（修改）：** `main.js`、`preload.js`、`app/剪辑.html`、`src/visual-group.js`、`src/edit-capabilities.js`、`src/remotion-assets.js`、`src/remotion-input.js`、`src/remotion-export.js`、`app/editor-project-editing.js`、`app/remotion/layers.jsx`、`src/instruction-capabilities.js`。不把辅助素材塞进只允许一个主视频的 `document.sources`。

**Interfaces（拟新增）：**

```js
// main 端持有本地路径；渲染端和 AI 只持有稳定 ID 与媒体事实。
createProjectAssetStore({ rootDir }) // 返回 importFile、list、resolve 三个方法
store.importFile({ projectId, filePath }) // Promise<AssetSummary>
store.list(projectId) // Promise<AssetSummary[]>
store.resolve({ projectId, assetIds }) // Promise<Array<{assetId,filePath}>>
// AssetSummary = {assetId,name,kind,width,height,durationSeconds?}

// preload：importProjectMedia 打开系统文件选择框，取消返回空列表。
srtAPI.importProjectMedia({ projectId }) // Promise<{ok,assets}>
srtAPI.listProjectMedia({ projectId }) // Promise<{ok,assets}>
// src/visual-media.js
normalizeMediaParams(kind, params) // kind 只能为 image 或 video
```

首次支持本机可解码的 PNG/JPEG/WebP 图片及 MP4 视频，沿本机已有媒体能力验证。索引记录路径与媒体事实，不把路径送给模型；本轮以引用本地文件为默认策略，移动原文件后清楚提示素材不可用。撤销编辑不删除素材文件。

子层接口与时间规则：

```js
{ kind: 'image', params: {
  assetId, x, y, width, height, fit: 'contain', cornerRadius: 0
} }
{ kind: 'video', params: {
  assetId, x, y, width, height, fit: 'cover', cornerRadius: 0,
  sourceStartSeconds: 0
} }
```

`x/y/width/height` 沿用全画幅比例；`fit` 只允许 contain/cover；cornerRadius 沿用较短边比例。内嵌视频正常速度、静音、不循环；素材剩余时长必须覆盖组区间，不足时说明原因，不擅自补帧或重复播放。`ceil(range.start*fps)` 为首个可见输出帧，媒体入点按同一时间量化方法换算，后续使用相对可见帧推进；与既有半开区间保持一致。原生 24/30fps 和小数起点至少各核对一处，避免跳到素材全局时间。

- [ ] 先做图片闭环：导入并持久化稳定 ID，真实确认能解码及尺寸；给 AI 只提供当前项目素材摘要。模型引用未知 ID 在提交前拒绝。
- [ ] `visual.group@1` 增加 image/video 子类并注册实际绘制；shape/text 原行为保留。素材可以放在玻璃底板之上、文字之下，按已有 layers 顺序渲染。
- [ ] 保留 `createRenderAssetSession({assetId,videoPath})`，增加汇总多个已引用素材会话的薄封装，复用当前文件句柄、Range 和 close。准备失败清理本次已打开的会话，运行时只为实际引用素材准备访问地址。
- [ ] `createRenderInput` 检查所有引用 ID 都已提供；预览检测引用资源集合变化，准备新会话后更新 Player 的 assets。取消或过时的异步准备沿现有 generation/session 规则释放，不能复用旧 assets 导致黑块。
- [ ] 导出固定本次图快照和引用清单；图片/视频底层使用本机 Remotion `Img`/`OffthreadVideo` 及共同组绘制，内嵌视频显式静音。主视频音轨有/无两种情况保持原样。
- [ ] 在已有图片闭环上增加视频入点和播放；通过预览拖动、重开、实际导出、整次撤销验证。图片和视频分别位于卡片内，毛玻璃及发光仍正常。
- [ ] 保留既有个人技能行为，拒绝执行当前项目未知或来自旧项目的素材 ID，并清楚提示素材缺失。跨项目自动重新选择素材列入以后，不作为本轮验收。
- [ ] 完成 `tests/project-assets.test.js`、`tests/visual-media.test.js`，以及现有 `tests/remotion-assets.test.js`/`tests/remotion-input.test.js` 相关断言；新增一个 `tests/e2e/remotion-media-card-flow.spec.js` 验证两种媒体。日志更新后停止。

```sh
node --test tests/project-assets.test.js tests/visual-media.test.js tests/remotion-assets.test.js tests/remotion-input.test.js
npm run build:remotion
npx playwright test tests/e2e/remotion-media-card-flow.spec.js --workers=1
```

## R8：从视频语音自动得到重点文字

### Task 4：一次请求准备文本、提炼并应用

**Files：** 修改 `src/instruction-capabilities.js`、`app/editor-timeline.js`，新增 `src/transcript-context.js` 负责全文检查和范围选择。复用 `src/subtitles.js`、`main.js` 的 `subtitles:generate`、`preload.js` 的 `generateSubtitles` 以及 `subtitleController.getAppliedSegments()`；只有接口实际需要时才修改这些已有模块。测试用 `tests/instruction-capabilities.test.js`、`tests/transcript-context.test.js` 和新增 `tests/e2e/keypoint-text-flow.spec.js`。

**用户流程：** 用户在原输入框要求“提炼这段视频的要点，在对应位置弹出重点文字”。已有已应用字幕就复用完整文本；没有时由模型申请一次文本准备，软件在本地识别语音，再自动续推，最终生成对应时段的多个文字组合。读取语音本身不增加可见字幕，不修改用户字幕草稿。全文预算仅限制需要原文的分析请求，不能导致同一长视频的普通调色/加字命令也无法执行。

**必要的小协议扩展：** 普通结果仍为 clarify/instruction。模型确实缺文本时允许以下一种严格准备响应，由编辑器内部处理；它不进入效果目录、项目图或时间线。

```json
{"kind":"prepare","resource":"transcript","range":{"start":14,"end":28}}
```

准备响应固定三个字段，range 为模型根据用户范围与已知视频时长填写的原片时间；全片请求为 0 到视频总时长。每个用户请求最多一次 prepare 和一次续推；第二次仍要求 prepare 为协议错误，不建立循环 Agent。`parseInstruction` 增加这一精确分支，拒绝其它 resource、额外字段及非法时间，编辑器再验证范围没有超过当前视频；`buildPrompt` 说明何时已有完整 transcript、何时可申请，以及已有编辑不需要再执行。

**Interfaces（新增）：**

```js
// 独立于原先有截断的字幕轨摘要。
selectTranscript({ segments, source, range, maxChars: 24000 })
// 返回 {source, range, segments:[{start,end,text}], complete:true}
// source: applied-subtitles 或 speech-recognition。
// 选择与范围相交的完整段；超过上限显式报错，不截断正文。
```

`context.transcript` 供首轮或续推使用。已有已应用全文在预算内时可直接附加；超预算则保留原有普通编辑摘要，由需要原文的模型申请具体范围。prepare 指定范围后只选相交的完整段，段落保留原片时间；最终新要点不得超出所请求的分析区间。选中正文仍超过 24000 字符才提示缩小范围；这允许文本量合适的长片，不以“只取前半段”冒充整片分析。本轮以 30–90 秒中文口播验收自动链路，并对超过原摘要限制的文本做一次定向验证。

- [ ] 测试完整 transcript 不受旧 500 段/80 字摘要限制；超出输入预算明确说明；原字幕草稿仍未应用。语音文本中的命令式内容只作为待分析素材，不作为应用指令。
- [ ] 在 `translateAndApply(text,record,card)` 开头固定 projectId、revision、主素材标识和当前技能。已有完整已应用字幕随首轮发送；无字幕且得到 prepare 时调用既有识别服务，返回后带完整 transcript 续推一次。
- [ ] 准备期间复用同一条历史记录显示“读取语音／提炼要点”，成功后自动折叠。先判断 prepare/clarify/instruction，再更新执行状态，避免出现“已转换但应用失败”的误导提示。
- [ ] 最终每个要点为一个 `visual.group@1`，含大标题、简短说明和可选标签；每组 range 对应原语音时段。数量随内容和用户要求决定，初次模型验收目标为 2–4 处；不硬编码全片一律生成几条。
- [ ] 默认布局使用主体两侧安全区，预留底部字幕区；当前只掌握画幅和文本，不把这种默认布局宣传为人脸识别/自动跟踪。用户可指定左侧或右侧。
- [ ] 最终一次 `applyRecipe` 提交全部新组；中途准备不提交。若期间换了项目/素材或 revision 改变则终止该结果，保留当前项目。历史恢复发现该 record 对应事务已存在，只恢复显示，不再执行；用户明确要求再次生成则使用新请求 ID。
- [ ] 检查后续普通指令只追加本次步骤；撤销一次移除本次所有要点，字幕和更早的编辑保留。时间线需要显示各要点实际范围，若当前聚合显示覆盖空白时段，仅修正该展示投影，不重做时间轴。
- [ ] 固定输入回归覆盖已有字幕、无字幕、无语音、一次续推、准备失败、切项目这几项直接业务分支。真实模型验证使用人工口播片与当前已选 CLI，核对提炼内容、出现时间、文字可读性和实际 MP4；其中一次无字幕请求至多两次 CLI 调用，不盲目重试。
- [ ] 若模型不可用或耗时失败，清楚记录停在哪一步，不更换渲染架构或擅自延长 CLI 时限。这个验收未通过就不能宣布自动链路完成。
- [ ] 结束前跑相关定向回归与一次完整现有回归；更新研发日志、项目状态、真实 AI 结果和两类用户可见文件，完成本计划。

```sh
node --test tests/transcript-context.test.js tests/instruction-capabilities.test.js tests/project-editing.test.js
npm run build:remotion
npx playwright test tests/e2e/keypoint-text-flow.spec.js --workers=1
```

## 完成后可对用户承诺的能力

- 用户能按自然语言新建不同内容、颜色、位置与时段的重点文字和玻璃素材卡片。
- 卡片可放已导入的本地图片、静音视频，按所选时段播放；主视频声音保留。
- 有语音内容时，能够通过已有字幕或本地识别获得文本，再提炼成带时间的文字组合；生成的结果可预览、导出、保存和整次撤销。
- 满意的风格沿用既有个人技能保存；不自动跨项目解析旧素材路径。本轮不承诺跨项目自动重新绑定素材。

本计划完成仍不等于任意算法、任意复杂动画、自动理解无语音画面或精准人脸避让。对已存在图层的原位修改继续沿当前软件边界处理；不能把重复追加宣传成修改旧卡片成功。

## 计划自检与阶段结果

- [x] 两个参考区间、粉色要求及 Remotion 核心明确。
- [x] 已有素材/组件目录、真实渲染、素材会话、语音上下文和事务接口均经只读核对。
- [x] 每周期具备唯一目的、可见成果、不做项、预算、半程检查和退出条件。
- [x] 新增参数、资产 ID、准备响应和上下文字段使用统一命名；未引入效果模板平台。
- [x] 字幕提炼与文字绘制分开验收；初始预览不冒称自动链路完成。
- [x] R5：两段视觉预览和用户观感验收（用户 2026-09-09 确认卡片、大标题/说明/标签风格很好）。
- [x] R6：正式文字/玻璃样式本地闭环（固定翻译；真实 AI 表达验收与 R8 一并待授权）。
- [x] R7：图片/静音视频卡片本地闭环。
- [ ] R8：真实模型要点提炼与编辑闭环。

结果只在实际完成后填写。下方分日期结果和研发日志为当前状态；任务原始检查项保留作为要求记录，不以固定翻译通过代替真实 AI 验收。

### R5 实测结果（2026-09-09）

- R5 结束时技术试做已完成、用户观感待确认；用户随后已确认风格很好，并授权正式接入。以下条目记录 R5 当时结果，最新 R6–R8 状态见后节。
- 11:22 开始；约 11:32 两段首版 MP4 已生成，11:35 修订成片生成；11:44 完成主要画面与浏览器检查。首次可见成果约 10–11 分钟，未耗尽 60 分钟止损额度。纯支撑工作粗估约 4–5 分钟，包含工具/权限准备和预览入口，非逐秒工时统计。
- 输出目录 `/var/folders/dz/dz1x73p96xn6d1ss30xqk1dw0000gn/T/srt-r5-u2MwLr/`：`glass-preview.mp4` 和 `keypoints-preview.mp4`，视频分别 240/420 帧，1280×720、30fps、H.264，均含 AAC 原片音轨。编码音频尾部填充使容器分别为 8.064/14.058667 秒，画面为精确 8/14 秒。
- 两个共享 JSX 组件通过同一个 ReferenceComposition 同时用于 Player 与成片；透明度与缩放沿用 visual-group.sample。真实模糊核验包含普通视频、调色 Canvas、淡入阶段和停留阶段；开关模糊的停留图片区域平均像素差约 0–0.002/255，说明内容未被后景模糊处理。背景区域差约 34–35/255；这些数字是观察值，不是调宽验收容差。
- 定向测试 19 通过、0 失败，1 个已有的浏览器驱动开关测试未启用；另在内置浏览器手动式操作核验播放/暂停、5 秒视频入点约 1 秒且 muted、反向跳到 2 秒恢复图片、Canvas 在暂停时绘制第 61 帧、关闭/开启模糊、9.2 秒出现第二组文字。没有冒称正式桌面端完整验收或真实 AI 联调。
- 初次采样失败源于试做层的空参数，最小回归先失败后修正；后景对照的第一次截图相同源于渲染脚本未更新 Remotion resolved props，已修正且重新生成对照。没有修改产品校验规则或更换引擎。
- 差异：两侧为演示底片以隔离原视频烧录效果；中间既有字幕/强调字仍来自参考，非本轮生成。玻璃配色按用户要求改为粉色；文案与时段人工配置；效果风格相近但未声称逐像素一致或已自动理解视频。文字字形与参考仍有差别，待用户查看决定是否需调整。
- 独立代码审查无阻断问题。非阻断记录：脚本 --out 只使用文件名并创建新的运行子目录，实际路径以输出日志为准，避免覆盖既有文件。
- 不提交、不推送、不继续扩大样式参数；下一停止点为用户查看两段视觉试做。

### R6–R8 本地接入结果（2026-09-09）

- 11:50 开始；12:06 正式 Electron 导入图片／视频、玻璃与标题说明标签、保存重开、真实 MP4、整次撤销通过。首个可检验成果约 16 分钟，未等到预算一半。
- R6/R7 复用 R5 组件并公开可选中性样式；加入项目素材 ID 索引、路径只留主进程、参考素材选择与引用集更新。一个组合最多一个位于首层的玻璃底板，多个卡片用多个组；内嵌视频正常速度、指定入点、不循环且静音，原声音保留。旧格式导出只接受其能实际绘制的中性字段，新样式与媒体不静默降级。
- R8 完整字幕输入、prepare／一次自动续推、临时原文反问复用、一次事务定时组、真实区间投影均已实现。普通编辑不受全文预算阻断，读取语音不动字幕／草稿；实际项目版本或主素材路径改变会拒绝迟到结果。
- 全真实开关 Node 450/450；本地要点桌面流程初次 8/8，真实 MP4 补充检查 1/1；旧 R4＋正式素材检查 2/2；素材移动／恢复补充检查 1/1。最终审查修复长字幕选段反问的缓存分支后，要点桌面 **9/9**、协议单测 **41/41**，不再重复全量 Node。均为固定模型响应的产品链路，数量包含重复强化，不相加宣称独立覆盖总数。
- 生产本地 ASR 对参考前 35 秒得到 21 段。真实 Claude 提炼的权限审查要求明确文字发送授权，尚未执行；不上传视频，不绕过批准，不把现有测试称作 R8 完整验收。`tests/e2e/real-keypoints-flow.spec.js` 为显式启用入口，默认不会消耗真实模型调用。
- 证据 `/tmp/srt-r6-r8-Tyoxuo/` 含正式玻璃素材卡片 MP4／截图与固定测试定时文字 MP4／截图。R5 已获用户外观认可；新正式功能仍保留用户人工检查机会。
- 不提交、不推送。真实 AI 语义／时段／成片观感是仍开放的验收门；没有跨项目自动素材重绑定、人物识别、云素材或新渲染平台。

### R8 已授权真实联调结果（2026-09-09 12:40 起）

- 用户允许将前 35 秒识别文字发送给当前 Claude CLI；一次 opt-in E2E、零重试。真实 profile 选择为 claude，首轮响应日志的 model 字段为 `deepseek-v4-pro`，未擅改配置。
- 首轮真实返回 `prepare 0–35`；生产本地识别得到 12 段原文并注入第二轮请求，精确 CLI 会话日志可证。第二轮没有记录到助手输出，界面报“编辑指令转换超时”，执行未开始。
- E2E 1 失败、0 通过，无新重点文字或 MP4。测试 180 秒等待与产品 60 秒调用上限区分；底层退出原因尚未留存，不能凭 UI 超时确定网络／模型／输出限制的具体根因。不自动重试或加长超时。
- R8 仍保持未验收；“授权待确认”已变为“已授权测试失败，第二轮 CLI 待排查”。证据 `/tmp/srt-r8-real-acceptance.xTpVLy/`，详细边界见研发日志最新条目。本轮不变更产品代码，不提交／推送。

### R8 Codex CLI 对照结果（2026-09-09 13:02 起）

- 按用户要求将实际 SRT 偏好切为 Codex，一次真实测试、零重试；提示词、60 秒生产上限、模型自身配置和渲染器均不变。
- 界面 waiting → not_run，报转换超时，尚未观察到准备语音阶段；E2E 1 失败，没有新配方或成片，导出与撤销未执行。R8 继续未验收。
- 测试首次 JSON 正文附件未被 line 报告器落盘，无法报告本次实际进程时长／退出细节／调用次数。已修测试为显式临时文件并离线验证，但未重新请求模型，不追溯填造证据。具体原因仍待 CLI 入口窄查。
- 证据 `/tmp/srt-r8-codex-acceptance.rBmv1G/`；CLI 单测 21/21、脚本语法及差异检查通过，仅证明相关本地检查。默认选择保留 Codex，不提交／推送。
