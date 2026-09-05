# 编辑器对话侧栏阶段一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 在不扩大本地 CLI 指令能力的前提下，把编辑器改成可左右吸附的“对话 / 组件”侧栏，并让每次自然语言编辑以一条可持久化的两阶段状态卡呈现。

**Architecture:** 全部产品改动留在 renderer，复用现有静态 HTML、CSS、原生 JavaScript、localStorage 和已验证的 translateLocalCliEffect / applyLocalCliEffect 路径。shared.js 只增加项目身份、当前项目、侧栏偏好和项目对话历史的最小帮助函数；主页仅增加头像偏好入口；编辑器原位重排现有组件、对话和工作区 DOM，不新增 main、preload、CLI 或通用状态框架。

**Tech Stack:** Electron 33、HTML/CSS、原生 JavaScript、localStorage、IndexedDB（保持现状，不改造）、Node.js node:test、Playwright Electron。

## Global Constraints

- 只实施冻结规格的阶段一；完整工作台首页属于阶段二，不得进入本计划。
- 阶段完成等级是“最低可用”，不是“平台级完善”。
- 总实施上限 6 小时；3 小时前必须出现可手动查看的编辑器成果。
- 支撑性工作不得超过 25%；支撑模块超过预估两倍立即停下来报告。
- 新增边界测试不得扩大验收范围；达到验收条件立即停止。
- 头像只在上传素材首页显示；偏好弹层只包含侧栏左 / 右位置，不显示宽度项、登录、会员或云同步。
- 侧栏位置与宽度是跨项目、跨应用重启保存的本机全局偏好；位置默认 left，宽度默认 320 px，宽度只在编辑器内拖动。
- 对话历史按稳定 project id 隔离；视频元数据和 IndexedDB 的 current_video 仍是全局数据，本计划不迁移媒体存储。
- 一次自然语言请求只产生一条用户消息和一张状态卡；状态卡原位更新，不生成额外处理、成功或失败通知。
- 只保留当前 fade_in 指令契约；不增加编辑操作、不修改 main / preload 安全边界。
- 不迁移、复活或清理旧云端、Ollama 与直接命令执行分支。
- 产品代码不得通过假延迟展示中间状态；测试可以延迟测试替身的 Promise。
- 不提交 .superpowers/brainstorm/ 预览文件。

## File Map

- Modify: app/shared.js — 稳定项目 ID、当前项目、侧栏偏好、项目对话存储。
- Modify: app/主页.html — 本地头像偏好入口、新项目身份和进入项目时激活 ID。
- Modify: app/剪辑.html — 统一吸附侧栏、页签、对话和状态卡结构。
- Modify: app/editor-core.js — 页签切换、左右布局、拖宽与宽度持久化。
- Modify: app/editor-timeline.js — 两阶段状态卡、历史恢复和现有淡入流程接入。
- Modify: tests/e2e/environment-flow.spec.js — 验证上传后项目 ID 和当前项目。
- Modify: tests/e2e/local-cli-effect-flow.spec.js — 改为单卡成功、转换失败和应用失败断言。
- Modify: tests/e2e/electron.fixture.js — 只增加测试替身延迟选项。
- Modify: tests/e2e/electron-main.js — 只让测试用 translateEffect 可受控延迟。
- Modify: package.json — 把效果与侧栏用例纳入默认 E2E 命令。
- Create: tests/project-state.test.js — renderer 本地状态单元测试。
- Create: tests/e2e/conversation-sidebar-flow.spec.js — 头像偏好、吸附、拖宽、页签与组件回归。

---

### Task 1: 建立最小项目身份与本地状态接口

**Files:**
- Create: tests/project-state.test.js
- Modify: app/shared.js:10-68

**Interfaces:**
- Produces: createLocalId(prefix) -> string
- Produces: getProjects() -> Project[]，惰性给旧项目补 id
- Produces: createProject(videoInfo) -> Project
- Produces: getActiveProjectId() -> string | null
- Produces: setActiveProjectId(projectId) -> void
- Produces: openProject(projectId) -> void
- Produces: getEditorSidebarSide() -> left | right
- Produces: saveEditorSidebarSide(side) -> void
- Produces: getEditorSidebarWidth() -> number，范围 180..500
- Produces: saveEditorSidebarWidth(width) -> void
- Produces: getProjectConversation(projectId) -> ConversationRequest[]
- Produces: saveProjectConversation(projectId, records) -> void

- [ ] **Step 1: 写项目身份、全局偏好和历史隔离的失败测试**

创建 tests/project-state.test.js：

~~~js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sharedSource = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'shared.js'),
  'utf8'
);

function loadShared(initial = {}) {
  const data = new Map(Object.entries(initial));
  let id = 0;
  const localStorage = {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    }
  };
  const context = {
    console,
    Date,
    Math,
    localStorage,
    document: { getElementById() { return null; } },
    location: { href: '' },
    crypto: { randomUUID() { id += 1; return 'uuid-' + id; } }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(sharedSource, context);
  return { context, data };
}

test('legacy projects receive stable unique ids exactly once', () => {
  const legacy = [
    { name: 'A', path: '剪辑.html', time: 1 },
    { name: 'B', path: '剪辑.html', time: 2 }
  ];
  const { context, data } = loadShared({
    srt_projects: JSON.stringify(legacy)
  });

  const first = context.getProjects();
  const second = context.getProjects();

  assert.equal(first[0].id, 'uuid-1');
  assert.equal(first[1].id, 'uuid-2');
  assert.notEqual(first[0].id, first[1].id);
  assert.equal(second[0].id, first[0].id);
  assert.equal(second[1].id, first[1].id);
  assert.deepEqual(
    JSON.parse(data.get('srt_projects')).map((project) => project.id),
    ['uuid-1', 'uuid-2']
  );
});

test('active project is set before navigation and falls back to the first project', () => {
  const projects = [
    { id: 'project-a', name: 'A', path: '剪辑.html', time: 1 },
    { id: 'project-b', name: 'B', path: '剪辑.html', time: 2 }
  ];
  const { context, data } = loadShared({
    srt_projects: JSON.stringify(projects)
  });

  assert.equal(context.getActiveProjectId(), 'project-a');
  context.openProject('project-b');

  assert.equal(data.get('srt_active_project_id'), 'project-b');
  assert.equal(context.location.href, '剪辑.html');
});

test('sidebar side and width are global validated preferences', () => {
  const { context, data } = loadShared();

  assert.equal(context.getEditorSidebarSide(), 'left');
  assert.equal(context.getEditorSidebarWidth(), 320);

  context.saveEditorSidebarSide('right');
  context.saveEditorSidebarWidth(440);
  assert.equal(context.getEditorSidebarSide(), 'right');
  assert.equal(context.getEditorSidebarWidth(), 440);

  context.saveEditorSidebarSide('invalid');
  context.saveEditorSidebarWidth(900);
  assert.equal(data.get('srt_editor_sidebar_side'), 'left');
  assert.equal(Number(data.get('srt_editor_sidebar_width')), 500);
});

test('conversation records stay isolated by project id', () => {
  const { context } = loadShared();
  const a = [{
    id: 'request-a',
    text: '给片头添加淡入',
    submittedAt: 1,
    instructionStatus: 'success',
    timelineStatus: 'success'
  }];
  const b = [{
    id: 'request-b',
    text: '字幕大一点',
    submittedAt: 2,
    instructionStatus: 'failed',
    timelineStatus: 'not_run'
  }];

  context.saveProjectConversation('project-a', a);
  context.saveProjectConversation('project-b', b);

  assert.equal(context.getProjectConversation('project-a')[0].text, '给片头添加淡入');
  assert.equal(context.getProjectConversation('project-b')[0].text, '字幕大一点');
  assert.equal(context.getProjectConversation('missing').length, 0);
});
~~~

- [ ] **Step 2: 运行测试并确认它因接口不存在而失败**

Run:

~~~bash
node --test tests/project-state.test.js
~~~

Expected: FAIL；首个失败明确指出 getProjects 没有补 id，或 getActiveProjectId / getEditorSidebarSide / saveProjectConversation 尚未定义。

- [ ] **Step 3: 在 shared.js 中增加四个存储键和最小帮助函数**

把 STORAGE_KEYS 扩展为：

~~~js
window.STORAGE_KEYS = {
  PROJECTS:              'srt_projects',
  VIDEO:                 'srt_video',
  RENDER_MODE:           'srt_render_mode',
  AI_CONFIG:             'srt_ai_config',
  ENV_DONE:              'srt_env_done',
  WORK_DRIVE:            'srt_work_drive',
  ACTIVE_PROJECT_ID:     'srt_active_project_id',
  EDITOR_SIDEBAR_SIDE:   'srt_editor_sidebar_side',
  EDITOR_SIDEBAR_WIDTH:  'srt_editor_sidebar_width',
  PROJECT_CONVERSATIONS: 'srt_project_conversations'
};
~~~

用以下代码替换 shared.js 的“项目管理”和“Tab bar 渲染”块；CLI 执行块保持原样：

~~~js
/* ── 项目、偏好与对话存储 ── */
var TABS_KEY = STORAGE_KEYS.PROJECTS;

function createLocalId(prefix) {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function readStoredJSON(key, fallback) {
  try {
    var value = JSON.parse(localStorage.getItem(key));
    return value === null ? fallback : value;
  } catch (e) {
    console.error('[storage] 读取失败:', key, e.message);
    return fallback;
  }
}

function getProjects() {
  var value = readStoredJSON(TABS_KEY, []);
  var projects = Array.isArray(value) ? value : [];
  var changed = false;
  for (var i = 0; i < projects.length; i++) {
    if (!projects[i].id) {
      projects[i] = Object.assign({}, projects[i], { id: createLocalId('project') });
      changed = true;
    }
  }
  if (changed) saveProjects(projects);
  return projects;
}

function saveProjects(projects) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(projects));
  } catch (e) {
    console.error('[saveProjects] 写入失败:', e.message);
  }
}

function createProject(videoInfo) {
  var project = {
    id: createLocalId('project'),
    name: '未命名项目',
    path: '剪辑.html',
    time: Date.now(),
    video: videoInfo || null
  };
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
  if (projects.length > 0) {
    setActiveProjectId(projects[0].id);
    return projects[0].id;
  }
  setActiveProjectId(null);
  return null;
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
  store[projectId] = Array.isArray(records) ? records : [];
  localStorage.setItem(STORAGE_KEYS.PROJECT_CONVERSATIONS, JSON.stringify(store));
}

/* ── Tab bar 渲染 ── */
function isHomePage() {
  return !!(window.__PAGE && window.__PAGE.id === 'home');
}

function renderTabs() {
  var bar = document.getElementById('tabsBar');
  if (!bar) return;
  var projects = getProjects();
  var activeId = getActiveProjectId();
  var onHome = isHomePage();
  var html = '';
  html += '<div class="wtab is-pinned' + (onHome ? ' is-active' : '') + '" onclick="location.href=\'主页.html\'">'
    + '<button class="wtab__main" type="button"><span class="wtab__label">三 三天remotion</span></button></div>';
  for (var i = 0; i < projects.length; i++) {
    var project = projects[i];
    var active = !onHome && project.id === activeId;
    html += '<div class="wtab' + (active ? ' is-active' : '') + '" data-project-id="' + project.id + '">'
      + '<button class="wtab__main" type="button" onclick="openProject(\'' + project.id + '\')"><span class="wtab__label">'
      + project.name.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      + '</span></button>'
      + '<button class="wtab__close" type="button" onclick="closeTab(event,\'' + project.id + '\')">&#10005;</button></div>';
  }
  bar.innerHTML = html;
}

function closeTab(event, projectId) {
  event.stopPropagation();
  var projects = getProjects();
  var next = [];
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].id !== projectId) next.push(projects[i]);
  }
  saveProjects(next);
  if (getActiveProjectId() === projectId) {
    setActiveProjectId(next.length ? next[0].id : null);
  }
  if (next.length === 0) {
    try { localStorage.removeItem(STORAGE_KEYS.VIDEO); } catch (_) {}
    if (!isHomePage()) location.href = '主页.html';
    else renderTabs();
  } else {
    renderTabs();
  }
}
~~~

- [ ] **Step 4: 运行定向测试并确认通过**

Run:

~~~bash
node --test tests/project-state.test.js
~~~

Expected: PASS，4 tests passed。

- [ ] **Step 5: 运行完整单元测试，确认没有 renderer 存储回归**

Run:

~~~bash
npm test
~~~

Expected: exit 0；全部单元测试通过。若仅 server-security 用例因受限环境绑定 127.0.0.1 报 EPERM，先在允许 loopback 的执行环境复跑，不把权限失败误判为产品失败。

- [ ] **Step 6: 提交任务一**

~~~bash
git add app/shared.js tests/project-state.test.js
git commit -m "feat: add project-scoped editor state"
~~~

---

### Task 2: 在现有首页增加唯一偏好入口并激活项目

**Files:**
- Create: tests/e2e/conversation-sidebar-flow.spec.js
- Modify: tests/e2e/environment-flow.spec.js:3-25
- Modify: app/主页.html:8-121, 177-190, 226-244

**Interfaces:**
- Consumes: createProject(videoInfo), openProject(projectId), getEditorSidebarSide(), saveEditorSidebarSide(side)
- Produces DOM: data-testid local-avatar
- Produces DOM: data-testid preferences-popover
- Produces DOM: data-testid sidebar-side-left
- Produces DOM: data-testid sidebar-side-right

- [ ] **Step 1: 写首页头像偏好的失败 E2E**

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

test('home avatar exposes only the global left or right sidebar preference', async ({ window }) => {
  await openHome(window);

  const avatar = window.getByTestId('local-avatar');
  await expect(avatar).toBeVisible();
  await avatar.click();

  const popover = window.getByTestId('preferences-popover');
  await expect(popover).toBeVisible();
  await expect(popover.getByTestId('sidebar-side-left')).toHaveAttribute('aria-pressed', 'true');
  await expect(popover).not.toContainText('侧栏宽度');
  await expect(popover).not.toContainText('登录');
  await expect(popover).not.toContainText('会员');
  await expect(popover).not.toContainText('云同步');

  await popover.getByTestId('sidebar-side-right').click();
  await window.reload();
  await expect(window.locator('#splash')).toHaveClass(/is-done/);
  await window.getByTestId('local-avatar').click();
  await expect(window.getByTestId('sidebar-side-right')).toHaveAttribute('aria-pressed', 'true');
});
~~~

- [ ] **Step 2: 在现有环境流程中增加项目身份断言，然后运行两个测试确认失败**

在 tests/e2e/environment-flow.spec.js 的首个 macOS ready journey 用例末尾追加：

~~~js
    const projectState = await window.evaluate(() => ({
      projects: getProjects(),
      activeProjectId: getActiveProjectId()
    }));
    expect(projectState.projects).toHaveLength(1);
    expect(projectState.projects[0].id).toBeTruthy();
    expect(projectState.activeProjectId).toBe(projectState.projects[0].id);
~~~

Run:

~~~bash
npx playwright test tests/e2e/conversation-sidebar-flow.spec.js tests/e2e/environment-flow.spec.js
~~~

Expected: FAIL；首页找不到 local-avatar，或上传后仍未建立 active project id。

- [ ] **Step 3: 给首页导航增加本地头像与只含位置的偏好弹层**

在 主页.html 的内联样式中追加：

~~~css
.nav{position:relative}
.local-avatar{appearance:none;width:34px;height:34px;border:1px solid var(--border);border-radius:50%;background:var(--accent-tint);color:var(--accent);font:inherit;font-size:12px;font-weight:700;cursor:pointer}
.local-avatar:hover,.local-avatar[aria-expanded="true"]{border-color:color-mix(in srgb,var(--accent) 42%,var(--border));background:color-mix(in srgb,var(--accent-tint) 68%,var(--bg-panel))}
.preferences-popover{position:absolute;z-index:80;top:48px;right:12px;width:236px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--bg-panel);box-shadow:var(--shadow-lg)}
.preferences-popover[hidden]{display:none}
.preferences-user{padding:6px 7px 10px;border-bottom:1px solid var(--border-soft)}
.preferences-user strong{display:block;font-size:12.5px;color:var(--text-strong)}
.preferences-user span{font-size:11px;color:var(--text-muted)}
.preferences-label{margin:10px 7px 7px;font-size:10.5px;font-weight:650;color:var(--text-faint)}
.preferences-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px;font-size:12px;color:var(--text)}
.sidebar-side-options{display:inline-flex;gap:3px;padding:3px;border-radius:var(--radius-md);background:var(--bg-subtle)}
.sidebar-side-option{appearance:none;border:0;border-radius:var(--radius-sm);padding:5px 9px;background:transparent;color:var(--text-muted);font:inherit;font-size:11px;cursor:pointer}
.sidebar-side-option[aria-pressed="true"]{background:var(--bg-panel);color:var(--text-strong);box-shadow:var(--shadow-xs)}
~~~

把 nav-r 改成以下内容，并把 popover 保持为 nav 的直接子元素：

~~~html
<div class="nav-r">
  <button class="btn ghost" style="padding:5px 12px;font-size:12px">文档</button>
  <a href="#" class="btn ghost" style="padding:5px 12px;font-size:12px">GitHub</a>
  <button class="local-avatar" id="localAvatar" data-testid="local-avatar" type="button" aria-label="打开本地偏好" aria-expanded="false">序</button>
</div>
<div class="preferences-popover" id="preferencesPopover" data-testid="preferences-popover" hidden>
  <div class="preferences-user">
    <strong>本地用户</strong>
    <span>偏好保存在本机</span>
  </div>
  <div class="preferences-label">偏好设置</div>
  <div class="preferences-row">
    <span>编辑器侧栏位置</span>
    <span class="sidebar-side-options">
      <button class="sidebar-side-option" id="sidebarSideLeft" data-testid="sidebar-side-left" type="button">左侧</button>
      <button class="sidebar-side-option" id="sidebarSideRight" data-testid="sidebar-side-right" type="button">右侧</button>
    </span>
  </div>
</div>
~~~

在 renderTabs() 之后初始化弹层；没有宽度行或账号动作：

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

- [ ] **Step 4: 让新素材总是建立项目，并让最近项目入口先设置 active id**

在最近项目卡片 HTML 中，把直接 location.href 改为按数组中的稳定 ID 打开：

~~~js
html += '<button class="pcard" data-project-id="' + p.id + '" onclick="openProject(\'' + p.id + '\')"><div class="pcard__preview"><div class="pcard__dots"><span class="pcard__dot"></span><span class="pcard__dot"></span><span class="pcard__dot"></span></div></div><div class="pcard__body"><div class="pcard__title">' + p.name + '</div><div class="pcard__desc">' + (videoName || '点击继续编辑') + (timeStr ? ' · ' + timeStr : '') + '</div></div></button>';
~~~

用以下代码替换 doStartEditing() 中按 剪辑.html 路径去重的部分：

~~~js
var videoInfo = null;
try {
  videoInfo = JSON.parse(localStorage.getItem(STORAGE_KEYS.VIDEO));
} catch (e) {
  console.error('[startEditing] 重复读取视频失败:', e.message);
}
createProject(videoInfo);
location.href = '剪辑.html';
~~~

保留 doStartEditing() 前面的“没有视频则提示并返回”检查，也保留 IndexedDB 的 current_video 写入方式。

- [ ] **Step 5: 运行定向 E2E 并确认通过**

Run:

~~~bash
npx playwright test tests/e2e/conversation-sidebar-flow.spec.js tests/e2e/environment-flow.spec.js
~~~

Expected: PASS；头像弹层只有左右选项，刷新后仍为右侧；上传进入编辑器后有稳定项目 ID，active id 与新项目一致。

- [ ] **Step 6: 提交任务二**

~~~bash
git add app/主页.html tests/e2e/conversation-sidebar-flow.spec.js tests/e2e/environment-flow.spec.js
git commit -m "feat: add local sidebar preference"
~~~

---

### Task 3: 把编辑器原位重排为可左右吸附的统一侧栏

**Files:**
- Modify: app/剪辑.html:9-121, 128-190
- Modify: app/editor-core.js:6-44
- Modify: app/editor-timeline.js:70-80
- Modify: tests/e2e/conversation-sidebar-flow.spec.js

**Interfaces:**
- Consumes: getEditorSidebarSide(), getEditorSidebarWidth(), saveEditorSidebarWidth(width)
- Produces DOM: data-testid editor-sidebar
- Produces DOM: data-testid sidebar-tab-conversation
- Produces DOM: data-testid sidebar-tab-components
- Produces DOM: data-testid conversation-panel
- Produces DOM: data-testid components-panel
- Produces behavior: setSidebarTab(name), applySidebarLayout()

- [ ] **Step 1: 追加布局、拖宽和组件回归的失败 E2E**

在 tests/e2e/conversation-sidebar-flow.spec.js 末尾追加：

~~~js
test('sidebar defaults left, docks right without overlap, and has no editor avatar', async ({ window }) => {
  await openHome(window);
  await window.getByTestId('local-avatar').click();
  await window.getByTestId('sidebar-side-right').click();
  await uploadAndOpenEditor(window, 'right-sidebar.mp4');

  const split = window.locator('#splitRoot');
  const sidebar = window.getByTestId('editor-sidebar');
  const workspace = window.getByTestId('editor-page');
  await expect(split).toHaveAttribute('data-sidebar-side', 'right');
  await expect(window.getByTestId('local-avatar')).toHaveCount(0);

  const sidebarBox = await sidebar.boundingBox();
  const workspaceBox = await workspace.boundingBox();
  expect(sidebarBox.x).toBeGreaterThanOrEqual(workspaceBox.x + workspaceBox.width);

  await window.reload();
  await expect(window.locator('#splitRoot')).toHaveAttribute('data-sidebar-side', 'right');
});

test('sidebar width is dragged in the editor, survives reload, and remains visible at 900px', async ({ window }) => {
  await openHome(window);
  await uploadAndOpenEditor(window, 'width-sidebar.mp4');

  const sidebar = window.getByTestId('editor-sidebar');
  const handle = window.locator('#splitHandle');
  const before = await sidebar.boundingBox();
  expect(Math.round(before.width)).toBe(320);

  const handleBox = await handle.boundingBox();
  await window.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 120);
  await window.mouse.down();
  await window.mouse.move(handleBox.x + 80, handleBox.y + 120);
  await window.mouse.up();

  const after = await sidebar.boundingBox();
  expect(after.width).toBeGreaterThan(before.width + 60);
  await window.reload();

  const reloaded = await window.getByTestId('editor-sidebar').boundingBox();
  expect(Math.abs(reloaded.width - after.width)).toBeLessThanOrEqual(2);

  await window.setViewportSize({ width: 900, height: 600 });
  await expect(window.getByTestId('editor-sidebar')).toBeVisible();
  await expect(window.getByTestId('conversation-panel')).toBeVisible();
  await expect(window.getByTestId('editor-page')).toBeVisible();
});

test('conversation is the default tab and components keep search and timeline drag', async ({ window }) => {
  await openHome(window);
  await uploadAndOpenEditor(window, 'component-regression.mp4');

  await expect(window.getByTestId('conversation-panel')).toBeVisible();
  await expect(window.getByTestId('components-panel')).toBeHidden();
  await window.getByTestId('sidebar-tab-components').click();
  await expect(window.getByTestId('components-panel')).toBeVisible();

  await window.locator('#compSearch').fill('缩放入场');
  const card = window.locator('.comp-card[data-name="缩放入场"]');
  await expect(card).toHaveCount(1);
  await card.dragTo(window.locator('#tlTrack'));
  await expect(window.locator('#tlTrack .tl-marker')).toHaveCount(1);

  const markerText = await window.locator('#tlTrack .tl-marker').textContent();
  await window.getByTestId('sidebar-tab-conversation').click();
  await expect(window.getByTestId('conversation-panel')).toBeVisible();
  await expect(window.locator('#tlTrack .tl-marker')).toHaveText(markerText);
});
~~~

- [ ] **Step 2: 运行新 E2E 并确认现有结构不满足断言**

Run:

~~~bash
npx playwright test tests/e2e/conversation-sidebar-flow.spec.js
~~~

Expected: FAIL；editor-sidebar 或页签不存在，右侧布局、320 px 持久宽度和 900 px 可见性尚未实现。

- [ ] **Step 3: 重排 剪辑.html DOM，但保留现有组件和工作区元素 ID**

将 splitRoot 的三个直接子项固定为 editorSidebar、splitHandle、workspace。editorSidebar 使用以下页签头：

~~~html
<aside class="pane editor-sidebar" id="editorSidebar" data-testid="editor-sidebar">
  <div class="sidebar-tabs" id="sidebarTabs" role="tablist" aria-label="编辑器侧栏">
    <button class="sidebar-tab is-active" id="sidebarTabConversation" data-testid="sidebar-tab-conversation" data-sidebar-tab="conversation" type="button" role="tab" aria-selected="true" aria-controls="conversationPanel">对话</button>
    <button class="sidebar-tab" id="sidebarTabComponents" data-testid="sidebar-tab-components" data-sidebar-tab="components" type="button" role="tab" aria-selected="false" aria-controls="componentsPanel">组件</button>
  </div>
  <section class="sidebar-view conversation-panel" id="conversationPanel" data-testid="conversation-panel" role="tabpanel">
    <div class="chat" id="chatArea" data-od-id="chat-history">
      <div class="chat-empty" id="chatEmpty">输入效果描述，开始对话</div>
    </div>
    <div class="input-card">
      <div class="input-editor" contenteditable="true" data-placeholder="描述要给视频加什么效果…" aria-label="效果描述输入" role="textbox" aria-multiline="true"></div>
      <div id="effectStatus" data-testid="effect-status" aria-live="polite"></div>
      <div class="input-foot">
        <div class="input-foot-r">
          <button class="input-submit" id="generateBtn">生成效果 →</button>
        </div>
      </div>
    </div>
  </section>
  <section class="sidebar-view components-panel" id="componentsPanel" data-testid="components-panel" role="tabpanel" hidden>
    <div class="comp-search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      <input type="text" id="compSearch" placeholder="搜索组件…" />
      <button class="comp-search-clear" id="compSearchClear" style="display:none" aria-label="清除搜索">×</button>
    </div>
    <div class="comp-chips" id="compChips">
      <button class="comp-chip is-active" data-cat="入场">入场<span class="comp-chip-count">4</span></button>
      <button class="comp-chip" data-cat="退场">退场<span class="comp-chip-count">3</span></button>
      <button class="comp-chip" data-cat="文字">文字<span class="comp-chip-count">4</span></button>
      <button class="comp-chip" data-cat="背景">背景<span class="comp-chip-count">4</span></button>
      <button class="comp-chip" data-cat="卡片">卡片<span class="comp-chip-count">3</span></button>
      <button class="comp-chip" data-cat="Glam">Glam<span class="comp-chip-count">6</span></button>
    </div>
    <div class="comp-body" id="compBody"></div>
  </section>
</aside>
~~~

保留现有 splitHandle 作为第二个直接子项。workspace 作为第三个直接子项，只保留 ws-scroll 内的 preview 与 timeline；把原 chatArea、input-card 和 effectStatus 一起移动到 conversationPanel，避免同一对话出现两份 DOM。effectStatus 只作为任务三的兼容过渡，任务四在新状态卡接管后删除。

- [ ] **Step 4: 用 grid areas 实现左右吸附和不覆盖布局**

在 剪辑.html 中把 :root、split、侧栏、聊天和输入相关样式调整为以下值；现有预览、时间轴、组件卡片细节样式保持不变：

~~~css
:root { --editor-sidebar-w: 320px; }
.split{display:grid;grid-template-columns:var(--editor-sidebar-w) 8px minmax(0,1fr);grid-template-areas:"sidebar handle workspace";min-height:0;min-width:0;max-width:100%;overflow:hidden;background:var(--bg);flex:1}
.split[data-sidebar-side="right"]{grid-template-columns:minmax(0,1fr) 8px var(--editor-sidebar-w);grid-template-areas:"workspace handle sidebar"}
.editor-sidebar{grid-area:sidebar;background:var(--bg);display:flex;flex-direction:column;min-height:0;min-width:0;border-right:1px solid var(--border)}
.split[data-sidebar-side="right"] .editor-sidebar{border-right:0;border-left:1px solid var(--border)}
.split-handle{grid-area:handle}
.workspace{grid-area:workspace}
.sidebar-tabs{height:44px;display:grid;grid-template-columns:1fr 1fr;flex:0 0 auto;border-bottom:1px solid var(--border);background:var(--bg-panel)}
.sidebar-tab{appearance:none;position:relative;border:0;background:transparent;color:var(--text-muted);font:inherit;font-size:12.5px;cursor:pointer}
.sidebar-tab.is-active{color:var(--text-strong);font-weight:650}
.sidebar-tab.is-active::after{content:"";position:absolute;left:28%;right:28%;bottom:-1px;height:2px;background:var(--accent)}
.sidebar-view{flex:1;min-height:0;min-width:0}
.sidebar-view[hidden]{display:none}
.conversation-panel{display:flex;flex-direction:column;background:var(--bg)}
.components-panel{display:flex;flex-direction:column;background:var(--bg)}
.chat{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:12px;padding:14px 12px;scrollbar-width:thin}
.chat-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px;padding:28px 0}
.msg-text{font-size:13px;color:var(--text);line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
.input-card{position:relative;z-index:2;width:auto;max-width:none;background:var(--bg-panel);border:1px solid var(--border);border-radius:var(--radius-lg);padding:10px;display:flex;flex-direction:column;gap:8px;margin:0 12px 12px;flex-shrink:0}
.input-editor{min-height:52px;padding:7px 4px;font-size:13px;color:var(--text-strong);outline:none;line-height:1.5;word-break:break-word}
.input-foot{display:flex;align-items:center;justify-content:flex-end;padding-top:4px}
.input-foot-r{display:flex;align-items:center;gap:8px}
@media(max-width:560px){.ws-scroll{padding:16px 16px 0}.preview{max-width:100%}.timeline{max-width:100%}.input-card{margin:0 10px 10px}.chat{padding:12px 10px}}
~~~

删除原来的以下规则，不能把统一侧栏在 Electron 的 900 px 最小宽度处隐藏：

~~~css
@media(max-width:900px){.split{grid-template-columns:0 0 minmax(0,1fr)}.comp-panel{display:none}}
~~~

- [ ] **Step 5: 在 editor-core.js 初始化页签、左右方向和持久宽度**

在组件初始化之前加入：

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

function maxVisibleSidebarWidth() {
  return Math.max(180, Math.min(500, window.innerWidth - 400));
}

function applySidebarWidth(width) {
  var safeWidth = Math.max(180, Math.min(maxVisibleSidebarWidth(), Number(width) || 320));
  splitRoot.style.setProperty('--editor-sidebar-w', safeWidth + 'px');
  return safeWidth;
}

function applySidebarLayout() {
  splitRoot.dataset.sidebarSide = getEditorSidebarSide();
  applySidebarWidth(getEditorSidebarWidth());
}

setSidebarTab('conversation');
applySidebarLayout();
window.addEventListener('resize', function() {
  applySidebarWidth(getEditorSidebarWidth());
});
~~~

用以下逻辑替换 editor-core.js 现有 Split resize 块：

~~~js
var resizing = false;
var startX = 0;
var startW = 320;
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

保留 renderComps、搜索、分类、bindDrag、视频加载、播放、音量和重新上传代码不变。

- [ ] **Step 6: 侧栏尺寸变化时让时间轴标记使用新宽度**

在 editor-timeline.js 的 ResizeObserver requestAnimationFrame 回调中，先清空缓存再重画：

~~~js
requestAnimationFrame(function() {
  _roPending = false;
  _trackW = 0;
  renderMarkers();
});
~~~

- [ ] **Step 7: 运行侧栏 E2E 和既有效果 E2E**

Run:

~~~bash
npx playwright test tests/e2e/conversation-sidebar-flow.spec.js tests/e2e/local-cli-effect-flow.spec.js
~~~

Expected: conversation-sidebar-flow 全部通过；local-cli-effect-flow 仍保持原有成功与失败结果，直到任务四替换旧 effect-status 断言。

- [ ] **Step 8: 手动打开当前桌面应用，确认第一个可见检查点**

Run:

~~~bash
npm start
~~~

Expected: 编辑器默认左侧出现“对话 / 组件”侧栏；侧栏占据布局空间而非覆盖视频；首页头像可改为右侧；拖动分隔线可改变宽度。若此时累计投入已接近 3 小时但仍无此可见成果，停止并报告，不继续任务四。

- [ ] **Step 9: 提交任务三**

~~~bash
git add app/剪辑.html app/editor-core.js app/editor-timeline.js tests/e2e/conversation-sidebar-flow.spec.js
git commit -m "feat: dock the editor conversation sidebar"
~~~

---

### Task 4: 用单张两阶段状态卡完成自然语言路径并接通项目历史

**Files:**
- Modify: app/剪辑.html:94-118, 179-188
- Modify: app/editor-timeline.js:23-54, 101-111, 220-247
- Modify: tests/e2e/electron.fixture.js:130-160
- Modify: tests/e2e/electron-main.js:46-73
- Modify: tests/e2e/local-cli-effect-flow.spec.js
- Modify: tests/e2e/conversation-sidebar-flow.spec.js
- Modify: package.json:6-14

**Interfaces:**
- Consumes: createLocalId(prefix), getActiveProjectId(), getProjectConversation(projectId), saveProjectConversation(projectId, records)
- Consumes: translateLocalCliEffect(text) Promise and applyLocalCliEffect(instruction)
- Produces: createConversationRequest(text) -> ConversationRequest
- Produces: appendRequestStatusCard(record) -> HTMLElement
- Produces: updateRequestStatus(record, card, patch) -> void
- Produces: hydrateConversationHistory() -> void
- ConversationRequest: { id, text, submittedAt, instructionStatus, timelineStatus, error? }

- [ ] **Step 1: 给 E2E 测试替身增加真实 Promise 延迟，不改产品时序**

在 tests/e2e/electron.fixture.js 的选项中加入：

~~~js
localCliEffectDelayMs: [0, { option: true }],
~~~

把 electronContext 参数和传入子进程的环境变量同步扩展：

~~~js
electronContext: async ({
  scenario,
  realEnvironment,
  localCliMode,
  localCliEffectResult,
  localCliEffectDelayMs
}, use, testInfo) => {
~~~

~~~js
SRT_E2E_EFFECT_DELAY_MS: String(localCliEffectDelayMs),
~~~

在 tests/e2e/electron-main.js 的测试 localCliService.translateEffect 开头加入：

~~~js
async translateEffect() {
  const delayMs = Number(process.env.SRT_E2E_EFFECT_DELAY_MS) || 0;
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (process.env.SRT_E2E_EFFECT_RESULT === 'invalid') {
    const error = new Error('Invalid local CLI effect output');
    error.code = 'LOCAL_CLI_INVALID_EFFECT_OUTPUT';
    throw error;
  }
  return { type: 'add_effect', effect: 'fade_in' };
}
~~~

删除该对象中原来的 translateEffect 实现，确保只保留一个定义。

- [ ] **Step 2: 用单卡状态断言替换旧 effectStatus E2E**

把 tests/e2e/local-cli-effect-flow.spec.js 改为：

~~~js
const { test, expect } = require('./electron.fixture');

async function openEditorWithCodex(window) {
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  await window.getByTestId('video-input').setInputFiles({
    name: 'local-cli-effect.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('local CLI effect test video')
  });
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
}

test.describe('local CLI effect instructions', () => {
  test.use({ localCliMode: 'two' });

  test.describe('valid output', () => {
    test.use({ localCliEffectDelayMs: 300 });

    test('updates one request card from converting to success and persists it', async ({ window }) => {
      await openEditorWithCodex(window);
      await window.locator('.input-editor').fill('给片头添加一个淡入效果');
      await window.locator('#generateBtn').click();

      await expect(window.getByTestId('request-user-message')).toHaveCount(1);
      await expect(window.getByTestId('request-status-card')).toHaveCount(1);
      await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'converting');
      await expect(window.getByTestId('instruction-status')).toContainText('转换中');
      await expect(window.getByTestId('timeline-status')).toHaveAttribute('data-state', 'waiting');
      await expect(window.getByTestId('timeline-status')).toContainText('等待');
      await expect(window.getByTestId('timeline-effect-fade-in')).toHaveCount(0);

      await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'success');
      await expect(window.getByTestId('timeline-status')).toHaveAttribute('data-state', 'success');
      await expect(window.getByTestId('request-status-card')).toHaveCount(1);
      await expect(window.getByTestId('timeline-effect-fade-in')).toHaveCount(1);

      await window.reload();
      await expect(window.getByTestId('request-user-message')).toHaveText('给片头添加一个淡入效果');
      await expect(window.getByTestId('request-status-card')).toHaveCount(1);
      await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'success');
      await expect(window.getByTestId('timeline-status')).toHaveAttribute('data-state', 'success');
    });
  });

  test.describe('invalid local CLI output', () => {
    test.use({ localCliEffectResult: 'invalid' });

    test('shows failed and not run in the same card without a marker', async ({ window }) => {
      await openEditorWithCodex(window);
      await window.locator('.input-editor').fill('添加淡入');
      await window.locator('#generateBtn').click();

      await expect(window.getByTestId('request-user-message')).toHaveCount(1);
      await expect(window.getByTestId('request-status-card')).toHaveCount(1);
      await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'failed');
      await expect(window.getByTestId('instruction-status')).toContainText('失败');
      await expect(window.getByTestId('timeline-status')).toHaveAttribute('data-state', 'not_run');
      await expect(window.getByTestId('timeline-status')).toContainText('未执行');
      await expect(window.getByTestId('timeline-effect-fade-in')).toHaveCount(0);
      await expect(window.getByTestId('effect-status')).toHaveCount(0);
    });
  });

  test.describe('interrupted request', () => {
    test.use({ localCliEffectDelayMs: 1000 });

    test('marks an interrupted conversion incomplete after reload without retrying', async ({ window }) => {
      await openEditorWithCodex(window);
      await window.locator('.input-editor').fill('给片头添加一个淡入效果');
      await window.locator('#generateBtn').click();
      await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'converting');

      await window.reload();
      await expect(window.getByTestId('request-status-card')).toHaveCount(1);
      await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'incomplete');
      await expect(window.getByTestId('timeline-status')).toHaveAttribute('data-state', 'not_run');
      await expect(window.getByTestId('timeline-effect-fade-in')).toHaveCount(0);
    });
  });

  test('shows conversion success and timeline failure in the same card', async ({ window }) => {
    await openEditorWithCodex(window);
    await window.evaluate(() => {
      window.applyLocalCliEffect = function() { return false; };
    });
    await window.locator('.input-editor').fill('添加淡入');
    await window.locator('#generateBtn').click();

    await expect(window.getByTestId('request-status-card')).toHaveCount(1);
    await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'success');
    await expect(window.getByTestId('timeline-status')).toHaveAttribute('data-state', 'failed');
    await expect(window.getByTestId('timeline-effect-fade-in')).toHaveCount(0);
  });
});
~~~

- [ ] **Step 3: 追加两个项目的历史隔离 E2E**

在 tests/e2e/conversation-sidebar-flow.spec.js 末尾追加：

~~~js
test.describe('project-scoped conversation history', () => {
  test.use({ localCliMode: 'two' });

  test('switching project tabs restores only that project conversation', async ({ window }) => {
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
    await expect(window.getByTestId('request-status-card')).toHaveCount(1);
    expect(await window.evaluate(() => getActiveProjectId())).toBe(projectAId);
  });
});
~~~

- [ ] **Step 4: 运行效果和历史 E2E，确认旧通知模型使测试失败**

Run:

~~~bash
npx playwright test tests/e2e/local-cli-effect-flow.spec.js tests/e2e/conversation-sidebar-flow.spec.js
~~~

Expected: FAIL；request-status-card、instruction-status 或 timeline-status 尚不存在，历史刷新和项目隔离尚未实现。

- [ ] **Step 5: 在 剪辑.html 增加紧凑状态卡样式并删除临时 effectStatus**

从 conversationPanel 的 input-card 删除：

~~~html
<div id="effectStatus" data-testid="effect-status" aria-live="polite"></div>
~~~

在聊天样式后加入：

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

- [ ] **Step 6: 让时间轴应用失败保持原子，不留下新 marker**

用以下实现替换 editor-timeline.js 的 applyLocalCliEffect：

~~~js
function applyLocalCliEffect(instruction) {
  if (!instruction || instruction.type !== 'add_effect' || instruction.effect !== 'fade_in') return false;
  var effect = {
    name: '淡入',
    time: videoDuration ? videoEl.currentTime : 0,
    color: 'var(--accent)'
  };
  timelineEffects.push(effect);
  try {
    var marker = addMarker(effect);
    marker.dataset.testid = 'timeline-effect-fade-in';
    return true;
  } catch (error) {
    timelineEffects.pop();
    return false;
  }
}
~~~

- [ ] **Step 7: 在 editor-timeline.js 加入项目历史和原位状态更新**

把 Chat 初始化行改为：

~~~js
var chatArea = document.getElementById('chatArea');
var chatEmpty = document.getElementById('chatEmpty');
var editorEl = document.querySelector('.input-editor');
var activeProjectId = getActiveProjectId();
var conversationRecords = getProjectConversation(activeProjectId);
~~~

保留 setSubmitState 和旧 addMsg，随后加入：

~~~js
var requestStatusMeta = {
  converting: { label: '转换中', icon: '·' },
  applying: { label: '应用中', icon: '·' },
  waiting: { label: '等待', icon: '·' },
  success: { label: '成功', icon: '✓' },
  failed: { label: '失败', icon: '×' },
  not_run: { label: '未执行', icon: '—' },
  incomplete: { label: '未完成', icon: '—' }
};

function formatRequestTime(timestamp) {
  var date = new Date(timestamp);
  return ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2);
}

function escapeConversationText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function requestCardTitle(record) {
  if (record.instructionStatus === 'converting' || record.timelineStatus === 'applying') {
    return '正在处理这次编辑';
  }
  if (
    record.instructionStatus === 'failed' ||
    record.timelineStatus === 'failed' ||
    record.instructionStatus === 'incomplete' ||
    record.timelineStatus === 'incomplete'
  ) {
    return '这次编辑未完成';
  }
  return '这次编辑已完成';
}

function statusRowHTML(testId, label, status) {
  var safeStatus = requestStatusMeta[status] ? status : 'incomplete';
  var meta = requestStatusMeta[safeStatus];
  return '<div class="request-status-row" data-testid="' + testId + '" data-state="' + safeStatus + '">'
    + '<span class="request-status-icon">' + meta.icon + '</span>'
    + '<span>' + label + '</span>'
    + '<span class="request-status-value">' + meta.label + '</span>'
    + '</div>';
}

function renderRequestStatusCard(card, record) {
  var error = record.error
    ? '<div class="request-error">' + escapeConversationText(record.error) + '</div>'
    : '';
  card.innerHTML = '<div class="request-status-head"><span>' + requestCardTitle(record) + '</span>'
    + '<span class="request-status-time">' + formatRequestTime(record.submittedAt) + '</span></div>'
    + statusRowHTML('instruction-status', '转换编辑指令', record.instructionStatus)
    + statusRowHTML('timeline-status', '应用到时间轴', record.timelineStatus)
    + error;
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
  card.dataset.requestId = record.id;
  card.setAttribute('aria-live', 'polite');
  renderRequestStatusCard(card, record);
  chatArea.appendChild(card);
  chatArea.scrollTop = chatArea.scrollHeight;
  return card;
}

function createConversationRequest(text) {
  return {
    id: createLocalId('request'),
    text: text,
    submittedAt: Date.now(),
    instructionStatus: 'converting',
    timelineStatus: 'waiting'
  };
}

function updateRequestStatus(record, card, patch) {
  Object.assign(record, patch);
  saveProjectConversation(activeProjectId, conversationRecords);
  renderRequestStatusCard(card, record);
}

function hydrateConversationHistory() {
  var changed = false;
  for (var i = 0; i < conversationRecords.length; i++) {
    var record = conversationRecords[i];
    if (record.instructionStatus === 'converting') {
      record.instructionStatus = 'incomplete';
      record.timelineStatus = 'not_run';
      changed = true;
    } else if (record.timelineStatus === 'waiting' || record.timelineStatus === 'applying') {
      record.timelineStatus = 'incomplete';
      changed = true;
    }
    appendRequestStatusCard(record);
  }
  if (changed) saveProjectConversation(activeProjectId, conversationRecords);
}

hydrateConversationHistory();
~~~

- [ ] **Step 8: 只改当前自然语言分支，把真实 Promise 状态写入同一卡片**

用以下实现替换 translateLocalCliEffect：

~~~js
function translateLocalCliEffect(text, record, card) {
  if (!window.srtAPI || typeof window.srtAPI.translateLocalCliEffect !== 'function') {
    updateRequestStatus(record, card, {
      instructionStatus: 'failed',
      timelineStatus: 'not_run',
      error: '未能生成编辑指令，请先选择可用的本地 CLI 或重试。'
    });
    return;
  }

  window.srtAPI.translateLocalCliEffect(text).then(function(instruction) {
    updateRequestStatus(record, card, {
      instructionStatus: 'success',
      timelineStatus: 'applying',
      error: ''
    });
    var applied = false;
    try {
      applied = applyLocalCliEffect(instruction);
    } catch (_) {
      applied = false;
    }
    updateRequestStatus(record, card, applied ? {
      timelineStatus: 'success',
      error: ''
    } : {
      timelineStatus: 'failed',
      error: '编辑指令未能应用到时间轴。'
    });
  }).catch(function() {
    updateRequestStatus(record, card, {
      instructionStatus: 'failed',
      timelineStatus: 'not_run',
      error: '未能生成编辑指令，请先选择可用的本地 CLI 或重试。'
    });
  });
}
~~~

用以下代码替换 generateBtn click handler；旧 executeCommand 函数本身保持不动：

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
  conversationRecords.push(record);
  saveProjectConversation(activeProjectId, conversationRecords);
  var card = appendRequestStatusCard(record);
  translateLocalCliEffect(text, record, card);
});
~~~

保留 Enter 提交监听、旧直接命令函数和未触发的旧云端/Ollama函数，不顺手删除或迁移。

- [ ] **Step 9: 把效果与侧栏规格加入默认 E2E 命令**

将 package.json 的 test:e2e 改为：

~~~json
"test:e2e": "playwright test tests/e2e/environment-flow.spec.js tests/e2e/local-cli-flow.spec.js tests/e2e/local-cli-effect-flow.spec.js tests/e2e/conversation-sidebar-flow.spec.js"
~~~

test:e2e:real-mac 保持独立，不新增 test:all。

- [ ] **Step 10: 运行全部自动验证**

Run:

~~~bash
npm test
~~~

Expected: exit 0；全部单元测试通过。

Run:

~~~bash
npm run test:e2e
~~~

Expected: exit 0；环境、CLI 选择、单卡效果和吸附侧栏四组 E2E 全部通过。特别确认 local-cli-effect-flow 与 conversation-sidebar-flow 出现在测试清单中。

- [ ] **Step 11: 完成一次桌面端手动验收**

Run:

~~~bash
npm start
~~~

按顺序人工检查：

1. 首页头像弹层只有“侧栏位置”，默认左侧；没有宽度、登录、会员或云同步。
2. 上传素材进入编辑器，侧栏与视频并排且不遮挡；900 px 左右窗口宽度下对话仍可使用。
3. 拖动宽度，关闭并重新打开应用，宽度保持。
4. 切换右侧偏好后重新进入项目，侧栏在右侧且拖动方向自然。
5. “对话 / 组件”切换正常；组件搜索和拖入时间轴仍工作。
6. 输入“给片头添加一个淡入效果”，只看到一条用户消息和一张状态卡；最终两行成功并出现淡入 marker。
7. 回到首页新建第二个项目；两个项目标签分别恢复自己的对话，不要求视频 Blob 或 marker 按项目恢复。

Expected: 七项全部通过。若任何一项失败，只修复对应验收点；不得扩展为通用存储、恢复或 Agent 系统。

- [ ] **Step 12: 提交任务四并立即结束阶段一**

~~~bash
git add app/剪辑.html app/editor-timeline.js tests/e2e/electron.fixture.js tests/e2e/electron-main.js tests/e2e/local-cli-effect-flow.spec.js tests/e2e/conversation-sidebar-flow.spec.js package.json
git commit -m "feat: persist compact edit request status"
~~~

阶段报告必须同时列出：

- 内部完成度：四个任务、单元测试、默认 E2E 和手动验收的真实结果。
- 用户可见成果：首页偏好、左右吸附、拖宽、项目历史、单卡状态和时间轴标记中哪些已可直接操作。

达到以上验收后停止。阶段二首页工作台、视频按项目存储、新编辑指令、账号与云端能力全部留在后续清单。
