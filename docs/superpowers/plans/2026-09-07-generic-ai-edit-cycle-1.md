# 通用 AI 剪辑执行链：周期 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）or superpowers:executing-plans task-by-task. Do not start Cycle 2 in this plan.

**Goal:** 建立最小统一执行主干，并让现有全片字幕完整通过它运行；AI 只看到当前真正能保存、展示、预览、撤销和导出的能力。

**Architecture:** 一个可执行能力注册表把 capability schema 与其真实 Adapter 函数绑定。`ProjectEditing` 是唯一写入入口，持久化 `EditDocument`，再通过最小线性 `RenderGraph` 提供时间轴、预览、导出和下一轮 AI 上下文。Cycle 1 只实现“源视频 → 字幕 → 输出”，不提前建设完整 DAG、任意端口或多图层系统。

**Tech Stack:** Electron 33、Node.js、原生 JavaScript、UMD/CommonJS、localStorage、FFmpeg、node:test、Playwright。

## 冻结边界

1. 只迁移现有全片字幕；不新增颜色、变换、图层、关键帧、音频或内容分析。
2. `subtitle.generate@1` 本周期声明 `range.allowed: false`，AI 不得输出 `start/end`；局部字幕以后单独设计。
3. 重复生成字幕采用“替换项目唯一字幕轨”，不追加第二条字幕轨；一次撤销恢复生成前的字幕或空状态。
4. 不建立完整 DAG 校验、通用端口类型、任意节点引用或无限撤销。
5. 不增加 npm 依赖、数据库或 IPC，不改变现有颜色和布局。
6. 旧字幕 key 只读迁移并保留；本周期不删除旧文件或旧数据。
7. 所有自然语言编辑都经过 AI Recipe 和 `ProjectEditing`；不保留 renderer 直接命令旁路。
8. 3 小时必须出现可人工查看的迁移结果；6 小时未完成则停止并报告。

## 本周期数据流

```text
全片字幕自然语言
→ AI 输出 subtitle.generate@1
→ ProjectEditing 校验并调用字幕 prepare Adapter
→ 替换唯一 subtitle.track@1 edit
→ 生成 source.video@1 → visual.subtitle@1 的线性 RenderGraph
→ 一次写入 EditDocument + 一次撤销记录
→ 时间轴 / 预览 / 导出 / AI 上下文读取同一 revision
```

能力分层固定为：

```text
AI capability        subtitle.generate@1
已应用 edit          subtitle.track@1
RenderGraph node     visual.subtitle@1
FFmpeg 兼容步骤      subtitle.burn@1
```

## 文件范围

### Create

- `src/edit-capabilities.js` — capability schema 与完整 Adapter 注册；只把完整注册项暴露给 AI。
- `src/render-graph.js` — Cycle 1 最小线性图编译和校验。
- `src/project-editing.js` — 初始化、加载、应用、替换、一次撤销、时间轴与 AI 上下文投影。
- `app/editor-project-editing.js` — 等待媒体信息、注入 localStorage 和字幕生成 IPC、执行旧状态迁移。
- `app/subtitle-draft-state.js` — 仅保存未应用字幕文字草稿。
- `tests/edit-capabilities.test.js`
- `tests/render-graph.test.js`
- `tests/project-editing.test.js`
- `tests/subtitle-draft-state.test.js`

### Modify

- `src/instruction-capabilities.js` — 提示词和解析器读取可执行目录。
- `src/render-recipe.js` — 从当前字幕 graph 生成现有 `subtitle.burn@1` 配方。
- `app/shared.js` — 新增 EditDocument 与字幕草稿存储 key。
- `app/editor-subtitles.js` — 草稿、应用和预览改读统一状态/graph。
- `app/editor-timeline.js` — 整条 Recipe 交给 ProjectEditing，时间轴、撤销和上下文改用投影。
- `app/editor-export.js` — 从当前 graph 生成导出配方。
- `app/editor-core.js` — 未接通组件不再产生假 marker。
- `app/剪辑.html` — 按依赖顺序载入新 module，停止载入旧 subtitle state runtime。
- 相关 unit/E2E tests、`docs/DEVELOPMENT_LOG.md`、`docs/PROJECT_STATUS.md`。

### Keep unchanged

- `main.js`、`preload.js`、`src/local-cli.js`、`src/subtitles.js`、`src/video-export.js`。
- `app/subtitle-state.js` 与原测试暂时保留，作为旧格式参考；页面不再载入它。

## 公开 Interface

```js
var projectEditing = createProjectEditing({
  storage: localStorage,
  storageKey: STORAGE_KEYS.PROJECT_EDIT_STATE,
  idFactory: createLocalId,
  now: Date.now,
  capabilityRegistry: registry,
  graphCompiler: graphCompiler
});

projectEditing.initializeProject({ projectId, mediaFacts, legacySubtitleState });
projectEditing.load(projectId);
// => { document, graph }

projectEditing.applyRecipe({ projectId, expectedRevision, requestId, recipe });
// => Promise<{ document, graph, transactionId }>

projectEditing.replaceEdit({ projectId, expectedRevision, editId, payload });
// => { document, graph }

projectEditing.canUndo({ projectId, transactionId });
projectEditing.undo({ projectId, expectedRevision, transactionId });
// => { document, graph }

projectEditing.timelineItems(projectId);
projectEditing.aiContext(projectId);
```

`applyRecipe` 是 Recipe 标准化的唯一所有者；renderer 直接传入 CLI 返回的 `instruction`。`initializeProject` 是媒体事实与旧字幕迁移的唯一入口。`load`、`timelineItems`、`aiContext` 均不执行迁移或补写数据。

## 关键语义

### 媒体信息就绪

- `editor-project-editing.js` 创建 `window.projectEditingReady`。
- 已有有效 EditDocument 时，可从其中恢复 duration/canvas；新项目必须等待视频 `loadedmetadata` 后调用 `initializeProject`。
- 聊天执行、字幕编辑和导出都先等待该 Promise；尚未就绪时显示“正在读取视频信息”，不得创建 0 秒文档。

### 旧数据迁移

- `editor-project-editing.js` 从旧 `srt_project_subtitles[projectId]` 读取一份 defensive clone，传给 `initializeProject`。
- `initializeProject` 仅在新 EditDocument 不存在时，将旧 `segments` 转成唯一 `subtitle.track@1`，并把旧 undo 转成当前一次撤销。
- `subtitle-draft-state.js` 独立、幂等地迁移旧 `draft`；草稿迁移失败不回滚已经成功的 EditDocument，下次打开继续重试。
- 新状态保存成功后不覆盖、不删除旧 key；重复初始化不得再次写入。

### 重复生成与撤销

- `subtitle.generate@1` 的 capability registration 声明 `editMode: 'replaceByType'` 和 `editType: 'subtitle.track@1'`。
- 新生成结果替换当前字幕轨；inverse 保存被替换前的完整轨，没有旧轨时 inverse 记录删除新轨。
- `replaceEdit` 只修改该字幕轨的完整 payload，不新建事务。若该轨属于当前可撤销事务，则同步推进 undo 记录的 `afterRevision`，保留原 inverse；否则清空旧的一次撤销，避免应用到不匹配状态。

## Task 1：建立真实 Adapter 驱动的可执行目录

**Files:** `src/edit-capabilities.js`、`tests/edit-capabilities.test.js`

- [ ] **Step 1: 先写失败测试**

测试一项完整 registration 会被暴露；分别删除 `prepare`、`toEdit`、`toGraph`、`toTimeline`、`preview` 或 `toExport` 中任一函数时，该 capability 不得进入 `promptDefinitions()`。同时断言：

```js
assert.deepEqual(registry.promptDefinitions().map(function(item) { return item.id; }), [
  'subtitle.generate@1'
]);
assert.equal(registry.get('subtitle.generate@1').definition.range.allowed, false);
assert.throws(function() {
  registry.normalizeRecipe({
    kind: 'instruction',
    steps: [{ capability: 'subtitle.generate@1', params: { start: 2, end: 5 } }]
  }, mediaFacts);
}, { code: 'RECIPE_INVALID_PARAM' });
```

- [ ] **Step 2: 实现最小注册表**

每个 registration 必须包含同一 capability 版本的：

```js
{
  definition: {
    schemaVersion: 1,
    id: 'subtitle.generate@1',
    params: { type: 'object', additionalProperties: false, properties: {} },
    range: { allowed: false, default: 'wholeTarget' }
  },
  prepare: Function,
  toEdit: Function,
  toGraph: Function,
  toTimeline: Function,
  preview: Function,
  toExport: Function
}
```

`promptDefinitions()` 必须从实际 registration 计算，不能接收独立支持 Set 或 `enabled`。`normalizeRecipe` 拒绝未知字段、未知参数、路径、命令或函数，并返回新对象。

这些 Adapter 必须是主进程和 renderer 都能加载的共享函数，通过调用参数接收依赖：`prepare` 从 execution context 取得 `generateSubtitles`，`preview` 返回与 DOM 无关的显示模型，`toExport` 返回声明式导出步骤。不得为了同步能力状态新增 IPC、复制第二份支持清单或手填 `enabled`。

- [ ] **Step 3: 验证并提交 Task 1**

Run: `node --test tests/edit-capabilities.test.js`

Expected: PASS.

Commit: `git add src/edit-capabilities.js tests/edit-capabilities.test.js && git commit -m "refactor: define executable edit capability registry"`.

## Task 2：实现最小 EditDocument、事务和线性 RenderGraph

**Files:** `src/project-editing.js`、`src/render-graph.js`、`tests/project-editing.test.js`、`tests/render-graph.test.js`

- [ ] **Step 1: 先写失败测试**

覆盖：新项目初始化、加载不写盘、字幕生成替换唯一字幕轨、prepare 失败零写入、graph 编译失败零写入、localStorage 失败保持旧 JSON、revision 冲突、完整 payload 替换、一次撤销和跨项目隔离。

```js
test('regenerating subtitles replaces the only track and undo restores it', async function() {
  var first = await fixture.generate('request-1', firstSegments);
  var second = await fixture.generate('request-2', secondSegments, first.document.revision);
  assert.equal(second.document.edits.length, 1);
  assert.deepEqual(second.document.edits[0].payload.segments, secondSegments);

  var undone = fixture.editing.undo({
    projectId: 'p1',
    expectedRevision: second.document.revision,
    transactionId: second.transactionId
  });
  assert.deepEqual(undone.document.edits[0].payload.segments, firstSegments);
});
```

- [ ] **Step 2: 实现最小线性 RenderGraph**

Cycle 1 只允许：

```text
source.video@1 → visual.subtitle@1 → video output
source.video@1.audio → audio output
```

编译器跳过 disabled edit；拒绝重复 node ID、未知节点、越界 range、字幕节点未连接当前 video head，以及不是唯一 video output 的结果。暂不实现任意分支、向后引用、通用端口推导或关键帧。

- [ ] **Step 3: 实现 ProjectEditing**

`applyRecipe` 固定顺序：读取当前 revision → 标准化整份 Recipe → prepare（不写入）→ `toEdit` 构造候选 document → 编译候选 graph → 再次检查 revision → 一次 `setItem` 保存 document 与 undo → 返回 defensive clones。

本周期只接受一条 `subtitle.generate@1` step；真正的多能力原子事务在 Cycle 2 用“字幕 + 颜色”验收，不使用测试专用假能力扩大本周期。

- [ ] **Step 4: 验证并提交 Task 2**

Run: `node --test tests/edit-capabilities.test.js tests/render-graph.test.js tests/project-editing.test.js`

Expected: PASS.

Commit: `git add src/project-editing.js src/render-graph.js tests/project-editing.test.js tests/render-graph.test.js && git commit -m "feat: add minimal project editing transaction"`.

## Task 3：接入媒体就绪、旧字幕和字幕草稿

**Files:** `app/editor-project-editing.js`、`app/subtitle-draft-state.js`、`app/shared.js`、`app/editor-subtitles.js`、`app/剪辑.html`、`tests/subtitle-draft-state.test.js`、`tests/project-editing.test.js`、`tests/e2e/auto-subtitles-flow.spec.js`

- [ ] **Step 1: 增加迁移与 readiness 测试**

验证：新视频 metadata 之前不创建 0 秒文档；旧 segments 迁移一次；旧 key 不变；旧 draft 单独迁移；重复加载零写入；重新生成后旧 draft 因 revision 不匹配而不能应用。

- [ ] **Step 2: 实现 composition root 与 draft sidecar**

新增 storage keys：

```js
PROJECT_EDIT_STATE: 'srt_project_edit_state',
PROJECT_SUBTITLE_DRAFTS: 'srt_project_subtitle_drafts'
```

`editor-project-editing.js` 注入现有 `window.srtAPI.generateSubtitles`，管理 `window.projectEditingReady`，并执行上述幂等迁移。`subtitle-draft-state.js` 只保存 `{projectId,editId,baseRevision,textById}`。

- [ ] **Step 3: 改造字幕编辑与预览**

- 字幕“保存”只更新 draft sidecar。
- “应用”调用 `replaceEdit`，并使用 `baseRevision` 防止旧草稿覆盖新字幕。
- 当前播放字幕必须通过 registration 的 `preview(graph,currentTime)` 得到显示模型，再更新 DOM；不得直接读取旧 store 或绕过 graph。
- 页面停止载入 `subtitle-state.js`，但文件和旧 key 保留。

- [ ] **Step 4: 执行 50% 可见检查点**

Run: `node --test tests/project-editing.test.js tests/subtitle-draft-state.test.js && npx playwright test tests/e2e/auto-subtitles-flow.spec.js`

Expected: PASS. 人工打开一个旧字幕项目，确认字幕、草稿、预览和一次撤销在刷新后仍一致。若 3 小时仍无这个结果，停止并报告。

- [ ] **Step 5: 提交 Task 3**

Commit: `git add app/editor-project-editing.js app/subtitle-draft-state.js app/shared.js app/editor-subtitles.js app/剪辑.html tests/project-editing.test.js tests/subtitle-draft-state.test.js tests/e2e/auto-subtitles-flow.spec.js && git commit -m "feat: migrate subtitles into project edit state"`.

## Task 4：把聊天、时间轴和 AI 上下文切到统一状态

**Files:** `src/instruction-capabilities.js`、`app/editor-timeline.js`、`app/editor-core.js`、相关 unit/E2E tests

- [ ] **Step 1: 写失败测试**

验证：AI prompt 只出现全片字幕；冷色、淡入等请求不会进入“转换成功、应用失败”；成功记录保存 transactionId；刷新后时间轴从 document 重建；下一轮上下文包含当前 revision 和已应用字幕摘要。

- [ ] **Step 2: 切换提示与执行入口**

`instruction-capabilities.js` 从 registry 的 `promptDefinitions()` 生成提示并校验。`editor-timeline.js` 在 clarify 之后仅调用一次：

```js
await window.projectEditingReady;
var loaded = window.projectEditing.load(activeProjectId);
var applied = await window.projectEditing.applyRecipe({
  projectId: activeProjectId,
  expectedRevision: loaded.document.revision,
  requestId: record.id,
  recipe: turn
});
```

删除 runtime 中的 `timelineEffects`、`applyEffectStep`、`applyInstructionSteps`、`isCommand` 与 `executeCommand` 分支。错误卡片区分“当前能力未接通”“准备失败”“项目已变化”和“保存失败”。

- [ ] **Step 3: 使用通用投影**

时间轴只消费 `timelineItems(projectId)` 返回的 `{editId,transactionId,lane,range,label,summary}`。历史记录撤销调用 `canUndo/undo`。下一轮上下文只消费 `aiContext(projectId)`。未接通的组件拖入只显示说明，不写 marker、document 或 AI context。

- [ ] **Step 4: 验证并提交 Task 4**

Run: `node --test tests/instruction-capabilities.test.js tests/local-cli.test.js && npx playwright test tests/e2e/local-cli-effect-flow.spec.js tests/e2e/conversation-sidebar-flow.spec.js tests/e2e/auto-subtitles-flow.spec.js`

Expected: PASS.

Commit: `git add src/instruction-capabilities.js app/editor-timeline.js app/editor-core.js tests/instruction-capabilities.test.js tests/local-cli.test.js tests/e2e/local-cli-effect-flow.spec.js tests/e2e/conversation-sidebar-flow.spec.js && git commit -m "refactor: route editor actions through project editing"`.

## Task 5：让导出读取同一 RenderGraph 并完成整链验收

**Files:** `src/render-recipe.js`、`app/editor-export.js`、`tests/render-recipe.test.js`、`tests/video-export.test.js`、`tests/e2e/video-export-flow.spec.js`、`docs/DEVELOPMENT_LOG.md`、`docs/PROJECT_STATUS.md`

- [ ] **Step 1: 先写 graph-to-export 失败测试**

验证 `visual.subtitle@1` 的 registration `toExport` 生成当前 `subtitle.burn@1` 步骤；未知节点必须返回 `EXPORT_UNSUPPORTED_OPERATION`。删除 E2E 中调用不存在全局 `applyInstruction` 的旧假淡入断言。

- [ ] **Step 2: 切换导出入口**

`editor-export.js` 等待 `projectEditingReady`，读取 `projectEditing.load(projectId).graph`，再调用 `buildRenderRecipe(graph,registry)`。保留现有保存对话框、进度、取消、编辑器冻结和源文件保护；未应用草稿继续阻止导出。

- [ ] **Step 3: 完整自动验证**

Run: `npm test`

Expected: 所有非环境依赖单测通过；真实渲染测试只允许因已有环境开关未启用而跳过。

Run:

```bash
npx playwright test \
  tests/e2e/environment-flow.spec.js \
  tests/e2e/local-cli-flow.spec.js \
  tests/e2e/local-cli-effect-flow.spec.js \
  tests/e2e/conversation-sidebar-flow.spec.js \
  tests/e2e/home-workbench-flow.spec.js \
  tests/e2e/auto-subtitles-flow.spec.js \
  tests/e2e/video-export-flow.spec.js
```

Expected: all listed E2E tests pass.

- [ ] **Step 4: 真实人工验收**

启动 Electron，打开真实视频，执行“给视频加字幕”，编辑并应用一处文字，刷新项目，重新生成并撤销，然后导出 MP4。用外部播放器确认：画面字幕、时间轴、字幕编辑区、导出字幕、音频与下一轮 AI 上下文一致。

- [ ] **Step 5: 更新记录并提交**

研发日志同时记录内部完成度、用户可见成果、自动验证、人工验证和未完成项。

Commit: `git add src/render-recipe.js app/editor-export.js tests/render-recipe.test.js tests/video-export.test.js tests/e2e/video-export-flow.spec.js docs/DEVELOPMENT_LOG.md docs/PROJECT_STATUS.md && git commit -m "feat: complete subtitle project editing chain"`.

## Cycle 1 Exit Gate

满足以下条件立即结束：

- AI 只看到全片字幕，未接通能力不再假成功。
- 有效旧字幕与草稿只迁移一次，旧数据未删除。
- 生成或重新生成始终只有一条字幕轨，撤销恢复生成前状态。
- 字幕编辑、时间轴、预览、导出和 AI 上下文读取同一 revision。
- 刷新复验和真实 MP4 验证通过。

完整 DAG、多能力原子事务、颜色、变换、图层和关键帧均不得成为本周期退出条件。
