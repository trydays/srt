const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const mainPath = path.join(projectRoot, 'main.js');
const e2eEntryPath = path.join(projectRoot, 'tests', 'e2e', 'electron-main.js');
const mainSource = fs.readFileSync(mainPath, 'utf8');
const preloadSource = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');

test('main and preload expose only narrow local CLI operations', () => {
  assert.match(mainSource, /ipcMain\.handle\('local-cli:get-state'/);
  assert.match(mainSource, /ipcMain\.handle\('local-cli:rescan'/);
  assert.match(mainSource, /ipcMain\.handle\('local-cli:select'/);
  assert.match(mainSource, /ipcMain\.handle\('local-cli:translate-effect'/);
  assert.match(mainSource, /ipcMain\.handle\('local-cli:translate-subtitle-or-fade-in'/);
  assert.match(mainSource, /ipcMain\.handle\('subtitles:generate'/);
  assert.match(preloadSource, /getLocalCliState: \(\) => ipcRenderer\.invoke\('local-cli:get-state'\)/);
  assert.match(preloadSource, /rescanLocalCli: \(\) => ipcRenderer\.invoke\('local-cli:rescan'\)/);
  assert.match(preloadSource, /selectLocalCli: \(id\) => ipcRenderer\.invoke\('local-cli:select', id\)/);
  assert.match(preloadSource, /translateLocalCliEffect: \(text\) => ipcRenderer\.invoke\('local-cli:translate-effect', text\)/);
  assert.match(preloadSource, /translateSubtitleOrFadeIn: \(text\) => ipcRenderer\.invoke\('local-cli:translate-subtitle-or-fade-in', text\)/);
  assert.match(preloadSource, /generateSubtitles: \(request\) => ipcRenderer\.invoke\('subtitles:generate', request\)/);
  assert.match(preloadSource, /getPathForFile: \(file\) => webUtils\.getPathForFile\(file\)/);
  assert.equal(preloadSource.includes('local-cli:exec'), false);
  assert.equal(preloadSource.includes('subtitle:exec'), false);
  assert.equal(preloadSource.includes('readFile'), false);
  assert.equal(preloadSource.includes('writeFile'), false);
});

test('preload exposes only the narrow video export bridge', () => {
  assert.match(preloadSource,
    /resolveVideoSource:\s*\(videoPath\)\s*=>\s*ipcRenderer\.invoke\('video:resolve-source', videoPath\)/);
  assert.match(preloadSource,
    /startVideoExport:\s*\(request\)\s*=>\s*ipcRenderer\.invoke\('video-export:start', request\)/);
  assert.match(preloadSource,
    /cancelVideoExport:\s*\(jobId\)\s*=>\s*ipcRenderer\.invoke\('video-export:cancel', jobId\)/);
  assert.match(preloadSource, /onVideoExportProgress:\s*\(callback\)\s*=>\s*\{/);
  assert.match(preloadSource,
    /return\s*\(\)\s*=>\s*ipcRenderer\.removeListener\('video-export:progress', listener\)/);
  assert.equal(/startVideoExport:\s*\([^)]*,/.test(preloadSource), false);
  assert.equal(preloadSource.includes('outputPath'), false);
  assert.equal(preloadSource.includes('ffmpegPath'), false);
  assert.equal(preloadSource.includes('ffprobePath'), false);
});

function observeAutomaticStart(scenario) {
  const script = `
    const { EventEmitter } = require('node:events');
    const Module = require('node:module');
    const scenario = ${JSON.stringify(scenario)};
    let getPathCalls = 0;
    const app = new EventEmitter();
    app.isPackaged = scenario.isPackaged;
    app.getPath = () => { getPathCalls += 1; return '/isolated-user-data'; };
    app.whenReady = () => new Promise(() => {});
    app.quit = () => {};
    const electron = {
      app,
      BrowserWindow: class BrowserWindow {},
      dialog: {},
      ipcMain: { handle() {} }
    };
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === 'electron') return electron;
      return originalLoad.call(this, request, parent, isMain);
    };
    if (scenario.processType === null) delete process.type;
    else Object.defineProperty(process, 'type', { value: scenario.processType, configurable: true });
    if (scenario.defaultApp === null) delete process.defaultApp;
    else Object.defineProperty(process, 'defaultApp', { value: scenario.defaultApp, configurable: true });
    if (scenario.isPackaged) {
      Object.defineProperty(process, 'resourcesPath', { value: '/packaged/resources', configurable: true });
    }
    process.argv[1] = scenario.argv1;
    require(${JSON.stringify(mainPath)});
    process.stdout.write('\\nENTRY_STARTS=' + getPathCalls + '\\n');
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const match = result.stdout.match(/ENTRY_STARTS=(\d+)/);
  assert.ok(match, result.stdout);
  return Number(match[1]);
}

function runMainProbe(probeSource, marker) {
  const result = spawnSync(process.execPath, ['-e', probeSource], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const match = result.stdout.match(new RegExp(marker + '=(.+)'));
  assert.ok(match, result.stdout);
  return JSON.parse(match[1]);
}

test('export-aware close protection is attached to a reactivated main window', () => {
  const script = `
    const { EventEmitter } = require('node:events');
    const Module = require('node:module');
    const windows = [];
    const app = new EventEmitter();
    app.isPackaged = false;
    app.getPath = () => '/isolated-user-data';
    app.whenReady = () => Promise.resolve();
    app.quit = () => {};
    class BrowserWindow extends EventEmitter {
      constructor() { super(); this.webContents = {}; windows.push(this); }
      loadFile() {}
      static fromWebContents() { return null; }
    }
    const electron = { app, BrowserWindow, dialog: {}, ipcMain: { handle() {} } };
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === 'electron') return electron;
      return originalLoad.call(this, request, parent, isMain);
    };
    const inertEnvironment = {
      detectEnvironment() {}, describeInstall() {}, installTool() {}, getExportTools() {}
    };
    const inertLocalCli = {
      getState() {}, rescan() {}, select() {}, translateEffect() {}, translateSubtitleOrFadeIn() {}
    };
    require(${JSON.stringify(mainPath)}).startApplication({
      environmentModule: inertEnvironment,
      localCliService: inertLocalCli,
      subtitleService: { generate() {} },
      videoExportService: { start() {}, cancel() {} },
      showSaveDialog() {}
    });
    setImmediate(() => {
      windows[0].emit('closed');
      app.emit('activate');
      process.stdout.write('CLOSE_LISTENERS=' + JSON.stringify(
        windows.map((window) => window.listenerCount('close'))
      ) + '\\n');
    });
  `;
  assert.deepEqual(runMainProbe(script, 'CLOSE_LISTENERS'), [1, 1]);
});

test('video export normalizes fulfilled service failure codes to the public allowlist', () => {
  const script = `
    const { EventEmitter } = require('node:events');
    const Module = require('node:module');
    const handlers = new Map();
    const app = new EventEmitter();
    app.isPackaged = false;
    app.getPath = () => '/isolated-user-data';
    app.whenReady = () => new Promise(() => {});
    app.quit = () => {};
    class BrowserWindow {
      static fromWebContents() { return null; }
    }
    const electron = {
      app, BrowserWindow, dialog: {},
      ipcMain: { handle(name, handler) { handlers.set(name, handler); } }
    };
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === 'electron') return electron;
      return originalLoad.call(this, request, parent, isMain);
    };
    let starts = 0;
    const inertEnvironment = {
      detectEnvironment() {}, describeInstall() {}, installTool() {}, getExportTools() {}
    };
    const inertLocalCli = {
      getState() {}, rescan() {}, select() {}, translateEffect() {}, translateSubtitleOrFadeIn() {}
    };
    require(${JSON.stringify(mainPath)}).startApplication({
      environmentModule: inertEnvironment,
      localCliService: inertLocalCli,
      subtitleService: { generate() {} },
      videoExportService: {
        start(request) {
          starts += 1;
          return Promise.resolve({ jobId: request.jobId, status: 'failed',
            errorCode: starts === 1 ? 'EACCES' : 'EXPORT_RENDER_FAILED' });
        },
        cancel() {}
      },
      showSaveDialog: async () => ({ canceled: false, filePath: '/tmp/export.mp4' })
    });
    const sender = { isDestroyed: () => false, send() {} };
    const start = handlers.get('video-export:start');
    Promise.all([
      start({ sender }, { jobId: 'unknown', videoPath: '/tmp/source.mp4', recipe: {} })
        .then(async (first) => {
          const second = await start({ sender }, {
            jobId: 'known', videoPath: '/tmp/source.mp4', recipe: {}
          });
          return [first.errorCode, second.errorCode];
        })
    ]).then((codes) => {
      process.stdout.write('EXPORT_CODES=' + JSON.stringify(codes[0]) + '\\n');
    });
  `;
  assert.deepEqual(runMainProbe(script, 'EXPORT_CODES'), [
    'EXPORT_WRITE_FAILED', 'EXPORT_RENDER_FAILED'
  ]);
});

test('default-app Electron project launch starts once', () => {
  assert.equal(observeAutomaticStart({
    processType: 'browser',
    defaultApp: true,
    isPackaged: false,
    argv1: '.'
  }), 1);
});

test('default-app Electron main-file launch starts once', () => {
  assert.equal(observeAutomaticStart({
    processType: 'browser',
    defaultApp: true,
    isPackaged: false,
    argv1: mainPath
  }), 1);
});

test('packaged Electron browser launch starts once', () => {
  assert.equal(observeAutomaticStart({
    processType: 'browser',
    defaultApp: false,
    isPackaged: true,
    argv1: '/packaged/bootstrap.js'
  }), 1);
});

test('explicit E2E entry import does not start automatically', () => {
  assert.equal(observeAutomaticStart({
    processType: 'browser',
    defaultApp: true,
    isPackaged: false,
    argv1: e2eEntryPath
  }), 0);
});

test('plain Node import does not start Electron', () => {
  assert.equal(observeAutomaticStart({
    processType: null,
    defaultApp: null,
    isPackaged: false,
    argv1: '/plain-node/importer.js'
  }), 0);
});
