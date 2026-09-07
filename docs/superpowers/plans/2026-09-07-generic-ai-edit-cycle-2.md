# 通用 AI 剪辑执行链：周期 2 通用颜色 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 推导出的一个通用颜色步骤，以同一组参数和时间区间贯通项目保存、时间轴、预览、撤销与真实视频导出，并证明“字幕 + 颜色”可以作为一个事务整体成功或失败。

**Architecture:** 新增完整注册的 `video.color.adjust@1` capability；它降低为 `video.color.adjustment@1` edit，再编译成 `video.color@1` RenderGraph 节点，最终由受控 Export Adapter 产生同名导出步骤。`ProjectEditing` 同时升级为通用多步骤原子事务；中央流程只识别 registration 的 `editMode`、`graphStage` 和 adapter，不判断“冷色”等用户效果名，也不判断具体 capability ID。

**Tech Stack:** Electron 33、Node.js、原生 JavaScript、UMD/CommonJS、localStorage、FFmpeg 9、Playwright、node:test。

## Global Constraints

- 本周期唯一目标是 `temperature`、`brightness`、`saturation`、`contrast` 四项通用颜色参数；不做 LUT、HDR、曝光、色彩矩阵、自动调色、滤镜商城或属性面板。
- AI 只能输出声明式 JSON；不能输出或触发 Shell、FFmpeg 字符串、HTML、CSS 或 JavaScript。
- AI 可见 capability 必须同时拥有参数校验、edit lowering、时间轴投影、Preview Adapter 和 Export Adapter。
- 一条自然语言请求对应一个事务；任一步失败时 `EditDocument`、revision 和 undo 均不变化。
- `EditDocument` 是唯一持久化事实来源；RenderGraph、时间轴、预览、导出和下一轮 AI 上下文均由同一 revision 派生。
- 不引入前端框架、数据库、新运行时依赖、通用 DAG、无限撤销或任意 FFmpeg 执行接口。
- 参数语义冻结为：`temperature -1..1（0 中性）`、`brightness -1..1（0 中性）`、`saturation 0..2（1 中性）`、`contrast 0..2（1 中性）`。
- 区间采用半开语义 `[start, end)`；省略时默认为整段视频，必须满足 `0 <= start < end <= duration`。
- 本周期最多 5 小时；四项参数各真实导出一次、字幕与颜色组合一次并整体撤销后立即结束。

---

## File map

- Create `src/color-adjustment.js`: 四项颜色参数的唯一 schema、默认值、标准化和时间区间判定；浏览器与 Node 共用，不包含任意命令执行。
- Modify `src/edit-capabilities.js`: 注册颜色完整 adapter，Recipe 支持多步骤与可信范围标准化，registration 支持 `append | replaceByType` 和 `sourceEffect | overlay`。
- Modify `src/instruction-capabilities.js`: 从 catalog 输出参数约束和可选区间协议，不加入“效果名 → 配方”样例。
- Modify `src/project-editing.js`: 通用多步骤预检、准备、lower、候选图编译、一次提交和一次撤销。
- Modify `src/render-graph.js`: 从 registry 编译多个 edit；按 graph stage 和 edit order 形成最小线性图。
- Modify `src/render-recipe.js`: 严格校验颜色、字幕及其组合导出 Recipe；去掉单字幕步骤假设。
- Modify `src/video-export.js`: 只从已校验步骤生成固定 `colorchannelmixer + eq + ass` filter chain。
- Create `app/editor-color-preview.js`: 从当前 RenderGraph 和播放时间读取颜色 preview descriptor，并只作用于视频元素。
- Modify `app/剪辑.html`: 加入共享颜色语义模块、SVG 颜色滤镜和 preview 脚本。
- Modify `app/editor-timeline.js`: 通用事务状态、区间 marker 和事务级撤销文案；不增加颜色专用分支。
- Modify `app/editor-subtitles.js`: 撤销和字幕定位不再假设字幕永远是 `edits[0]`。
- Modify `app/editor-export.js`: 保持从当前 graph 导出，并接受颜色单独或颜色 + 字幕组合。
- Modify corresponding unit/E2E tests and `docs/DEVELOPMENT_LOG.md`.

---

### Task 1: Register one complete color primitive and extend the AI Recipe protocol

**Files:**
- Create: `src/color-adjustment.js`
- Modify: `src/edit-capabilities.js`
- Modify: `src/instruction-capabilities.js`
- Modify: `app/剪辑.html`
- Test: `tests/color-adjustment.test.js`
- Test: `tests/edit-capabilities.test.js`
- Test: `tests/instruction-capabilities.test.js`

**Interfaces:**
- Produces: `SRTColorAdjustment.PARAMETER_SCHEMA`, `normalizeParams(params, requireChange)`, `normalizeRange(range, duration)`, `isActive(range, time)`.
- Produces: `createColorRegistration()` with capability `video.color.adjust@1`, edit type `video.color.adjustment@1`, node type `video.color@1`, `editMode: 'append'`, `graphStage: 'sourceEffect'`.
- Changes: `registry.validateRecipe(recipe)` accepts one or more strictly data-only steps; `registry.normalizeRecipe(recipe, mediaFacts)` adds trusted target and normalized range to every step.
- Consumes later: Task 2 uses `editMode`, `graphStage`, `toEdit`, `toGraph`; Task 3 uses `toExport`; Task 4 uses `preview`.

- [ ] **Step 1: Write failing shared-semantics tests**

```js
assert.deepEqual(normalizeParams({ temperature: -0.8, brightness: 0.25 }, true), {
  temperature: -0.8, brightness: 0.25, saturation: 1, contrast: 1
});
assert.throws(() => normalizeParams({ brightness: 1.01 }, true), { code: 'RECIPE_INVALID_PARAM' });
assert.throws(() => normalizeParams({}, true), { code: 'RECIPE_INVALID_PARAM' });
assert.deepEqual(normalizeRange({ start: 5, end: 10 }, 12), { start: 5, end: 10 });
assert.equal(isActive({ start: 5, end: 10 }, 10), false);
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test tests/color-adjustment.test.js tests/edit-capabilities.test.js tests/instruction-capabilities.test.js`

Expected: FAIL because `src/color-adjustment.js` and `video.color.adjust@1` do not exist.

- [ ] **Step 3: Add the UMD/CommonJS color semantics module**

```js
var PARAMETER_SCHEMA = Object.freeze({
  temperature: Object.freeze({ type: 'number', minimum: -1, maximum: 1, default: 0,
    description: '负值偏冷，正值偏暖，0 不改变' }),
  brightness: Object.freeze({ type: 'number', minimum: -1, maximum: 1, default: 0,
    description: '负值变暗，正值变亮，0 不改变' }),
  saturation: Object.freeze({ type: 'number', minimum: 0, maximum: 2, default: 1,
    description: '0 为黑白，1 不改变，大于 1 增强饱和度' }),
  contrast: Object.freeze({ type: 'number', minimum: 0, maximum: 2, default: 1,
    description: '1 不改变，小于 1 降低对比度，大于 1 增强对比度' })
});
```

`normalizeParams` 只接受以上四个有限数值，至少一个参数由 Recipe 明确提供，并补齐其余中性默认值；`normalizeRange` 实现半开合法区间，省略时返回整段范围。

- [ ] **Step 4: Add a full color registration and generic registration metadata**

颜色 adapter 的返回形状固定为：

```js
{
  definition: { id: 'video.color.adjust@1', params: { properties: PARAMETER_SCHEMA },
    range: { allowed: true, default: 'wholeTarget' } },
  editMode: 'append',
  editType: 'video.color.adjustment@1',
  nodeType: 'video.color@1',
  graphStage: 'sourceEffect',
  prepare: async function() { return {}; },
  toEdit: function(_prepared, step) {
    return { type: 'video.color.adjustment@1', range: clone(step.range),
      payload: normalizeParams(step.params, true) };
  },
  toGraph: function(edit, graphContext) {
    return { id: 'node-' + edit.id, type: 'video.color@1', range: clone(edit.range),
      inputs: [{ port: 'base', nodeId: graphContext.videoHead }], props: clone(edit.payload) };
  },
  toTimeline: function(edit) {
    return { editId: edit.id, transactionId: edit.transactionId, lane: 'video-effect',
      range: clone(edit.range), label: '画面调色', summary: colorSummary(edit.payload) };
  },
  preview: function(graph, time) {
    return graph.nodes.filter(function(node) {
      return node.type === 'video.color@1' && colorAdjustment.isActive(node.range, time);
    }).map(function(node) { return colorAdjustment.normalizeParams(node.props, false); });
  },
  toExport: function(node) {
    return { capability: 'video.color.adjust@1', range: clone(node.range),
      params: normalizeParams(node.props, false) };
  }
}
```

字幕 registration 增加 `graphStage: 'overlay'`。`completeRegistration` 接受 `append | replaceByType` 和两个已定义 stage，仍要求全部六个 adapter 存在；默认 registry 同时注册字幕和颜色。

- [ ] **Step 5: Extend strict Recipe validation and normalization**

允许 raw step 仅有：

```js
{ capability: 'video.color.adjust@1', range: { start: 5, end: 10 }, params: { temperature: -0.8 } }
```

禁止 `target`、路径、命令、函数和未知 key；禁止给 `range.allowed:false` 的字幕传 range。先校验整份 Recipe，再为每一步加入 `{ target:{kind:'source',id:'main-video'}, range }`。不得在这里执行任何 adapter。

- [ ] **Step 6: Update prompt generation without adding effect recipes**

`capabilityLine()` 必须列出每个参数的 type、minimum、maximum、default 和 description，并说明颜色能力可以提供顶层 `range.start/end`。输出协议描述多步骤数组，但不添加冷色、复古或任何“效果名 → 参数”few-shot。

- [ ] **Step 7: Run focused tests and confirm GREEN**

Run: `node --test tests/color-adjustment.test.js tests/edit-capabilities.test.js tests/instruction-capabilities.test.js`

Expected: PASS；catalog 只包含两个完整能力，越界参数和非法区间都在调用 `ProjectEditing` 前被拒绝。

- [ ] **Step 8: Commit Task 1**

```bash
git add src/color-adjustment.js src/edit-capabilities.js src/instruction-capabilities.js app/剪辑.html tests/color-adjustment.test.js tests/edit-capabilities.test.js tests/instruction-capabilities.test.js
git commit -m "feat: register executable color adjustment capability"
```

---

### Task 2: Make ProjectEditing and RenderGraph support generic atomic multi-step execution

**Files:**
- Modify: `src/project-editing.js`
- Modify: `src/render-graph.js`
- Test: `tests/project-editing.test.js`
- Test: `tests/render-graph.test.js`

**Interfaces:**
- Consumes: Task 1 registration fields `editMode`, `editType`, `nodeType`, `graphStage` and normalized multi-step Recipe.
- Produces: `applyRecipe()` prepares and lowers all steps, compiles one candidate graph, then performs one storage write and one revision increment.
- Produces: graph order `source.video → sourceEffect by edit.order → overlay by edit.order`.

- [ ] **Step 1: Write failing atomic-transaction tests**

Cover exactly these cases:

```js
// One color step creates one color edit with the requested range.
assert.equal(result.document.edits.filter(e => e.type === 'video.color.adjustment@1').length, 1);
// Subtitle + color share one transaction and one revision increment.
assert.deepEqual(new Set(result.document.edits.map(e => e.transactionId)), new Set(['request-2']));
assert.equal(result.document.revision, before.document.revision + 1);
// Failure in step 2 leaves storage, revision and undo byte-for-byte unchanged.
assert.equal(rawAfterFailure, rawBeforeFailure);
// Whole-request undo restores the exact prior edits array.
assert.deepEqual(undone.document.edits, before.document.edits);
```

Also verify color `append` preserves existing ranges, subtitle `replaceByType` leaves only one subtitle track, and `aiContext()` includes each edit’s originating capability, normalized params and range without local paths.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test tests/project-editing.test.js tests/render-graph.test.js`

Expected: FAIL because the current implementation consumes only `steps[0]`, replaces all edits and only compiles one subtitle node.

- [ ] **Step 3: Prepare every step before mutation**

Use this sequence inside `applyRecipe()`:

```js
var normalized = registry.normalizeRecipe(input.recipe, facts(current.document));
var context = resolveExecutionContext(input.projectId);
var prepared = [];
for (var i = 0; i < normalized.steps.length; i++) {
  var registration = registry.get(normalized.steps[i].capability);
  prepared.push({ step: normalized.steps[i], registration: registration,
    value: await registration.prepare(normalized.steps[i], context) });
}
```

在所有 `prepare` 完成前不得 clone 成待提交文档、不得调用 storage；准备完成后仍由现有 `commit()` 再次检查 expected revision。

- [ ] **Step 4: Lower and merge steps through registration metadata**

从当前 edits 的副本开始。为每个 lower 结果分配新 edit ID、同一个 transaction ID 和单调递增 order：

```js
if (registration.editMode === 'replaceByType') {
  candidate.edits = candidate.edits.filter(function(edit) { return edit.type !== registration.editType; });
}
candidate.edits.push(persistedEdit);
```

不得在 `ProjectEditing` 中判断字幕或颜色 capability ID。全部 lower 完成后 revision 只增加一次，undo inverse 保存请求前完整 edits 数组。

- [ ] **Step 5: Compile a registered linear RenderGraph**

编译器先严格验证 document、source 和每个 edit 的通用外壳，再由 `registry.forEditType(edit.type)` 取得 registration。按 `graphStage`（`sourceEffect` 在 `overlay` 前）、`order`、原数组索引稳定排序；每个 `toGraph()` 都接当前 video head。局部 edit range 只要求 `0 <= start < end <= duration`，source range 仍必须覆盖整片。

- [ ] **Step 6: Make timeline and AI context generic projections**

`timelineItems()` 继续只调用 registration `toTimeline()`。`aiContext()` 逐 edit 通过 registration 映射 capability，并输出实际 `payload` 的安全副本与 range；字幕摘要必须查找 `subtitle.track@1`，不得再读取 `active[0]`。

- [ ] **Step 7: Run focused and regression tests**

Run: `node --test tests/project-editing.test.js tests/render-graph.test.js tests/edit-capabilities.test.js`

Expected: PASS；旧字幕项目仍可加载，颜色多区间可追加，组合失败零写入。

- [ ] **Step 8: Commit Task 2**

```bash
git add src/project-editing.js src/render-graph.js tests/project-editing.test.js tests/render-graph.test.js
git commit -m "feat: apply multi-step edit recipes atomically"
```

---

### Task 3: Compile controlled color export steps and render them with FFmpeg

**Files:**
- Modify: `src/render-recipe.js`
- Modify: `src/video-export.js`
- Test: `tests/render-recipe.test.js`
- Test: `tests/video-export.test.js`

**Interfaces:**
- Consumes: Task 1 `video.color.adjust@1` export step and normalized color semantics.
- Produces: validated render Recipe containing one or more color steps and at most one subtitle step.
- Produces: internal `buildVideoFilters(recipe, taskDir)`; this is not exposed to AI or renderer IPC.

- [ ] **Step 1: Write failing render-recipe tests**

Verify color-only and color-plus-subtitle graph snapshots produce defensive, frozen recipes in graph order. Reject unknown capabilities, unknown step keys, invalid ranges, non-finite/out-of-range parameters, duplicate subtitles and executable fields.

```js
assert.deepEqual(recipe.steps[0], {
  capability: 'video.color.adjust@1',
  range: { start: 1, end: 3 },
  params: { temperature: -0.8, brightness: 0.25, saturation: 1, contrast: 1 }
});
```

- [ ] **Step 2: Write failing export-service tests**

Inspect the exact spawn argument array and prove:

- color-only does not create `captions.ass`;
- color + subtitle creates one ASS and puts `ass=captions.ass` last;
- each color node generates two whitelisted filters with the same range;
- no recipe value can become an executable path, command or arbitrary filter name;
- existing cancel, progress, source protection, output validation and cleanup behavior remains intact.

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `node --test tests/render-recipe.test.js tests/video-export.test.js`

Expected: FAIL because the current validator and exporter require exactly one subtitle step.

- [ ] **Step 4: Generalize strict render-recipe validation**

Replace the subtitle-only freezer with recursive data freezing. Dispatch validation only across the two hard-coded executable step versions registered for this cycle:

```js
if (step.capability === 'video.color.adjust@1') return validateColorStep(step);
if (step.capability === 'subtitle.burn@1') return validateSubtitleStep(step);
throw codedError('EXPORT_UNSUPPORTED_OPERATION');
```

这份白名单位于真实导出边界，不接受 AI 提供 filter 字符串。允许多个颜色步骤；字幕最多一个且必须处于视频效果之后。

- [ ] **Step 5: Build the fixed FFmpeg color chain**

每个颜色步骤生成：

```text
colorchannelmixer=rr=1+0.2*T:gg=1:bb=1-0.2*T:enable='gte(t,start)*lt(t,end)'
eq=brightness=0.25*B:saturation=S:contrast=C:enable='gte(t,start)*lt(t,end)'
```

实际字符串使用已验证的有限数值序列化，不拼入任何用户字符串。正 temperature 为暖、负值为冷。颜色 filter 按 graph 顺序执行；若有字幕，`ass=captions.ass` 永远最后。继续使用 `spawn(command, args, { shell:false })`。

- [ ] **Step 6: Make media checks step-aware**

字幕时间与颜色 range 都必须在 ffprobe 得到的源时长内。仅有字幕步骤时保持原行为；仅有颜色步骤时也可导出；无步骤仍返回 `EXPORT_INVALID_RECIPE`。

- [ ] **Step 7: Run focused tests and confirm GREEN**

Run: `node --test tests/render-recipe.test.js tests/video-export.test.js`

Expected: PASS；断言的 `-vf` 参数只含受控颜色 filter 和可选字幕 filter。

- [ ] **Step 8: Commit Task 3**

```bash
git add src/render-recipe.js src/video-export.js tests/render-recipe.test.js tests/video-export.test.js
git commit -m "feat: export ranged color adjustments"
```

---

### Task 4: Project the same color graph into preview, timeline and transaction UI

**Files:**
- Create: `app/editor-color-preview.js`
- Modify: `app/剪辑.html`
- Modify: `app/editor-timeline.js`
- Modify: `app/editor-subtitles.js`
- Modify: `app/editor-export.js`
- Test: `tests/e2e/project-editing-flow.spec.js`
- Test: `tests/e2e/video-export-flow.spec.js`

**Interfaces:**
- Consumes: `projectEditing.load(projectId).graph`, registration `preview(graph, time)`, and generic transaction result.
- Produces: `window.colorPreviewController.render()` that never stores an independent effect list.
- Changes: timeline marker width comes from `item.range`; chat card and undo operate on transaction, not subtitle ID.

- [ ] **Step 1: Write failing renderer E2E tests**

Use deterministic translated Recipes to verify:

1. A 1–3 second color request renders one marker whose `left` and `width` reflect the range.
2. At 0.5s the video has no color filter; at 2s the SVG filter carries the normalized cold/bright/high-contrast values; at 3s it is inactive.
3. Reload restores the same marker and preview behavior from `EditDocument`.
4. Undo removes the whole color transaction.
5. One subtitle + color request shows one successful request card, two timeline projections, and one transaction-level undo control.

- [ ] **Step 2: Run the renderer tests and confirm RED**

Run: `npx playwright test tests/e2e/project-editing-flow.spec.js tests/e2e/video-export-flow.spec.js`

Expected: FAIL because preview and UI still assume one subtitle step and timeline markers have no interval width.

- [ ] **Step 3: Add graph-derived SVG color preview**

Add one hidden SVG filter attached only to `#previewVideo`, with primitives driven from registration preview output:

```html
<filter id="previewColorFilter" color-interpolation-filters="sRGB">
  <feColorMatrix data-color-temperature type="matrix" />
  <feColorMatrix data-color-saturation type="saturate" />
  <feComponentTransfer data-color-tone>
    <feFuncR type="linear"/><feFuncG type="linear"/><feFuncB type="linear"/>
  </feComponentTransfer>
</filter>
```

温度矩阵使用与导出一致的 RGB 对角增益 `R=1+0.2*T, G=1, B=1-0.2*T`；亮度与对比度通过 `slope=C`、`intercept=0.25*B + 0.5*(1-C)` 表达，饱和度直接用 `S`。控制器监听 `timeupdate`、`seeked`、`loadedmetadata` 和 `project-edit-state-changed`，每次都重新读取当前 graph；区间外设置 `video.style.filter=''`。

- [ ] **Step 4: Make timeline and request status transaction-generic**

Marker 使用 `left=start/duration` 与 `width=(end-start)/duration`。`translateAndApply()` 不再读取 `turn.steps[0]` 判定成功类型；应用完成后按同一 transaction 的 timeline items 生成摘要。按钮文案改为“撤销本次编辑”，并仍以 `transactionId` 调用 `ProjectEditing.undo()`。

字幕生成状态仍可在包含字幕的事务中显示“生成字幕”，但判断必须使用 `steps.some(...)`，不能影响颜色步骤执行或隐藏第二个 timeline item。

- [ ] **Step 5: Remove subtitle-index assumptions**

`editor-subtitles.js` 的撤销后恢复必须通过 `type === 'subtitle.track@1'` 查找字幕 edit；没有字幕时隐藏字幕文档，但不得报错。导出继续读取当前 graph，不新增颜色状态副本。

- [ ] **Step 6: Run focused E2E and unit regression**

Run: `npx playwright test tests/e2e/project-editing-flow.spec.js tests/e2e/video-export-flow.spec.js`

Run: `npm test`

Expected: E2E PASS；unit PASS；时间轴、预览、项目保存和撤销指向同一 revision。

- [ ] **Step 7: Commit Task 4**

```bash
git add app/editor-color-preview.js app/剪辑.html app/editor-timeline.js app/editor-subtitles.js app/editor-export.js tests/e2e/project-editing-flow.spec.js tests/e2e/video-export-flow.spec.js
git commit -m "feat: preview and present color edit transactions"
```

---

### Task 5: Prove four real color parameters, range isolation and subtitle composition

**Files:**
- Create: `tests/color-video-export.test.js`
- Create: `tests/e2e/color-edit-flow.spec.js`
- Modify: `tests/e2e/electron-main.js`
- Modify: `package.json`
- Modify: `docs/DEVELOPMENT_LOG.md`

**Interfaces:**
- Consumes: completed Cycle 2 chain only.
- Produces: automated evidence for each declared parameter, before/in/after range behavior, combined subtitle + color transaction and whole undo.

- [ ] **Step 1: Add a real FFmpeg fixture and frame probes**

Generate a short constant-color MP4 with audio using the resolved test FFmpeg; export four separate Recipes, each changing exactly one non-neutral parameter. Extract RGB/statistics at times before, inside and after `[1,3)` and assert:

- temperature `-1` makes inside-frame blue/red ratio increase;
- brightness `0.5` increases inside-frame luma;
- saturation `1.8` increases inside-frame chroma distance;
- contrast `1.6` increases inside-frame luma spread;
- before and after frames stay within the codec tolerance of the source;
- output duration, dimensions and audio remain present.

- [ ] **Step 2: Add the deterministic full UI flow**

The E2E scenario must return a two-step Recipe (`video.color.adjust@1` + `subtitle.generate@1`), then verify one revision increment, two edits with one transaction ID, interval preview, reload persistence, export Recipe order, and one undo restoring the exact pre-request document.

- [ ] **Step 3: Run the complete Cycle 2 verification**

Run: `npm test`

Run: `npx playwright test tests/e2e/project-editing-flow.spec.js tests/e2e/video-export-flow.spec.js tests/e2e/color-edit-flow.spec.js`

Run: `npm run test:e2e`

Run: `SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe node --test tests/color-video-export.test.js`

Expected: all tests PASS with zero skipped Cycle 2 cases. Record exact counts in the development log.

- [ ] **Step 4: Perform one real local CLI smoke test**

With a real project video loaded, submit a natural-language request equivalent to “5 到 10 秒明显调冷、提亮并增强对比度”; verify one color timeline item, preview only inside the range, reload persistence, undo, and successful video export. If the fixture video is shorter than 10 seconds, use a valid interval inside its duration rather than changing product logic.

- [ ] **Step 5: Update the development log with the required report**

Append one Cycle 2 entry containing:

- internal completion: modules/interfaces/adapters changed;
- user-visible result: what can now be requested, previewed and exported;
- automated verification: exact pass/fail/skip counts;
- manual verification: path and result;
- unfinished items: only Cycle 3+ or explicitly deferred work.

- [ ] **Step 6: Commit Task 5 and stop the cycle**

```bash
git add tests/color-video-export.test.js tests/e2e/color-edit-flow.spec.js tests/e2e/electron-main.js package.json docs/DEVELOPMENT_LOG.md
git commit -m "test: verify complete ranged color editing flow"
```

Do not begin transforms, cards, keyframes, grain, vignette or personal skills in this cycle.

---

## Self-review

- Spec coverage: the five tasks cover all four declared parameters, valid ranges, one user-readable edit, persistence, preview, export, atomic subtitle composition and whole-request undo.
- Scope check: no Task adds future effects, arbitrary commands, a generic DAG, a property editor, new dependencies or platform infrastructure.
- Type consistency: `video.color.adjust@1` is the AI and Export capability, `video.color.adjustment@1` is the EditDocument type, and `video.color@1` is the RenderGraph node in every task.
- Source-of-truth check: only `EditDocument` is persisted; preview, timeline, export and AI context are projections.
- Exit check: Task 5 ends Cycle 2 immediately after the agreed acceptance evidence exists.
