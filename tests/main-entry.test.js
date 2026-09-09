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
  assert.match(mainSource, /ipcMain\.handle\('local-cli:translate-instruction'/);
  assert.equal(mainSource.includes("local-cli:translate-effect"), false);
  assert.equal(mainSource.includes("local-cli:translate-subtitle-or-fade-in"), false);
  assert.match(mainSource, /ipcMain\.handle\('subtitles:generate'/);
  assert.match(preloadSource, /getLocalCliState: \(\) => ipcRenderer\.invoke\('local-cli:get-state'\)/);
  assert.match(preloadSource, /rescanLocalCli: \(\) => ipcRenderer\.invoke\('local-cli:rescan'\)/);
  assert.match(preloadSource, /selectLocalCli: \(id\) => ipcRenderer\.invoke\('local-cli:select', id\)/);
  assert.match(preloadSource, /translateInstruction:\s*\(text, history, context, skill\)\s*=>\s*ipcRenderer\.invoke\('local-cli:translate-instruction',\s*\{ text, history, context, skill \}\)/);
  assert.equal(preloadSource.includes('translateLocalCliEffect'), false);
  assert.equal(preloadSource.includes('translateSubtitleOrFadeIn'), false);
  assert.match(preloadSource, /generateSubtitles: \(request\) => ipcRenderer\.invoke\('subtitles:generate', request\)/);
  assert.match(preloadSource, /getPathForFile: \(file\) => webUtils\.getPathForFile\(file\)/);
  assert.equal(preloadSource.includes('local-cli:exec'), false);
  assert.equal(preloadSource.includes('subtitle:exec'), false);
  assert.equal(preloadSource.includes('readFile'), false);
  assert.equal(preloadSource.includes('writeFile'), false);
});

test('main forwards the optional personal skill context to the local CLI service', () => {
  const script = `
    const { EventEmitter } = require('node:events');
    const Module = require('node:module');
    const handlers = new Map();
    const app = new EventEmitter();
    app.isPackaged = false;
    app.getPath = () => '/isolated-user-data';
    app.whenReady = () => new Promise(() => {});
    app.quit = () => {};
    class BrowserWindow { static fromWebContents() { return null; } }
    const electron = { app, BrowserWindow, dialog: {},
      ipcMain: { handle(name, handler) { handlers.set(name, handler); } } };
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === 'electron') return electron;
      return originalLoad.call(this, request, parent, isMain);
    };
    const received = [];
    require(${JSON.stringify(mainPath)}).startApplication({
      environmentModule: { detectEnvironment() {}, describeInstall() {}, installTool() {}, getExportTools() {} },
      localCliService: {
        getState() {}, rescan() {}, select() {},
        translateInstruction(...args) { received.push(args); return { kind: 'clarify', message: 'ok' }; }
      },
      subtitleService: { generate() {} },
      videoExportService: { start() {}, cancel() {} },
      showSaveDialog() {}
    });
    const skill = { name: '技能', intent: '意图', preferences: { description: '' },
      referenceRecipe: { kind: 'instruction', steps: [{ capability: 'old@1', params: {} }] },
      capabilityVersions: ['old@1'] };
    handlers.get('local-cli:translate-instruction')({}, {
      text: '继续', history: [], context: { revision: 1 }, skill
    }).then(() => process.stdout.write('FORWARDED=' + JSON.stringify(received) + '\\n'));
  `;
  assert.deepEqual(runMainProbe(script, 'FORWARDED'), [[
    '继续', [], { revision: 1 }, {
      name: '技能', intent: '意图', preferences: { description: '' },
      referenceRecipe: { kind: 'instruction', steps: [{ capability: 'old@1', params: {} }] },
      capabilityVersions: ['old@1']
    }
  ]]);
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

test('default export accepts Remotion snapshots and rejects old recipe routes before opening a dialog', () => {
  const script = `
    const { EventEmitter } = require('node:events');
    const Module = require('node:module');
    const handlers = new Map();
    const app = new EventEmitter();
    app.isPackaged = false; app.getPath = () => '/isolated-user-data';
    app.whenReady = () => new Promise(() => {}); app.quit = () => {};
    class BrowserWindow { static fromWebContents() { return null; } }
    const electron = { app, BrowserWindow, dialog: {},
      ipcMain: { handle(name, handler) { handlers.set(name, handler); } } };
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      return request === 'electron' ? electron : originalLoad.call(this, request, parent, isMain);
    };
    const received = [], legacy = []; let dialogs = 0;
    require(${JSON.stringify(mainPath)}).startApplication({
      environmentModule: { detectEnvironment() {}, describeInstall() {}, installTool() {}, getExportTools() {} },
      localCliService: { getState() {}, rescan() {}, select() {}, translateInstruction() {} },
      subtitleService: { generate() {} },
      videoExportService: { start(value) { legacy.push(value); return {status:'failed'}; }, cancel() {} },
      remotionExportService: { start(value) { received.push(value); return { jobId:value.jobId,status:'completed',outputPath:value.outputPath }; }, cancel() {} },
      showSaveDialog: async () => { dialogs++; return { canceled:false,filePath:'/tmp/remotion-probe-result.mp4' }; }
    });
    const sender = new EventEmitter(); sender.id=1; sender.isDestroyed=()=>false; sender.send=()=>{};
    const snapshot={document:{revision:7},graph:{documentRevision:7}};
    handlers.get('video-export:start')({sender}, {jobId:'r1',videoPath:'/tmp/source.mp4',engine:'remotion',snapshot})
      .then(async result => {
        const rejected = [];
        for (const engine of [undefined, 'legacy']) rejected.push(await handlers.get('video-export:start')(
          {sender}, {jobId:'old-route',videoPath:'/tmp/source.mp4',engine,recipe:{}}));
        process.stdout.write('REMOTION_ROUTE='+JSON.stringify({result,received,legacy,rejected,dialogs})+'\\n');
      });
  `;
  const value = runMainProbe(script, 'REMOTION_ROUTE');
  assert.equal(value.result.status, 'completed');
  assert.equal(value.legacy.length, 0);
  assert.equal(value.received.length, 1);
  assert.deepEqual(value.received[0].snapshot, { document: { revision: 7 }, graph: { documentRevision: 7 } });
  assert.equal(value.dialogs, 1);
  assert.deepEqual(value.rejected.map(result => result.errorCode),
    ['EXPORT_UNSUPPORTED_OPERATION', 'EXPORT_UNSUPPORTED_OPERATION']);
});

test('preview accepts only local regular files and only the newest overlapping request retains its session', () => {
  const script = `
    const {EventEmitter}=require('node:events'), Module=require('node:module');
    const handlers=new Map(), app=new EventEmitter();
    app.isPackaged=false; app.getPath=()=>'/isolated-user-data'; app.whenReady=()=>new Promise(()=>{}); app.quit=()=>{};
    class BrowserWindow {static fromWebContents(){return null;}}
    const electron={app,BrowserWindow,dialog:{},ipcMain:{handle(n,f){handlers.set(n,f);}}};
    const closed=[]; let count=0, probes=0;
    const original=Module._load;
    Module._load=function(request,parent,isMain){
      if(request==='electron') return electron;
      if(request==='./src/remotion-assets') return {createRenderAssetSession:async()=>{
        const id=++count; return {assets:{p:{src:'http://127.0.0.1:9000/'+id}},close:async()=>closed.push(id)};
      }};
      if(request==='./src/remotion-export') return {readMediaFacts:async()=>{probes++;return {width:640,height:360,duration:4,fps:24,hasAudio:false};}};
      return original.call(this,request,parent,isMain);
    };
    const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'srt-preview-race-test-'));
    const videoPath=path.join(dir,'video.mp4'); fs.writeFileSync(videoPath,'test');
    const document={schemaVersion:1,projectId:'p',revision:0,timeline:{duration:4,canvas:{width:640,height:360}},
      sources:[{id:'main-video',assetId:'p',kind:'video',range:{start:0,end:4}}],edits:[]};
    const graph=require(${JSON.stringify(path.join(projectRoot, 'src/render-graph'))}).createRenderGraphCompiler().compile(document);
    require(${JSON.stringify(mainPath)}).startApplication({
      environmentModule:{getRemotionTools:async()=>({ffprobePath:'/fake/probe'}),
        getExportTools:async()=>{throw new Error('old FFmpeg filters must not gate preview');},
        detectEnvironment(){},describeInstall(){},installTool(){}},
      localCliService:{},subtitleService:{},videoExportService:{},showSaveDialog(){}
    });
    const sender=new EventEmitter(); sender.id=1; sender.isDestroyed=()=>false;
    const prepare=handlers.get('remotion:prepare-preview');
    Promise.all([prepare({sender},{videoPath,snapshot:{document,graph}}),prepare({sender},{videoPath,snapshot:{document,graph}})])
      .then(async results=>{
        const beforeRelease=closed.slice();
        await handlers.get('remotion:release-preview')({sender},results[1].sessionId);
        const invalid=[];
        for(const invalidPath of ['https://example.invalid/video.mp4',dir]) {
          invalid.push(await prepare({sender},{videoPath:invalidPath,snapshot:{document,graph}}));
        }
        fs.rmSync(dir,{recursive:true,force:true});
        process.stdout.write('PREVIEW_RACE='+JSON.stringify({ok:results.map(r=>r.ok),beforeRelease,closed,invalid,probes})+'\\n');
      });
  `;
  const value = runMainProbe(script, 'PREVIEW_RACE');
  assert.deepEqual(value.ok, [false, true]);
  assert.deepEqual(value.beforeRelease, [1]);
  assert.deepEqual(value.closed, [1, 2]);
  assert.deepEqual(value.invalid, [
    { ok: false, errorCode: 'EXPORT_INVALID_MEDIA' },
    { ok: false, errorCode: 'EXPORT_INVALID_MEDIA' }
  ]);
  assert.equal(value.probes, 2);
});

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
      getState() {}, rescan() {}, select() {}, translateInstruction() {}
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
      getState() {}, rescan() {}, select() {}, translateInstruction() {}
    };
    require(${JSON.stringify(mainPath)}).startApplication({
      remotionEnabled: false,
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
