const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const dialog = electron.dialog;
const ipcMain = electron.ipcMain;
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, execSync } = require('child_process');
const { loadConfig } = require('./config-loader');

let mainWindow = null;

/* ── 启动时加载 AI 配置 ── */
var aiConfig = null;
try {
  aiConfig = loadConfig(process.argv, process.env, __dirname);
  if (aiConfig) {
    console.log('[main] AI 配置已加载: provider=' + aiConfig.provider + ', key=' + aiConfig.key.slice(0,7) + '...');
  } else {
    console.log('[main] 未检测到预设 AI 配置');
  }
} catch (e) {
  console.error('[main] 配置加载失败:', e.message);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: '三天remotion',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'app', '主页.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('dialog:openVideo', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频文件',
    filters: [
      { name: '视频文件', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const fp = result.filePaths[0];
  return { name: path.basename(fp), path: fp, size: fs.statSync(fp).size };
});

/* ── CLI 执行 ── 返回 {ok, stdout, stderr, exitCode} ── */
ipcMain.handle('cli:exec', async (_event, cmd, timeout) => {
  return new Promise(function(resolve) {
    exec(cmd, { timeout: timeout || 15000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      function(err, stdout, stderr) {
        if (err) resolve({ ok: false, stdout: (stdout||'').trim(), stderr: (stderr||'').trim(), exitCode: err.code||1 });
        else resolve({ ok: true, stdout: (stdout||'').trim(), stderr: (stderr||'').trim(), exitCode: 0 });
      });
  });
});

/* ── 工具安装 ── 复制 bundled 工具到 AppData ── */
function getAppDataDir() {
  return path.join(os.homedir(), 'AppData', 'Roaming', 'srt', 'tools');
}

function getToolsVersionsPath(relative) {
  var bundled = path.join(__dirname, 'resources', 'tools', 'tools-versions.json');
  var appdata = path.join(getAppDataDir(), 'tools-versions.json');
  if (relative === 'bundled') return bundled;
  if (relative === 'appdata') return appdata;
  return bundled;
}

function ensureVCRedist() {
  var vcPath = path.join(__dirname, 'resources', 'tools', 'VC_redist.x64.exe');
  if (!fs.existsSync(vcPath)) {
    console.log('[main] VC++ Redist 不存在，跳过');
    return;
  }
  try {
    console.log('[main] 正在安装 VC++ Redist...');
    execSync('"' + vcPath + '" /quiet /norestart', { windowsHide: true, timeout: 300000 });
    console.log('[main] VC++ Redist 安装完成');
  } catch (e) {
    console.error('[main] VC++ Redist 安装失败:', e.message);
  }
}

function ensureTools() {
  var bundledVersions = path.join(__dirname, 'resources', 'tools', 'tools-versions.json');
  var appdataDir = getAppDataDir();
  var appdataVersions = path.join(appdataDir, 'tools-versions.json');

  if (!fs.existsSync(bundledVersions)) {
    console.log('[main] tools-versions.json 不存在，跳过工具安装');
    return;
  }

  var versions;
  try { versions = JSON.parse(fs.readFileSync(bundledVersions, 'utf-8')); }
  catch (e) { console.error('[main] 解析 tools-versions.json 失败:', e.message); return; }

  if (!fs.existsSync(appdataDir)) fs.mkdirSync(appdataDir, { recursive: true });

  var toolsDir = path.join(__dirname, 'resources', 'tools');
  var names = Object.keys(versions.bundled);
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    var info = versions.bundled[n];
    if (info.size === 0) continue; // 未下载的工具（whisper/vcredist）

    var src = path.join(toolsDir, info.exe);
    var dst = path.join(appdataDir, info.exe);
    if (!fs.existsSync(src)) continue;

    // 原子复制：.tmp → rename → size 校验
    var tmp = dst + '.tmp';
    try {
      fs.copyFileSync(src, tmp);
      var stat = fs.statSync(tmp);
      if (stat.size === info.size || info.size <= 6) {
        // size=6 是 dummy marker，表示文件大小未知，直接 rename
        if (fs.existsSync(dst)) fs.unlinkSync(dst);
        fs.renameSync(tmp, dst);
        console.log('[main] 工具已安装: ' + n + ' → ' + dst);
      } else {
        fs.unlinkSync(tmp);
        console.error('[main] 工具大小校验失败: ' + n + ' expected=' + info.size + ' got=' + stat.size);
      }
    } catch (e) {
      console.error('[main] 安装工具失败: ' + n, e.message);
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    }
  }

  // 写入 AppData 版本文件
  try {
    fs.writeFileSync(appdataVersions, JSON.stringify(versions, null, 2), 'utf-8');
  } catch (e) {
    console.error('[main] 写入 AppData tools-versions.json 失败:', e.message);
  }

  cleanupBundledTools();
}

function cleanupBundledTools() {
  var bundledVersions = path.join(__dirname, 'resources', 'tools', 'tools-versions.json');
  if (!fs.existsSync(bundledVersions)) return;
  var versions;
  try { versions = JSON.parse(fs.readFileSync(bundledVersions, 'utf-8')); }
  catch (e) { return; }

  var toolsDir = path.join(__dirname, 'resources', 'tools');
  var names = Object.keys(versions.bundled);
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    var info = versions.bundled[n];
    if (info.size === 0) continue;
    var src = path.join(toolsDir, info.exe);
    try {
      if (fs.existsSync(src)) {
        fs.unlinkSync(src);
        console.log('[main] 已清理 bundled 工具: ' + n);
      }
    } catch (e) {
      console.error('[main] 清理失败: ' + n, e.message);
    }
  }
}

function ensureWhisper() {
  var whisperDir = path.join(__dirname, 'resources', 'whisper');
  if (!fs.existsSync(whisperDir)) {
    console.log('[main] Whisper 模型目录不存在');
    return;
  }
  var appdataWhisper = path.join(os.homedir(), 'AppData', 'Roaming', 'srt', 'whisper');
  if (fs.existsSync(appdataWhisper)) {
    console.log('[main] Whisper 模型已在 AppData');
    return;
  }
  // Whisper 预装在包体中，不需要额外操作
  console.log('[main] Whisper 模型位于 bundled resources/whisper');
}

/* ── IPC: 查询捆绑工具列表 ── */
ipcMain.handle('tools:queryBundled', async () => {
  var fp = getToolsVersionsPath('bundled');
  if (!fs.existsSync(fp)) return { versions: null, appdataExists: false };
  try {
    var versions = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    var appdataFp = getToolsVersionsPath('appdata');
    return { versions: versions, appdataExists: fs.existsSync(appdataFp) };
  } catch (e) {
    return { versions: null, appdataExists: false, error: e.message };
  }
});

/* ── IPC: 手动安装工具 ── */
ipcMain.handle('tools:install', async (_event, tool) => {
  return new Promise(function(resolve) {
    var cmd;
    if (tool === 'ffmpeg') cmd = 'echo "use bundled ffmpeg"';
    else if (tool === 'python') cmd = 'echo "use bundled python"';
    else if (tool === 'node') cmd = 'echo "use bundled node"';
    else if (tool === 'whisper') cmd = 'echo "whisper is pre-installed"';
    else { resolve({ ok: false, error: 'Unknown tool: ' + tool }); return; }
    exec(cmd, { timeout: 10000, windowsHide: true }, function(err, stdout, stderr) {
      resolve({ ok: !err, stdout: (stdout||'').trim(), stderr: (stderr||'').trim() });
    });
  });
});

/* ── IPC: AI 配置查询 ── */
ipcMain.handle('ai:config:query', async () => {
  return aiConfig;
});

/* ── IPC: Ollama 检测 ── */
ipcMain.handle('ai:ollama:detect', async () => {
  return new Promise(function(resolve) {
    exec('ollama list', { timeout: 5000, windowsHide: true }, function(err, stdout) {
      if (err) { resolve({ available: false }); return; }
      var models = [];
      var lines = (stdout || '').trim().split('\n');
      for (var i = 1; i < lines.length; i++) {
        var name = lines[i].trim().split(/\s+/)[0];
        if (name) models.push(name);
      }
      resolve({ available: true, models: models });
    });
  });
});

/* ── IPC: AI 翻译（云端） ── */
ipcMain.handle('ai:translate:cloud', async (_event, text, provider, key, endpoint, model) => {
  var p = provider || (aiConfig && aiConfig.provider) || 'deepseek';
  var k = key || (aiConfig && aiConfig.key);
  var ep = endpoint || (aiConfig && aiConfig.endpoint);
  var m = model || (aiConfig && aiConfig.model);

  if (!k) return { ok: false, error: '未配置 AI Key' };
  if (!ep) {
    if (p === 'deepseek') ep = 'https://api.deepseek.com/v1/chat/completions';
    else if (p === 'openai') ep = 'https://api.openai.com/v1/chat/completions';
    else if (p === 'anthropic') ep = 'https://api.anthropic.com/v1/messages';
  }
  if (!m) m = 'deepseek-chat';

  var payload = JSON.stringify({
    model: m,
    messages: [
      { role: 'system', content: '你是一个视频编辑助手。将用户的自然语言指令转换为 ffmpeg 命令。只输出可执行的 ffmpeg 命令，不要解释。' },
      { role: 'user', content: text }
    ],
    max_tokens: 500
  });

  return new Promise(function(resolve) {
    var url = require('url');
    var http = require('follow-redirects').https;
    var apiUrl = url.parse(ep);
    var options = {
      hostname: apiUrl.hostname,
      path: apiUrl.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + k
      },
      timeout: 30000
    };
    var req = http.request(options, function(res) {
      var body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        try {
          var data = JSON.parse(body);
          if (data.error) { resolve({ ok: false, error: data.error.message }); return; }
          var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          resolve({ ok: true, result: content || '' });
        } catch (e) {
          resolve({ ok: false, error: '解析响应失败: ' + e.message });
        }
      });
    });
    req.on('error', function(e) { resolve({ ok: false, error: e.message }); });
    req.on('timeout', function() { req.destroy(); resolve({ ok: false, error: '请求超时' }); });
    req.write(payload);
    req.end();
  });
});

/* ── IPC: AI 翻译（Ollama 本地） ── */
ipcMain.handle('ai:translate:ollama', async (_event, text, model) => {
  var m = model || 'qwen2.5:latest';
  var payload = JSON.stringify({
    model: m,
    messages: [
      { role: 'system', content: '你是一个视频编辑助手。将用户的自然语言指令转换为 ffmpeg 命令。只输出可执行的 ffmpeg 命令，不要解释。' },
      { role: 'user', content: text }
    ],
    stream: false
  });

  return new Promise(function(resolve) {
    var http = require('http');
    var options = {
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/chat',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000
    };
    var req = http.request(options, function(res) {
      var body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        try {
          var data = JSON.parse(body);
          resolve({ ok: true, result: data.message && data.message.content || '' });
        } catch (e) {
          resolve({ ok: false, error: '解析响应失败: ' + e.message });
        }
      });
    });
    req.on('error', function(e) { resolve({ ok: false, error: 'Ollama 连接失败: ' + e.message }); });
    req.on('timeout', function() { req.destroy(); resolve({ ok: false, error: '请求超时' }); });
    req.write(payload);
    req.end();
  });
});

/* ── IPC: 更新检查 ── */
ipcMain.handle('update:check', async () => {
  try {
    var { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false;
    var result = await autoUpdater.checkForUpdates();
    if (result && result.updateInfo) {
      return { hasUpdate: true, version: result.updateInfo.version };
    }
    return { hasUpdate: false };
  } catch (e) {
    return { hasUpdate: false, error: e.message };
  }
});

/* ── IPC: 安装更新 ── */
ipcMain.handle('update:install', async () => {
  try {
    var { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.on('download-progress', function(progress) {
      if (mainWindow) mainWindow.webContents.send('download:progress', progress);
    });
    await autoUpdater.downloadUpdate();
    autoUpdater.quitAndInstall();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* ── 应用生命周期 ── */
app.whenReady().then(async () => {
  ensureVCRedist();
  ensureTools();
  ensureWhisper();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
