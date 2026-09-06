# 字幕真实渲染与 MP4 导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户将当前项目已应用的字幕烧入真实 MP4，并能在编辑器中选择位置、查看进度、取消和确认结果。

**Architecture:** 保留现有字幕状态，导出时生成 RenderRecipe v1 快照。独立导出模块负责 ASS、FFprobe、FFmpeg 与落盘，主进程负责原生另存为，页面负责交互。环境检测与导出共用同一个工具解析方法。

**Tech Stack:** 现有 Electron 33、原生 JavaScript/CommonJS、node:test、Playwright、FFmpeg/libass 与 FFprobe。不新增 React、Remotion 或流程框架。

**Design:** 仓库 docs/superpowers/specs/2026-09-06-subtitle-video-export-design.md。

**Baseline:** main @ 55266f4；实际开工时再次检查 Git 状态。

**Status:** 计划文档已编制；下面所有实施与验收项均未执行。当前任务只授权文档。

**Working directory:** /Users/mac/Documents/项目/SRTP。

## Global Constraints

- 当前只交付字幕这一项真实能力；配方 capability 唯一标识为 subtitle.burn@1。
- 导出读取已应用 segments，不读取 draft；新生成字幕沿用已有自动应用行为。
- 原生另存为默认源目录与“原文件名-已编辑.mp4”；只创建新文件，不覆盖源文件或已有目标。
- MP4/H.264/AAC/yuv420p 固定；不新增用户编码设置、不自动改变画面尺寸。
- 预览、识别与导出绑定同一实际加载的视频路径；字幕使用同一文字、布局和样式参数。
- 导出时保留播放和历史查看，冻结写操作、项目导航及重新上传；所有终态释放锁。
- 任意 AI 配方、效果库建设、组件统计、存储迁移、Windows 真机和正式打包均排除。
- 30 + 120 + 120 + 60 = 330 分钟主动开发与验证硬上限；依赖等待单列，超过闸门停止报告。
- 支撑性工作累计不超过 75 分钟；达到 150 分钟应已有真实字幕 MP4。
- 实际实现发现超过预算时报告；不通过缩减已冻结验收或换名归类支撑工作掩盖超时。
- 文件和接口名称以本计划为准；先验证对外行为，再实现通过该行为所需的最小代码。
- 局部修复目前的视频路径错配计入 T4；不借此重构全体项目存储。
- 已存在的 .superpowers/brainstorm/ 是用户设计预览，禁止加入本次 Git 提交或删除。

## 周期与任务映射

| 周期 | 任务 | 分钟 | 独立可验收成果 |
|---|---|---:|---|
| 0 能力闸门 | T1 | 30 | 实际工具就绪状态与中文字幕短样片；失败则阻断 |
| 1 渲染核心 | T2 + T3 | 25 + 95 | 模块根据字幕配方输出可播放 MP4 |
| 2 编辑器接入 | T4 + T5 | 45 + 75 | 真正可用的原生导出与进度、取消 |
| 3 整链验收 | T6 | 60 | 真实 Mac 工作流、回归与研发记录 |

各任务开工时记录开始时间、主动投入、依赖等待。每完成一个周期，报告“内部实现”和“用户可见成果”。达到退出条件立即进入下一项，不为额外完善停留。

## 文件职责映射

以下路径均相对上述仓库根目录；当前文件存在情况已只读核对。

| 文件 | 动作与职责 |
|---|---|
| src/render-recipe.js | 新建；快照构建、唯一字幕能力校验、固定样式常量；CommonJS/浏览器共享 |
| src/video-export.js | 新建；唯一渲染模块，小接口封装视频探测、ASS、进度、取消与落盘 |
| app/editor-export.js | 新建；前置检查、任务锁、字幕排版快照、右上角导出交互 |
| src/environment/index.js | 修改；实际能力探测、getExportTools、subtitleExport 模式、兼容安装计划 |
| app/env-check.js | 修改；在现有模式区域显示字幕导出能力与原因 |
| main.js / preload.js | 修改；源文件解析、原生另存为、受限导出接口、进度、正常关闭 |
| app/editor-core.js | 修改；桌面播放器绑定本项目实际源，处理加载失败与重传锁 |
| app/editor-subtitles.js | 修改；只读快照、排版与样式共用、字幕写操作锁 |
| app/editor-timeline.js | 修改；当前不支持项读取、发送/拖放/删除/撤销锁 |
| app/shared.js | 修改；项目标签导航/关闭操作遵守导出锁 |
| app/剪辑.html | 修改；右上角入口与浮层、加载新脚本；保留现有颜色 |
| tests/render-recipe.test.js | 新建；快照独立、草稿不混入、非法能力/数据 |
| tests/video-export.test.js | 新建；模块行为与显式启用的真实 FFmpeg 冒烟 |
| tests/e2e/video-export-flow.spec.js | 新建；成功、阻断、取消、源项目一致的 UI 行为 |
| tests/environment.test.js / tests/environment-install.test.js | 修改；能力探测和安装方案的实际行为 |
| tests/e2e/scenario-dependencies.js / tests/e2e/environment-flow.spec.js | 修改；模拟能力与检测页断言 |
| tests/e2e/electron-main.js / tests/e2e/electron.fixture.js | 修改；可注入导出结果和原生对话框结果 |
| tests/main-entry.test.js / package.json | 修改；新增桥接回归和 E2E 脚本入口 |
| docs/DEVELOPMENT_LOG.md / docs/PROJECT_STATUS.md | 仅在实现验收后更新实际状态 |

不修改 src/local-cli.js、src/subtitles.js、Whisper 模型、app/effects.js 和组件目录来增加功能。src/environment/node-adapter.js 的短探测 runner 继续复用，不扩展成通用长任务平台。

## 接口契约

以下类型只是 JavaScript 数据约定，不引入 TypeScript 编译链。

```js
// RenderRecipe
const exampleRecipe = {
  version: 1,
  steps: [{
    capability: 'subtitle.burn@1',
    params: {
      segments: [{
        id: 's1',
        start: 0.2,
        end: 1.4,
        text: '大家好',
        lines: ['大家好']
      }]
    }
  }]
};

// 单一固定样式；不建立样式注册系统。
const SUBTITLE_STYLE = {
  referenceHeight: 450,
  fontSize: 16,
  fontFamily: 'Heiti SC',
  bottomRatio: 0.07,
  maxWidthRatio: 0.84,
  color: '#ffffff',
  backgroundOpacity: 0.72,
  paddingX: 10,
  paddingY: 6
};

// 环境输出；主进程控制值，不接受页面或 AI 覆盖。
const tools = {
  ffmpegPath: '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
  ffprobePath: '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe'
};

// 每次 UI 点击生成唯一 jobId；StartResult 的所有终态带相同 ID。
const progress = { jobId: 'job-1', phase: 'rendering', percent: 42 };
const completed = {
  jobId: 'job-1',
  status: 'completed',
  outputPath: '/videos/sample-已编辑.mp4'
};
const failed = {
  jobId: 'job-1',
  status: 'failed',
  errorCode: 'EXPORT_RUNTIME_NOT_READY'
};
const cancelled = { jobId: 'job-1', status: 'cancelled' };
```

配方合法性规则：顶层与 step 不允许额外执行字段；version 必须为 1；steps 为数组且最多一个字幕 step；空 steps 合法；segments 非空、ID 唯一、时间有限且 0 <= start < end、text 非空。lines 可省略；有值时必须为非空字符串数组且拼接等于原始 text。构建器保留文字，不 trim 掉实际内容，校验空白文字时使用 trim。未知能力报 EXPORT_UNSUPPORTED_OPERATION；其他结构错误报 EXPORT_INVALID_RECIPE。

进度 phase 只有 preparing、rendering、finalizing；空闲状态为 { jobId:null, phase:'idle' }。completed/cancelled/failed 是终态，不与进度混用。准备阶段 percent 为 null，rendering 为 0–99，finalizing 为 99；成功落盘后 UI 自行显示 100%。

---

### Task 1：确认字幕导出能力并展示真实状态（30 分钟）

**唯一目的：** 最终选定的 FFmpeg/FFprobe 确实能够输出中文字幕 MP4。

**Files:** src/environment/index.js、app/env-check.js、上述 environment 单元/安装/E2E 测试与场景数据。短样片放独立临时目录，不提交视频二进制。

**Consumes:** 现有 dependencies.run、getBundledTools、安装确认和模式显示逻辑。

**Produces:** environment.getExportTools() -> Promise<{ffmpegPath,ffprobePath}>；report.modes.subtitleExport -> {status,reason,blockers}。

- [ ] 先记录环境基准。只读运行最终候选工具的版本、filters、encoders、muxers 和 ffprobe 版本，保留必要输出。已知普通 Homebrew FFmpeg 缺 libass，不能重复只测版本然后宣布就绪。
- [ ] 加入行为测试：程序已安装但缺 ass/subtitles 时 tools.ffmpeg 仍表示已安装，而 modes.subtitleExport 为 limited；模式不 ready 时 getExportTools 拒绝。再加入同一工具路径可用、ffprobe 缺失与探测失败场景。
- [ ] 使用下面的实际断言扩充现有 macFixture，测试指令和错误码保持一致：

```js
test('installed FFmpeg is not necessarily ready for subtitle export', async () => {
  const fixture = macFixture({
    versions: { ffmpeg: '9.0.1' },
    commandResults: {
      'ffmpeg -hide_banner -filters': 'Filters:\n ... scale V->V',
      'ffmpeg -hide_banner -encoders': ' V..... libx264\n A..... aac',
      'ffmpeg -hide_banner -muxers': ' E mp4 MP4',
      'ffprobe -version': 'ffprobe version 9.0.1'
    }
  });
  const environment = createEnvironmentModule(fixture);
  const report = await environment.detectEnvironment();
  assert.equal(report.tools.ffmpeg.installed, true);
  assert.equal(report.modes.subtitleExport.status, 'limited');
  assert.equal(report.modes.subtitleExport.reason, 'subtitle_filter_missing');
  await assert.rejects(environment.getExportTools(), {
    code: 'EXPORT_RUNTIME_NOT_READY'
  });
  assert.equal(report.canContinue, true);
});
```

- [ ] 运行 node --test tests/environment.test.js，先确认新增断言因功能未实现失败。
- [ ] 在现有环境模块内集中实现工具选择和 probeExportTools()。darwin 候选仅增加两个 Homebrew ffmpeg-full 标准目录，随后为既有 FFmpeg；ffprobe 取同安装目录或既有系统组合。探测 filters 中实际执行器所用的完整名称 ass、encoders 中 libx264/aac、muxers 中 mp4，并确认 ffprobe 可运行。只有 subtitles 而没有 ass 也按当前能力缺失处理，避免检测通过而固定 ass 命令失败。
- [ ] detectEnvironment 和 getExportTools 使用同一个 probeExportTools。检测成功的执行路径原样返回；导出 start 仍验证当前可用状态，不复用陈旧的 UI 报告。禁止页面传入可执行文件路径。
- [ ] 在现有模式定义加入 { id:'subtitleExport', label:'字幕导出', description:'将字幕烧录到 MP4' }，原因分别显示滤镜缺失、编码能力缺失、ffprobe 缺失、探测失败。继续进入首页行为不变。
- [ ] macOS 的 FFmpeg 安装计划指向 ffmpeg-full；说明增加依赖与位置，通过既有确认执行。候选包为 keg-only 时直接使用其绝对路径，禁止 force-link、替换系统 ffmpeg 或自动换安装渠道。
- [ ] 获得实施及安装授权后，用确认过的工具生成一秒中文有声样片，外部播放器检查文字与声音。仅出现 filters 名字还不能算这个闸门通过。
- [ ] 运行 node --test tests/environment.test.js tests/environment-install.test.js，及 npx playwright test tests/e2e/environment-flow.spec.js。结果属于检测行为测试，与样片证据分别记录。
- [ ] 闸门通过则单独提交本任务文件，提交说明 feat: detect hard-subtitle export capability。若到 30 分钟仍无可用样片或需新安装渠道，停止后续任务并报告工具、失败阶段与已用时间。

**不做：** 新下载器、自动修复、编译 FFmpeg、供应商扫描、Windows 真机验收。

### Task 2：创建最薄字幕配方（25 分钟）

**Files:** 新建 src/render-recipe.js、tests/render-recipe.test.js。

**Consumes:** 已应用 subtitle-state segments（秒）。

**Produces:** buildSubtitleRecipe(segments)、validateRenderRecipe(recipe)、SUBTITLE_STYLE；CommonJS 导出及 window.SRTRenderRecipe。

- [ ] 将以下测试保存到新测试文件。运行 node --test tests/render-recipe.test.js，预期因模块缺失失败。

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSubtitleRecipe,
  validateRenderRecipe
} = require('../src/render-recipe');

test('builds an independent snapshot using applied segments', () => {
  const applied = [{ id:'s1', start:0.2, end:1.4, text:'大家好' }];
  const recipe = buildSubtitleRecipe(applied);
  assert.equal(recipe.steps[0].capability, 'subtitle.burn@1');
  assert.deepEqual(recipe.steps[0].params.segments, applied);
  applied[0].text = '后来的修改';
  assert.equal(recipe.steps[0].params.segments[0].text, '大家好');
});

test('allows empty project edits but rejects an unknown capability', () => {
  assert.deepEqual(validateRenderRecipe({ version:1, steps:[] }),
    { version:1, steps:[] });
  assert.throws(() => validateRenderRecipe({
    version:1,
    steps:[{ capability:'unknown@1', params:{} }]
  }), { code:'EXPORT_UNSUPPORTED_OPERATION' });
});

test('rejects invalid timing and executable fields', () => {
  const recipe = buildSubtitleRecipe([
    { id:'s1', start:0, end:1, text:'原文' }
  ]);
  recipe.steps[0].params.segments[0].end = 0;
  assert.throws(() => validateRenderRecipe(recipe),
    { code:'EXPORT_INVALID_RECIPE' });
  assert.throws(() => validateRenderRecipe({
    version:1, steps:[], command:'unexpected'
  }), { code:'EXPORT_INVALID_RECIPE' });
});
```

- [ ] 实现严格的数据构建与校验，执行本计划“接口契约”的字段、时间、ID 和文字约定。通过克隆返回新对象，不向现有字幕 store 写入任何值。
- [ ] 使用一个静态的 subtitle.burn@1 处理入口，不引入注册 API、动态加载、通用滤镜图或第二个能力。错误只需 code，不新建错误类层级。
- [ ] 按冻结值导出 SUBTITLE_STYLE。使用同一文件的 UMD 包装，Node 和浏览器不复制校验逻辑。
- [ ] 增补两项有实际作用的断言：lines 拼接不等于 text 时拒绝；输入对象修改不改变校验后的快照。
- [ ] 运行 node --test tests/render-recipe.test.js tests/subtitle-state.test.js，确认通过。
- [ ] 单独提交两文件，提交说明 feat: add subtitle render recipe snapshot。

**退出：** 可构建/校验实际字幕快照，已有字幕存储未迁移。没有为了“可扩展”添加第二个效果。

### Task 3：字幕配方生成真实 MP4（95 分钟）

**Files:** 新建 src/video-export.js、tests/video-export.test.js。

**Consumes:** T1 getExportTools、T2 validateRenderRecipe/SUBTITLE_STYLE、源文件、新目标路径。

**Produces:** createVideoExportService，含 start(request,onProgress)、cancel(jobId)、getState()，终态与进度使用上文契约。

- [ ] 先建立模块行为测试夹具：spawnImpl 记录 program/args/options，并用 EventEmitter、PassThrough 模拟 stdout/stderr/close；临时文件使用 node:fs.mkdtemp。覆盖参数数组、shell:false、进度、取消等待 close、错误后的文件清理。不得复用 tests/e2e 的假 MP4 冒充真实可播放视频。
- [ ] 失败和取消测试都断言 start 只产生一个终态、已有目标/源未变化，以及 getState().phase 恢复 idle；错误码使用下方映射。
- [ ] 运行 node --test tests/video-export.test.js，确认新增模块测试先失败。
- [ ] 实现任务互斥与一次终态处理。start 在任何 await 前占用当前任务，最终 finally 释放。cancel 标记对应 jobId，停止当前子进程并等待 close；preparing 阶段同样可取消。
- [ ] 执行媒体探测，读取首个主视频与音频、时长、编码尺寸、旋转元数据和帧节奏；按旋转后的显示尺寸生成 ASS/验证输出，不能把手机旋转视频的原始编码宽高当作画面宽高。拒绝无视频、不可读文件及不能保留显示尺寸的输入。检查字幕实际时间范围。运行固定参数如下，动态路径只能作为数组元素：

```js
const probeArgs = [
  '-v', 'error', '-show_format', '-show_streams',
  '-of', 'json', videoPath
];

const renderArgs = [
  '-hide_banner', '-nostdin', '-n',
  '-i', videoPath,
  '-map', '0:v:0', '-map', '0:a:0?',
  '-vf', 'ass=captions.ass',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
  '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough',
  '-c:a', 'aac', '-b:a', '192k',
  '-movflags', '+faststart',
  '-progress', 'pipe:1', '-nostats',
  stagedOutputPath
];
// 空 steps 时不传 -vf。cwd 为任务专属 ASS 目录。
// 不设置 -r、-s 或 scale 来改变原输入；必要限制通过明确错误表达。
```

- [ ] 在任务私有目录生成 UTF-8 captions.ass。PlayRes 使用实际输出画面尺寸，样式使用统一参数；时间以秒转 ASS 百分秒；lines 用显式换行输出。使用经实测可保留反斜线/花括号的纯文本处理方式，不允许用户文本改变样式。
- [ ] 同时保留一条中文长句和包含反斜线、花括号的测试字幕，真实解码检查字符；不凭命令 exit=0 判断字幕显示正确。
- [ ] 监听 progress 行并处理跨 chunk 的半行，out_time_us / 1000000 / duration 计算 0–99。进程 close=0 后进入 finalizing；不要根据 progress=end 提前成功。
- [ ] FFprobe 验证临时视频可读、视频流/音频与时长符合要求。文件提交用 COPYFILE_EXCL；遇 EEXIST 保留已有目标并提示换名。复制失败只清除当前操作新建的目标；不得删掉本来就有的文件。
- [ ] 清理仅限本任务临时目录与临时 MP4，检查源与目标的规范化路径；源和已有目标只读。取消结果待子进程终止、清理完成才返回；finalizing 开始后不接受新取消。
- [ ] 使用以下真实测试作为现有测试文件中的显式开关场景。准备有效测试视频和已验证工具路径后启用；跳过不算成功证据。

```js
test('real FFmpeg produces an MP4 from a subtitle recipe', {
  skip: process.env.SRT_REAL_EXPORT !== '1'
}, async (t) => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const { createVideoExportService } = require('../src/video-export');
  const { buildSubtitleRecipe } = require('../src/render-recipe');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'srt-export-real-'));
  t.after(() => fs.rm(root, { recursive:true, force:true }));
  const videoPath = process.env.SRT_EXPORT_SAMPLE;
  const outputPath = path.join(root, '中文字幕.mp4');
  assert.ok(videoPath, 'SRT_EXPORT_SAMPLE must be a real local video');
  assert.ok(process.env.SRT_FFMPEG_PATH);
  assert.ok(process.env.SRT_FFPROBE_PATH);
  const service = createVideoExportService({
    getExportTools: async () => ({
      ffmpegPath:process.env.SRT_FFMPEG_PATH,
      ffprobePath:process.env.SRT_FFPROBE_PATH
    })
  });
  const result = await service.start({
    jobId:'real-1', videoPath, outputPath,
    recipe:buildSubtitleRecipe([
      { id:'s1', start:0, end:1, text:'真实字幕验收' }
    ])
  }, () => {});
  assert.equal(result.status, 'completed');
  assert.ok((await fs.stat(outputPath)).size > 0);
  assert.equal(service.getState().phase, 'idle');
});
```

- [ ] 运行普通模块测试；在选定短样片上显式运行真实场景并另保留一份人工检查 MP4（测试临时目录清理后不能再用作人工证据）。使用 FFprobe 和外部播放器核对中文字幕、音频、尺寸、时长。
- [ ] 单独提交两文件，提交说明 feat: render subtitle recipes to MP4。

**退出：** T3 渲染模块已生成真实字幕 MP4；累计目标时间 150 分钟。取消、失败和源保护可检验。到此仍无视频则停止报告。

### Task 4：桌面桥接与视频源一致（45 分钟）

**Files:** main.js、preload.js、app/editor-core.js、tests/main-entry.test.js、tests/e2e/electron-main.js、tests/e2e/electron.fixture.js；本任务的源一致场景加入新 video-export-flow.spec.js。

**Consumes:** T3 导出模块、现有项目 video.path。

**Produces:** 本计划定义的四个 srtAPI 入口和主进程生命周期处理。

- [ ] 先加入桥接行为断言：取消另存为时导出服务调用数为零；默认目录和文件名正确；页面不能提供目标路径或工具路径。接口命名与下列 preload 代码一致：

```js
resolveVideoSource: (videoPath) =>
  ipcRenderer.invoke('video:resolve-source', videoPath),
startVideoExport: (request) =>
  ipcRenderer.invoke('video-export:start', request),
cancelVideoExport: (jobId) =>
  ipcRenderer.invoke('video-export:cancel', jobId),
onVideoExportProgress: (callback) => {
  const listener = (_event, progress) => callback(progress);
  ipcRenderer.on('video-export:progress', listener);
  return () => ipcRenderer.removeListener('video-export:progress', listener);
},
```

- [ ] 主进程 video:resolve-source 使用 fs.realpath/stat 与 node:url.pathToFileURL，返回真实本地视频路径和 src；不可用时返回 VIDEO_PATH_UNAVAILABLE。不公开任意文件读写。
- [ ] 桌面 editor-core 初次打开按项目路径请求 source，然后设置播放器 src；loadedmetadata 成功才确认该项目源可用于识别/导出。失败后清空可导出路径，显示返回首页重新导入提示。浏览器保留原 Blob 预览。
- [ ] 将 A/B 项目回归写入测试：给全局 Blob 放 B，再打开保存 A 路径的项目，断言播放器加载 A 的 file URL，currentProjectVideoPath 也为 A；A 无效时不能显示 B 并宣称 A 就绪。
- [ ] main.js 的 startApplication 注入 videoExportService，默认以 activeEnvironment.getExportTools 构造实际模块。测试注入 fake 模块、源解析和原生对话框结果，避免测试打开用户真实文件对话框。
- [ ] video-export:start 在任何异步工作前占用单任务槽，validateRecipe 后打开另存为；原生取消返回 cancelled。源与输出路径相同/输出已存在时返回错误；不会调用旧 cli:exec。
- [ ] 另存为期间的主进程 preparing 槽独立记录取消/关闭标记；此时服务尚未 start，不能只调用服务 cancel。对话框返回后先检查标记和发起窗口是否存活，通过才调用 start；否则返回 cancelled，不创建进程或输出。进度发给发起窗口，完成后释放单任务槽。正常关闭或退出时通过同一 cancel 路径结束子进程并等待清理；文件正在 finalizing 时等待它结束再关闭。
- [ ] 测试仅校验窄 IPC 行为、默认路径、取消、源一致。运行 node --test tests/main-entry.test.js 与该聚焦 E2E，再复跑自动字幕中与视频导入有关的场景。已有字幕测试使用无效 MP4 字节，需要为依赖 loadedmetadata 的新场景使用有效素材，不能调低生产检查迁就假素材。
- [ ] 单独提交上述文件，提交说明 feat: connect native video export and project source。

**退出：** 主进程受控导出可调用，预览源与导出源一致，取消另存为不触发渲染；没有新增资产管理系统。

### Task 5：导出交互、字幕外观与编辑锁（75 分钟）

**Files:** app/editor-export.js、app/剪辑.html、app/editor-subtitles.js、app/editor-timeline.js、app/editor-core.js、app/shared.js、tests/e2e/video-export-flow.spec.js、必要 fixture、package.json。

**Consumes:** T2 配方和样式、T4 srtAPI、现有字幕与时间轴状态。

**Produces:** 可手动操作的导出界面；同一任务锁与 applied 快照。

新增控制器接口：
- subtitleController.getAppliedSegments() -> 深拷贝；已有 hasPendingChanges 保持语义。
- timelineController.getUnsupportedExportItems() -> 当前 timelineEffects 的名称数组；不读取历史对话推断效果。
- editorExportController.isBusy() -> boolean。
- editorExportController.getSubtitleLayout(segments) -> 同一文本/字体测量生成的 segments + lines，仅用于预览和快照。

- [ ] 在新 E2E 文件里先写用户行为：有草稿不能开始，应用后能开始，右上角浮层可收起/展开，取消后恢复编辑。运行 npx playwright test tests/e2e/video-export-flow.spec.js，预期缺入口失败。
- [ ] 在 workspace 内、ws-scroll 之前加入右对齐工具栏。使用现有颜色变量，不改主题或侧栏。按如下 ID 固定最小 DOM：

```html
<div class="export-toolbar" data-testid="export-toolbar">
  <button type="button" data-testid="video-export-button"
    aria-controls="videoExportPanel" aria-expanded="false">导出视频</button>
  <section id="videoExportPanel" data-testid="video-export-panel"
    aria-label="视频导出" hidden>
    <p data-testid="video-export-status" role="status"></p>
    <p data-testid="video-export-target"></p>
    <progress data-testid="video-export-progress" max="100" value="0"></progress>
    <button type="button" data-testid="video-export-cancel">取消导出</button>
  </section>
</div>
```

- [ ] 新脚本在现有控制器之后加载；共享配方文件在 editor-subtitles 前加载。加入 app/editor-export.js，进度事件只更新当前 jobId；卸载时移除事件监听。
- [ ] 点击的检查顺序：是否桌面/当前源已加载，是否已有生成请求，是否未应用草稿，是否有不支持项。检查通过后建立锁，获取 applied 快照并排版，再调用 startVideoExport。所有终态在 finally 中解锁。
- [ ] 源不就绪提示重新导入；草稿提示应用并打开字幕区；不支持项逐项显示；已有请求提示等待。错误集中在同一导出浮层，不加聊天消息，不自动应用草稿。
- [ ] 同一组布局数据供预览和 ASS 使用。字体加载完成后测量；按视频实际显示矩形计算内容区域，使用统一样式缩放。长句按实际字体测量折行，保留原始字符串，每个 lines 拼接等于 text。Resize 重算，不写字幕 store。
- [ ] 在实际写入口添加 isBusy 检查：生成按钮、字幕内容输入/保存/应用/撤销、时间轴 drop/add/remove、重新上传、openProject/closeTab。禁用样式与逻辑共同生效；锁解除后重新计算按钮状态，不一律全部 enable。
- [ ] 首页与项目导航在导出期间拦截并显示同一浮层。播放、seek、历史展开/收起仍可使用。不要禁用整个编辑器容器来实现锁。
- [ ] 进度 UI 实现 preparing/rendering/finalizing 及唯一终态；finalizing 禁用取消，完成显示路径。渲染取消显示“正在取消”，等待模块终态后才显示“已取消”并解锁。
- [ ] 用注入导出服务测试 jobId 和真实进度事件，而不在产品中加入演示计时器。下面的断言接在同一个成功/取消场景中：

```js
await window.getByTestId('video-export-button').click();
await expect(window.getByTestId('video-export-status')).toContainText('导出中');
await expect(window.locator('#generateBtn')).toBeDisabled();
await expect(window.getByTestId('subtitle-document-apply')).toBeDisabled();
await expect(window.locator('#tlPlayBtn')).toBeEnabled();
await window.getByTestId('video-export-button').click();
await expect(window.getByTestId('video-export-panel')).toBeHidden();
await window.getByTestId('video-export-button').click();
await window.getByTestId('video-export-cancel').click();
await expect(window.getByTestId('video-export-status')).toContainText('已取消');
```

- [ ] package.json 显式 test:e2e 列表追加新文件；测试场景覆盖草稿、未支持项、取消/失败后恢复以及 T4 的 A/B 来源一致。无需对每种错误码复制一条 E2E。
- [ ] 运行 node --test tests/render-recipe.test.js tests/video-export.test.js tests/subtitle-state.test.js，及 npx playwright test tests/e2e/video-export-flow.spec.js tests/e2e/auto-subtitles-flow.spec.js。
- [ ] 在真实编辑器打开同一视频，验证原生选择位置、浮层、取消；横屏/竖屏各核对一条长字幕。位置和字号不一致属于本任务缺陷，不在验收阶段改成“可以不一致”。
- [ ] 单独提交，提交说明 feat: add editor export controls and applied-state guards。

**退出：** 用户能独立导出；UI、字幕外观、状态冻结与恢复均满足设计。不增加格式面板或后台任务中心。

### Task 6：真实整链复跑、回归与研发日志（60 分钟）

**Files:** docs/DEVELOPMENT_LOG.md、docs/PROJECT_STATUS.md；仅允许修改阻断上述验收的现有任务文件。

**Consumes:** T1–T5 已完成软件、可用 CLI、已有 Whisper Small、用户允许测试的真实视频。

**Produces:** 分开标注的模拟/真实证据、最终输出与未完成清单。

- [ ] 先运行 npm test 和 npm run test:e2e 一次完整现有回归。若失败，定位与本期关系；不得为了“全部通过”删除断言或绕过源路径/能力检查。仅修当前链路阻断项。
- [ ] 从首页真实导入，向已选择的本地 CLI 发送“给视频加字幕”，使用已经准备好的 Whisper 模型；本场景不替换为 fake 服务。
- [ ] 在整段字幕文稿里修改一条文字，保存但不应用，确认导出被阻止；点击应用，确认预览更新。
- [ ] 选择新文件名导出，在进度中播放/seek、收起/展开浮层、查看历史，并尝试一次被锁住的修改；确认没有修改成功。
- [ ] 在外部播放器打开输出。将相同时间点的原视频预览与输出对照，检查修改文字已烧录、声音存在、时长与画面尺寸正确。
- [ ] 用一条带旋转元数据的手机竖屏样片核对实际观看方向、显示尺寸及长中文字幕的位置、相对字号和换行；该样片可使用人工已应用字幕，标记为渲染布局验证，不冒充第二次 CLI/Whisper 全链路。
- [ ] 验证一次取消和一次受控失败，检查子进程消失、锁释放、源文件与已有目标未改。正常关闭任务中的应用时不残留渲染进程。异常强制退出不扩展验收。
- [ ] 验证 A/B 项目回开 A、未支持时间轴项删除前后、源路径失效。与前述 E2E 重复的纯界面断言无需在真实长视频反复跑。
- [ ] 更新两份现有状态文档：实际提交基准、通过/失败的命令、真实素材时长、输出文件位置、观测结果、主动开发与等待时间。不得填写预期值替代观测值。
- [ ] 完成记录使用以下固定字段，写入观察到的具体值后才能提交：

```text
内部实现：哪些模块和接口已交付。
用户可见成果：从哪个项目导出、输出位置、能看到的字幕修改。
模拟验证：实际运行命令和通过/失败统计。
真实验证：使用的 CLI、模型、FFmpeg/FFprobe 路径、素材与输出核对结果。
时间：主动开发、支撑投入、外部等待各用多少分钟。
仍未完成：AI 动态效果、Windows 真机、正式发布等排除项。
```

- [ ] 最后执行 git diff --check、检查只暂存本阶段明确文件。提交说明 docs: record subtitle video export acceptance；是否推送根据届时用户的明确要求处理。
- [ ] 告知用户完成等级为“最低可用”，附可打开的导出视频和实际限制。达到验收即停止。

## 可读错误映射

| code / 情况 | 用户提示 | 后续动作 |
|---|---|---|
| VIDEO_PATH_UNAVAILABLE | 当前视频无法读取，请从首页重新导入 | 不启动渲染 |
| EXPORT_BUSY | 正在处理当前导出 | 展开当前进度 |
| 已有编辑请求 | 请等待当前编辑完成后导出 | 不建立新导出 |
| 未应用字幕 | 字幕修改尚未应用，请先点击“应用” | 展开字幕区 |
| EXPORT_UNSUPPORTED_OPERATION | 当前效果暂不支持导出：实际名称 | 不丢弃效果 |
| EXPORT_INVALID_RECIPE | 当前编辑数据无法导出 | 保留项目，记录诊断 |
| EXPORT_RUNTIME_NOT_READY | 字幕导出工具尚未准备好，请前往检测页 | 不假装成功 |
| EXPORT_TARGET_EXISTS | 文件已存在，请更换文件名 | 保留原目标 |
| EXPORT_SOURCE_OVERWRITE | 请为导出选择新的文件名 | 源文件只读 |
| EXPORT_INVALID_MEDIA | 当前视频暂不支持此导出方式 | 不自动转换尺寸/颜色 |
| EXPORT_WRITE_FAILED | 无法保存到所选位置，请检查目录或磁盘空间 | 清理本次未完成文件 |
| EXPORT_RENDER_FAILED | 导出失败，请重试 | 保留字幕，释放锁 |

使用以上有限映射就足够；无需异常分类平台或自动重试。

## 计划自审与覆盖

| 设计要求 | 对应任务 |
|---|---|
| 真实工具、同一路径、可读准备状态 | T1 |
| 最薄配方、唯一字幕能力、无存储迁移 | T2 |
| MP4、硬字幕、音频、进度、取消、源/已有目标保护 | T3 |
| 原生另存为、窄桥接、视频源一致、正常关闭 | T4 |
| 已应用状态、未知项阻断、UI、锁、字幕外观 | T5 |
| 真实链路、模拟/真实区别、日志、停止线 | T6 |

接口自审：全篇统一使用 version/steps/capability/params/segments，时间统一为秒；源参数统一 videoPath，目标 outputPath 只由主进程原生对话框确定；进度以 jobId 关联；不存在另一套 recipe 存储或已实现的“动态 AI 配方”宣称。

周期 0 实测说明：macOS 私有目录中的 PingFang 无法被当前 libass 可靠读取；系统公开字体 Heiti SC 已通过中文字幕烧录样片，因此当前 Mac 固定字体改为 Heiti SC。不引入字体下载器或字体管理系统。长句布局仍需周期 1 样片核对。预算是明确停止线，不能据此提前宣布能在 5.5 小时内交付所有未知条件。
