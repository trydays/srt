# Task 4 实施报告

## 基线与范围

- 基线提交：`4eb8fe0`（`fix: harden video export lifecycle`）
- 工作树：`/Users/mac/Documents/Codex/SRTP-worktrees/subtitle-export-cycle0`
- 提交信息：`feat: export applied subtitles from the editor`
- 仅实施周期 2 Task 4；未开始 Task 5。

## RED / GREEN 证据

### 1. preload 桥接

- RED：`node --test tests/main-entry.test.js`
  - 结果：6 pass / 1 fail。
  - 关键失败：`preload exposes only the narrow video export bridge`，缺少 `resolveVideoSource`。
- GREEN：`node --test tests/main-entry.test.js`
  - 结果：7 pass / 0 fail。
  - 已证明四个公开名、进度监听移除函数、`startVideoExport(request)` 单参数，以及 preload 不出现 `outputPath`、`ffmpegPath`、`ffprobePath`。

### 2. 组合式编辑器导出流程

- RED：`npx playwright test tests/e2e/video-export-flow.spec.js`
  - 结果：1 fail。
  - 关键失败：等待 `[data-testid="video-export-button"]` 超时，导出入口尚不存在。
- GREEN：`npx playwright test tests/e2e/video-export-flow.spec.js`
  - 结果：1 pass / 0 fail（4.3s）。
  - 已证明 metadata 前拒绝且服务未调用、A/B 源隔离、pending draft 阻止并展开、未支持“淡入”按实际名称阻止、最终请求只含 A 与 applied 字幕、42% 后失败恢复、第二次冻结、目标路径、取消 jobId 与恢复。

### 3. 条件夹具适配

- RED：`npx playwright test tests/e2e/video-export-flow.spec.js tests/e2e/auto-subtitles-flow.spec.js`
  - 首轮：3 pass / 4 fail，既有假 MP4 不产生 `loadedmetadata`，字幕请求得到 `VIDEO_PATH_UNAVAILABLE`。
  - 窄适配后首轮：5 pass / 2 fail；失败均发生在测试内 reload 后未再次派发 metadata。
- GREEN：同一命令复跑。
  - 结果：7 pass / 0 fail（23.9s）。
  - 仅在 `auto-subtitles-flow.spec.js` 的 helper 与需要继续操作的 reload 后设置 `duration/videoWidth/videoHeight` 并派发 `loadedmetadata`，未放宽生产检查。

### 4. 聚焦 Node 验证

- 命令：`node --test tests/main-entry.test.js tests/render-recipe.test.js tests/video-export.test.js tests/subtitle-state.test.js`
- 结果：35 tests；34 pass / 0 fail / 1 skip。skip 是既有真实可播放 MP4 测试的条件跳过。

## 修改文件

- `main.js`
- `preload.js`
- `app/editor-core.js`
- `app/editor-subtitles.js`
- `app/editor-timeline.js`
- `app/editor-export.js`（新增）
- `app/剪辑.html`
- `tests/main-entry.test.js`
- `tests/e2e/electron-main.js`
- `tests/e2e/video-export-flow.spec.js`（新增）
- `tests/e2e/auto-subtitles-flow.spec.js`（条件夹具适配）

## 真实按钮闸门

- 状态：通过，且在 45 分钟闸门前到达可从按钮发起的真实链路。
- 唯一目录：`/private/tmp/srt-cycle2-codex.4xjmds`
- 真实源：`source.mp4`
- 人工路径：选择 Codex CLI → 导入源 → 发送“给视频加字幕” → 点击右上“导出视频” → 使用原生另存为保存默认目标。
- 人工观察：浮层从“准备导出”进入真实渲染并最终显示“导出完成”；目标为 `/private/tmp/srt-cycle2-codex.4xjmds/source-已编辑.mp4`。
- 独立冻结检查：源与目标均可由真实 `ffprobe` 读取；二者均为 H.264 640×360 + AAC、时长 4.000000 秒。源为 42383 bytes（10:53），目标为 65397 bytes（10:56），源未被覆盖且目标原先不存在。
- 真实取消按 brief 留到周期 3 取证；本周期取消由聚焦 E2E 验证。

## 时间账

- 产品实现、测试与自审：约 31 分钟。
- 支撑：约 9 分钟总计，其中前置 Electron 基线诊断 6 分钟（接手时已发生）、窄 fake 注入约 1 分钟、条件假媒体夹具适配约 2 分钟；未超过 10 分钟上限。
- 外部等待 / 人工操作：约 2 分钟，单独列账。

## 范围自审

- 未修改 `app/shared.js`、`package.json`、环境模块、`src/local-cli.js`、`src/subtitles.js`、`app/effects.js` 或组件目录。
- 未添加第二效果、格式/编码设置、通用锁、队列、任务中心、事件总线、自动重试、持续 Resize 或页面改版。
- 主进程只有一个普通 `activeExport` slot；页面只有一个 `window.isExporting`。
- 默认导出服务只消费 `activeEnvironment.getExportTools`；real-mac E2E 明确省略 fake 导出服务与 fake 对话框。
- 页面只提交 `jobId/videoPath/recipe`；输出路径只由主进程原生另存为产生。
- UI 复用现有 CSS 变量，没有新增颜色值。

## 顾虑

- 无阻塞顾虑。按 brief，真实取消不在本周期重复取证；正常关闭路径已实现并自审，本次组合 E2E 覆盖页面取消而未单列窗口关闭 GUI 场景。

## Review 修复与复测（Changes requested）

### 四项窄修复

1. `openAfter(null)` 现在仅展开现有字幕文稿；已有 `candidateTexts` 时不再从持久化状态重建，因此未保存候选不会被覆盖。字幕保存、应用、输入、粘贴和键盘写入同时直接服从页面级 `window.isExporting`。
2. 历史卡允许在导出中继续展开查看，但其重渲染出的新撤销按钮会保持禁用；撤销处理本身也检查 `window.isExporting`，导出终态后恢复当前 DOM 中的撤销入口。未引入 MutationObserver 或通用锁。
3. 导出感知的 close handler 由每次 `createWindow` 创建窗口时安装，覆盖首次 ready 窗口和 macOS activate 重建窗口。
4. 服务 fulfilled 的 `failed` terminal 也经过 `publicExportCode`；未知 `EACCES` 收敛为 `EXPORT_WRITE_FAILED`，允许的 `EXPORT_RENDER_FAILED` 原样保留。

### RED 证据

- 命令：`node --test tests/main-entry.test.js`
  - 结果：7 pass / 2 fail。
  - 重建窗口 close listener 实际为 `[1,0]`，期望 `[1,1]`。
  - fulfilled 服务错误码实际为 `EACCES`，期望 `EXPORT_WRITE_FAILED`；允许码对照项仍为 `EXPORT_RENDER_FAILED`。
- 命令：`npx playwright test tests/e2e/video-export-flow.spec.js --grep 'unsaved subtitle candidate|history-created undo'`
  - 结果：2 fail。
  - 未保存候选期望“尚未保存也尚未应用”，实际被重置为“大家好”。
  - 历史卡在导出中重渲染后，新的 `subtitle-undo` 实际为 enabled，期望 disabled。

### GREEN 证据

- 命令：`node --test tests/main-entry.test.js`
  - 结果：9 pass / 0 fail。
- 命令：`npx playwright test tests/e2e/video-export-flow.spec.js --grep 'unsaved subtitle candidate|history-created undo'`
  - 结果：2 pass / 0 fail（7.3s）。
- 命令：`node --test tests/main-entry.test.js tests/render-recipe.test.js tests/video-export.test.js tests/subtitle-state.test.js`
  - 最终结果：37 tests；36 pass / 0 fail / 1 条件 skip。
- 命令：`npx playwright test tests/e2e/video-export-flow.spec.js tests/e2e/auto-subtitles-flow.spec.js`
  - 最终结果：9 pass / 0 fail（30.7s）。
- 语法检查与 `git diff --check` 均通过。

### Review 修复文件

- `app/editor-subtitles.js`
- `app/editor-timeline.js`
- `app/editor-export.js`
- `main.js`
- `tests/main-entry.test.js`
- `tests/e2e/video-export-flow.spec.js`
- `.superpowers/sdd/task-4-report.md`

### 增量时间账

- 产品修复、测试与自审：约 12 分钟。
- 新增支撑：0 分钟；未遇到新的环境或夹具问题，保留剩余 1 分钟支撑额度。
- 外部等待：0 分钟。
