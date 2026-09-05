/* === shared.js — 三天remotion 共享脚本 === */

/* ── Chip 选中 ── */
function setActiveChip(container, clickedEl, selector) {
  var all = container.querySelectorAll(selector);
  for (var i = 0; i < all.length; i++) all[i].classList.remove('is-active');
  clickedEl.classList.add('is-active');
}

/* ── 存储 key 常量 ── */
window.STORAGE_KEYS = {
  PROJECTS:    'srt_projects',
  VIDEO:       'srt_video',
  RENDER_MODE: 'srt_render_mode',
  AI_CONFIG:   'srt_ai_config',
  ENV_DONE:    'srt_env_done',
  WORK_DRIVE:  'srt_work_drive',
  ACTIVE_PROJECT_ID: 'srt_active_project_id',
  PROJECT_CONVERSATIONS: 'srt_project_conversations',
};

/* ── 项目管理 ── */
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

/* ── CLI 执行（仅 Electron 桌面版）── */
function cliExec(cmd, timeout, cb) {
  if (window.srtAPI && window.srtAPI.execCommand) {
    window.srtAPI.execCommand(cmd, timeout).then(function(r) { cb(r); })
      .catch(function(e) { cb({ ok: false, stderr: e.message || 'IPC 错误', exitCode: 1 }); });
  } else {
    cb({ ok: false, stdout: '', stderr: '请在桌面版执行媒体命令', exitCode: 1 });
  }
}
