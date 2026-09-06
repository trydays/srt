# 字幕文稿编辑器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 字幕生成成功后，在左侧同一个文稿区集中校对全部字幕；“保存”只保存项目草稿，“应用”更新字幕轨和预览；成功任务自动折叠，发送下一条指令前安全保存未保存草稿。

**Architecture:** 只扩展现有 renderer：`subtitle-state.js` 管理已应用字幕、草稿和一层生成撤销；`editor-subtitles.js` 管理唯一字幕文稿节点；`editor-timeline.js` 管理两行状态卡、折叠和发送前协调。Whisper、FFmpeg、IPC、Agent 协议和导出链路不变。

**Tech Stack:** Electron 33、经典 JavaScript、HTML/CSS、`localStorage`、Node test、Playwright Electron；不增加依赖。

## Global Constraints

- 完成等级：项目够用，不建设平台级字幕系统。
- 只改 7 个现有文件：`app/subtitle-state.js`、`tests/subtitle-state.test.js`、`app/剪辑.html`、`app/editor-subtitles.js`、`app/editor-timeline.js`、`tests/e2e/auto-subtitles-flow.spec.js`、`tests/e2e/local-cli-effect-flow.spec.js`。
- 不改颜色；不做样式、时间、分段、搜索、AI 校对、翻译、多轨、导出、模型、后端、IPC、关窗拦截或通用撤销。
- E2E 新验收只进入 3 个测试体：扩写既有字幕主流程；净新增 1 个“下一指令/保存失败”流程；扩写既有淡入成功流程。既有无语音失败用例保持原测试体，不另建同类用例。
- 聚焦单元与上述 E2E 是验收门。全量测试只做一次、最多 20 分钟的诊断；允许文件之外的既有失败只报告，不顺手修复。
- TDD：每项先见到与该项缺失能力一致的 RED，再做最小实现并见到 GREEN。
- 中文输入法、编辑中 DOM 不被视频事件覆盖、撤销前确认，分别通过核心可编辑性或现实数据损失闸门；合计最多 20 分钟，包含在支撑预算内，不据此建设通用输入或恢复框架。

## 范围控制合同

1. **唯一目的：** 完成自然语言生成字幕后的集中校对、保存、应用和低密度历史。
2. **可见成果：** 生成后自动打开文稿；成功卡折叠；全部字幕同区可改；保存刷新仍在且预览不变；应用更新预览；失败不丢旧字幕或草稿。
3. **明确不做：** 以上 Global Constraints 列出的能力全部延后。
4. **额度：** 目标 180 分钟，硬上限 240 分钟；支撑目标 40 分钟，硬上限 60 分钟（25%）。第 95 分钟前应出现真实可见文稿、按钮和折叠；最晚第 120 分钟仍未出现则停止报告。
5. **立即结束：** 六项可见成果和聚焦测试通过后停止开发，不因“还能完善”继续加功能。

新增工作只有在“不做无法验收”“不做会造成现实安全/法律/数据损失”“用户知情后明确批准”之一成立时进入；否则记入以后再做，不修改当前阶段。

## 文件职责

- `app/subtitle-state.js`：纯数据；`segments`、`draft`、一层 `undo`，不读 DOM。
- `app/editor-subtitles.js`：唯一文稿 DOM、候选文字、保存/应用、已应用轨道与预览刷新。
- `app/editor-timeline.js`：任务卡状态、折叠、发送下一指令前的安全收起、撤销确认。
- `app/剪辑.html`：既有色彩体系内的结构和样式。
- 三个测试文件：只承载下列已冻结验收，不扩写边界矩阵。

---

### Task 1: 已应用字幕与项目草稿状态

**Files:**

- Modify: `app/subtitle-state.js`
- Modify: `tests/subtitle-state.test.js`

**Produces:**

- `get(projectId) -> {segments, draft, undo}`，兼容旧存储缺少 `draft` 的状态。
- `saveDraft(projectId, textById)`：整份校验，只写 `draft`。
- `applyTexts(projectId, textById)`：整份校验，一次写入 `segments`，清空 `draft`。
- `replace(projectId, requestId, rawSegments)`：快照旧 `segments + draft`，新结果的 `draft` 为 `null`。
- `undo(projectId, requestId)`：恢复快照中的 `segments + draft`，仍只允许一次。
- `updateText(...)` 暂时保留兼容现有界面；成功后清空当前草稿，不扩展其职责。

- [ ] **Step 1: 先补状态测试并运行 RED**

在现有测试文件中覆盖以下精确行为：项目隔离同时包含 `draft`；保存不改变 `segments`；应用更新全部文字并清空草稿；任一空白文字抛 `SUBTITLE_TEXT_REQUIRED` 且无部分写入；未知或缺失 ID 抛 `SUBTITLE_DOCUMENT_STALE` 且无部分写入；重新生成再撤销同时恢复旧字幕和旧草稿；既有“一次撤销”仍成立。

Run: `node --test tests/subtitle-state.test.js`

Expected RED: 缺少 `draft`、`saveDraft` 或 `applyTexts` 的断言失败。

- [ ] **Step 2: 最小实现状态合同**

候选文稿必须恰好覆盖当前所有段落 ID，每个值 `String(value).trim()` 后非空。先完整校验并构造新对象，再调用一次 `write()`；校验失败不得写入。`get()` 返回深拷贝且把旧状态规范化为 `draft: null`、`undo.draft: null`。

- [ ] **Step 3: 运行 GREEN 并提交**

Run: `node --test tests/subtitle-state.test.js`

Expected: 该文件全部通过。

Commit only these two files with: `feat: add subtitle document draft state`

---

### Task 2: 单一字幕文稿与真实保存/应用

**Files:**

- Modify: `app/剪辑.html`
- Modify: `app/editor-subtitles.js`
- Modify: `tests/e2e/auto-subtitles-flow.spec.js`

**Consumes:** Task 1 的 `get/saveDraft/applyTexts/replace/undo`。

**Produces on `window.subtitleController`:**

- 保留 `replace/undo/canUndo/count/render` 兼容入口。
- `openAfter(card)`：把唯一文稿节点移动到最新字幕成功卡后并展开。
- `restoreAfter(card)`：按项目存储恢复文稿并保持折叠。
- `prepareForNextRequest()`：Task 3 使用；无脏数据直接收起，有脏数据保存成功才收起，失败返回 `false` 并保留界面/文字。
- `hasPendingChanges()` 与 `confirmUndo()`：供 Task 3 判定数据损失风险。

- [ ] **Step 1: 扩写既有字幕主流程并运行 RED**

只扩写 `generates, edits, persists and undoes the one subtitle track` 这个既有测试体，验证：

1. 成功后只有一个 `[data-subtitle-document]`，位于结果卡后且展开，标题为 `编辑全部字幕 · 2 段`。
2. 同一滚动表面一次呈现两个固定段落和只读时间；旧 `#subtitleTextEditor/#subtitleTextSave` 消失。
3. 连续修改两段后显示“有未保存更改”；保存后显示“草稿已保存 · 尚未应用”，刷新仍显示草稿，但时间轴/预览仍为旧已应用文字。
4. 应用可直接使用当前候选文稿，更新两段、时间轴与当前画面字幕，状态为“所有修改已应用”。
5. `Tab/Shift+Tab` 在段落间移动；组合输入时的 Enter 不被拦截；普通 Enter 不新增段落；粘贴换行变空格。
6. 人工输入后触发 `loadedmetadata`，候选文字不被重建覆盖。
7. 当前有草稿或未保存修改时，撤销先出现原生确认；取消不撤销，确认后恢复生成前的字幕与草稿。

Run: `npx playwright test tests/e2e/auto-subtitles-flow.spec.js -g "generates, edits, persists"`

Expected RED: 新文稿选择器或行为不存在。

- [ ] **Step 2: 增加唯一文稿结构和最小样式**

在 `#chatArea` 内放一个可移动的静态文稿节点。展开标题精确为 `编辑全部字幕 · N 段`，收起标题为 `编辑字幕 · N 段`；右上角按钮精确为“保存”“应用”。删除时间轴下方旧单句输入和保存按钮。只复用现有 CSS 变量、边框、圆角、字号和颜色；窄栏可换行，不新增主题色。

- [ ] **Step 3: 实现候选文稿、保存和应用**

每段是同一表面内按段落 ID 标识的无卡片可编辑行；开始时间只读。文稿打开时以 `draft` 覆盖对应 `segments.text`。输入只改内存候选并设为 dirty；保存调用 `saveDraft`，不刷新已应用轨道/预览；应用调用 `applyTexts` 后才刷新轨道和预览。

拆分渲染职责：视频 `timeupdate`、`loadedmetadata` 和轨道点击只能刷新已应用字幕表面或定位，不能重建正在编辑的文稿。只有页面恢复、生成替换、应用和撤销可从存储重建文稿。

空白段落在原处提示“字幕文字不能为空”；存储/陈旧错误显示在文稿标题区。失败保留候选 DOM 和原已应用字幕。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `node --test tests/subtitle-state.test.js`

Run: `npx playwright test tests/e2e/auto-subtitles-flow.spec.js -g "generates, edits, persists"`

Expected: 两条命令全部通过。

Commit only these three files with: `feat: add unified subtitle document editor`

---

### Task 3: 两行状态折叠与发送前协调

**Files:**

- Modify: `app/editor-timeline.js`
- Modify: `tests/e2e/auto-subtitles-flow.spec.js`
- Modify: `tests/e2e/local-cli-effect-flow.spec.js`
- Modify `app/editor-subtitles.js` only if Task 2 的既定控制器接口需接线，不扩展接口。
- Modify `app/剪辑.html` only for任务卡折叠样式，不改文稿设计。

**Card contract:**

- 执行中显示“转换编辑指令”和“生成字幕/应用编辑”两行。
- 成功自动折叠；字幕摘要 `✓ 字幕已生成 · N 条 · HH:MM`，普通编辑摘要 `✓ 这次编辑已完成 · HH:MM`。
- 手动展开只保留本次页面会话；失败卡始终展开，保留步骤、错误和恢复提示。
- 字幕成功持久化完成后才 `replace()` 并 `openAfter(card)`；失败不移动文稿、不改变字幕或草稿。

- [ ] **Step 1: 先补两个冻结流程并运行 RED**

Flow B：在 `auto-subtitles-flow.spec.js` 净新增一个测试体。修改文稿后发送下一条指令，断言先保存草稿、文稿收起为 `编辑字幕 · N 段`、有草稿标记、新任务才出现；随后模拟 `Storage.setItem` 失败，再发送时断言输入未清空、指令未发送、文稿未收起、候选文字和既有已存草稿均保留，并显示“字幕草稿保存失败，请重试”。

Flow C：扩写 `local-cli-effect-flow.spec.js` 中既有 `keeps one message and one card, then adds one fade-in marker`，断言成功后只有一行摘要，点击可展开原两步详情。不要新增普通编辑成功测试体。

Run: `npx playwright test tests/e2e/auto-subtitles-flow.spec.js tests/e2e/local-cli-effect-flow.spec.js`

Expected RED: 自动折叠或发送前协调断言失败。

- [ ] **Step 2: 最小实现任务卡与发送门**

最终成功时折叠详情容器，不删除两行、结果或撤销按钮；点击摘要切换 DOM 会话态。最终失败保持展开。恢复历史时成功卡默认折叠，并把唯一文稿恢复到最新有效字幕结果后、默认收起。

发送处理顺序固定为：读取输入但不清空 → `await subtitleController.prepareForNextRequest()` → 只有返回成功才清空输入、追加用户消息并调用 Agent。保存失败时不执行后续步骤。

撤销按钮调用 `confirmUndo()`：仅当前文稿 dirty 或当前版本存在已保存草稿时调用原生 `confirm`；取消不改变任何状态。不要增加自定义弹窗、重做栈或通用事务层。

- [ ] **Step 3: 运行 GREEN 并提交**

Run: `node --test tests/subtitle-state.test.js`

Run: `npx playwright test tests/e2e/auto-subtitles-flow.spec.js tests/e2e/local-cli-effect-flow.spec.js`

Expected: 聚焦测试全部通过；既有无语音失败测试继续证明失败卡可读且不覆盖旧字幕。另以一次手动步骤验证：保存旧草稿后触发无语音失败，刷新后旧草稿仍在。

Commit only allowed files with: `feat: fold completed edit tasks safely`

---

## 有界收尾

- [ ] 检查 `git diff` 只含 7 个允许文件和本计划/设计文档；不处理两个既有未跟踪目录。
- [ ] 复跑聚焦单元与两个聚焦 E2E 文件，作为硬验收。
- [ ] 聚焦通过后各运行一次 `npm run test:unit` 与 `npm run test:e2e`，总诊断时长最多 20 分钟；不运行 `test:e2e:real-mac`，不重复下载或运行 Whisper 长视频。
- [ ] 在真实编辑器做六项可见验收，包括“已存草稿 + 字幕失败仍保留”。
- [ ] 独立审查本阶段完整 diff；只修 Critical/Important 且必须落在冻结范围。Minor 记录，不借机扩展。
- [ ] 达到退出条件即停止，并分开报告“内部完成度”和“用户可见成果”。
