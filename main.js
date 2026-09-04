const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const dialog = electron.dialog;
const ipcMain = electron.ipcMain;
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { loadConfig } = require('./config-loader');
const { createProductionEnvironment } = require('./src/environment/node-adapter');

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

function startApplication({ environmentModule } = {}) {
  const userDataDir = app.getPath('userData');
  const bundledRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'tools')
    : path.join(__dirname, 'resources', 'tools');
  const activeEnvironment = environmentModule || createProductionEnvironment({
    targetPath: userDataDir,
    userDataDir,
    bundledRoot
  });

  ipcMain.handle('environment:detect', () => activeEnvironment.detectEnvironment());
  ipcMain.handle('installation:describe', (_event, toolId) => activeEnvironment.describeInstall(toolId));
  ipcMain.handle('installation:execute', (_event, request) => activeEnvironment.installTool(request));

  app.whenReady().then(async () => {
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (mainWindow === null) createWindow();
  });
}

module.exports = { startApplication };

function isDirectApplicationEntry() {
  if (require.main === module) return true;
  if (process.type !== 'browser') return false;
  if (app.isPackaged) return true;
  if (!process.defaultApp || !process.argv[1]) return false;

  const entryPath = path.resolve(process.argv[1]);
  return entryPath === __dirname || entryPath === __filename;
}

if (isDirectApplicationEntry()) startApplication();
