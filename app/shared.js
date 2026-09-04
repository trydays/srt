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
};

/* ── 项目管理 ── */
var TABS_KEY = STORAGE_KEYS.PROJECTS;
function getProjects() {
  try { return JSON.parse(localStorage.getItem(TABS_KEY) || '[]'); }
  catch (e) { console.error('[getProjects] 读取失败:', e.message); return []; }
}
function saveProjects(arr) {
  try { localStorage.setItem(TABS_KEY, JSON.stringify(arr)); }
  catch (e) { console.error('[saveProjects] 写入失败:', e.message); }
}

/* ── Tab bar 渲染 ── */
function isHomePage() {
  return !!(window.__PAGE && window.__PAGE.id === 'home');
}
function renderTabs() {
  var bar = document.getElementById('tabsBar');
  if (!bar) return;
  var projects = getProjects();
  var onHome = isHomePage();
  var html = '';
  html += '<div class="wtab is-pinned' + (onHome ? ' is-active' : '') + '" onclick="location.href=\'主页.html\'">'
    + '<button class="wtab__main" type="button"><span class="wtab__label">三 三天remotion</span></button></div>';
  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    var isActive = (!onHome && i === 0);
    html += '<div class="wtab' + (isActive ? ' is-active' : '') + '">'
      + '<button class="wtab__main" type="button" onclick="switchTo(' + i + ')"><span class="wtab__label">' + p.name.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</span></button>'
      + '<button class="wtab__close" type="button" onclick="closeTab(event,' + i + ')">&#10005;</button></div>';
  }
  bar.innerHTML = html;
}
function switchTo(idx) {
  var p = getProjects();
  if (idx >= 0 && idx < p.length) location.href = p[idx].path;
}
function closeTab(e, idx) {
  e.stopPropagation();
  var p = getProjects();
  p.splice(idx, 1);
  saveProjects(p);
  if (p.length === 0) {
    try { localStorage.removeItem(STORAGE_KEYS.VIDEO); } catch (_) {}
    if (!isHomePage()) location.href = '主页.html';
    else renderTabs();
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
