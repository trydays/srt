# Remotion Core Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. R1–R4 实现和本地自动化验收已完成，用户人工观感待确认。R4 获参考增量确认后按独立小计划执行；R4 真实 AI 尚未授权/执行，未提交或推送。

**Goal:** 保留现有 AI 剪辑、项目、撤销与个人技能成果，让同一 Remotion 场景负责桌面预览和真实视频导出，再按用户参考视频扩展卡片表达能力。

**Architecture:** 继续使用现有 EditDocument → RenderGraph；补充可信媒体信息、画布和帧率，生成同一份 Remotion 输入。现有 Electron 页面只嵌入一个 React 播放区域；Player 和导出服务使用同一个 SrtComposition。迁移期间按整张图选择已支持的引擎，全部八能力通过后切换默认，不建设长期双引擎平台。

**Tech Stack:** 现有 Electron / JavaScript / Node test / Playwright；新增 React、React DOM、remotion、@remotion/player、@remotion/renderer、@remotion/bundler；播放器构建使用 esbuild。执行时核对当前 Electron 内置 Node 与依赖要求，锁定互相兼容的精确版本，Remotion 系列版本一致。FFmpeg/ffprobe 继续用于已有媒体处理、检查与验收抽帧。

## Global Constraints

- 基线：`38c6263ba1f4e0dfe93064e2a604f96c06487efd`，分支 `feature/subtitle-export-cycle0`。实际工作树 `/Users/mac/Documents/Codex/SRTP-worktrees/subtitle-export-cycle0`；不是另一份主仓库工作目录。开工先检查变更，不覆盖其他人的工作。
- 承接用户已认可的迁移方向。保留现有配色、布局、左侧对话、折叠历史、字幕编辑、项目保存及个人技能；不重写整个前端，不新增账号、云端渲染、插件市场或任意代码执行。
- 首三周期只迁移现有能力。新增卡片属性仅在 R4 对照参考视频后确定；不提前承诺阴影、模糊、旋转、图片、三维或所有特效。
- 不扩大现有单视频项目模型、线性 RenderGraph 或最近一次事务撤销范围；不顺手建设多素材剪辑、任意 DAG、多级撤销或恢复平台。
- 保留现有源文件防覆盖、导出取消、字幕草稿保护、存档校验；这些直接服务已有验收或真实数据风险，不因迁移移除。
- 不静默跳过不支持节点；不把同一卡片先烧入 FFmpeg 视频，再叠加一次 Remotion 卡片；不把动画运行失败自动伪装为旧引擎成功。
- 每阶段验收成立立即结束。新增需求仅在“验收不可缺少 / 现实安全或数据风险 / 用户了解成本后明确批准”之一成立时加入。
- 支撑工作累计控制在阶段投入的 25% 以内；超出则报告原因和已有可见成果，不继续扩建基础设施。支撑模块超预估两倍立即停下报告。
- 每阶段实际投入达到上限的 50% 时必须有下表规定的可检验成果；达不到即报告偏差。达到上限仍未验收则交付现状及阻碍，不自动续期。下载/等待不偷偷从报告中消失，应与有效开发耗时分开记录。
- R1–R3 不借迁移顺带排查本地 CLI 超时。已有第七周期真实 AI 验收未完全通过，迁移测试不能将它改写为通过。真实 AI 调用次数另需授权，过去授权不重复使用。
- 用户已批准 R1 和审查收缩后的 R2；后续仍按周期另行确认。本计划不自动授权全部周期、GitHub 推送、收费服务或发送用户视频。

---

## 一、周期总表：先迁移，再扩展

估时为有效开发与必要验证的初步区间，不是“必须用满”的时长，也不保证在止损上限内一定完成。依赖接入是 R1 最大不确定项，实际证据出现后可向用户提出重估，但不得自行延长。

| 周期 | 唯一目的 | 可直接查看的交付 | 初估 / 止损上限 | 半程检查点 | 退出条件 |
|---|---|---|---|---|---|
| R1：现有卡片闭环 | 证明现有项目可由同一 Remotion 场景预览和导出 | 桌面内可播放、拖动的旧卡片项目；含源视频与声音的 MP4 | 3–5 小时 / 5 小时 | 2.5 小时前已有原视频上按原时段出现的动态卡片预览 | 真实预览、真实导出、保存重开、最近事务撤销均通过；不只是脚本独立渲染 |
| R2：视觉图层与字幕 | 迁移独立文字、矩形及已生成字幕，与卡片共同绘制 | 文字、底板、动画组、字幕共存的视频；字幕修改应用后预览与导出同步 | 2–3 小时 / 3 小时 | 1.5 小时前已有包含字幕和卡片的桌面预览 | 四类视觉能力、字幕保存/应用/撤销、旧项目读取通过 |
| R3：画面效果与默认切换 | 补齐剩余四种源画面效果，使八能力项目默认走 Remotion | 同时带调色、变换、颗粒、暗角、图层及字幕的完整导出 | 3–5 小时 / 5 小时 | 2.5 小时前已有源画面效果与卡片的同场景预览和一次真实导出 | 八能力覆盖、混合项目、桌面完整工作流通过，预览与导出成对切为 Remotion |
| R4：参考卡片增量 | 根据用户视频增加一个经确认的通用视觉行为 | 一段同类型卡片效果，可换文字/时间/画幅，并保存复用为技能 | 收到视频后先限 30 分钟分析；实现预算另定 | 实现前冻结具体行为、参考片段、额度与半程可见成果 | 选定行为经自然语言→应用→预览→导出→技能复用验收，用户确认观感 |

R1–R3 初估合计 **8–13 小时，分三次交付**，不是先做完这些时间才让用户看结果。制定初版时尚无参考视频，R4 未计入这个合计。收到参考并获确认后，R4 独立冻结为 90 分钟上限的通用底板样式增量，实际本地开发验收约 45 分钟内收尾，见第七节。

R1 只宣布“已有卡片接通”，R2 只宣布“四类视觉能力迁移”，直到 R3 通过才宣布“Remotion 已是现有八能力的统一渲染核心”。R4 不代表任意 JSON、任意算法都能执行。

## 二、保留与替换的位置

下列路径均相对上述实际工作树；新增文件列为 Create，现有文件列为 Modify/Reuse。不按此表顺手整体重构。

| 文件或区域 | 处理与责任 |
|---|---|
| Reuse `src/project-editing.js`, `src/render-graph.js` | 项目事务、v1 文档、编译、保存、一次撤销继续使用；按需增加针对迁移的测试，不先改变存储格式 |
| Modify `src/edit-capabilities.js` | R3 把能力的核心完整性与当前渲染器支持判断分开；新能力不再被要求实现旧 FFmpeg toExport |
| Reuse `src/instruction-capabilities.js`, `src/local-cli.js`, `src/personal-skills.js` | R1–R3 不改输出协议或推导方法；R4 仅同步已实现的新参数，不增加效果名配方表 |
| Reuse `src/keyframes.js`, `src/visual-layers.js`, `src/visual-group.js` | 复用参数含义、坐标、组透明度与关键帧求值；不是直接复用旧预览时钟 |
| Create `src/remotion-input.js` | 将已验证的项目快照和媒体信息合成可序列化的渲染输入；集中秒/帧规则 |
| Create `app/remotion/SrtComposition.jsx`, `app/remotion/layers.jsx`, `app/remotion/entry.jsx` | 同一场景与图层实现；entry 只注册 Composition；R3 增加源画面实现 `app/remotion/source-effects.jsx` |
| Create `app/remotion/player.jsx`, `app/editor-playback.js` | React 播放岛与小型播放控制接口，衔接原按钮/时间轴；不形成第二个独立音视频时钟 |
| Create `src/remotion-assets.js` | 主进程把用户已选中的本地文件提供给播放和无头渲染浏览器；只读本地资产会话，不是通用文件服务器 |
| Create `src/remotion-export.js` | 真实 selectComposition/renderMedia 调用、取消、产物验证；延续现有导出结果形状 |
| Modify `main.js`, `preload.js`, `app/editor-export.js` | 打通新快照输入与可信媒体映射，保留保存弹窗、进度、取消与导出锁 |
| Modify `app/editor-core.js`, `app/editor-timeline.js`, `app/editor-subtitles.js`, `app/editor-project-editing.js`, `app/剪辑.html` | 项目初始化、元数据、播放位置、字幕跳转接新预览；不改视觉设计 |
| Modify `app/editor-source-preview.js`, `app/editor-layer-preview.js`, `app/editor-color-preview.js` | 当前项目使用 Remotion 时停用旧绘制循环，避免重复叠加与声音；R3 解除正常路径引用 |
| Create `scripts/build-remotion.mjs`; Modify `package.json`, `package-lock.json`, `.gitignore` | 构建播放器和渲染 bundle，纳入已有启动/打包流程；不提交缓存、测试视频和机器本地资源 |
| Modify `src/environment/index.js`, `src/environment/node-adapter.js`, `app/env-check.js` | R3 将 Remotion 状态由“仅 Node/npm 已装”改为实际依赖、bundle、渲染浏览器可用；沿用检测页，不扩建下载管理器 |
| Modify `docs/DEVELOPMENT_LOG.md`, `docs/PROJECT_STATUS.md` | 每轮通过后记录真实范围、证据、未通过项；计划创建不写成实现完成 |

## 三、最薄公共接口与迁移约定

### 3.1 一个场景，两个入口

```js
// src/remotion-input.js：纯数据，不读文件，不改 localStorage。
createRenderInput(snapshot, { fps, assets });
// snapshot = { document, graph }，来自 projectEditing.load(projectId)。
// assets = { [assetId]: { src: 'http://127.0.0.1:临时端口/会话路径' } }。
// 返回 { graph, width, height, fps, durationInFrames, assets }。
// 图重新校验；宽高来自 document.timeline.canvas；拒绝 graph/document
// 的 projectId、revision、duration 不匹配，以及缺少源 assetId 映射。

// app/remotion/SrtComposition.jsx：无业务存储、无 AI、无磁盘访问。
SrtComposition({ graph, width, height, fps, durationInFrames, assets });
// 场景按 useCurrentFrame()/fps 求值，遍历已有 graph 顺序。
// Player 和 Composition 注册入口直接引用此函数，不复制一份渲染实现。
```

不把 FPS 或临时 URL 塞进严格 v1 存档；RenderGraph 本身也不含画布或 FPS，不能只裸传 graph。媒体映射由主进程从用户选定的实际视频解析，AI 不提供路径、URL、帧率或画布事实。

帧率按主进程探测到的有效源视频平均帧率确定，无法取得时返回可读错误，不猜成 30fps。输出为该帧率的恒定帧率；可变帧率逐帧原样保留不在此次承诺中。`durationInFrames = Math.ceil(duration * fps)`，导出视频时长与项目时长差不超过一帧；音频时长另外检查，不拿容器尾部填充掩盖不同步。

时间判断继续使用 `start <= frame/fps < end`。组动画求值继续用 `keyframes.valueAt(value, frame/fps - range.start, min, max)`；目标关键帧 easing、末值保持、整组透明度、固定 pivot、叠加顺序不变。不要直接用 Remotion spring 默认曲线替换旧 back-out。

### 3.2 播放与资产

```js
// app/editor-playback.js：原界面消费这个接口，具体播放器由接入代码提供。
createEditorPlayback(driver);
// -> { play(), pause(), seekSeconds(seconds), getState(), subscribe(fn), destroy() }
// getState() -> { currentTime, duration, paused }; subscribe -> unsubscribe。
// Remotion driver 使用 Player 引用与帧事件；旧项目迁移路径使用原 video。
// 不 monkey-patch HTMLVideoElement，不留两个同时发声的播放源。

// src/remotion-assets.js：资产只来自用户已选中的媒体。
createRenderAssetSession({ assetId, videoPath });
// Promise<{ assets, close() }>：绑定 127.0.0.1 的临时只读会话。
// 只处理已解析文件的 GET/HEAD/Range，不提供目录或任意 path 查询；
// 预览切换项目后释放其会话，导出任务持有自己的会话直到结束。
```

首轮要实际验证含中文/空格的本地路径、拖动后取帧、音频只有一份、从 A 项目切到 B 不闪回 A。资产不可读取必须失败，不关闭 Electron 安全设置解决访问问题。字体采用本机已用于项目且确实可用的字体，等待字体完成加载再捕获画面；不默默联网取字体。

### 3.3 导出保持现有用户流程

```js
// 保持 start/cancel 与进度、完成形状；新服务消费快照而非旧 filter recipe。
createRemotionExportService({ getMediaFacts, getBundlePath, createAssetSession });
// -> { start({jobId, videoPath, outputPath, snapshot}, onProgress), cancel(jobId) }
// -> {jobId, status:'completed', outputPath}
// 或 {jobId, status:'cancelled'} / {jobId,status:'failed',errorCode}。

// 迁移期沿用 video-export:start IPC，显式区分整个任务的路径：
// {jobId,videoPath,engine:'remotion',snapshot}
// 旧路径暂收 {jobId,videoPath,engine:'legacy',recipe}。
// renderer 不提供 outputPath；仍由原生保存弹窗确定。
```

主进程重复校验快照和源映射，通过同一 `createRenderInput` 构建实际输入；播放器与导出必须对应同一项目修订和媒体事实。导出开始冻结快照，继续沿用现有“导出期间不修改项目”的保护。

真实链路为本地 bundle → selectComposition → renderMedia → 临时成片检查 → 既有保护下完成保存。`onProgress` 与取消信号接现有弹窗；准备、渲染失败、取消均恢复按钮并释放本任务资产。不得仅替换 UI 文案或用测试注入服务冒充实际渲染。

### 3.4 迁移期有限兼容，不长期双轨

- R1 支持 source.video + visual.group（包括组内矩形/文字）。R2 加 standalone shape/text/subtitle。R3 加四种 source effects。
- 每次项目修订后，在更新播放器前检查全部启用节点。全部受支持才成对采用 Remotion 预览和导出，否则整张图暂用原路径。播放位置转换后保持，不能混用两套视觉结果。
- Remotion 运行时失败不得触发静默 fallback；记录为失败并展示原因。
- 读取旧存档仍使用完整的旧 schema/注册能力集合；不要把阶段渲染支持子集用于 `readMap()`，否则另一个尚未迁移的项目可能使所有项目读失败。
- R3 八能力通过后正常路径只使用 Remotion；解除旧视觉执行入口，保留有用算法及 FFmpeg 媒体工具，不额外安排一次全库清理。

## 四、R1 任务与验收

### Task 1：旧项目快照进入同一场景，并有可看的卡片预览

**Files:** Create `src/remotion-input.js`, `app/remotion/SrtComposition.jsx`, `app/remotion/layers.jsx`, `app/remotion/entry.jsx`, `app/remotion/player.jsx`, `scripts/build-remotion.mjs`, `tests/remotion-input.test.js`。Modify `package.json`, `package-lock.json`, `.gitignore`。

**Consumes:** `projectEditing.load()` 的 `{document,graph}`；现有 `visualGroup.sample` / `keyframes.valueAt` 语义。

**Produces:** 上述 `createRenderInput` 与 `SrtComposition`；播放器 bundle 和渲染 bundle 都引用同一场景，新增脚本 `npm run build:remotion`。

- [x] 写快照输入测试：不修改原快照、旧 schema 不增字段、画布和时间正确、缺资产拒绝、修订不匹配拒绝。初始 8 项中 5 项因接口缺失为 RED；其余负向测试当时因缺模块错误通过，不能单独计为业务 RED，最终均在真实接口上验证通过。完整最小源文档构造：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRenderGraphCompiler } = require('../src/render-graph');
const { createRenderInput } = require('../src/remotion-input');

test('builds frame inputs without rewriting the v1 document', () => {
  const document = {
    schemaVersion: 1, projectId: 'migration-test', revision: 0,
    timeline: { duration: 4, canvas: { width: 640, height: 360 } },
    sources: [{ id: 'main-video', assetId: 'test-video', kind: 'video',
      range: { start: 0, end: 4 } }], edits: []
  };
  const graph = createRenderGraphCompiler().compile(document);
  const snapshot = { document, graph };
  const before = JSON.stringify(snapshot);
  const input = createRenderInput(snapshot, {
    fps: 30, assets: { 'test-video': { src: 'http://127.0.0.1:9000/test' } }
  });
  assert.equal(input.durationInFrames, 120);
  assert.equal(input.width, 640);
  assert.equal(input.height, 360);
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(Object.hasOwn(document.timeline, 'fps'), false);
});
```

- [x] 执行输入测试并观察接口缺失 RED；实际浏览器测试的沙箱故障不计为业务 RED。
- [x] 接通输入和构建，现有 group 的 shape/text 子元素按原坐标、关键帧和组层次绘制。测试参数未写进系统提示词或能力配方表。
- [x] `npm run build:remotion` 成功；输入/场景及相关语义测试 39/39，包含真实浏览器 Player；主代理已查看真实桌面卡片截图和导出帧。

### Task 2：接入桌面原播放器位置与真实本地素材

**Files:** Create `src/remotion-assets.js`, `app/editor-playback.js`, `tests/remotion-assets.test.js`, `tests/e2e/remotion-player-flow.spec.js`。Modify `main.js`, `preload.js`, `app/editor-core.js`, `app/editor-timeline.js`, `app/editor-project-editing.js`, `app/editor-subtitles.js`, `app/剪辑.html` 及旧预览脚本的启停钩子。

**Consumes:** Task 1 场景与输入，用户原本选中的视频路径，既有加载/保存项目流程。

**Produces:** 既有界面中的 Player；只有一个活动播放时钟；主进程可读取、支持 seek 的资产会话。

- [x] 桌面检查覆盖导入时长/画布、同一播放器的播放/暂停/跳转、重传停止旧源与未迁移项目兼容；重叠预览会话、重传和 Player 错误锁存分别观察 RED 后修复。
- [x] 资产测试从模块缺失 RED 到真实 HEAD/Range/关闭验证通过；只提供已选文件，关闭后不可再读。
- [x] 时间轴、上下文和字幕跳转的业务读取接播放控制器；元数据不依赖隐藏视频继续播放。
- [x] 两项 Player 桌面检查最终通过；真实 Electron 页面出现可播放卡片，播放/暂停/拖动及重开/撤销已验证，半程可见成果约 14:52 UTC 达成。自动化确认仅一个活动发声源并检查实际音频内容，不冒称人工听音完成。
- [ ] 用户使用自己的视频确认观感、字体呈现及音频听感；原生保存框人工点验另列。

### Task 3：通过现有导出按钮生成真实 MP4，并交付 R1

**Files:** Create `src/remotion-export.js`, `tests/remotion-export.test.js`, `tests/e2e/remotion-export-flow.spec.js`。Modify `main.js`, `preload.js`, `app/editor-export.js`, `tests/e2e/scenario-dependencies.js`, `tests/main-entry.test.js`；复用 `src/video-export.js` 的源保护/结果约定，不复制出新的任务调度平台。

**Consumes:** 同一冻结 snapshot，主进程媒体事实、资产会话、本地 bundle。

**Produces:** 原保存弹窗选择位置下的真实 H.264 MP4；有源音频时保留音频；当前取消、进度及恢复操作可用。

- [x] 覆盖冻结快照、不调用旧配方、取消恢复、源文件/已有目标保护、缺资产拒绝；服务接口及导出集成先出现 RED 后接通。等待预览时新增草稿的漏洞也经 RED→GREEN 修复。
- [x] 真实 `selectComposition` / `renderMedia` 已接上桌面保存路径；首次真实失败暴露二进制配置、AAC 尾部及无声源音轨问题，均修复后再验收。
- [x] 同一组件导出；准备/渲染取消和任务清理已检查；实际视频流、画幅、帧数/时长和音频通过。
- [x] 真实渲染服务测试 16/16，最终所有真实开关 Node 389/389，零跳过。
- [x] 真实桌面自动化完成项目保存/重开、导出、撤销及再次导出；保留横竖版有卡片和无卡片四份 MP4。固定翻译和测试指定保存路径明确标记，不算人工点击或真实 AI。
- [x] 五时点内容、组内一次透明度、裁剪/缩放语义、反向跳转确定性已检查；主代理查看中文截图与成片帧。统一 sRGB 内容合成与真实屏幕截图分别保留，不保证屏幕色彩和字形完全一致，详情见研发日志。
- [x] 内部三项实现任务、新增桌面 9/9 完成，实际视频已生成；停止 R1 开发并保留人工观感验收项，未提交/推送、未开 R2。

**R1 最终证据：** `/tmp/srt-remotion-r1.xDXjmb/accepted-remotion-e2e/`。原有 67 项桌面回归经默认 56 项及实际媒体补测覆盖全部用例；新增 9 项最终运行 41.4 秒。四份成片的视频均为 24fps、96 帧、4.000 秒；音频 4.010667 秒，小于一帧差。此处标记的是实现与自动化完成，不代替以上人工项。

## 五、R2 任务与验收：四类视觉能力共同工作

**唯一目的：** 让独立矩形、独立文字、已应用字幕与第一轮的动画组共用 Remotion。

**Files:** Modify `src/remotion-input.js`, `app/remotion/layers.jsx`, `app/remotion/SrtComposition.jsx`, `app/editor-subtitles.js`；`app/editor-export.js` 仅在既有导出连接确有缺口时改。Create `tests/e2e/remotion-subtitles-flow.spec.js`；补 `tests/remotion-input.test.js`、`tests/remotion-scene.test.js`，复用既有真实导出/项目/字幕回归；仅新增本轮验收及回归所必需测试。

**Interfaces:** 不增加输出协议，不改字幕识别器；`SrtComposition` 直接消费现有 `visual.shape@1`、`visual.text@1`、`visual.subtitle@1` 图节点。编辑能力 `subtitle.generate@1` 仍先生成 segments，再进入该图节点。

**审查后的冻结项（2026-09-08）：** 上限仍为 3 小时，90 分钟前必须看到字幕＋卡片混合预览；15:46:22 UTC 开始，17:16:22 可见检查，18:46:22 止损。支撑/开发/验收/等待以简单时间段记录，支撑接近实际投入 25% 即报告，单支撑模块超过预估两倍停止。文件修改归属和临时证据记在 `/tmp/srt-remotion-r2.OeB8le/progress.md`，不为记时开发系统。

必须补入的三个接点：渲染支持集合增加 shape/text/subtitle、现有字体等待覆盖这三类文字、Remotion 接管时跳过旧字幕 DOM 绘制。复用已有文字矩形几何、字幕保存/应用/撤销和完整存档校验；不重建任何一套。保存未应用草稿仍阻止导出，不借“只保存不改成片”解除保护。R1 已知字体外观差异单列，不顺手解决 CLI 超时或专业色彩管理；文字丢失/重复/影响阅读的裁切必须修复。

- [x] 输入准入先出现两项 RED、场景先出现三项 RED，再接通支持集合和共享绘制。图层顺序、字幕半开区间/样式/换行已有断言；禁用编辑沿用编译器过滤并回归。桌面通过原字幕生成→保存→应用入口验收，不用直接塞图替代。
- [x] 按既有 schema 增加三个节点绘制，复用组内几何和现有字幕样式；同一个场景服务 Player 与导出，不增字幕样式编辑器。
- [x] 点击字幕导致旧 DOM 重复叠加经实际桌面 RED→GREEN 修复。横竖屏确认保存草稿不改已应用预览且阻止导出；应用后预览/成片改变，重开恢复、最近请求整次撤销成立。
- [x] 严格 v1 文档、旧 undoStack 和草稿格式不变；完整旧项目/字幕回归通过。启用源画面效果仍整项目走旧路径，暂停状态切回旧引擎及撤销回 Remotion 均有实际桌面检查。
- [x] 最终全真实开关 Node 395/395，Remotion 桌面 12/12，旧桌面完整真实媒体 67/67，零失败/零跳过；覆盖计划所列字幕和真实渲染测试，不另重复拆跑相同用例。
- [x] 横竖屏各交付字幕修改前后真实 MP4，独立文字、矩形、动画组和字幕同场可见；已检查最终预览/成片帧，并独立探测四份文件。固定翻译/识别与测试指定保存路径不冒称真实 AI 或人工验收。

**R2 最终证据：** `/tmp/srt-remotion-r2.OeB8le/remotion-final/`、`legacy-final/`。视频为 640×360 / 360×640、24fps、96 帧、4.000 秒，H.264/AAC；音轨及容器 4.010667 秒。15:59 UTC 已有混合预览和真实成片，早于 17:16:22 检查点。R2 产品只改四个必要文件；未改依赖、AI、存储、导出服务或用户配色。场景及全轮独立审查无待修 Critical/Important，保留字幕节点范围单独隔离测试的非阻断建议和 R1 字体外观限制。实现及自动化到此结束，用户素材观感仍待确认。

**不做：** 不换语音识别模型、不增字幕特效库、不加入新的画面效果或字体管理器。四类能力验收成立即结束。

## 六、R3 任务与验收：现有八能力全部切换

**唯一目的：** 迁移调色、画面变换、颗粒、暗角并将现有功能的预览和导出统一切到 Remotion。

**Files:** Create `app/remotion/source-effects.jsx`, `tests/e2e/remotion-source-effects-flow.spec.js`。Modify `app/remotion/SrtComposition.jsx`, `src/edit-capabilities.js`, `src/remotion-export.js`, `app/editor-export.js`, `main.js`, `src/environment/index.js`, `src/environment/node-adapter.js`, `app/env-check.js`, `package.json`；按接口变化更新相关 Node/Electron 测试。

**Interfaces:** `SrtComposition` 继续遍历同一 graph；source-effects 消费现有节点参数，不生成另一种模型输出协议。复用 `src/color-adjustment.js`, `src/video-transform.js`, `src/video-texture.js` 现有数学语义；旧 FFmpeg 表达式不是新入口。

**R3 冻结与结果（2026-09-09 北京时间）：** 16:21:55 UTC 开始，上限 5 小时，18:51:55 必须有可见成果，21:21:55 止损。沿用上述唯一目的与不做项；现有八能力、默认入口、真实检测和基本桌面闭环通过即停止。R2 未提交文件已完整快照到 `/tmp/srt-remotion-r3.TvI79k/baseline/`，按此而非 Git HEAD 审查本轮改动。16:52 前横竖屏混合 Player/MP4 已可检查；混合流程及保护用例 8/8 通过（45.9 秒）。最终 Node 全真实开关 **410/410**（12.753 秒），完整桌面 **82/82**（5.1 分钟，含 15 项 Remotion 与 67 项显式旧路径回归），真实 Mac 检测页 **1/1**（1.7 秒），全部零失败、零跳过。素材读取取消后关闭共享句柄的真实异常已做 RED→GREEN 修复；只增加必要读取回归，未扩展资源平台。

**R3 交付证据：** `/tmp/srt-remotion-r3.TvI79k/e2e-final/` 下 `remotion-source-effects-fl-47943--undoes-all-eight-abilities/`（横版）和 `remotion-source-effects-fl-bd71e--undoes-all-eight-abilities/`（竖版），含预览、实际成片、再次导出和抽帧。两种画幅均 H.264、24fps、96 帧、视频 4.000 秒；横版为单 AAC 音轨 4.010667 秒，竖版无音轨、容器 4.000 秒。主代理另行探测四份文件并查看最终画面。真实源效果测试验证半开范围、图顺序、变换裁剪、前后跳转、确定性噪点和不影响覆盖图层；纯色阈值仍为 12/255，没有放宽。独立审查发现的工作目录依赖和浏览器启动失败清理问题已修复并复审，无未解决 Critical/Important。

**收尾边界：** 约 17:03 UTC 完成记录，墙钟约 41 分钟，提前满足检查点并停止。约 3 分钟准备/基线，之后为并行产品接入、必要环境检测、真实桌面排错与回归；工作和工具等待交叠，未精确计量有效工时或支撑占比，不给伪精确百分比。没有新依赖下载、AI 协议变更或平台化模块；新增构建文件沿现有 app/src 打包通配规则包含，但安装包中的浏览器分发及真实 Windows 未验收，不宣称可发布安装版。原有字体/屏幕色彩解释限制、个人素材和原生保存框人工观感仍待确认，R4 等参考视频另行冻结。

- [x] RED：依次覆盖四类能力的区间内有效、区间外不影响、多个操作按图顺序执行；卡片/字幕不被错误调色或翻转。创建无文字纯色检查区用于定量比较，避免用文本抗锯齿误差掩盖错误。
- [x] 源画面变换与颜色使用帧驱动的公共实现；颗粒噪声必须由同一帧号/既有确定性求值产生，禁止预览/导出各自调用随机数。先保证短视频结果正确，不扩展 GPU 优化项目。
- [x] 在固定画幅/帧率的测试中比较 Player 同帧与真实导出抽帧：空间/时间偏差至多 1 像素/1 帧；纯色区以 8-bit 通道差不超过 12 作为初始编码容差。颗粒另比较同帧确定性及区域统计；差异超标必须解释或修复，不能直接放宽阈值让它通过。必要时以无损静帧区分渲染偏差与 H.264 编码偏差。
- [x] 能力完整性只要求 `prepare/toEdit/toGraph/toTimeline` 等编辑核心；另按当前场景已实现的 nodeType 检查可执行性。存档读取仍保留全量历史声明；不能因取消强制旧 `preview/toExport` 而把未实现能力发布给 AI。以一个只有核心转换、没有旧 toExport 的测试注册项证明边界，再以“不在场景支持集合”证明实际执行仍被拒绝。
- [x] 八能力通过后，正常导出入口不再生成旧 render-recipe；旧浏览器滤镜和 canvas 动画循环不再参与当前画面。不引入用户可选的双引擎偏好，也不清理全部历史测试或有用旧工具。
- [x] 现有检测页真实检查 Remotion 包、本地 bundle、渲染浏览器可用；缺哪项显示哪项，不能再仅凭 Node/npm 宣布 Remotion 可用。首次依赖下载需按环境权限处理，不暗中购买或新增后台下载服务。
- [x] 桌面完整验收：导入→自然语言/固定翻译标识→应用混合指令→播放/拖动→字幕改字/应用→保存重开→导出→取消另一次导出→重新导出→撤销→切项目；个人技能仍可保存、查看和选用。固定翻译用于稳定回归，不叫真实 AI 联调通过。
- [x] 执行 `npm test`、`npm run test:e2e`（将新增 spec 纳入该脚本）及 `SRT_REAL_REMOTION=1 node --test tests/remotion-export.test.js`；报告真实运行数量与所有 skip/fail，不照抄历史 349/67。
- [x] 交付横版、竖版八能力覆盖证据与至少一份混合成片；验证包含源音频、有源视频但无音频两种输入。正式启动能找到 bundle/资源；打包资源规则不遗漏新增文件。当前只声明在本 Mac 验证，不能据此宣称 Windows 安装包验收通过。

**不做：** 不扩展 AI 聊天能力、不修复非本次引入的模型耗时问题、不增加多轨音频、转场系统、渲染农场、缓存调度或跨平台发布工程。现有八能力、基本桌面流程与默认切换通过即结束。

## 七、R4 的开工闸门：拿到参考再写具体实现任务

2026-09-09 用户已提供本地参考视频 `37875025116-1-192.mp4`，并确认以约 02:11–02:24 的信息卡为参考补通用底板样式。[R4 参考分析](../../reference-analysis/2026-09-09-r4-card-reference.md) 与 [R4 独立实施计划](2026-09-09-remotion-r4-card-style.md) 记录了依据、90 分钟上限和不做项。现已完成圆角、内描边、底板透明度，同一 Remotion 场景服务预览/导出；四字段自动暴露，未增加固定模板、图标、阴影或新引擎。

R4 最终本地验证：全真实 Node/媒体 418/418、完整桌面 83/83（其中 16 项 Remotion），零失败/跳过，独立审查通过；横竖版成片、旧存档不写回、追加请求/重开/撤销、技能保存后查看与选择均通过。17:39 有首份可见成片，18:08 完整回归结束，随后收尾。本轮未调用真实 AI、未上传视频、未提交/推送。原自然语言推导与跨项目重新适配验收门仍保留，不能用固定翻译替代；用户观感也待确认。

分析阶段最多 30 分钟，产出参考片段起止时间、关键帧截图、文字/底板/图片层级、运动轨迹、哪些当前可表达、哪些确实缺失。先明确复现“同类型可调整行为”，不是未经验证承诺像素级复制整段视频。

之后仅选择一个用户认可的可复用能力增量，另写该周期的小计划，冻结五项：唯一目的、可见片段、明确不做项、实现额度、退出条件。无需扩展即可表达的，直接由 AI 组合现有参数，不强行新增能力。

当选定行为确需新参数时，任务顺序为：

1. 参数声明与兼容校验 → 缺失新字段时保持旧行为；拒绝非法值但不改写旧存档。
2. 同一 Remotion 场景实现 → 一处实现同时服务预览与导出；无需另补 FFmpeg 特效链。
3. 提示词自动暴露实际已实现的参数 → 仍由模型推导组合，不加“某效果名称→固定配方”查表。
4. 实际自然语言操作 → 合法执行、保存、撤销、真实成片；不满意时可改文字/时间/位置并再次应用。
5. 沿用个人技能保存 → 换一份媒体后由 AI 重新推导；不是把第一次配方原样强行复制。

验收必须包含原参考行为、改变文案或时段、另一画幅三个观察点。真实 AI 调用在开工时明确次数与发送信息范围；本次计划不授权模型调用、视频上传或训练。新增功能不需要跨项目云同步、社区技能或自动效果统计。

## 八、验收证据与每轮汇报格式

每轮报告必须同时列出：

- **内部完成度：** 本轮必需任务/验收项通过数量；未通过的集成点；此次代码版本。不要给没有分母的“整体完成 83%”。
- **用户可见成果：** 可打开的桌面入口、截图或短视频、实际导出文件路径；指出是否走真正 Remotion。
- **测试性质：** 单元/固定翻译桌面回归/真实渲染/真实 AI/人工观感分开。一个通过不替代另一个。
- **投入与偏差：** 有效开发时长、等待时长、支撑占比、半程检查是否兑现；超过预计的原因。
- **剩余边界：** 哪些节点仍旧路径、参考扩展是否未开工、其他平台是否未验收；没有自动续期。

真实媒体测试使用人工合成短视频或用户明确选择的素材，输出到唯一临时验收目录。按阶段保留预览截图、MP4、抽帧、媒体信息和不含秘密的结果说明；不把私人素材、原始模型日志或机器配置提交 Git。

### 本计划自检

- [x] 三项已认可方向均被覆盖：R1 现有闭环；R2/R3 现有能力迁移；R4 参考驱动扩展。
- [x] 前三轮各有唯一目的、可见成果、不做项、估时/止损、明确退出条件。
- [x] 第一轮不是仅安装依赖；预览、真实导出、项目重开和撤销同轮验收。
- [x] 没有改变已有 UI 颜色，没有新增与迁移无关的基础设施或扩大 AI 协议。
- [x] 已标明 FPS/旧存档严格 schema、主进程资产访问、播放时钟、导出入口、能力完整性等真实接点。
- [x] 缺参考视频的第四轮没有伪造具体能力与工期；不得以本文直接启动未冻结的效果开发。
- [x] 本小节复选框只代表计划自检；开发任务状态按 R1–R4 本地证据更新，R4 真实 AI 与用户观感验收仍待完成。

## 技术依据

- [Remotion Player](https://www.remotion.dev/docs/player)：可嵌入 React 的播放入口，用于现有页面中的局部播放区域。
- [renderMedia](https://www.remotion.dev/docs/renderer/render-media)：真实成片入口，配合同一 Composition 输入、进度及取消能力。
- [bundle](https://www.remotion.dev/docs/bundle)：构建渲染入口供本地 renderer 使用。具体依赖版本在执行时核定，不能以仅安装 Node/npm 视为渲染环境就绪。
