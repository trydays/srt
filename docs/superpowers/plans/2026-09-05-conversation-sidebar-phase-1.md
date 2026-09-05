# 编辑器对话侧栏阶段一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 不扩大本地 CLI 指令能力，先交付可见的吸附侧栏和自然语言编辑闭环，再补最小项目历史与全局位置偏好。

**Architecture:** 所有产品改动留在 renderer，复用现有 HTML、CSS、原生 JavaScript、localStorage 和已经验证的 translateLocalCliEffect / applyLocalCliEffect。只持久化成功、失败或未执行等最终记录；处理中状态不跨刷新保存。不新增数据库、main、preload、CLI、测试延迟管线或通用状态框架。

**Tech Stack:** Electron 33、HTML/CSS、原生 JavaScript、localStorage、IndexedDB（保持现状）、Playwright Electron。

## Global Constraints

- 只实施冻结规格的阶段一；完整工作台首页属于阶段二。
- 总实施硬上限 6 小时；1.5 小时内必须出现可操作侧栏。
- 3 小时内必须跑通“自然语言 → 单卡状态 → 淡入时间轴标记”。
- 支撑工作硬上限 1.5 小时；达到上限立即停止新增测试或支撑代码。
- 默认左侧，可切右侧；侧栏不覆盖视频。宽度默认约 320 px，只在编辑器内拖动并记忆。
- 头像只在上传首页；弹层只包含侧栏左 / 右位置。
- “对话 / 组件”均保留，组件搜索和拖入不得退化。
- 每次自然语言请求只产生一条用户消息和一张两阶段状态卡。
- 只保存最终记录；不建设 incomplete、中断恢复、续跑或自动重试。
- 只保留 fade_in；不增加指令，不修改 main / preload 安全边界。
- 视频元数据与 IndexedDB current_video 继续全局存储，不做媒体迁移。
- 不修改 tests/e2e/electron.fixture.js 或 tests/e2e/electron-main.js。
- 不增加精确像素 E2E、测试专用延迟或极端 DOM 故障回滚。
- 不迁移、复活或清理旧云端、Ollama 与直接命令分支。
- 不提交 .superpowers/brainstorm/。

## Budget Ledger

| 工作块 | 累计上限 | 支撑累计上限 | 用户可见检查点 |
|---|---:|---:|---|
| Task 1 | 1.25 h | 0.20 h | 默认左侧侧栏、两个页签 |
| Task 2 | 2.50 h | 0.40 h | 淡入单卡成功/失败闭环 |
| Task 3 | 4.00 h | 0.65 h | 已完成历史按项目保存 |
| Task 4 | 5.25 h | 1.00 h | 左右偏好、拖宽记忆、完整验收 |
| 验收阻塞缓冲 | 6.00 h | 1.50 h | 只修既定验收 |

每个任务结束记录实际总投入、支撑投入、内部完成度与用户可见成果。缓冲不得用于新边界、恢复能力或阶段二。

## File Map

**产品文件**

- Modify: app/剪辑.html — 统一侧栏、页签和状态卡。
- Modify: app/editor-core.js — 页签、左右布局、拖宽与宽度记忆。
- Modify: app/editor-timeline.js — 单卡状态、淡入应用与最终历史。
- Modify: app/shared.js — 项目身份、当前项目、项目历史与侧栏偏好。
- Modify: app/主页.html — 新项目身份、最近项目激活与头像偏好。

**最小支撑文件**

- Create: tests/e2e/conversation-sidebar-flow.spec.js — 侧栏/组件、项目历史、位置偏好三个组合场景。
- Modify: tests/e2e/local-cli-effect-flow.spec.js — 单卡成功与转换失败。
- Modify: package.json — 把两组关键用例纳入默认 E2E。

---

### Task 1: 先交付可见的默认左侧侧栏

**时间盒:** 1.25 小时；测试与手检最多 0.20 小时。1.5 小时仍看不到侧栏则停止报告。

**Files:**

- Modify: app/剪辑.html
- Modify: app/editor-core.js
- Modify: app/editor-timeline.js
- Create: tests/e2e/conversation-sidebar-flow.spec.js

**Produces:**

- editor-sidebar、sidebar-tab-conversation、sidebar-tab-components
- conversation-panel、components-panel
- setSidebarTab(name)

- [ ] **Step 1: 写一条组合烟测**

创建 tests/e2e/conversation-sidebar-flow.spec.js：

~~~js
const { test, expect } = require('./electron.fixture');

async function openHome(window) {
  await window.getByTestId('continue').click();
  await expect(window.getByTestId('home-page')).toBeVisible();
  await expect(window.locator('#splash')).toHaveClass(/is-done/);
}

async function uploadAndOpenEditor(window, name = 'sidebar-test.mp4') {
  await expect(window.locator('#splash')).toHaveClass(/is-done/);
  await window.getByTestId('video-input').setInputFiles({
    name,
    mimeType: 'video/mp4',
    buffer: Buffer.from('sidebar test video')
  });
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
}

test('docks conversation left and keeps one component drag path', async ({ window }) => {
  await openHome(window);
  await uploadAndOpenEditor(window);

  const sidebar = window.getByTestId('editor-sidebar');
  const workspace = window.getByTestId('editor-page');
  await expect(window.locator('#splitRoot')).toHaveAttribute('data-sidebar-side', 'left');
  await expect(window.getByTestId('conversation-panel')).toBeVisible();
  await expect(window.getByTestId('components-panel')).toBeHidden();

  const sidebarBox = await sidebar.boundingBox();
  const workspaceBox = await workspace.boundingBox();
  expect(sidebarBox.x + sidebarBox.width).toBeLessThanOrEqual(workspaceBox.x);

  await window.getByTestId('sidebar-tab-components').click();
  await window.locator('#compSearch').fill('缩放入场');
  const card = window.locator('.comp-card[data-name="缩放入场"]');
  await expect(card).toHaveCount(1);
  await card.dragTo(window.locator('#tlTrack'));
  await expect(window.locator('#tlTrack .tl-marker')).toHaveCount(1);

  await window.getByTestId('sidebar-tab-conversation').click();
  await expect(window.getByTestId('conversation-panel')).toBeVisible();
  await expect(window.locator('#tlTrack .tl-marker')).toHaveCount(1);
});
~~~

- [ ] **Step 2: 确认测试因统一侧栏不存在而失败**

Run:

~~~bash
npx playwright test tests/e2e/conversation-sidebar-flow.spec.js
~~~

Expected: FAIL；editor-sidebar 或两个页签不存在。

- [ ] **Step 3: 重排现有 DOM，不复制功能节点**

先把根节点改为 `<div class="split" id="splitRoot" data-sidebar-side="left">`。其三个直接子项固定为：

1. editorSidebar
2. splitHandle
3. workspace

使用以下侧栏骨架：

~~~html
<aside class="pane editor-sidebar" id="editorSidebar" data-testid="editor-sidebar">
  <div class="sidebar-tabs" id="sidebarTabs" role="tablist" aria-label="编辑器侧栏">
    <button class="sidebar-tab is-active" data-testid="sidebar-tab-conversation"
      data-sidebar-tab="conversation" type="button" role="tab"
      aria-selected="true" aria-controls="conversationPanel">对话</button>
    <button class="sidebar-tab" data-testid="sidebar-tab-components"
      data-sidebar-tab="components" type="button" role="tab"
      aria-selected="false" aria-controls="componentsPanel">组件</button>
  </div>
  <section class="sidebar-view conversation-panel" id="conversationPanel"
    data-testid="conversation-panel" role="tabpanel"></section>
  <section class="sidebar-view components-panel" id="componentsPanel"
    data-testid="components-panel" role="tabpanel" hidden></section>
</aside>
~~~

精确移动关系：

| 现有节点 | 新父节点 |
|---|---|
| #chatArea、.input-card | #conversationPanel |
| .comp-search、#compChips、#compBody | #componentsPanel |
| #previewArea、.timeline | .workspace > .ws-scroll |

保留所有内部 ID、搜索、分类、输入、视频和时间轴节点；移除 workspace 中旧的 chatArea 与 input-card 位置，确保没有重复 DOM。

- [ ] **Step 4: 添加不覆盖视频的网格样式**

替换旧 split、comp-panel、chat 与 input-card 的布局规则：

~~~css
:root{--editor-sidebar-w:320px}
.split{display:grid;grid-template-columns:var(--editor-sidebar-w) 8px minmax(0,1fr);grid-template-areas:"sidebar handle workspace";min-height:0;min-width:0;max-width:100%;overflow:hidden;background:var(--bg);flex:1}
.editor-sidebar{grid-area:sidebar;background:var(--bg);display:flex;flex-direction:column;min-height:0;min-width:0;border-right:1px solid var(--border)}
.split-handle{grid-area:handle}.workspace{grid-area:workspace}
.sidebar-tabs{height:44px;display:grid;grid-template-columns:1fr 1fr;flex:0 0 auto;border-bottom:1px solid var(--border);background:var(--bg-panel)}
.sidebar-tab{appearance:none;position:relative;border:0;background:transparent;color:var(--text-muted);font:inherit;font-size:12.5px;cursor:pointer}
.sidebar-tab.is-active{color:var(--text-strong);font-weight:650}
.sidebar-tab.is-active::after{content:"";position:absolute;left:28%;right:28%;bottom:-1px;height:2px;background:var(--accent)}
.sidebar-view{flex:1;min-height:0;min-width:0}.sidebar-view[hidden]{display:none}
.conversation-panel,.components-panel{display:flex;flex-direction:column;background:var(--bg)}
.chat{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:12px;padding:14px 12px}
.input-card{width:auto;max-width:none;margin:0 12px 12px;padding:10px;flex-shrink:0}
@media(max-width:560px){.ws-scroll{padding:16px 16px 0}.preview,.timeline{max-width:100%}.input-card{margin:0 10px 10px}.chat{padding:12px 10px}}
~~~

删除会在 900 px 隐藏整个侧栏的旧 media rule。

- [ ] **Step 5: 初始化页签并保留最小拖宽**

在 editor-core.js 的组件初始化内、renderComps() 之前加入：

~~~js
var splitRoot = document.getElementById('splitRoot');
var editorSidebar = document.getElementById('editorSidebar');
var handle = document.getElementById('splitHandle');
var conversationPanel = document.getElementById('conversationPanel');
var componentsPanel = document.getElementById('componentsPanel');
var sidebarTabs = document.getElementById('sidebarTabs');

function setSidebarTab(name) {
  var selected = name === 'components' ? 'components' : 'conversation';
  var buttons = sidebarTabs.querySelectorAll('[data-sidebar-tab]');
  for (var i = 0; i < buttons.length; i++) {
    var active = buttons[i].dataset.sidebarTab === selected;
    buttons[i].classList.toggle('is-active', active);
    buttons[i].setAttribute('aria-selected', active ? 'true' : 'false');
  }
  conversationPanel.hidden = selected !== 'conversation';
  componentsPanel.hidden = selected !== 'components';
}

sidebarTabs.addEventListener('click', function(event) {
  var button = event.target.closest('[data-sidebar-tab]');
  if (button) setSidebarTab(button.dataset.sidebarTab);
});
setSidebarTab('conversation');
~~~

用以下代码替换现有 Split resize 块；本任务只做左侧拖动，不持久化：

~~~js
var resizing = false, startX = 0, startW = 320;
function applySidebarWidth(width) {
  var maxWidth = Math.max(180, Math.min(500, window.innerWidth - 400));
  var safeWidth = Math.max(180, Math.min(maxWidth, Number(width) || 320));
  splitRoot.style.setProperty('--editor-sidebar-w', safeWidth + 'px');
  return safeWidth;
}
handle.addEventListener('mousedown', function(event) {
  resizing = true;
  splitRoot.classList.add('is-resizing');
  startX = event.clientX;
  startW = editorSidebar.getBoundingClientRect().width;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  event.preventDefault();
});
document.addEventListener('mousemove', function(event) {
  if (resizing) applySidebarWidth(startW + event.clientX - startX);
});
document.addEventListener('mouseup', function() {
  if (!resizing) return;
  resizing = false;
  splitRoot.classList.remove('is-resizing');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});
~~~

在 editor-timeline.js 的 ResizeObserver 回调中，在 renderMarkers() 前加入：

~~~js
_trackW = 0;
~~~

- [ ] **Step 6: 通过烟测并立即人工查看**

Run:

~~~bash
npx playwright test tests/e2e/conversation-sidebar-flow.spec.js
npm start
~~~

Expected: 默认左侧出现“对话 / 组件”；侧栏占布局空间；组件搜索和拖入仍工作。

记录累计投入、支撑投入和用户可见成果。若超过时间盒，停止，不进入 Task 2。

- [ ] **Step 7: 提交 Task 1**

~~~bash
git add app/剪辑.html app/editor-core.js app/editor-timeline.js tests/e2e/conversation-sidebar-flow.spec.js
git commit -m "feat: dock the editor sidebar"
~~~

---

### Task 2: 接通单张两阶段状态卡

**时间盒:** 1.25 小时；累计不超过 2.5 小时。不得为观察瞬态状态改测试 fixture。

**Files:**

- Modify: app/剪辑.html
- Modify: app/editor-timeline.js
- Modify: tests/e2e/local-cli-effect-flow.spec.js

- [ ] **Step 1: 把现有效果 E2E 收缩为成功与转换失败**

把 tests/e2e/local-cli-effect-flow.spec.js 的两个断言场景改为：

~~~js
test('keeps one message and one card, then adds one fade-in marker', async ({ window }) => {
  await openEditorWithCodex(window);
  await window.locator('.input-editor').fill('给片头添加一个淡入效果');
  await window.locator('#generateBtn').click();
  await expect(window.getByTestId('request-user-message')).toHaveCount(1);
  await expect(window.getByTestId('request-status-card')).toHaveCount(1);
  await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'success');
  await expect(window.getByTestId('timeline-status')).toHaveAttribute('data-state', 'success');
  await expect(window.getByTestId('timeline-effect-fade-in')).toHaveCount(1);
  await expect(window.getByTestId('effect-status')).toHaveCount(0);
});

test.describe('invalid local CLI output', () => {
  test.use({ localCliEffectResult: 'invalid' });
  test('shows failed and not run in the same card without a marker', async ({ window }) => {
    await openEditorWithCodex(window);
    await window.locator('.input-editor').fill('添加淡入');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('request-status-card')).toHaveCount(1);
    await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'failed');
    await expect(window.getByTestId('timeline-status')).toHaveAttribute('data-state', 'not_run');
    await expect(window.getByTestId('timeline-effect-fade-in')).toHaveCount(0);
  });
});
~~~

保留文件现有 openEditorWithCodex 和 localCliMode: 'two'。不增加中断、人工覆写 applyLocalCliEffect 或延迟场景。

- [ ] **Step 2: 确认测试因旧 effect-status 模型失败**

Run:

~~~bash
npx playwright test tests/e2e/local-cli-effect-flow.spec.js
~~~

Expected: FAIL；request-status-card 不存在。

- [ ] **Step 3: 删除 effectStatus，并增加已确认的紧凑样式**

从 input-card 删除 effectStatus，并把 Chat 初始化改为：

~~~js
var chatArea = document.getElementById('chatArea');
var chatEmpty = document.getElementById('chatEmpty');
var editorEl = document.querySelector('.input-editor');
~~~

加入：

~~~css
.request-user-message{align-self:flex-end;max-width:78%;padding:8px 11px;border-radius:12px 12px 3px 12px;background:var(--accent);color:white;font-size:12.5px;line-height:1.45}
.request-status-card{padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--bg-panel);box-shadow:var(--shadow-xs)}
.request-status-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px;font-size:11.5px;font-weight:650;color:var(--text-strong)}
.request-status-time{font-size:10px;font-weight:400;color:var(--text-faint)}
.request-status-row{min-height:27px;display:grid;grid-template-columns:17px minmax(0,1fr) auto;align-items:center;gap:6px;font-size:11px;color:var(--text-muted)}
.request-status-row + .request-status-row{border-top:1px solid var(--border-soft)}
.request-status-icon{width:15px;height:15px;border-radius:50%;display:grid;place-items:center;background:var(--bg-subtle);color:var(--text-muted);font-size:9px;font-weight:700}
.request-status-row[data-state="converting"] .request-status-icon,.request-status-row[data-state="applying"] .request-status-icon{border:2px solid var(--border);border-top-color:var(--accent);background:transparent}
.request-status-row[data-state="success"] .request-status-icon{background:color-mix(in srgb,var(--green) 14%,var(--bg-panel));color:var(--green)}
.request-status-row[data-state="failed"] .request-status-icon{background:color-mix(in srgb,var(--red) 12%,var(--bg-panel));color:var(--red)}
.request-status-value{font-size:10.5px;color:var(--text-muted)}
.request-status-row[data-state="success"] .request-status-value{color:var(--green)}
.request-status-row[data-state="failed"] .request-status-value{color:var(--red)}
.request-error{margin-top:6px;padding-top:7px;border-top:1px solid var(--border-soft);color:var(--red);font-size:10.5px;line-height:1.4}
~~~

- [ ] **Step 4: 用当前会话内的单卡状态替换自然语言分支**

在 editor-timeline.js 的 Chat 初始化后加入：

~~~js
var requestStatusMeta = {
  converting: { label: '转换中', icon: '·' },
  applying: { label: '应用中', icon: '·' },
  waiting: { label: '等待', icon: '·' },
  success: { label: '成功', icon: '✓' },
  failed: { label: '失败', icon: '×' },
  not_run: { label: '未执行', icon: '—' }
};
function formatRequestTime(timestamp) {
  var date = new Date(timestamp);
  return ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2);
}
function escapeConversationText(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function requestCardTitle(record) {
  if (record.instructionStatus === 'converting' || record.timelineStatus === 'applying') {
    return '正在处理这次编辑';
  }
  return record.instructionStatus === 'failed' || record.timelineStatus === 'failed'
    ? '这次编辑未完成' : '这次编辑已完成';
}
function statusRowHTML(testId, label, status) {
  var meta = requestStatusMeta[status];
  return '<div class="request-status-row" data-testid="' + testId
    + '" data-state="' + status + '"><span class="request-status-icon">'
    + meta.icon + '</span><span>' + label + '</span>'
    + '<span class="request-status-value">' + meta.label + '</span></div>';
}
function renderRequestStatusCard(card, record) {
  var error = record.error
    ? '<div class="request-error">' + escapeConversationText(record.error) + '</div>' : '';
  card.innerHTML = '<div class="request-status-head"><span>' + requestCardTitle(record)
    + '</span><span class="request-status-time">' + formatRequestTime(record.submittedAt)
    + '</span></div>' + statusRowHTML('instruction-status', '转换编辑指令', record.instructionStatus)
    + statusRowHTML('timeline-status', '应用到时间轴', record.timelineStatus) + error;
}
function appendRequestStatusCard(record) {
  if (chatEmpty) chatEmpty.style.display = 'none';
  var message = document.createElement('div');
  message.className = 'request-user-message';
  message.dataset.testid = 'request-user-message';
  message.textContent = record.text;
  chatArea.appendChild(message);
  var card = document.createElement('div');
  card.className = 'request-status-card';
  card.dataset.testid = 'request-status-card';
  card.setAttribute('aria-live', 'polite');
  renderRequestStatusCard(card, record);
  chatArea.appendChild(card);
  chatArea.scrollTop = chatArea.scrollHeight;
  return card;
}
function createConversationRequest(text) {
  return { text: text, submittedAt: Date.now(),
    instructionStatus: 'converting', timelineStatus: 'waiting' };
}
function updateRequestStatus(record, card, patch) {
  Object.assign(record, patch);
  renderRequestStatusCard(card, record);
}
~~~

替换 translateLocalCliEffect：

~~~js
function translateLocalCliEffect(text, record, card) {
  if (!window.srtAPI || typeof window.srtAPI.translateLocalCliEffect !== 'function') {
    updateRequestStatus(record, card, { instructionStatus: 'failed',
      timelineStatus: 'not_run',
      error: '未能生成编辑指令，请先选择可用的本地 CLI 或重试。' });
    return;
  }
  window.srtAPI.translateLocalCliEffect(text).then(function(instruction) {
    updateRequestStatus(record, card,
      { instructionStatus: 'success', timelineStatus: 'applying', error: '' });
    var applied = false;
    try { applied = applyLocalCliEffect(instruction); } catch (_) {}
    updateRequestStatus(record, card, applied
      ? { timelineStatus: 'success', error: '' }
      : { timelineStatus: 'failed', error: '编辑指令未能应用到时间轴。' });
  }, function() {
    updateRequestStatus(record, card, { instructionStatus: 'failed',
      timelineStatus: 'not_run',
      error: '未能生成编辑指令，请先选择可用的本地 CLI 或重试。' });
  });
}
~~~

同时把 `applyLocalCliEffect` 调整为先成功追加 DOM、再写入数组。这里只修正写入顺序，不建设回滚机制：

~~~js
function applyLocalCliEffect(instruction) {
  if (!instruction || instruction.type !== 'add_effect' || instruction.effect !== 'fade_in') return false;
  var effect = { name: '淡入', time: videoDuration ? videoEl.currentTime : 0,
    color: 'var(--accent)' };
  var marker = createMarkerDOM(effect, timelineEffects.length);
  marker.dataset.testid = 'timeline-effect-fade-in';
  track.appendChild(marker);
  timelineEffects.push(effect);
  return true;
}
~~~

替换完整的 generateBtn click handler，保证直接命令仍使用旧消息，只有自然语言请求创建单张状态卡：

~~~js
generateBtn.addEventListener('click', function() {
  var text = editorEl.textContent.trim();
  if (!text) return;
  editorEl.textContent = '';
  setSubmitState();

  if (isCommand(text)) {
    addMsg('user', text);
    executeCommand(text);
    return;
  }

  var record = createConversationRequest(text);
  var card = appendRequestStatusCard(record);
  translateLocalCliEffect(text, record, card);
});
~~~

- [ ] **Step 5: 验证 50% 可见闭环**

Run:

~~~bash
npx playwright test tests/e2e/local-cli-effect-flow.spec.js
npm start
~~~

Expected: 成功路径只有一条消息、一张卡和一个淡入 marker；转换失败为“失败 / 未执行”。真实 CLI 提交时卡片先显示“转换中 / 等待”。

累计投入不得超过 2.5 小时；3 小时仍未跑通则停止报告。

- [ ] **Step 6: 提交 Task 2**

~~~bash
git add app/剪辑.html app/editor-timeline.js tests/e2e/local-cli-effect-flow.spec.js
git commit -m "feat: show compact edit request status"
~~~

---

### Task 3: 增加最小项目身份与最终历史

**时间盒:** 1.5 小时。不得增加处理中恢复、重试、schema 框架或媒体迁移。

**Files:**

- Modify: app/shared.js
- Modify: app/主页.html
- Modify: app/editor-timeline.js
- Modify: tests/e2e/conversation-sidebar-flow.spec.js

- [ ] **Step 1: 追加一个项目历史 E2E**

追加到 conversation-sidebar-flow.spec.js：

~~~js
test.describe('project-scoped final conversation history', () => {
  test.use({ localCliMode: 'two' });
  test('separates completed history across two projects and reload', async ({ window }) => {
    await window.getByTestId('local-cli-codex').click();
    await openHome(window);
    await uploadAndOpenEditor(window, 'project-a.mp4');
    await window.locator('.input-editor').fill('项目 A 的淡入');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('timeline-status')).toHaveAttribute('data-state', 'success');
    const projectAId = await window.evaluate(() => getActiveProjectId());

    await window.locator('.wtab.is-pinned .wtab__main').click();
    await uploadAndOpenEditor(window, 'project-b.mp4');
    const projectBId = await window.evaluate(() => getActiveProjectId());
    expect(projectBId).not.toBe(projectAId);
    await expect(window.getByTestId('request-status-card')).toHaveCount(0);

    await window.locator('[data-project-id="' + projectAId + '"] .wtab__main').click();
    await expect(window.getByTestId('request-user-message')).toHaveText('项目 A 的淡入');
    await window.reload();
    await expect(window.getByTestId('request-status-card')).toHaveCount(1);
  });
});
~~~

- [ ] **Step 2: 确认测试因稳定项目身份不存在而失败**

Run:

~~~bash
npx playwright test tests/e2e/conversation-sidebar-flow.spec.js
~~~

Expected: FAIL；项目没有稳定 id、active project 或独立历史。

- [ ] **Step 3: 在 shared.js 增加最小项目与历史接口**

向 STORAGE_KEYS 增加：

~~~js
ACTIVE_PROJECT_ID: 'srt_active_project_id',
PROJECT_CONVERSATIONS: 'srt_project_conversations',
~~~

替换现有项目管理与 tab 渲染块：

~~~js
var TABS_KEY = STORAGE_KEYS.PROJECTS;
function createLocalId() { return window.crypto.randomUUID(); }
function readStoredJSON(key, fallback) {
  try {
    var value = JSON.parse(localStorage.getItem(key));
    return value === null ? fallback : value;
  } catch (error) {
    console.error('[storage] 读取失败:', key, error.message);
    return fallback;
  }
}
function getProjects() {
  var value = readStoredJSON(TABS_KEY, []);
  var projects = Array.isArray(value) ? value : [];
  var changed = false;
  for (var i = 0; i < projects.length; i++) {
    if (!projects[i].id) {
      projects[i] = Object.assign({}, projects[i], { id: createLocalId() });
      changed = true;
    }
  }
  if (changed) saveProjects(projects);
  return projects;
}
function saveProjects(projects) {
  try { localStorage.setItem(TABS_KEY, JSON.stringify(projects)); }
  catch (error) { console.error('[saveProjects] 写入失败:', error.message); }
}
function createProject(videoInfo) {
  var project = { id: createLocalId(), name: '未命名项目', path: '剪辑.html',
    time: Date.now(), video: videoInfo || null };
  var projects = getProjects();
  projects.unshift(project);
  saveProjects(projects);
  setActiveProjectId(project.id);
  return project;
}
function setActiveProjectId(projectId) {
  if (projectId) localStorage.setItem(STORAGE_KEYS.ACTIVE_PROJECT_ID, projectId);
  else localStorage.removeItem(STORAGE_KEYS.ACTIVE_PROJECT_ID);
}
function getActiveProjectId() {
  var projects = getProjects();
  var activeId = localStorage.getItem(STORAGE_KEYS.ACTIVE_PROJECT_ID);
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].id === activeId) return activeId;
  }
  if (!projects.length) return null;
  setActiveProjectId(projects[0].id);
  return projects[0].id;
}
function openProject(projectId) {
  var projects = getProjects();
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].id === projectId) {
      setActiveProjectId(projectId);
      location.href = projects[i].path;
      return;
    }
  }
}
function getConversationStore() {
  var value = readStoredJSON(STORAGE_KEYS.PROJECT_CONVERSATIONS, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function getProjectConversation(projectId) {
  if (!projectId) return [];
  var records = getConversationStore()[projectId];
  return Array.isArray(records) ? records : [];
}
function saveProjectConversation(projectId, records) {
  if (!projectId) return;
  var store = getConversationStore();
  store[projectId] = records;
  localStorage.setItem(STORAGE_KEYS.PROJECT_CONVERSATIONS, JSON.stringify(store));
}

function isHomePage() {
  return !!(window.__PAGE && window.__PAGE.id === 'home');
}
function renderTabs() {
  var bar = document.getElementById('tabsBar');
  if (!bar) return;
  var projects = getProjects();
  var activeId = getActiveProjectId();
  var onHome = isHomePage();
  var html = '<div class="wtab is-pinned' + (onHome ? ' is-active' : '')
    + '" onclick="location.href=\'主页.html\'"><button class="wtab__main" type="button">'
    + '<span class="wtab__label">三 三天remotion</span></button></div>';
  for (var i = 0; i < projects.length; i++) {
    var project = projects[i];
    var active = !onHome && project.id === activeId;
    html += '<div class="wtab' + (active ? ' is-active' : '')
      + '" data-project-id="' + project.id + '"><button class="wtab__main"'
      + ' type="button" onclick="openProject(\'' + project.id + '\')">'
      + '<span class="wtab__label">'
      + project.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      + '</span></button><button class="wtab__close" type="button"'
      + ' onclick="closeTab(event,\'' + project.id + '\')">&#10005;</button></div>';
  }
  bar.innerHTML = html;
}
function closeTab(event, projectId) {
  event.stopPropagation();
  var projects = getProjects();
  var activeId = getActiveProjectId();
  var next = projects.filter(function(project) { return project.id !== projectId; });
  saveProjects(next);
  if (activeId === projectId) setActiveProjectId(next.length ? next[0].id : null);
  if (!next.length) {
    localStorage.removeItem(STORAGE_KEYS.VIDEO);
    if (!isHomePage()) location.href = '主页.html';
    else renderTabs();
  } else if (activeId === projectId && !isHomePage()) {
    location.reload();
  } else {
    renderTabs();
  }
}
~~~

- [ ] **Step 4: 上传与最近项目入口设置 active project**

主页最近项目按钮改为：

~~~js
html += '<button class="pcard" data-project-id="' + p.id
  + '" onclick="openProject(\'' + p.id + '\')">'
  + '<div class="pcard__preview"><div class="pcard__dots">'
  + '<span class="pcard__dot"></span><span class="pcard__dot"></span>'
  + '<span class="pcard__dot"></span></div></div>'
  + '<div class="pcard__body"><div class="pcard__title">' + p.name + '</div>'
  + '<div class="pcard__desc">' + (videoName || '点击继续编辑')
  + (timeStr ? ' · ' + timeStr : '') + '</div></div></button>';
~~~

用以下代码替换 doStartEditing() 中按 剪辑.html 路径去重的块：

~~~js
var videoInfo = null;
try { videoInfo = JSON.parse(localStorage.getItem(STORAGE_KEYS.VIDEO)); }
catch (error) { console.error('[startEditing] 读取视频信息失败:', error.message); }
createProject(videoInfo);
location.href = '剪辑.html';
~~~

保留“没有视频则返回”和 current_video 的现有 IndexedDB 写入。

- [ ] **Step 5: 只在请求到达终态时保存**

在 Chat 初始化后加入：

~~~js
var activeProjectId = getActiveProjectId();
var conversationRecords = getProjectConversation(activeProjectId);
~~~

createConversationRequest 增加：

~~~js
id: createLocalId(),
~~~

updateRequestStatus 改为：

~~~js
function isFinalRequest(record) {
  if (record.instructionStatus === 'failed') return true;
  return record.instructionStatus === 'success'
    && (record.timelineStatus === 'success'
      || record.timelineStatus === 'failed'
      || record.timelineStatus === 'not_run');
}
function updateRequestStatus(record, card, patch) {
  Object.assign(record, patch);
  renderRequestStatusCard(card, record);
  if (activeProjectId && isFinalRequest(record)
      && conversationRecords.indexOf(record) === -1) {
    conversationRecords.push(record);
    saveProjectConversation(activeProjectId, conversationRecords);
  }
}
~~~

appendRequestStatusCard 给卡片写入 record.id，然后在 Enter 监听前恢复历史：

~~~js
card.dataset.requestId = record.id;

function hydrateConversationHistory() {
  for (var i = 0; i < conversationRecords.length; i++) {
    appendRequestStatusCard(conversationRecords[i]);
  }
}
hydrateConversationHistory();
~~~

不得在请求刚提交时保存；不得添加 incomplete 或恢复时状态迁移。

- [ ] **Step 6: 验证并提交 Task 3**

Run:

~~~bash
npx playwright test tests/e2e/conversation-sidebar-flow.spec.js tests/e2e/local-cli-effect-flow.spec.js
~~~

Expected: A/B 历史不串用；A 的最终记录重载后仍在；处理中刷新不属于测试。

~~~bash
git add app/shared.js app/主页.html app/editor-timeline.js tests/e2e/conversation-sidebar-flow.spec.js
git commit -m "feat: persist final project conversations"
~~~

---

### Task 4: 增加首页左右偏好与拖宽记忆

**时间盒:** 1.25 小时；累计不超过 5.25 小时。剩余时间只修验收阻塞。

**Files:**

- Modify: app/shared.js
- Modify: app/主页.html
- Modify: app/剪辑.html
- Modify: app/editor-core.js
- Modify: tests/e2e/conversation-sidebar-flow.spec.js
- Modify: package.json

- [ ] **Step 1: 追加一个偏好组合 E2E**

~~~js
test('home owns side preference and editor docks right without overlap', async ({ window }) => {
  await openHome(window);
  await expect(window.getByTestId('local-avatar')).toBeVisible();
  await window.getByTestId('local-avatar').click();
  const popover = window.getByTestId('preferences-popover');
  await expect(popover.getByTestId('sidebar-side-left')).toHaveAttribute('aria-pressed', 'true');
  await expect(popover).not.toContainText('侧栏宽度');
  await expect(popover).not.toContainText('登录');
  await expect(popover).not.toContainText('云同步');

  await popover.getByTestId('sidebar-side-right').click();
  await uploadAndOpenEditor(window, 'right-sidebar.mp4');
  await expect(window.locator('#splitRoot')).toHaveAttribute('data-sidebar-side', 'right');
  await expect(window.getByTestId('local-avatar')).toHaveCount(0);

  const sidebarBox = await window.getByTestId('editor-sidebar').boundingBox();
  const workspaceBox = await window.getByTestId('editor-page').boundingBox();
  expect(workspaceBox.x + workspaceBox.width).toBeLessThanOrEqual(sidebarBox.x);

  await window.reload();
  await expect(window.locator('#splitRoot')).toHaveAttribute('data-sidebar-side', 'right');
});
~~~

不自动断言 320 px、拖动增量或重载误差；拖宽由最终手检确认。

- [ ] **Step 2: 确认测试因头像与偏好接口不存在而失败**

Run:

~~~bash
npx playwright test tests/e2e/conversation-sidebar-flow.spec.js
~~~

Expected: FAIL；local-avatar 或 sidebar-side-right 不存在。

- [ ] **Step 3: 增加四个最小偏好函数**

向 STORAGE_KEYS 增加：

~~~js
EDITOR_SIDEBAR_SIDE: 'srt_editor_sidebar_side',
EDITOR_SIDEBAR_WIDTH: 'srt_editor_sidebar_width',
~~~

在 shared.js 加入：

~~~js
function getEditorSidebarSide() {
  return localStorage.getItem(STORAGE_KEYS.EDITOR_SIDEBAR_SIDE) === 'right' ? 'right' : 'left';
}
function saveEditorSidebarSide(side) {
  localStorage.setItem(STORAGE_KEYS.EDITOR_SIDEBAR_SIDE, side === 'right' ? 'right' : 'left');
}
function getEditorSidebarWidth() {
  var width = Number(localStorage.getItem(STORAGE_KEYS.EDITOR_SIDEBAR_WIDTH));
  if (!Number.isFinite(width) || width <= 0) width = 320;
  return Math.max(180, Math.min(500, width));
}
function saveEditorSidebarWidth(width) {
  var safeWidth = Math.max(180, Math.min(500, Number(width) || 320));
  localStorage.setItem(STORAGE_KEYS.EDITOR_SIDEBAR_WIDTH, String(safeWidth));
}
~~~

- [ ] **Step 4: 在首页增加唯一头像入口**

在 nav-r 尾部加入：

~~~html
<button class="local-avatar" id="localAvatar" data-testid="local-avatar"
  type="button" aria-label="打开本地偏好" aria-expanded="false">序</button>
~~~

在 nav 内加入：

~~~html
<div class="preferences-popover" id="preferencesPopover"
  data-testid="preferences-popover" hidden>
  <div class="preferences-user"><strong>本地用户</strong><span>偏好保存在本机</span></div>
  <div class="preferences-label">偏好设置</div>
  <div class="preferences-row">
    <span>编辑器侧栏位置</span>
    <span class="sidebar-side-options">
      <button class="sidebar-side-option" id="sidebarSideLeft"
        data-testid="sidebar-side-left" type="button">左侧</button>
      <button class="sidebar-side-option" id="sidebarSideRight"
        data-testid="sidebar-side-right" type="button">右侧</button>
    </span>
  </div>
</div>
~~~

加入以下样式；不得增加宽度行、账号动作或编辑器头像：

~~~css
.nav{position:relative}
.local-avatar{appearance:none;width:34px;height:34px;border:1px solid var(--border);border-radius:50%;background:var(--accent-tint);color:var(--accent);font:inherit;font-size:12px;font-weight:700;cursor:pointer}
.preferences-popover{position:absolute;z-index:80;top:48px;right:12px;width:236px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--bg-panel);box-shadow:var(--shadow-lg)}
.preferences-popover[hidden]{display:none}
.preferences-user{padding:6px 7px 10px;border-bottom:1px solid var(--border-soft)}
.preferences-user strong{display:block;font-size:12.5px;color:var(--text-strong)}
.preferences-user span{font-size:11px;color:var(--text-muted)}
.preferences-label{margin:10px 7px 7px;font-size:10.5px;font-weight:650;color:var(--text-faint)}
.preferences-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px;font-size:12px}
.sidebar-side-options{display:inline-flex;gap:3px;padding:3px;border-radius:var(--radius-md);background:var(--bg-subtle)}
.sidebar-side-option{appearance:none;border:0;border-radius:var(--radius-sm);padding:5px 9px;background:transparent;color:var(--text-muted);font:inherit;font-size:11px;cursor:pointer}
.sidebar-side-option[aria-pressed="true"]{background:var(--bg-panel);color:var(--text-strong);box-shadow:var(--shadow-xs)}
~~~

脚本使用：

~~~js
var localAvatar = document.getElementById('localAvatar');
var preferencesPopover = document.getElementById('preferencesPopover');
var sidebarSideLeft = document.getElementById('sidebarSideLeft');
var sidebarSideRight = document.getElementById('sidebarSideRight');
function renderSidebarSidePreference() {
  var side = getEditorSidebarSide();
  sidebarSideLeft.setAttribute('aria-pressed', side === 'left' ? 'true' : 'false');
  sidebarSideRight.setAttribute('aria-pressed', side === 'right' ? 'true' : 'false');
}
function setSidebarSide(side) {
  saveEditorSidebarSide(side);
  renderSidebarSidePreference();
}
localAvatar.addEventListener('click', function(event) {
  event.stopPropagation();
  var willOpen = preferencesPopover.hidden;
  preferencesPopover.hidden = !willOpen;
  localAvatar.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  if (willOpen) renderSidebarSidePreference();
});
sidebarSideLeft.addEventListener('click', function() { setSidebarSide('left'); });
sidebarSideRight.addEventListener('click', function() { setSidebarSide('right'); });
document.addEventListener('click', function(event) {
  if (preferencesPopover.hidden || preferencesPopover.contains(event.target)) return;
  preferencesPopover.hidden = true;
  localAvatar.setAttribute('aria-expanded', 'false');
});
~~~

- [ ] **Step 5: 让编辑器读取方向并在 mouseup 保存宽度**

向 剪辑.html 加入：

~~~css
.split[data-sidebar-side="right"]{grid-template-columns:minmax(0,1fr) 8px var(--editor-sidebar-w);grid-template-areas:"workspace handle sidebar"}
.split[data-sidebar-side="right"] .editor-sidebar{border-right:0;border-left:1px solid var(--border)}
~~~

editor-core.js 初始化：

~~~js
function applySidebarLayout() {
  splitRoot.dataset.sidebarSide = getEditorSidebarSide();
  applySidebarWidth(getEditorSidebarWidth());
}
applySidebarLayout();
window.addEventListener('resize', function() {
  applySidebarWidth(getEditorSidebarWidth());
});
~~~

Task 1 的三个拖动监听替换为：

~~~js
var currentW = 320;
handle.addEventListener('mousedown', function(event) {
  resizing = true;
  splitRoot.classList.add('is-resizing');
  startX = event.clientX;
  startW = editorSidebar.getBoundingClientRect().width;
  currentW = startW;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  event.preventDefault();
});
document.addEventListener('mousemove', function(event) {
  if (!resizing) return;
  var direction = splitRoot.dataset.sidebarSide === 'right' ? -1 : 1;
  currentW = applySidebarWidth(startW + direction * (event.clientX - startX));
});
document.addEventListener('mouseup', function() {
  if (!resizing) return;
  resizing = false;
  splitRoot.classList.remove('is-resizing');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  saveEditorSidebarWidth(currentW);
});
~~~

- [ ] **Step 6: 纳入默认 E2E 并运行完整验证**

package.json：

~~~json
"test:e2e": "playwright test tests/e2e/environment-flow.spec.js tests/e2e/local-cli-flow.spec.js tests/e2e/local-cli-effect-flow.spec.js tests/e2e/conversation-sidebar-flow.spec.js"
~~~

Run:

~~~bash
npm test
npm run test:e2e
~~~

Expected: 全部通过，默认清单实际运行效果与侧栏用例。不得因失败扩展为恢复或平台层。

- [ ] **Step 7: 做一次最终桌面验收**

Run:

~~~bash
npm start
~~~

只检查：

1. 首页头像只显示左右位置；没有宽度、登录、会员或云同步。
2. 默认左侧；在首页改为右侧，进入编辑器后位于右侧且编辑器没有头像。
3. 侧栏与视频并排；约 900 px 窗口下仍可访问。
4. 编辑器内拖宽可用，不要求精确像素。
5. 对话 / 组件可切换；搜索并拖入一个组件后 marker 保留。
6. 淡入请求只有一条消息和一张卡，最终两行成功并出现一个 marker。
7. 准备好右侧位置、调整后的宽度和两个项目的已完成历史后，关闭应用并重新启动一次；确认三者仍分别保持。处理中状态、视频 Blob 和 marker 不要求恢复。

七项全部通过立即结束。新问题只有阻塞这七项时才允许修复。

- [ ] **Step 8: 提交 Task 4 并结束阶段一**

~~~bash
git add app/shared.js app/主页.html app/剪辑.html app/editor-core.js tests/e2e/conversation-sidebar-flow.spec.js package.json
git commit -m "feat: remember editor sidebar preferences"
~~~

阶段报告必须列出：

- 内部完成度：四个任务、默认 E2E 与手动验收的真实结果。
- 用户可见成果：侧栏、项目历史、单卡状态、首页偏好和淡入 marker 中哪些可直接操作。
- 实际总投入和支撑投入；支撑达到 1.5 小时立即停止。

阶段二首页、处理中恢复、视频按项目存储、新指令、账号与云端能力全部留在以后再做。
