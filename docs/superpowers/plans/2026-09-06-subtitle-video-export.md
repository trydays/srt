# 字幕真实渲染与 MP4 导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户把当前项目已应用的字幕真正烧入 MP4，并能选择保存位置、查看真实进度、取消和确认结果。

**Architecture:** 现有字幕状态仍是唯一数据源；导出时生成只含 subtitle.burn@1 的不可变快照。独立模块使用周期 0 已验证的 FFmpeg/FFprobe 渲染，主进程负责原生另存为，页面只负责一次性快照和最小交互。

**Tech Stack:** Electron 33、原生 JavaScript/CommonJS、node:test、Playwright、FFmpeg/libass、FFprobe。不新增依赖。

**Design:** docs/superpowers/specs/2026-09-06-subtitle-video-export-design.md

**Baseline:** feature/subtitle-export-cycle0 @ 06abc0c

**Status:** 周期 0 已完成并关闭；周期 1–3 尚未实施。当前只授权文档同步，不授权功能实施、合并或推送。

**Working directory:** /Users/mac/Documents/Codex/SRTP-worktrees/subtitle-export-cycle0

## Global Constraints

- 只实现 subtitle.burn@1；必须恰好一个字幕步骤和至少一段字幕，空配方不做普通转码。
- 只读已应用 segments；draft 和编辑区候选文字不能进入输出。
- 固定 MP4/H.264/AAC/yuv420p；不增加格式、编码器、画质、GPU 或多效果设置。
- 只创建新文件；源文件和已有目标绝不覆盖。
- 当前 Mac 固定使用已实测的 Heiti SC；不下载或管理字体。
- 预览、识别和导出绑定同一项目实际加载路径；不迁移 IndexedDB，不建设资产库。
- 页面只维护一个 isExporting；不建设通用锁、事件总线、任务中心、队列、恢复或自动重试。
- 不做持续 Resize 字幕排版、精确换行/像素一致、HDR、复杂多流、Windows 真机或正式打包。
- 总口径 30（已完成）+ 90 + 90 + 40 = 250 分钟；剩余主动开发与验证最多 220 分钟。
- 周期 0 的 30 分钟全部保守计为支撑；剩余支撑最多 32 分钟，分配为周期 1/2/3 各 14/10/8 分钟。
- 前一周期未用的支撑额度可后移，不可提前透支。周期 0 可靠的超时总投入从剩余主动额度 220 分钟等额扣减，其中属于支撑的部分同时从剩余支撑 32 分钟等额扣减。
- 直接实现冻结行为及直接证明该行为的聚焦测试属于产品实现/验证；环境诊断、工具修理、测试夹具适配和无关失败定位属于支撑；只有无人工作、无需监看的纯等待单列外部等待。
- 支撑项超过自身估时两倍、检查点没有可见成果或周期预算耗尽时，立即停止报告。
- 新工作只有直接阻断冻结验收、避免现实安全/法律/数据损失，或用户知情批准时才可加入。
- 每周期通过后只提交明确文件；下一周期仍须用户授权。不得自动合并或推送。
- .superpowers/brainstorm/ 不加入提交、不删除。

## 周期冻结

| 周期 | 唯一目的 | 可见成果 | 明确不做 | 上限 | 立即结束 |
|---|---|---|---|---:|---|
| 0 能力闸门 | 证明当前 Mac 能烧录中文字幕 | 检测页状态和一秒有声样片 | 不重开环境建设 | 30 分钟，已完成 | 保持关闭 |
| 1 渲染核心 | 已应用字幕快照生成真实 MP4 | 外部播放器可打开的真实 MP4 | 不做普通转码、注册器、第二效果或 UI | 90 分钟 | 开工 45 分钟先有 MP4；进度、取消和源保护通过即停 |
| 2 编辑器接入 | 从现有编辑器调用周期 1 能力 | 原生另存为、真实进度和取消 | 不做持续 Resize、通用锁、任务中心或改版 | 90 分钟 | 开工 45 分钟能发起真实导出；源一致和入口恢复通过即停 |
| 3 整链验收 | 证明自然语言字幕到导出的整链 | 最终视频、聚焦回归和研发记录 | 不重复人工矩阵、不修无关失败、不扩平台 | 40 分钟 | 开工 20 分钟先跑真实整链；冻结验收通过即停 |

每周期开始和结束记录产品实现、支撑工作、外部等待、剩余主动额度和剩余支撑额度五个实际整数分钟值；没有发生的项目记 0。

## 文件与接口边界

周期 0 已完成的 src/environment/index.js、app/env-check.js 及其测试不再修改；后续只调用 getExportTools()。

| 周期 | 文件 | 职责 |
|---|---|---|
| 1 | src/render-recipe.js | 新建；唯一字幕快照和固定样式 |
| 1 | src/video-export.js | 新建；媒体探测、ASS、渲染、进度、取消、验证和排他保存 |
| 1 | tests/render-recipe.test.js、tests/video-export.test.js | 新建；窄校验、真实 MP4 闸门和必要模块行为 |
| 2 | main.js、preload.js | 修改；源解析、原生另存为、窄 IPC、正常关闭 |
| 2 | app/editor-core.js | 修改；桌面预览绑定当前项目规范化路径 |
| 2 | app/editor-subtitles.js | 修改；增加已应用字幕深拷贝读取口 |
| 2 | app/editor-timeline.js | 修改；增加请求中和当前未支持项读取口 |
| 2 | app/editor-export.js、app/剪辑.html | 新建控制器并增加右上角入口、浮层和现有色彩样式 |
| 2 | tests/main-entry.test.js、tests/e2e/electron-main.js | 修改；窄桥接和固定假导出结果 |
| 2 | tests/e2e/video-export-flow.spec.js | 新建；一条组合流程 |
| 2 | tests/e2e/auto-subtitles-flow.spec.js | 仅在无效媒体夹具阻断 loadedmetadata 时最小适配 |
| 3 | docs/DEVELOPMENT_LOG.md、docs/PROJECT_STATUS.md | 完整证据只写前者；后者只写等级、成果、限制和链接 |

不修改 src/local-cli.js、src/subtitles.js、app/effects.js、app/shared.js、package.json、Whisper 模型或组件目录。

冻结接口：

~~~text
buildSubtitleRecipe(segments)
validateRenderRecipe(recipe)
SUBTITLE_STYLE

createVideoExportService({ getExportTools, spawnImpl?, fsApi? })
service.start({ jobId, videoPath, outputPath, recipe }, onProgress)
service.cancel(jobId)
service.getState()

// outputPath 只可由主进程在另存为结束后加入 preparing 进度
{ jobId, phase: 'preparing' | 'rendering' | 'finalizing', percent, outputPath? }
{ jobId, status: 'completed', outputPath }
{ jobId, status: 'cancelled' }
{ jobId, status: 'failed', errorCode }

srtAPI.resolveVideoSource(videoPath)
srtAPI.startVideoExport({ jobId, videoPath, recipe })
srtAPI.cancelVideoExport(jobId)
srtAPI.onVideoExportProgress(callback)
~~~

## 已关闭：周期 0

- [x] 应用选择 /opt/homebrew/opt/ffmpeg-full/bin/ffmpeg 及同目录 ffprobe。
- [x] ass、libx264、AAC、MP4、ffprobe 已实测；Heiti SC 中文字幕 + AAC 样片可播放。
- [x] environment/install 42/42、聚焦 E2E 7/7、npm test 134/134 通过。
- [x] 代码与证据已提交于 3d11ccd、63afc59、11dc10d、77a59cd。

不得重跑安装、扩充候选扫描、补环境框架或重做周期 0 证据。

---

### Task 2：最薄字幕快照（周期 1，15 分钟）

**Files:**
- Create: src/render-recipe.js
- Create: tests/render-recipe.test.js

**Interfaces:** 读取已应用 segments；产出 buildSubtitleRecipe、validateRenderRecipe、SUBTITLE_STYLE。

**不做与退出:** 不做空配方、注册器、第二效果或存储迁移。计划内步骤均为直接实现/验证，意外支撑预留最多 4 分钟并从本任务总额内扣；聚焦测试通过即结束。

- [ ] **Step 1（3 分钟）: 写 RED**

tests/render-recipe.test.js 只写三项：

~~~js
test('builds an independent applied-subtitle snapshot', () => {
  const applied = [{ id: 's1', start: 0.2, end: 1.4, text: '大家好' }];
  const recipe = buildSubtitleRecipe(applied);
  applied[0].text = '后来的草稿';
  assert.equal(recipe.steps[0].params.segments[0].text, '大家好');
});
test('rejects empty and unknown recipes', () => {
  assert.throws(() => validateRenderRecipe({ version: 1, steps: [] }),
    { code: 'EXPORT_INVALID_RECIPE' });
  assert.throws(() => buildSubtitleRecipe([]), { code: 'EXPORT_INVALID_RECIPE' });
  assert.throws(() => validateRenderRecipe({
    version: 1,
    steps: [{
      capability: 'subtitle.burn@2',
      params: { segments: [{ id: 's1', start: 0, end: 1, text: '原文' }] }
    }]
  }), { code: 'EXPORT_UNSUPPORTED_OPERATION' });
});
test('rejects invalid timing, blank text and executable fields', () => {
  assert.throws(() => buildSubtitleRecipe([
    { id: 's1', start: 1, end: 1, text: '原文' }
  ]), { code: 'EXPORT_INVALID_RECIPE' });
  assert.throws(() => buildSubtitleRecipe([
    { id: 's1', start: 0, end: 1, text: '   ' }
  ]), { code: 'EXPORT_INVALID_RECIPE' });
  for (const field of ['command', 'args', 'script']) {
    const step = {
      capability: 'subtitle.burn@1',
      params: { segments: [{ id: 's1', start: 0, end: 1, text: '原文' }] },
      [field]: 'not allowed'
    };
    assert.throws(() => validateRenderRecipe({ version: 1, steps: [step] }),
      { code: 'EXPORT_INVALID_RECIPE' });
  }
});
~~~

文件顶部直接 require node:test、node:assert/strict 和 ../src/render-recipe。

- [ ] **Step 2（2 分钟）: 运行 RED**

Run: node --test tests/render-recipe.test.js

Expected: FAIL，原因是模块尚不存在。

- [ ] **Step 3（5 分钟）: 实现窄校验**

src/render-recipe.js 使用现有 UMD 风格同时导出 CommonJS 和 window.SRTRenderRecipe。validateRenderRecipe 只接受：

~~~js
{
  version: 1,
  steps: [{
    capability: 'subtitle.burn@1',
    params: { segments: [{ id, start, end, text }] }
  }]
}
~~~

要求 steps.length === 1、segments 非空、ID 唯一、时间有限且 0 <= start < end、text.trim() 非空。顶层、step、params 和 segment 仅允许上述字段。返回全新对象；SUBTITLE_STYLE 严格复制设计第 4 节的 Heiti SC、16/450、7%、84%、白字和 0.72 黑底参数。

- [ ] **Step 4（3 分钟）: 运行 GREEN**

Run: node --test tests/render-recipe.test.js tests/subtitle-state.test.js

Expected: 全部 PASS；subtitle-state 无改动。

- [ ] **Step 5（2 分钟）: 检查边界**

Run: git diff --check

Expected: 只有本任务两文件，且不存在空配方分支、注册表或新存储。

### Task 3：先产出真实 MP4，再补进度和取消（周期 1，75 分钟）

**Files:**
- Create: src/video-export.js
- Create: tests/video-export.test.js
- Modify only for a direct Task 2 contract defect: src/render-recipe.js、tests/render-recipe.test.js

**Interfaces:** 消费 getExportTools、validateRenderRecipe、SUBTITLE_STYLE；产出 createVideoExportService 的 start/cancel/getState。

**不做与退出:** 不做普通转码、第二效果、UI、多流策略或媒体修复。计划内步骤均为直接实现/验证；周期 1 意外支撑（含 Task 2）合计最多 14 分钟且仍受 90 分钟总额约束。开工后 45 分钟没有真实 MP4 立即停止，冻结行为通过后停止。

- [ ] **Step 1（3 分钟）: 写唯一真实输入 helper**

在 tests/video-export.test.js 加 `createRealInput(t, ffmpegPath)`：每次用 `fs.mkdtemp(path.join(os.tmpdir(), 'srt-cycle1-'))` 创建独占目录，以 `execFile` 和下列参数生成四秒 640×360 H.264 + AAC 输入；使用 `-n`，不得覆盖任何已有文件。`SRT_KEEP_REAL_EXPORT=1` 时保留并打印目录，否则 `t.after` 只删除本次目录。

~~~js
[
  '-n', '-f', 'lavfi', '-i', 'color=c=0x243044:s=640x360:r=25',
  '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000',
  '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', sourcePath
]
~~~

- [ ] **Step 2（2 分钟）: 写真实导出 RED**

在 tests/video-export.test.js 写一个 SRT_REAL_EXPORT 开关测试：从 `SRT_FFMPEG_PATH`、`SRT_FFPROBE_PATH` 取得周期 0 工具，调用 helper 和 start，字幕为“周期一真实字幕”，只断言 completed、输出非空、H.264、AAC、约四秒，并打印 `REAL_EXPORT_OUTPUT=<绝对路径>`。第 45 分钟闸门不提前要求进度；进度由 Step 9–13 完成。

- [ ] **Step 3（2 分钟）: 运行 RED**

Run: `SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe node --test tests/video-export.test.js`

Expected: FAIL，原因是 src/video-export.js 尚不存在。

- [ ] **Step 4（3 分钟）: 建立服务边界**

创建 src/video-export.js；start 在第一个 await 前占用唯一 current，先校验 recipe、realpath/stat，并在 spawn 前拒绝源/目标相同及已有目标。

- [ ] **Step 5（5 分钟）: 探测输入**

使用 getExportTools 的同套路径和参数 ['-v','error','-show_format','-show_streams','-of','json',videoPath]。只读取首个视频、首个音频、时长、宽高和旋转；无视频或字幕明显越界返回 EXPORT_INVALID_MEDIA。

- [ ] **Step 6（5 分钟）: 写 ASS**

在任务临时目录写 UTF-8 captions.ass。PlayRes 按旋转后的显示尺寸；Fontsize=`显示高度 × 16 / 450`，左右 Margin 各为显示宽度 8%（内容宽 84%），MarginV 为显示高度 7%；Heiti SC、白字、0.72 黑底、Alignment=2。左花括号前加反斜线；用户原始反斜线后插 U+2060；文本换行转为 `\N`，其余自动折行交给 libass，不做浏览器排版引擎。

- [ ] **Step 7（5 分钟）: 渲染、验证并排他保存**

~~~js
const renderArgs = [
  '-hide_banner', '-nostdin', '-n', '-i', videoPath,
  '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'ass=captions.ass',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
  '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
  '-progress', 'pipe:1', '-nostats', stagedPath
];
spawnImpl(ffmpegPath, renderArgs, { cwd: taskDir, shell: false });
~~~

close=0 后 ffprobe staged.mp4：可读、有视频、有源音频时保留音频、时长基本一致、旋转后的显示尺寸与输入一致；再以 COPYFILE_EXCL 保存。finally 只删本任务临时目录。

- [ ] **Step 8（5 分钟）: 执行周期第 45 分钟可见闸门**

Run: `SRT_REAL_EXPORT=1 SRT_KEEP_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe node --test tests/video-export.test.js`

Expected: PASS，并打印唯一 `REAL_EXPORT_OUTPUT`；外部播放器打开该路径可见“周期一真实字幕”。失败即停止。

- [ ] **Step 9（5 分钟）: 写五个聚焦行为测试**

只增加：已有目标不变；progress 跨 chunk 且未结束最多 99；cancel 等待 close/清理；反斜线和花括号不形成样式指令；一次非零 close 返回 failed 并清理本任务文件。最小 EventEmitter + PassThrough 留在本测试文件，不建公共夹具。

- [ ] **Step 10（5 分钟）: 实现真实进度**

preparing 为 null；rendering 按 out_time_us / duration 计算 0–99；close=0 后进入 finalizing 99；提交完成后才 completed。

- [ ] **Step 11（5 分钟）: 实现取消**

idle 或 jobId 不匹配时安全返回；preparing/rendering 时标记、终止当前子进程并等待 finally；finalizing 不接受取消；每个 job 只返回一个终态。

- [ ] **Step 12（5 分钟）: 核对源与目标保护**

确认 EEXIST 映射 EXPORT_TARGET_EXISTS，源目标相同映射 EXPORT_SOURCE_OVERWRITE，渲染/写入失败仅清理本任务文件；不增加错误类层级。

- [ ] **Step 13（5 分钟）: 运行聚焦测试**

Run: node --test tests/render-recipe.test.js tests/video-export.test.js tests/subtitle-state.test.js

Expected: 全部 PASS；特殊字符不再人工取证。

- [ ] **Step 14（5 分钟）: 最后一次真实复核**

复跑 Step 8（测试会创建另一独占目录）；确认新输出的字幕、音频、显示尺寸和时长。横竖屏留到周期 3。

- [ ] **Step 15（5 分钟）: 自审实际 diff**

逐项检查只有唯一 capability、固定参数、一个 current 和本任务临时目录清理；删除未被冻结验收需要的抽象。

- [ ] **Step 16（5 分钟）: 验证提交范围**

Run: git diff --check

Expected: 只有周期 1 四个文件，或 Task 2 直接契约修正。

- [ ] **Step 17（5 分钟）: 提交并报告**

~~~bash
git add src/render-recipe.js src/video-export.js tests/render-recipe.test.js tests/video-export.test.js
git commit -m 'feat: render applied subtitles to MP4'
~~~

报告内部实现、可打开的 MP4 和时间账；未经用户授权不进入周期 2。

---

### Task 4：编辑器原生导出纵切（周期 2，90 分钟）

**Files:**
- Modify: main.js、preload.js、app/editor-core.js、app/editor-subtitles.js、app/editor-timeline.js、app/剪辑.html、tests/main-entry.test.js、tests/e2e/electron-main.js
- Create: app/editor-export.js、tests/e2e/video-export-flow.spec.js
- Conditional: tests/e2e/auto-subtitles-flow.spec.js（仅适配既有无效媒体夹具）

**Interfaces:** 消费周期 1 服务和当前项目 video.path；产出四个 srtAPI 方法、右上角入口和一个页面级 isExporting。

**不做与退出:** 不做 app/shared.js 改造、持续 Resize、锁控制器、任务中心或页面改版。支撑最多 10 分钟，其中窄 fake 注入最多 5 分钟、条件夹具适配最多 5 分钟；其他步骤是直接产品实现或冻结验收。第 45 分钟必须由真实按钮启动真实导出，保存、取消、源一致和恢复通过后停止。

- [ ] **Step 1（3 分钟）: 写桥接 RED**

在 tests/main-entry.test.js 读取 preload.js 源码，断言 `resolveVideoSource`、`startVideoExport`、`cancelVideoExport`、`onVideoExportProgress` 四个公开名及移除监听函数存在；同时断言 `startVideoExport` 只有一个 request 参数，页面桥接不出现 outputPath、ffmpegPath 或 ffprobePath。

Run: `node --test tests/main-entry.test.js`

Expected: FAIL，原因是四个桥接尚不存在。

- [ ] **Step 2（5 分钟）: 注入真实服务**

startApplication 参数增加 `videoExportService` 和 `showSaveDialog`；默认服务只以 `activeEnvironment.getExportTools` 构造，默认对话框调用 `dialog.showSaveDialog`。tests/e2e/electron-main.js 的 environment 包装原样转发 `getExportTools`，以便 Step 10 在生产环境模式调用真实服务。主进程只保留一个 `activeExport = null` 普通对象，不建 Job 类或队列。

- [ ] **Step 3（3 分钟）: 加入 preload**

~~~js
resolveVideoSource: (videoPath) => ipcRenderer.invoke('video:resolve-source', videoPath),
startVideoExport: (request) => ipcRenderer.invoke('video-export:start', request),
cancelVideoExport: (jobId) => ipcRenderer.invoke('video-export:cancel', jobId),
onVideoExportProgress: (callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on('video-export:progress', listener);
  return () => ipcRenderer.removeListener('video-export:progress', listener);
}
~~~

- [ ] **Step 4（5 分钟）: 接通单槽另存为与进度转发**

`video-export:start` 只读 jobId/videoPath/recipe，并在第一个 await 前执行：已有 activeExport 就返回 `EXPORT_BUSY`，否则记录 slot `{ jobId, sender, phase:'dialog', cancelled:false, completion:null }`。从占槽开始用同一个外层 try/catch/finally 覆盖对话框、路径处理、通知和服务；无论同步异常、异步异常、取消或终态，finally 都按对象身份释放 slot。对话框使用 MP4 filter，默认 `path.join(path.dirname(videoPath), path.parse(videoPath).name + '-已编辑.mp4')`；非 `.mp4` 选择自动追加扩展名。

取消对话框、发起窗口销毁或 slot 已标记取消时不调用服务。选择后先向仍存活的发起 sender 发送 `{jobId,phase:'preparing',percent:null,outputPath}`，核心结构固定为：

~~~js
const PUBLIC_EXPORT_CODES = new Set([
  'VIDEO_PATH_UNAVAILABLE', 'EXPORT_BUSY', 'EXPORT_UNSUPPORTED_OPERATION',
  'EXPORT_RUNTIME_NOT_READY', 'EXPORT_INVALID_RECIPE',
  'EXPORT_TARGET_EXISTS', 'EXPORT_SOURCE_OVERWRITE', 'EXPORT_INVALID_MEDIA',
  'EXPORT_WRITE_FAILED', 'EXPORT_RENDER_FAILED'
]);
function publicExportCode(error, fallback) {
  return error && PUBLIC_EXPORT_CODES.has(error.code) ? error.code : fallback;
}
if (activeExport) {
  return { jobId, status: 'failed', errorCode: 'EXPORT_BUSY' };
}
const slot = activeExport = {
  jobId, sender, phase: 'dialog', cancelled: false, completion: null
};
try {
  const senderWindow = BrowserWindow.fromWebContents(sender);
  const saveOptions = {
    title: '导出视频',
    defaultPath: path.join(
      path.dirname(videoPath), path.parse(videoPath).name + '-已编辑.mp4'
    ),
    filters: [{ name: 'MP4 视频', extensions: ['mp4'] }]
  };
  const choice = await activeShowSaveDialog(senderWindow, saveOptions);
  if (choice.canceled || slot.cancelled || sender.isDestroyed()) {
    return { jobId, status: 'cancelled' };
  }
  const outputPath = /\.mp4$/i.test(choice.filePath)
    ? choice.filePath : choice.filePath + '.mp4';
  sender.send('video-export:progress', {
    jobId, phase: 'preparing', percent: null, outputPath
  });
  slot.phase = 'service';
  slot.completion = activeVideoExportService.start(
    { jobId, videoPath, outputPath, recipe },
    function(progress) {
      if (activeExport === slot && !sender.isDestroyed()) {
        sender.send('video-export:progress', progress);
      }
    }
  );
  return await slot.completion;
} catch (error) {
  return {
    jobId,
    status: 'failed',
    errorCode: publicExportCode(error, 'EXPORT_WRITE_FAILED')
  };
} finally {
  if (activeExport === slot) activeExport = null;
}
~~~

- [ ] **Step 5（4 分钟）: 解析项目源**

video:resolve-source 只做 fs.promises.realpath/stat 和 pathToFileURL，返回规范化路径与 file URL；失败返回 VIDEO_PATH_UNAVAILABLE。

- [ ] **Step 6（5 分钟）: 让预览绑定同一路径**

editor-core 在桌面版先把 currentProjectVideoPath 设为 null；resolve 成功且 previewVideo loadedmetadata 后才写入规范化路径。桌面失败不回退 IndexedDB；浏览器版保留 Blob。重新上传仍清空托管路径。

- [ ] **Step 7（5 分钟）: 增加两个窄读取口**

~~~js
// subtitleController
getAppliedSegments: function() {
  return currentSubtitleState().segments.map(function(segment) {
    return { id: segment.id, start: segment.start, end: segment.end, text: segment.text };
  });
}

window.timelineController = {
  isRequestInFlight: function() { return requestInFlight; },
  getUnsupportedExportItems: function() {
    return timelineEffects.map(function(effect) { return effect.name; });
  }
};
~~~

- [ ] **Step 8（5 分钟）: 加入最小 UI**

在 .workspace 内、.ws-scroll 前加入“导出视频”按钮及锚定浮层；浮层只含状态、目标路径、progress 和“取消导出”。使用现有 CSS 变量，不改颜色。render-recipe.js 在 editor-subtitles.js 前加载，editor-export.js 在 editor-timeline.js 后加载。

- [ ] **Step 9（5 分钟）: 接通真实点击**

editor-export 点击依次检查：源已加载、没有 requestInFlight、没有 pending subtitle（否则用现有 openAfter(null) 展开字幕区）、没有未支持项。随后设 isExporting=true，获取 applied 深拷贝、构建 recipe、生成 jobId 并调用 startVideoExport；只处理同 jobId 事件。

- [ ] **Step 10（5 分钟）: 执行第 45 分钟真实按钮闸门**

在同一终端运行下列命令；唯一目录保证源与目标不存在。tests/e2e/electron-main.js 继续注入现有 fake CLI/字幕结果来快速得到 applied 字幕，但不注入 videoExportService 或 showSaveDialog，因此按钮、原生对话框和 FFmpeg 全为真实链路。

~~~bash
SRT_CYCLE2_DIR="$(mktemp -d /private/tmp/srt-cycle2.XXXXXX)"
/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg -n -f lavfi -i color=c=0x243044:s=640x360:r=25 -f lavfi -i sine=frequency=660:sample_rate=48000 -t 4 -c:v libx264 -pix_fmt yuv420p -c:a aac "$SRT_CYCLE2_DIR/source.mp4"
printf '%s\n' "$SRT_CYCLE2_DIR"
SRT_E2E_USER_DATA="$SRT_CYCLE2_DIR/user-data" SRT_E2E_REAL_MAC=1 SRT_E2E_LOCAL_CLI=two ./node_modules/.bin/electron tests/e2e/electron-main.js
~~~

在应用中选择 Codex CLI、上传打印目录内的 source.mp4、发送“给视频加字幕”，然后点击导出并把新文件保存到同一打印目录。

Expected: 真实 FFmpeg 启动，浮层出现 preparing/rendering 和目标路径。失败即停止，不继续写状态锁或测试夹具。

- [ ] **Step 11（5 分钟）: 冻结最小写入口**

导出中禁用重复导出、发送、字幕保存/应用/撤销、重新上传，并将指令输入和字幕文字设为不可编辑。tabsBar.inert=true 冻结首页、切换和关闭；捕获 drop/contextmenu 阻止时间轴增删，但保留播放、seek、音量、历史和浮层收展。记录并恢复原状态。

- [ ] **Step 12（5 分钟）: 完成进度、失败与取消**

preparing“准备导出”、rendering“导出中 N%”、finalizing“正在保存”、completed“导出完成”、cancelled“已取消”、failed 显示有限错误文案。finalizing 禁用取消；其他阶段只调用 cancelVideoExport(currentJobId)。completed/cancelled/failed 都在 finally 恢复入口。

- [ ] **Step 13（5 分钟）: 正常关闭**

`video-export:cancel` 只接受当前 jobId：对话框阶段标记 cancelled，服务阶段调用 service.cancel。主窗口 close 时若拥有 activeExport，仅第一次 preventDefault，按同一路径取消并 await activeExport.completion，完成后 destroy；finalizing 时只等待 completion。另存为返回后窗口已销毁则不启动。不得增加强退、断电或重启恢复。

- [ ] **Step 14（4 分钟，支撑）: 注入窄 fake**

仅当 `SRT_E2E_REAL_MAC !== '1'` 时，electron-main.js 才注入固定 fake 服务和 fake showSaveDialog；real-mac 模式永远省略这两项，确保 Step 10 在周期结束后复跑仍走真实链路。fake 记录 exportRequests/exportCancels：第一次 start 发 rendering 42% 后返回 `{status:'failed',errorCode:'EXPORT_RENDER_FAILED'}`；第二次发 42% 后等待 cancel 并返回 cancelled。fake showSaveDialog 返回该测试 userDataDir 下不存在的 export.mp4。不修改 electron.fixture.js。

- [ ] **Step 15（5 分钟）: 写一条组合 E2E**

video-export-flow.spec.js 在一条测试中完成：

1. 路径未完成 loadedmetadata 时点击，断言 VIDEO_PATH_UNAVAILABLE，服务未调用。
2. 首页导入项目 A 后向 IndexedDB 放入 B，重开编辑器并派发测试 metadata。
3. seed 已应用字幕；先保存 draft，断言导出阻止并展开字幕区；应用后继续。
4. 临时加入“淡入”，断言实际名称被阻止；删除后继续。
5. 断言 currentProjectVideoPath 和最终导出请求均为 A。
6. 第一次点击导出，断言 42% 后显示导出失败，按钮、导航和编辑入口恢复。
7. 第二次点击导出，断言 42%、主进程选择的目标、写入口禁用、播放可用、tabsBar.inert。
8. 点击取消，断言“已取消”、exportCancels 的 jobId、按钮和导航恢复。

不得拆分为错误码矩阵。

- [ ] **Step 16（5 分钟）: 运行聚焦验证**

Run:

~~~bash
node --test tests/main-entry.test.js tests/render-recipe.test.js tests/video-export.test.js tests/subtitle-state.test.js
npx playwright test tests/e2e/video-export-flow.spec.js tests/e2e/auto-subtitles-flow.spec.js
~~~

Expected: 全部 PASS。受控失败、A/B、未支持项和失效路径由本次聚焦自动测试证明，不做真实长视频矩阵。

- [ ] **Step 17（5 分钟，条件支撑）: 只适配阻断夹具**

仅当 Step 16 唯一失败原因是 auto-subtitles-flow 的假 MP4 不触发 metadata，才在其 openEditor helper 设置 duration/videoWidth/videoHeight 并派发 loadedmetadata，然后复跑失败场景；否则本步骤记 0 分钟。五分钟仍不通过即停止，不放宽生产检查。

- [ ] **Step 18（5 分钟）: 手动完成一次**

确认原生保存位置、真实进度、源/已有目标不变、播放/seek/历史可用和成功后恢复。真实取消只在周期 3 取证，本周期使用聚焦 E2E，避免重复。

- [ ] **Step 19（3 分钟）: 复核范围**

Run: git diff --check

Expected: 没有 shared.js、package.json、环境模块、持续 Resize、锁框架或任务中心改动。

- [ ] **Step 20（3 分钟）: 提交周期 2**

显式 git add 实际改动的 Task 4 文件，若 auto-subtitles-flow.spec.js 未改则不加入。

Commit: git commit -m 'feat: export applied subtitles from the editor'

报告时间账；未经用户授权不进入周期 3。

---

### Task 5：真实整链、聚焦回归和研发记录（周期 3，40 分钟）

**Files:**
- Modify: docs/DEVELOPMENT_LOG.md、docs/PROJECT_STATUS.md
- Conditional: 仅直接阻断冻结验收的 Task 2–4 文件

**不做与退出:** 不重复人工矩阵，不修无关失败，不扩平台。计划步骤是直接验收/记录；意外诊断支撑最多 8 分钟且仍受 40 分钟总额约束。前 20 分钟必须先得到真实整链视频，冻结验收通过即停止。

- [ ] **Step 1（5 分钟）: 记录额度并导入**

记录时间账；不先跑全量测试。从首页导入一份普通横屏真实有声视频，通过已选本地 CLI 发送“给视频加字幕”。

- [ ] **Step 2（5 分钟）: 修改和应用**

在完整字幕文稿把一处改成常见中文长句并保存；确认未应用时导出被阻止，再点击应用。

- [ ] **Step 3（5 分钟）: 真实导出**

选择新路径导出；观察真实进度，期间收起/展开浮层并播放/seek。

- [ ] **Step 4（5 分钟）: 执行 20 分钟闸门**

外部播放器确认长句在对应时间出现，文字已烧录，白字、半透明黑底、相对位置和相对字号符合预览，且声音存在、时长和显示尺寸基本一致；不比较精确断行或像素。未得到最终视频即停止并报告卡在 CLI、字幕、保存、渲染或播放器哪一层。

- [ ] **Step 5（5 分钟）: 一次竖屏和一次取消**

用一份带旋转元数据的常见手机竖屏长句检查文字出现时间、白字与半透明黑底、相对位置和相对字号，不验精确断行或像素。再做一次真实取消，确认没有伪成功文件，源和已有目标不变。

- [ ] **Step 6（5 分钟）: 运行冻结回归**

Run:

~~~bash
node --test tests/environment.test.js tests/render-recipe.test.js tests/video-export.test.js tests/main-entry.test.js
npx playwright test tests/e2e/video-export-flow.spec.js tests/e2e/auto-subtitles-flow.spec.js
~~~

Expected: 全部 PASS。默认不跑 npm test 或全部 E2E；相关失败需要定位且支撑额度足够时才限时运行，无关失败只记录。

只修同时满足“直接阻断冻结验收、位于计划文件清单、能在剩余额度内完成”的问题，否则写入未完成并停止。

- [ ] **Step 7（5 分钟）: 写单份证据**

DEVELOPMENT_LOG.md 写实际内部实现、用户可见成果、命令与统计、CLI/模型/工具路径、横屏/竖屏/取消、三类时间和限制。PROJECT_STATUS.md 只写“最低可用”、成果、限制和日志链接。

- [ ] **Step 8（5 分钟）: 验证并提交**

Run:

~~~bash
git diff --check
git status --short
~~~

Expected: 只有两份文档及通过三问闸门的直接阻断修复。

显式暂存实际文件；文档提交信息为 docs: record subtitle video export acceptance。达到验收立即停止；推送仍须用户明确要求。

## 有限错误文案

| 状态 | 提示 |
|---|---|
| VIDEO_PATH_UNAVAILABLE | 当前视频无法读取，请从首页重新导入 |
| EXPORT_BUSY | 正在处理当前导出 |
| 请求仍在生成 | 请等待当前编辑完成后导出 |
| 未应用字幕 | 字幕修改尚未应用，请先点击“应用” |
| EXPORT_UNSUPPORTED_OPERATION | 当前效果暂不支持导出：实际名称 |
| EXPORT_RUNTIME_NOT_READY | 字幕导出工具尚未准备好，请前往检测页 |
| EXPORT_INVALID_RECIPE | 当前字幕数据无法导出，请检查字幕内容 |
| EXPORT_TARGET_EXISTS / EXPORT_SOURCE_OVERWRITE | 文件已存在或是源文件，请更换文件名 |
| EXPORT_INVALID_MEDIA | 当前视频暂不支持此导出方式 |
| EXPORT_WRITE_FAILED / EXPORT_RENDER_FAILED | 无法保存或导出失败，请重试 |

不增加异常分类平台或自动重试。

## 自审清单

- 周期 0 只有完成证据，没有未来式安装、测试或样片任务。
- 空 steps 和空字幕明确失败，没有普通转码出口。
- 周期 1/2/3 的可见检查点分别为 45/45/20 分钟。
- 剩余预算 90+90+40=220；支撑 14+10+8=32。
- 周期 1 先产出真实 MP4；周期 2 先打通按钮；周期 3 先跑真实整链。
- 没有持续 Resize、通用锁、任务中心、恢复平台、第二效果或无关修复。
- RenderRecipe、videoExportService、IPC、progress、jobId 前后一致。
- DEVELOPMENT_LOG.md 是唯一完整证据源。
- 每个周期达到退出条件即停止；进入下一周期仍需用户授权。
