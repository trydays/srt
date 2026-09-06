# 字幕文稿编辑器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成左侧自然语言字幕任务的低负担闭环：字幕生成成功后，用户在同一个文稿区集中校对全部字幕，用“保存”保留未应用草稿、用“应用”同步当前字幕轨与预览；成功任务自动折叠，发送下一条指令前安全保存未保存草稿。

**Architecture:** 沿用现有 renderer 内的项目级 `localStorage` 字幕状态和 `window.subtitleController`。状态层只增加“已应用字幕 / 文字草稿”双状态；编辑器层把当前项目的唯一字幕文稿节点移动到最新成功字幕卡下方；对话层只负责成功卡折叠和发送前协调。Agent、Whisper、FFmpeg、IPC、视频导出和组件系统保持不变。

**Tech Stack:** Electron 33 renderer、经典 JavaScript、HTML/CSS、浏览器 `localStorage`、Node.js 内置测试运行器、Playwright Electron；不增加 npm 或 Python 依赖。

## Global Constraints

- 实施基线：开始编码前记录 `git rev-parse HEAD`；预期同时包含范围收紧提交 `c544c70` 和本计划提交。
- 本阶段完成等级固定为“项目够用”：核心流程可操作、项目草稿不丢失、常规回归通过；不追求跨项目复用或极端故障恢复。
- 目标用时 180 分钟，硬上限 240 分钟。剩余时间不是必须消耗的额度。
- 支撑性工作目标 40 分钟、硬上限 60 分钟，只包括既有测试维护、旧状态兼容和测试运行故障排查；字幕草稿、保存、应用本身属于核心功能，不计为支撑。不得新建通用状态机、存储框架或测试夹具。
- 达到 120 分钟时，真实编辑器必须已经可见：固定字幕文稿、“保存 / 应用”可操作、成功任务可折叠。任一项不可见就停止并报告。
- E2E 逻辑主流程最多 3 条；本计划通过扩写既有用例，预计净新增仅 1 条 `test()`。
- 只改下列 7 个现有文件：
  - `app/subtitle-state.js`
  - `tests/subtitle-state.test.js`
  - `app/剪辑.html`
  - `app/editor-subtitles.js`
  - `app/editor-timeline.js`
  - `tests/e2e/auto-subtitles-flow.spec.js`
  - `tests/e2e/local-cli-effect-flow.spec.js`
- 不改 `app/shared.js`、`app/editor-core.js`、`main.js`、`preload.js`、`src/subtitles.js`、`tests/e2e/electron-main.js` 或 `tests/e2e/electron.fixture.js`。
- 不改产品颜色，不做字幕样式、时间调整、分段合并拆分、搜索替换、AI 校对、翻译、多轨、导出、关窗拦截或通用撤销。
- 用户可见按钮文案保持“保存”和“应用”；用附近状态文字解释语义，不擅自改为新文案。
- 成功卡的手动展开状态只保留当前页面会话，不增加持久化字段。
- 新需求只有满足“三问闸门”之一才进入：不做无法通过既定验收；不做会导致现实安全、法律或数据损失；用户了解成本后明确批准。否则写入“以后再做”。
- 任一任务超过目标预算两倍，或支撑性工作达到 60 分钟，立即停止并同时报告内部完成度与用户可见成果。
- 无论单项预算如何，总耗时达到 240 分钟都立即停止并报告，不允许用任务拆分绕过总硬上限。

## Stage Exit Conditions

以下条件全部通过后立即结束，不继续因为“还可以更完善”而延长：

1. 字幕成功卡自动折叠；失败卡保持展开且旧字幕不被覆盖。
2. 同一个左侧文稿区一次显示全部字幕段落，旧的时间轴单句输入框消失。
3. “保存”只持久化草稿，刷新可恢复，时间轴和预览仍使用已应用字幕。
4. “应用”可直接应用当前候选文字，随后时间轴、预览和项目存储一致。
5. 发送下一条指令时，未保存文字先成为未应用草稿再收起；保存失败则不发送、不收起、不丢文字。
6. 重新生成与一层撤销能够一起保护生成前的已应用字幕和已保存草稿；若撤销会丢弃当前版本的修改，先明确确认。
7. 全部单元测试与常规 E2E 通过；不重复运行真实 Whisper 长视频验收。

## Progress and Budget

| 任务 | 目标预算 | 用户可见成果 |
|---|---:|---|
| Task 1：字幕草稿状态 | 30 分钟 | 暂无；提供后续真实按钮语义 |
| Task 2：统一字幕文稿 | 65 分钟 | 全量字幕、保存、应用在真实编辑器可见 |
| Task 3：折叠与发送协调 | 45 分钟 | 成功卡折叠；新指令前自动保存 |
| Task 4：回归与手动验收 | 40 分钟 | 可打开并按验收清单检查的最终版本 |

Task 1 + Task 2 目标累计 95 分钟。Task 3 必须先完成成功卡折叠，再继续自动保存协调；累计达到 120 分钟时执行半程检查。合计目标 180 分钟，距离 240 分钟硬上限保留 60 分钟止损缓冲，验收提前通过时不得消耗缓冲做额外完善。

### Support Budget

| 支撑项 | 目标 | 硬上限 |
|---|---:|---:|
| 修改既有测试断言（不含业务实现） | 20 分钟 | 30 分钟 |
| 旧字幕状态的最小兼容 | 10 分钟 | 15 分钟 |
| 测试命令与环境故障排查 | 10 分钟 | 15 分钟 |
| **合计** | **40 分钟** | **60 分钟** |

Task 4 的 40 分钟同时包含用户可见的手动验收；其中只有测试维护与运行故障排查计入上表。不得把核心编辑器实现重新归类为支撑工作，也不得反向把支撑工作藏入核心任务。

## File Map

### Production

- `app/subtitle-state.js`：保存已应用字幕、文字草稿和现有一层生成撤销。
- `app/editor-subtitles.js`：渲染紧凑字幕轨、画面字幕和唯一字幕文稿；实现保存、应用、折叠和发送前准备。
- `app/editor-timeline.js`：渲染两行任务状态及折叠摘要；在字幕生成成功后打开文稿；发送前调用字幕控制器。
- `app/剪辑.html`：增加唯一文稿节点和样式，删除时间轴下方旧单句编辑入口。

### Tests

- `tests/subtitle-state.test.js`：双状态、整份提交和一层撤销单元测试。
- `tests/e2e/auto-subtitles-flow.spec.js`：流程 A（字幕文稿主流程）和流程 B（新指令与保存失败）。
- `tests/e2e/local-cli-effect-flow.spec.js`：流程 C（非字幕成功卡折叠与展开）。

本阶段只允许以下 3 个 E2E test body 承载新验收断言：

1. **流程 A：字幕文稿主流程**——扩写并重命名既有 `generates, edits, persists and undoes the one subtitle track`。
2. **流程 B：新指令与保存失败**——净新增 1 个 `test()`。
3. **流程 C：非字幕卡折叠**——扩写既有 `keeps one message and one card, then adds one fade-in marker`。

其他既有 E2E 保持原断言，仅作为原有回归运行；不得向第四个 test body 增加本阶段的新验收。

---

### Task 1: Add the Minimal Applied/Draft Subtitle State

**Files:**

- Modify: `app/subtitle-state.js`
- Modify: `tests/subtitle-state.test.js`

**Contract:**

- `segments` 是时间轴和预览唯一读取的已应用字幕。
- `draft` 为 `null` 或“当前段落 ID → 草稿文字”的对象，不复制时间码。
- `saveDraft(projectId, textById)` 整体校验并只写草稿。
- `applyTexts(projectId, textById)` 整体校验后一次写入 `segments` 并清空草稿。
- `replace()` / `undo()` 的现有一层快照同时包含草稿；不建立文字编辑历史。

- [ ] **Step 1: Record the implementation baseline and start time**

Run:

    git rev-parse --short HEAD
    git status --short

Expected: HEAD includes `c544c70`; only the pre-existing untracked `.superpowers/brainstorm/` and `docs/research/` may appear. Record the clock start in the task commentary; do not create a timing subsystem.

- [ ] **Step 2: Replace the single-text state tests with whole-document tests**

Keep the existing one-level undo test. Replace the project isolation test so it covers both applied subtitles and drafts:

    test('keeps applied subtitles and drafts isolated by project', () => {
      const store = fixture();
      const projectA = store.replace('project-a', 'request-a', [
        { start: 0, end: 1, text: 'A' }
      ]);
      const draftA = {};
      draftA[projectA.segments[0].id] = 'A 草稿';
      store.saveDraft('project-a', draftA);

      assert.equal(store.get('project-a').segments[0].text, 'A');
      assert.deepEqual(store.get('project-a').draft, draftA);
      assert.deepEqual(store.get('project-b'), {
        segments: [],
        draft: null,
        undo: null
      });
    });

Replace the `updateText`-based cases and add these exact contracts:

    test('saves a full draft without changing applied subtitles', () => {
      const store = fixture();
      const generated = store.replace('project-a', 'request-a', [
        { start: 0, end: 1, text: '已应用一' },
        { start: 1, end: 2, text: '已应用二' }
      ]);
      const textById = {};
      textById[generated.segments[0].id] = '草稿一';
      textById[generated.segments[1].id] = '草稿二';
      const saved = store.saveDraft('project-a', textById);

      assert.deepEqual(saved.draft, textById);
      assert.deepEqual(saved.segments.map((item) => item.text), ['已应用一', '已应用二']);
    });

    test('applies the whole candidate and clears the draft', () => {
      const store = fixture();
      const generated = store.replace('project-a', 'request-a', [
        { start: 0, end: 1, text: '原文一' },
        { start: 1, end: 2, text: '原文二' }
      ]);
      const textById = {};
      textById[generated.segments[0].id] = '应用一';
      textById[generated.segments[1].id] = '应用二';
      store.saveDraft('project-a', textById);
      const applied = store.applyTexts('project-a', textById);

      assert.deepEqual(applied.segments.map((item) => item.text), ['应用一', '应用二']);
      assert.equal(applied.draft, null);
    });

    test('rejects invalid whole candidates without a partial write', () => {
      const store = fixture();
      const generated = store.replace('project-a', 'request-a', [
        { start: 0, end: 1, text: '保留一' },
        { start: 1, end: 2, text: '保留二' }
      ]);
      const textById = {};
      textById[generated.segments[0].id] = '会被拒绝';
      textById[generated.segments[1].id] = '   ';

      assert.throws(
        () => store.applyTexts('project-a', textById),
        { code: 'SUBTITLE_TEXT_REQUIRED' }
      );
      assert.deepEqual(
        store.get('project-a').segments.map((item) => item.text),
        ['保留一', '保留二']
      );

      assert.throws(
        () => store.saveDraft('project-a', { 'obsolete-segment': '旧文稿' }),
        { code: 'SUBTITLE_DOCUMENT_STALE' }
      );
      assert.deepEqual(
        store.get('project-a').segments.map((item) => item.text),
        ['保留一', '保留二']
      );
    });

    test('regeneration and undo restore both applied subtitles and saved draft', () => {
      const store = fixture();
      const first = store.replace('project-a', 'request-a', [
        { start: 0, end: 1, text: '旧已应用' }
      ]);
      const oldDraft = {};
      oldDraft[first.segments[0].id] = '旧草稿';
      store.saveDraft('project-a', oldDraft);

      store.replace('project-a', 'request-b', [
        { start: 0, end: 1, text: '重新生成' }
      ]);
      const restored = store.undo('project-a', 'request-b');

      assert.equal(restored.segments[0].text, '旧已应用');
      assert.deepEqual(restored.draft, oldDraft);
    });

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

    node --test tests/subtitle-state.test.js

Expected: new tests FAIL because `saveDraft`, `applyTexts` and `draft` do not exist. Existing isolation and undo behavior still passes.

- [ ] **Step 4: Implement only the minimal state transition**

In `app/subtitle-state.js`, normalize old project data by adding `draft: null` without migrating storage or introducing versions:

    function emptyState() {
      return { segments: [], draft: null, undo: null };
    }

    function normalizeState(state) {
      if (!state || !Array.isArray(state.segments)) return emptyState();
      return {
        segments: state.segments,
        draft: state.draft && typeof state.draft === 'object'
          && !Array.isArray(state.draft) ? state.draft : null,
        undo: state.undo || null
      };
    }

    function get(projectId) {
      return clone(normalizeState(readAll()[projectId]));
    }

Add one whole-document validator and the two methods:

    function candidateTextById(segments, textById) {
      var candidate = {};
      var source = textById && typeof textById === 'object' ? textById : {};
      var keys = Object.keys(source);
      if (keys.length !== segments.length) {
        throw codedError('SUBTITLE_DOCUMENT_STALE');
      }
      for (var i = 0; i < segments.length; i++) {
        var id = segments[i].id;
        if (!Object.prototype.hasOwnProperty.call(source, id)) {
          throw codedError('SUBTITLE_DOCUMENT_STALE');
        }
        var value = String(source[id] || '').trim();
        if (!value) throw codedError('SUBTITLE_TEXT_REQUIRED');
        candidate[id] = value;
      }
      return candidate;
    }

    function saveDraft(projectId, textById) {
      var state = get(projectId);
      var candidate = candidateTextById(state.segments, textById);
      var differs = state.segments.some(function(segment) {
        return candidate[segment.id] !== segment.text;
      });
      state.draft = differs ? candidate : null;
      return write(projectId, state);
    }

    function applyTexts(projectId, textById) {
      var state = get(projectId);
      var candidate = candidateTextById(state.segments, textById);
      state.segments = state.segments.map(function(segment) {
        return Object.assign({}, segment, { text: candidate[segment.id] });
      });
      state.draft = null;
      return write(projectId, state);
    }

Change only the existing one-level snapshot:

    function replace(projectId, requestId, rawSegments) {
      var current = get(projectId);
      var nextSegments = rawSegments.map(function(segment) {
        return { id: idFactory(), start: segment.start, end: segment.end, text: segment.text };
      });
      return write(projectId, {
        segments: nextSegments,
        draft: null,
        undo: {
          requestId: requestId,
          segments: current.segments,
          draft: current.draft
        }
      });
    }

    function undo(projectId, requestId) {
      var state = get(projectId);
      if (!state.undo || state.undo.requestId !== requestId) {
        throw codedError('SUBTITLE_UNDO_UNAVAILABLE');
      }
      return write(projectId, {
        segments: state.undo.segments,
        draft: state.undo.draft || null,
        undo: null
      });
    }

Keep the existing `updateText` method temporarily so the Task 1 commit does not break the still-visible old editor. Before writing its updated `segments`, set `state.draft = null` so it cannot leave a stale draft beside changed applied text. Removing the now-unused compatibility method after Task 2 would be cleanup outside this stage. Return:

    return {
      get: get,
      replace: replace,
      updateText: updateText,
      saveDraft: saveDraft,
      applyTexts: applyTexts,
      canUndo: canUndo,
      undo: undo
    };

- [ ] **Step 5: Run focused and full unit tests**

Run:

    node --test tests/subtitle-state.test.js
    npm run test:unit

Expected: all subtitle-state tests PASS; the complete unit suite remains PASS.

- [ ] **Step 6: Commit Task 1 only**

Run:

    git add app/subtitle-state.js tests/subtitle-state.test.js
    git commit -m "feat: add subtitle draft state"

Do not stage the pre-existing untracked directories.

---

### Task 2: Replace the Single-Line Editor with One Subtitle Document

**Files:**

- Modify: `app/剪辑.html`
- Modify: `app/editor-subtitles.js`
- Modify: `tests/e2e/auto-subtitles-flow.spec.js`

**User-visible checkpoint:** This task must end with a real editor view containing all fixed subtitle segments plus working “保存 / 应用” buttons. No task-card work is required yet.

- [ ] **Step 1: Expand Flow A in the existing subtitle conversation E2E**

Leave `shows fixed segments in one track and the preview` unchanged as an old regression. Rename the existing `generates, edits, persists and undoes the one subtitle track` test to:

    test('edits, saves, applies and undoes the full subtitle document', async ({ window }, testInfo) => {

Keep its existing generated two-segment fixture. For Task 2 only, call `subtitleController.openAfter(null)` after generation so the document behavior can be tested before Task 3 wires automatic placement; Task 3 removes this direct test call and proves automatic opening. Use these stable test IDs:

    subtitle-document-editor
    subtitle-document-toggle
    subtitle-document-segment
    subtitle-document-save
    subtitle-document-apply
    subtitle-document-status

In Task 2, the same Flow A test must prove:

1. `subtitle-document-segment` count is 2 and the old `subtitle-text-input` / `subtitle-text-save` count is 0.
2. Editing the first segment and pressing `Tab` focuses the second; `Shift+Tab` returns to the first.
3. Dispatching a cancelable `Enter` keydown with `isComposing: true` is not prevented, so Chinese IME can confirm a candidate.
4. After editing a segment, dispatching `loadedmetadata` on the video does not replace its current DOM text.
5. Clicking “保存” produces “草稿已保存 · 尚未应用”; after reload, the draft text is restored while `preview-subtitle` still shows the old applied text.
6. Clicking “应用” updates the first timeline block and `preview-subtitle`, clears the draft marker and shows “所有修改已应用”.
7. Editing another segment and clicking “应用” directly also succeeds without first clicking “保存”.

Keep its existing regenerate/undo assertions for now; Task 3 adds dirty-draft confirmation before undo. Do not add another happy-path `test()` and do not add new assertions to the separate subtitle-surface test body.

- [ ] **Step 2: Run the focused E2E and verify RED**

Run:

    npx playwright test tests/e2e/auto-subtitles-flow.spec.js --grep "full subtitle document"

Expected: FAIL because the document test IDs and dual button behavior do not exist.

- [ ] **Step 3: Replace the old editor DOM with one movable document node**

Inside `#chatArea`, immediately after `#chatEmpty`, add:

    <section class="subtitle-document" id="subtitleDocument"
      data-testid="subtitle-document-editor" data-collapsed="true" hidden>
      <div class="subtitle-document-head">
        <button class="subtitle-document-toggle" id="subtitleDocumentToggle"
          data-testid="subtitle-document-toggle" type="button"
          aria-expanded="false" aria-controls="subtitleDocumentBody">
          <span id="subtitleDocumentTitle">编辑字幕 · 0 段</span>
          <span class="subtitle-document-badge" id="subtitleDocumentBadge"></span>
        </button>
        <div class="subtitle-document-actions">
          <button id="subtitleDocumentSave" data-testid="subtitle-document-save"
            type="button">保存</button>
          <button id="subtitleDocumentApply" data-testid="subtitle-document-apply"
            type="button">应用</button>
        </div>
      </div>
      <div class="subtitle-document-body" id="subtitleDocumentBody">
        <div class="subtitle-document-status" id="subtitleDocumentStatus"
          data-testid="subtitle-document-status"></div>
        <div class="subtitle-document-surface" id="subtitleDocumentSurface"
          aria-label="全部字幕文稿"></div>
      </div>
    </section>

Delete only the old `#subtitleEditor` label, `#subtitleTextInput` and `#subtitleTextSave` from `.subtitle-section`. Keep `#subtitleTrack` unchanged.

- [ ] **Step 4: Replace the old single-line CSS without changing tokens or colors**

Delete the `.subtitle-editor` rules. Add rules using only existing CSS variables:

    .subtitle-document{border:1px solid var(--border);border-radius:var(--radius-md);
      background:var(--bg-panel);box-shadow:var(--shadow-xs);overflow:hidden;
      flex:0 0 auto;container-type:inline-size}
    .subtitle-document[hidden]{display:none}
    .subtitle-document-head{display:grid;grid-template-columns:minmax(0,1fr) auto;
      align-items:center;gap:8px;padding:8px 9px;border-bottom:1px solid var(--border-soft)}
    .subtitle-document[data-collapsed="true"] .subtitle-document-head{border-bottom:0}
    .subtitle-document-toggle{min-width:0;border:0;background:transparent;color:var(--text-strong);
      font:inherit;font-size:11.5px;font-weight:650;text-align:left;cursor:pointer}
    .subtitle-document-badge{display:block;margin-top:2px;color:var(--text-muted);
      font-size:10px;font-weight:400}
    .subtitle-document-actions{display:flex;align-items:center;gap:6px}
    .subtitle-document-actions button{height:28px;padding:0 10px;border:1px solid var(--border);
      border-radius:var(--radius-pill);background:var(--bg-panel);color:var(--text);
      font:inherit;font-size:11px;cursor:pointer}
    .subtitle-document-actions button:disabled{opacity:.45;cursor:default}
    .subtitle-document[data-collapsed="true"] .subtitle-document-body,
    .subtitle-document[data-collapsed="true"] .subtitle-document-actions{display:none}
    .subtitle-document-body{padding:8px}
    .subtitle-document-status{min-height:18px;color:var(--text-muted);font-size:10.5px}
    .subtitle-document-status[data-state="error"]{color:var(--red)}
    .subtitle-document-surface{max-height:min(44vh,380px);overflow:auto;padding:2px 4px}
    .subtitle-document-row{display:grid;grid-template-columns:42px minmax(0,1fr);
      gap:7px;align-items:start;padding:6px 0;border-top:1px solid var(--border-soft)}
    .subtitle-document-row:first-child{border-top:0}
    .subtitle-document-time{padding-top:2px;color:var(--text-faint);font:10px var(--mono)}
    .subtitle-document-text{min-width:0;outline:none;color:var(--text);
      font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
    .subtitle-document-text:focus{background:var(--bg-subtle)}
    .subtitle-document-text.is-invalid{color:var(--red)}
    @container (max-width:260px){
      .subtitle-document-head{grid-template-columns:1fr}
      .subtitle-document-actions{justify-content:flex-end}
      .subtitle-document-row{grid-template-columns:1fr;gap:2px}
    }

Do not introduce new hex/RGB colors and do not change the existing sidebar width.

- [ ] **Step 5: Rewrite `editor-subtitles.js` around one controller**

Remove `selectedSubtitleId`, `renderSubtitleEditor()`, `saveSelectedSubtitle()` and the old input handlers. Keep the track and preview rendering logic.

Read the one static document node explicitly; do not rely on element IDs becoming global variables:

    var subtitleDocument = document.getElementById('subtitleDocument');
    var subtitleDocumentToggle = document.getElementById('subtitleDocumentToggle');
    var subtitleDocumentTitle = document.getElementById('subtitleDocumentTitle');
    var subtitleDocumentBadge = document.getElementById('subtitleDocumentBadge');
    var subtitleDocumentStatus = document.getElementById('subtitleDocumentStatus');
    var subtitleDocumentSurface = document.getElementById('subtitleDocumentSurface');
    var subtitleDocumentSave = document.getElementById('subtitleDocumentSave');
    var subtitleDocumentApply = document.getElementById('subtitleDocumentApply');
    var documentDirty = false;

Define the functions referenced by the Task 2 controller before its independent commit:

    function formatSubtitleTime(seconds) {
      return formatDur(Number(seconds) || 0);
    }

    function refreshAppliedSubtitleSurfaces() {
      renderSubtitleTrack();
      renderCurrentSubtitle();
    }

    function renderAllSubtitles() {
      refreshAppliedSubtitleSurfaces();
      renderSubtitleDocument();
    }

    function replaceSubtitles(requestId, segments) {
      var state = subtitleStore.replace(getActiveProjectId(), requestId, segments);
      renderAllSubtitles();
      return state;
    }

    function undoSubtitles(requestId) {
      var state = subtitleStore.undo(getActiveProjectId(), requestId);
      renderAllSubtitles();
      return state;
    }

Use these controller methods:

    window.subtitleController = {
      replace: replaceSubtitles,
      undo: undoSubtitles,
      canUndo: function(requestId) {
        return subtitleStore.canUndo(getActiveProjectId(), requestId);
      },
      count: function() {
        return currentSubtitleState().segments.length;
      },
      render: renderAllSubtitles,
      openAfter: openDocumentAfter,
      restoreAfter: restoreDocumentAfter,
      collapse: function() {
        setDocumentCollapsed(true);
      }
    };

Render each subtitle as an unbordered editable row, always keyed by the existing segment ID:

    function renderSubtitleDocument() {
      var state = currentSubtitleState();
      subtitleDocumentSurface.innerHTML = '';
      subtitleDocumentTitle.textContent = '编辑字幕 · ' + state.segments.length + ' 段';
      subtitleDocument.hidden = state.segments.length === 0;
      var source = state.draft || {};

      state.segments.forEach(function(segment) {
        var row = document.createElement('div');
        row.className = 'subtitle-document-row';
        var time = document.createElement('time');
        time.className = 'subtitle-document-time';
        time.textContent = formatSubtitleTime(segment.start);
        var text = document.createElement('div');
        text.className = 'subtitle-document-text';
        text.contentEditable = 'true';
        text.tabIndex = 0;
        text.dataset.testid = 'subtitle-document-segment';
        text.dataset.segmentId = segment.id;
        text.textContent = Object.prototype.hasOwnProperty.call(source, segment.id)
          ? source[segment.id] : segment.text;
        row.appendChild(time);
        row.appendChild(text);
        subtitleDocumentSurface.appendChild(row);
      });

      documentDirty = false;
      renderDocumentState(state);
    }

`formatSubtitleTime(seconds)` returns existing `MM:SS` style text. `renderDocumentState(state)` must set exactly:

- dirty: “有未保存更改”; both buttons enabled.
- saved draft: “草稿已保存 · 尚未应用”; Save disabled, Apply enabled; badge “草稿未应用”.
- no draft: “所有修改已应用”; both disabled; empty badge.

Use one explicit state renderer:

    function renderDocumentState(state) {
      var hasDraft = !!state.draft;
      subtitleDocumentStatus.dataset.state = '';
      if (documentDirty) {
        subtitleDocumentStatus.textContent = '有未保存更改';
        subtitleDocumentBadge.textContent = '有未保存更改';
        subtitleDocumentSave.disabled = false;
        subtitleDocumentApply.disabled = false;
        return;
      }
      if (hasDraft) {
        subtitleDocumentStatus.textContent = '草稿已保存 · 尚未应用';
        subtitleDocumentBadge.textContent = '草稿未应用';
        subtitleDocumentSave.disabled = true;
        subtitleDocumentApply.disabled = false;
        return;
      }
      subtitleDocumentStatus.textContent = '所有修改已应用';
      subtitleDocumentBadge.textContent = '';
      subtitleDocumentSave.disabled = true;
      subtitleDocumentApply.disabled = true;
    }

Collect the full candidate from the current DOM:

    function collectDocumentText() {
      var textById = {};
      var nodes = subtitleDocumentSurface.querySelectorAll('[data-segment-id]');
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].classList.remove('is-invalid');
        textById[nodes[i].dataset.segmentId] = nodes[i].textContent;
      }
      return textById;
    }

Button behavior:

    function saveDocumentDraft() {
      var state = subtitleStore.saveDraft(
        getActiveProjectId(),
        collectDocumentText()
      );
      renderSubtitleDocument();
      return state;
    }

    function applyDocumentTexts() {
      var state = subtitleStore.applyTexts(
        getActiveProjectId(),
        collectDocumentText()
      );
      renderAllSubtitles();
      return state;
    }

Wire the real buttons and the title toggle:

    subtitleDocumentSave.addEventListener('click', function() {
      try {
        saveDocumentDraft();
      } catch (error) {
        showDocumentError(error, 'save');
      }
    });

    subtitleDocumentApply.addEventListener('click', function() {
      try {
        applyDocumentTexts();
      } catch (error) {
        showDocumentError(error, 'apply');
      }
    });

    subtitleDocumentToggle.addEventListener('click', function() {
      setDocumentCollapsed(
        subtitleDocument.dataset.collapsed !== 'true'
      );
    });

Keep collapse state in the DOM only:

    function setDocumentCollapsed(collapsed) {
      subtitleDocument.dataset.collapsed = collapsed ? 'true' : 'false';
      subtitleDocumentToggle.setAttribute(
        'aria-expanded',
        collapsed ? 'false' : 'true'
      );
    }

    function openDocumentAfter(card) {
      if (card) card.after(subtitleDocument);
      renderSubtitleDocument();
      setDocumentCollapsed(false);
    }

    function restoreDocumentAfter(card) {
      if (card) card.after(subtitleDocument);
      renderSubtitleDocument();
      setDocumentCollapsed(true);
    }

On `SUBTITLE_TEXT_REQUIRED`, mark every blank document segment with `is-invalid` and show “字幕文字不能为空”. For other storage errors show “字幕草稿保存失败，请重试” on save or “字幕暂时无法应用，请重试” on apply. Do not create a new chat message.

Implement that as one local helper:

    function showDocumentError(error, action) {
      var nodes = subtitleDocumentSurface.querySelectorAll('[data-segment-id]');
      if (error && error.code === 'SUBTITLE_TEXT_REQUIRED') {
        for (var i = 0; i < nodes.length; i++) {
          if (!nodes[i].textContent.trim()) nodes[i].classList.add('is-invalid');
        }
        subtitleDocumentStatus.textContent = '字幕文字不能为空';
      } else if (error && error.code === 'SUBTITLE_DOCUMENT_STALE') {
        subtitleDocumentStatus.textContent =
          '字幕已经变化，请重新载入当前字幕后再编辑';
      } else {
        subtitleDocumentStatus.textContent = action === 'save'
          ? '字幕草稿保存失败，请重试'
          : '字幕暂时无法应用，请重试';
      }
      subtitleDocumentStatus.dataset.state = 'error';
    }

- [ ] **Step 6: Add only the required editing guards**

Use one delegated handler on `#subtitleDocumentSurface`:

    subtitleDocumentSurface.addEventListener('input', function() {
      documentDirty = true;
      renderDocumentState(currentSubtitleState());
    });

    subtitleDocumentSurface.addEventListener('keydown', function(event) {
      var segment = event.target.closest('[data-segment-id]');
      if (!segment) return;
      if (event.isComposing) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        return;
      }
      if (event.key !== 'Tab') return;
      event.preventDefault();
      var segments = Array.from(
        subtitleDocumentSurface.querySelectorAll('[data-segment-id]')
      );
      var current = segments.indexOf(segment);
      var next = Math.max(0, Math.min(
        segments.length - 1,
        current + (event.shiftKey ? -1 : 1)
      ));
      segments[next].focus();
    });

    subtitleDocumentSurface.addEventListener('paste', function(event) {
      var segment = event.target.closest('[data-segment-id]');
      if (!segment) return;
      event.preventDefault();
      var text = event.clipboardData.getData('text/plain')
        .replace(/\s*\r?\n+\s*/g, ' ');
      document.execCommand('insertText', false, text);
    });

Do not implement split, merge, retiming, rich text, search or virtual scrolling.

- [ ] **Step 7: Freeze the render boundary so media events cannot erase typing**

Keep `videoEl` `timeupdate` bound only to `renderCurrentSubtitle`. Change `loadedmetadata` to refresh only the applied track and preview:

    videoEl.addEventListener('timeupdate', renderCurrentSubtitle);
    videoEl.addEventListener('loadedmetadata', refreshAppliedSubtitleSurfaces);

Only these explicit transitions may call `renderSubtitleDocument()` or `renderAllSubtitles()`: initial controller render, Save success, Apply success, generation replacement, undo success, `openAfter` and `restoreAfter`. Track clicks, `timeupdate`, `loadedmetadata`, resize and sidebar tab changes must not rebuild the document DOM.

- [ ] **Step 8: Keep timeline blocks as navigation only**

The `#subtitleTrack` click handler must only seek and update the preview. It must not open a second text input:

    subtitleTrack.addEventListener('click', function(event) {
      var block = event.target.closest('[data-segment-id]');
      if (!block) return;
      var segment = currentSubtitleState().segments.find(function(item) {
        return item.id === block.dataset.segmentId;
      });
      if (!segment) return;
      try { videoEl.currentTime = segment.start; } catch (_) {}
      subtitlePreview.hidden = false;
      subtitlePreview.textContent = segment.text;
    });

- [ ] **Step 9: Run the document happy path and inspect the real editor**

Run:

    npx playwright test tests/e2e/auto-subtitles-flow.spec.js --grep "full subtitle document"

Expected: PASS.

Then start the existing app and use fixed/previously generated subtitles to inspect the real editor. Confirm one continuous document, unchanged colors, no bottom single-line editor, and working Save/Apply. Do not download a model or run long transcription.

- [ ] **Step 10: Commit Task 2 only**

Run:

    git add app/剪辑.html app/editor-subtitles.js tests/e2e/auto-subtitles-flow.spec.js
    git commit -m "feat: add unified subtitle document editor"

---

### Task 3: Collapse Successful Tasks and Save Before the Next Request

**Files:**

- Modify: `app/editor-timeline.js`
- Modify: `app/剪辑.html`
- Modify: `app/editor-subtitles.js`
- Modify: `tests/e2e/auto-subtitles-flow.spec.js`
- Modify: `tests/e2e/local-cli-effect-flow.spec.js`

- [ ] **Step 1: Extend existing card tests before implementation**

Only the three named test bodies in File Map may receive new acceptance assertions:

1. **Flow A:** Remove Task 2's direct `subtitleController.openAfter(null)` test call. Assert the successful subtitle card has `data-collapsed="true"` and the document automatically appears immediately after that card. Before the existing final undo, edit a document segment; stub `window.confirm` to return false and verify undo is blocked with text preserved, then return true and verify the existing one-level restore succeeds.
2. **Flow C:** Extend only the existing successful local CLI effect test to assert the card has `data-collapsed="true"`, click `data-testid="request-status-toggle"`, and confirm both existing status rows become visible.
3. Keep the existing no-speech test body unchanged: its existing visible error-text and old-track assertions already fail if a failure card is incorrectly collapsed or subtitles are replaced. Keep the invalid-output and other failure tests unchanged.

Add only one new `test()` named:

    test('saves dirty subtitle text before sending and blocks the send when that save fails', async ({ window }, testInfo) => {

In that single test:

- Generate subtitles.
- Edit one document segment without clicking Save.
- Enter a fade-in instruction and click Send.
- Assert the document collapses, its title shows “草稿未应用”, a second request card appears, and the preview still shows the old applied subtitle.
- Reopen the document, edit again, then monkey-patch `Storage.prototype.setItem` only for `SRTSubtitleState.STORAGE_KEY`.
- Enter another instruction and click Send.
- Assert the request-card count does not increase, the editor stays expanded, current text remains, and “字幕草稿保存失败，请重试” is visible.

This keeps the feature at exactly three E2E test bodies carrying new assertions and one net-new test.

- [ ] **Step 2: Run the two focused specs and verify RED**

Run:

    npx playwright test tests/e2e/auto-subtitles-flow.spec.js tests/e2e/local-cli-effect-flow.spec.js

Expected: new collapse and send-before-save assertions FAIL.

- [ ] **Step 3: Add a one-line successful summary and a details wrapper**

In `app/editor-timeline.js` keep `requestStatusMeta` and existing row test IDs. Add:

    function isSuccessfulRequest(record) {
      return isFinalRequest(record)
        && record.instructionStatus === 'success'
        && record.timelineStatus !== 'failed';
    }

    function collapsedRequestTitle(record) {
      var time = formatRequestTime(record.submittedAt);
      if (record.subtitleRequest === true) {
        return '✓ 字幕已生成 · ' + Number(record.resultCount || 0)
          + ' 条 · ' + time;
      }
      return '✓ 这次编辑已完成 · ' + time;
    }

Rewrite `renderRequestStatusCard(card, record)` so:

- A successful final card defaults to `card.dataset.collapsed = 'true'` unless `card.dataset.userExpanded === 'true'`.
- A processing or failed card always uses `data-collapsed="false"`.
- The header is a button with `data-testid="request-status-toggle"` only for successful final cards.
- The two current rows, result, error and undo button are wrapped in `.request-status-details`.
- Existing test IDs (`instruction-status`, `subtitle-status`, `timeline-status`, `subtitle-undo`) do not change.

Add:

    .request-status-card[data-collapsed="true"] .request-status-details{display:none}
    .request-status-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;
      gap:8px;padding:0;border:0;background:transparent;color:var(--text-strong);
      font:inherit;font-size:11.5px;font-weight:650;text-align:left;cursor:pointer}

Use existing colors only.

- [ ] **Step 4: Extend the existing chat click delegation**

Before undo handling, support the summary toggle:

    chatArea.addEventListener('click', function(event) {
      var toggle = event.target.closest('[data-testid="request-status-toggle"]');
      if (toggle) {
        var statusCard = toggle.closest('[data-request-id]');
        var shouldExpand = statusCard.dataset.collapsed === 'true';
        statusCard.dataset.userExpanded = shouldExpand ? 'true' : 'false';
        var record = conversationRecords.find(function(item) {
          return item.id === statusCard.dataset.requestId;
        });
        if (record) renderRequestStatusCard(statusCard, record);
        return;
      }

      var button = event.target.closest('[data-undo-request]');
      if (!button) return;
      var requestId = button.dataset.undoRequest;
      if (!subtitleController.confirmUndo()) return;
      try {
        subtitleController.undo(requestId);
        for (var i = 0; i < conversationRecords.length; i++) {
          var card = chatArea.querySelector(
            '[data-request-id="' + conversationRecords[i].id + '"]'
          );
          if (card) renderRequestStatusCard(card, conversationRecords[i]);
        }
      } catch (_) {}
    });

Do not persist `userExpanded`.

In `editor-subtitles.js` add the smallest data-loss guard:

    function confirmUndo() {
      if (!documentDirty && !currentSubtitleState().draft) return true;
      return window.confirm(
        '撤销本次字幕会丢弃当前字幕草稿，是否继续？'
      );
    }

Add `confirmUndo: confirmUndo` to `window.subtitleController`. Do not build a custom modal, redo stack or extra history.

- [ ] **Step 5: Open the document only after a successful subtitle replacement**

In `runSubtitleInstruction()` keep the current order that prevents subtitle replacement when final conversation persistence fails. Immediately after the successful `subtitleController.replace(...)` call, add:

    subtitleController.openAfter(card);

`openAfter(card)` moves the one existing document node with `card.after(subtitleDocument)`, renders the current state and calls `setDocumentCollapsed(false)`.

After `hydrateConversationHistory()`, locate the newest persisted successful subtitle card and call:

    subtitleController.restoreAfter(latestSubtitleCard);

`restoreAfter(card)` moves the same node after that card and starts collapsed. If a draft exists, its title badge must say “草稿未应用”. Do not create a document copy per history record.

- [ ] **Step 6: Put the save gate before clearing or appending the next request**

In `editor-subtitles.js` implement:

    function prepareForNextRequest() {
      try {
        if (documentDirty) saveDocumentDraft();
        setDocumentCollapsed(true);
        return true;
      } catch (error) {
        showDocumentError(error, 'save');
        setDocumentCollapsed(false);
        return false;
      }
    }

Add `prepareForNextRequest: prepareForNextRequest` to the existing `window.subtitleController` in this task; it was intentionally absent from the independently runnable Task 2 controller.

In the `generateBtn` click handler, call it before the current `editorEl.textContent = ''` and before appending any message/card:

    var text = editorEl.textContent.trim();
    if (!text || generateBtn.disabled) return;
    if (window.subtitleController
        && !subtitleController.prepareForNextRequest()) return;
    editorEl.textContent = '';
    setSubmitState();

This applies to both natural-language and direct-command routes because both are new user instructions. A failed draft save leaves the input text intact and creates no new history item.

- [ ] **Step 7: Perform the 120-minute stop-loss check**

If elapsed implementation time is 120 minutes or more, stop and visibly verify all three:

1. Fixed subtitle data appears in the real unified editor.
2. “保存” and “应用” produce different visible results.
3. A successful task is one-line collapsed and can be expanded.

If any item fails, report and do not continue into more tests or refactoring. If all pass, continue only with the already frozen behavior.

- [ ] **Step 8: Run the two focused E2E specs**

Run:

    npx playwright test tests/e2e/auto-subtitles-flow.spec.js tests/e2e/local-cli-effect-flow.spec.js

Expected: all tests in both files PASS. Confirm only one new `test()` was added.

- [ ] **Step 9: Commit Task 3 only**

Run:

    git add app/editor-timeline.js app/剪辑.html app/editor-subtitles.js tests/e2e/auto-subtitles-flow.spec.js tests/e2e/local-cli-effect-flow.spec.js
    git commit -m "feat: collapse completed edit tasks"

---

### Task 4: Verify the Frozen User Flow and Stop

**Files:**

- Modify only if a frozen acceptance condition fails.
- Do not update the development log or push remotely unless the user separately requests it after acceptance.

- [ ] **Step 1: Run focused state and UI verification**

Run:

    node --test tests/subtitle-state.test.js
    npx playwright test tests/e2e/auto-subtitles-flow.spec.js tests/e2e/local-cli-effect-flow.spec.js

Expected: PASS.

- [ ] **Step 2: Run all normal automated checks**

Run:

    npm run test:unit
    npm run test:e2e

Expected: all unit and all regular E2E tests PASS.

Do not run `npm run test:e2e:real-mac`. This change does not touch transcription, the model, FFmpeg or IPC, and the previous real runtime acceptance remains the evidence for that chain.

- [ ] **Step 3: Perform one manual visible acceptance**

Open the real editor with existing generated subtitles or fixed local subtitle state and verify:

- During a subtitle request, one card shows the two existing progress rows.
- On success, the card folds to one line and the document opens below it.
- All subtitle text is visible in one scrollable surface.
- Save survives reload without changing the preview.
- Apply changes the preview and timeline.
- Sending another instruction folds the editor; a forced save failure blocks the send.
- Video metadata refresh does not erase in-progress typing, and Chinese IME Enter is not intercepted while composing.
- Undo with current dirty text or a saved current-version draft asks for confirmation; cancel keeps the text.
- Failure cards remain expanded.
- Product colors are unchanged and no bottom single-line subtitle editor remains.

Do not use this pass to refine spacing, add animations or revisit unrelated timeline density.

- [ ] **Step 4: Report both completion dimensions**

The completion message must separately state:

- **用户可见成果：** which of the seven exit conditions can be opened and manually verified.
- **内部完成度：** focused/full test results, files changed, E2E net-new count, support-time use and total elapsed time.

- [ ] **Step 5: Check the final diff and stop**

Run:

    git status --short
    git diff --check c544c70...HEAD
    git diff --name-only c544c70...HEAD
    rg -c "^\s*test\(" tests/e2e/auto-subtitles-flow.spec.js tests/e2e/local-cli-effect-flow.spec.js
    git diff --unified=0 c544c70...HEAD -- tests/e2e/auto-subtitles-flow.spec.js tests/e2e/local-cli-effect-flow.spec.js
    git log --oneline -4

Expected:

- No unstaged implementation changes; only pre-existing untracked directories may remain.
- The name-only range contains exactly the 7 frozen implementation/test files plus these 2 approved planning documents:
  - `docs/superpowers/specs/2026-09-06-subtitle-document-editor-design.md`
  - `docs/superpowers/plans/2026-09-06-subtitle-document-editor.md`
- Test counts are `auto-subtitles-flow.spec.js: 6` and `local-cli-effect-flow.spec.js: 2`, exactly one more than the 7-test baseline.
- The E2E diff adds new acceptance assertions only inside Flow A, Flow B and Flow C.

Once exit conditions pass, stop. Do not add optional resilience, abstraction, new UI variants, development-log changes or a remote push without a new explicit request.
