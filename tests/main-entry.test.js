const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const mainPath = path.join(projectRoot, 'main.js');
const e2eEntryPath = path.join(projectRoot, 'tests', 'e2e', 'electron-main.js');

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
