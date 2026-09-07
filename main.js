const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const dialog = electron.dialog;
const ipcMain = electron.ipcMain;
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { exec } = require('child_process');
const { loadConfig } = require('./config-loader');
const { createProductionEnvironment } = require('./src/environment/node-adapter');
const { createLocalCliService } = require('./src/local-cli');
const { createSubtitleService } = require('./src/subtitles');
const { createVideoExportService } = require('./src/video-export');

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

function createWindow(onClose) {
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
  if (onClose) mainWindow.on('close', onClose);
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

function publicFailure(error, fallback) {
  return { ok: false, errorCode: error && error.code ? error.code : fallback };
}

const PUBLIC_EXPORT_CODES = new Set([
  'VIDEO_PATH_UNAVAILABLE', 'EXPORT_BUSY', 'EXPORT_UNSUPPORTED_OPERATION',
  'EXPORT_RUNTIME_NOT_READY', 'EXPORT_INVALID_RECIPE',
  'EXPORT_TARGET_EXISTS', 'EXPORT_SOURCE_OVERWRITE', 'EXPORT_INVALID_MEDIA',
  'EXPORT_WRITE_FAILED', 'EXPORT_RENDER_FAILED'
]);

function publicExportCode(error, fallback) {
  return error && PUBLIC_EXPORT_CODES.has(error.code) ? error.code : fallback;
}

function startApplication({ environmentModule, localCliService, subtitleService,
  videoExportService, showSaveDialog } = {}) {
  const userDataDir = app.getPath('userData');
  const bundledRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'tools')
    : path.join(__dirname, 'resources', 'tools');
  const activeEnvironment = environmentModule || createProductionEnvironment({
    targetPath: userDataDir,
    userDataDir,
    bundledRoot
  });
  const activeLocalCliService = localCliService || createLocalCliService({ userDataDir });
  const activeSubtitleService = subtitleService || createSubtitleService({
    userDataDir,
    transcriberPath: path.join(bundledRoot, 'transcribe-subtitles.py')
  });
  const activeVideoExportService = videoExportService || createVideoExportService({
    getExportTools: () => activeEnvironment.getExportTools()
  });
  const activeShowSaveDialog = showSaveDialog
    || ((browserWindow, options) => dialog.showSaveDialog(browserWindow, options));
  let activeExport = null;

  ipcMain.handle('environment:detect', () => activeEnvironment.detectEnvironment());
  ipcMain.handle('installation:describe', (_event, toolId) => activeEnvironment.describeInstall(toolId));
  ipcMain.handle('installation:execute', (_event, request) => activeEnvironment.installTool(request));
  ipcMain.handle('local-cli:get-state', () => activeLocalCliService.getState());
  ipcMain.handle('local-cli:rescan', () => activeLocalCliService.rescan());
  ipcMain.handle('local-cli:select', (_event, id) => activeLocalCliService.select(id));
  ipcMain.handle('local-cli:translate-effect', (_event, text) => activeLocalCliService.translateEffect(text));
  ipcMain.handle('local-cli:translate-subtitle-or-fade-in', async (_event, text) => {
    try {
      return {
        ok: true,
        instruction: await activeLocalCliService.translateSubtitleOrFadeIn(text)
      };
    } catch (error) {
      return publicFailure(error, 'LOCAL_CLI_TRANSLATION_FAILED');
    }
  });
  ipcMain.handle('subtitles:generate', async (_event, request) => {
    try {
      const result = await activeSubtitleService.generate(request);
      return { ok: true, segments: result.segments };
    } catch (error) {
      return publicFailure(error, 'SUBTITLE_TRANSCRIPTION_FAILED');
    }
  });
  ipcMain.handle('video:resolve-source', async (_event, videoPath) => {
    try {
      const resolvedPath = await fs.promises.realpath(videoPath);
      const stat = await fs.promises.stat(resolvedPath);
      if (!stat.isFile()) throw new Error('not a file');
      return { ok: true, path: resolvedPath, url: pathToFileURL(resolvedPath).href };
    } catch (_) {
      return { ok: false, errorCode: 'VIDEO_PATH_UNAVAILABLE' };
    }
  });
  ipcMain.handle('video-export:start', async (event, request) => {
    const { jobId, videoPath, recipe } = request || {};
    const sender = event.sender;
    if (activeExport) {
      return { jobId, status: 'failed', errorCode: 'EXPORT_BUSY' };
    }
    const slot = activeExport = {
      jobId, sender, phase: 'dialog', cancelled: false, completion: null
    };
    try {
      const senderWindow = BrowserWindow.fromWebContents(sender);
      const saveOptions = {
        title: '导出视频',
        defaultPath: path.join(
          path.dirname(videoPath), path.parse(videoPath).name + '-已编辑.mp4'
        ),
        filters: [{ name: 'MP4 视频', extensions: ['mp4'] }]
      };
      const choice = await activeShowSaveDialog(senderWindow, saveOptions);
      if (choice.canceled || slot.cancelled || sender.isDestroyed()) {
        return { jobId, status: 'cancelled' };
      }
      const outputPath = /\.mp4$/i.test(choice.filePath)
        ? choice.filePath : choice.filePath + '.mp4';
      sender.send('video-export:progress', {
        jobId, phase: 'preparing', percent: null, outputPath
      });
      slot.phase = 'service';
      slot.completion = activeVideoExportService.start(
        { jobId, videoPath, outputPath, recipe },
        function(progress) {
          if (progress && progress.phase) slot.phase = progress.phase;
          if (activeExport === slot && !sender.isDestroyed()) {
            sender.send('video-export:progress', progress);
          }
        }
      );
      const result = await slot.completion;
      if (result && result.status === 'failed') {
        return Object.assign({}, result, {
          errorCode: publicExportCode({ code: result.errorCode }, 'EXPORT_FAILED')
        });
      }
      return result;
    } catch (error) {
      return {
        jobId,
        status: 'failed',
        errorCode: publicExportCode(error, 'EXPORT_WRITE_FAILED')
      };
    } finally {
      if (activeExport === slot) activeExport = null;
    }
  });
  ipcMain.handle('video-export:cancel', async (_event, jobId) => {
    const slot = activeExport;
    if (!slot || slot.jobId !== jobId) return;
    if (slot.phase === 'dialog') {
      slot.cancelled = true;
      return;
    }
    if (slot.phase !== 'finalizing') await activeVideoExportService.cancel(jobId);
    if (slot.completion) await slot.completion;
  });

  function handleExportingWindowClose(event) {
      const closingWindow = this;
      const slot = activeExport;
      if (!slot || slot.sender !== closingWindow.webContents || slot.closing) return;
      event.preventDefault();
      slot.closing = true;
      Promise.resolve().then(async function() {
        if (slot.phase === 'dialog') slot.cancelled = true;
        else if (slot.phase !== 'finalizing') await activeVideoExportService.cancel(slot.jobId);
        if (slot.completion) await slot.completion;
      }).finally(function() {
        if (!closingWindow.isDestroyed()) closingWindow.destroy();
      });
  }

  app.whenReady().then(async () => {
    createWindow(handleExportingWindowClose);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (mainWindow === null) createWindow(handleExportingWindowClose);
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
