# Local CLI Detection and Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Detect only locally usable Codex CLI, Claude Code, and Gemini CLI, and preserve an explicit optional local default without running it for video work.

**Architecture:** A focused main-process scanner owns fixed definitions, path verification, and version probes. A preference service owns scan-validated JSON selection. Existing Electron main, preload, and environment page expose only state, rescan, and selection. E2E uses temporary userData and fixture paths.

**Tech Stack:** Electron, Node.js CommonJS, node:test, Playwright Electron, existing npm scripts.

## Global Constraints

- Support exactly codex, claude, and gemini, in that order; no registry, authentication, installation, models, invocation, SSE, or more CLIs.
- Return only id, label, available, and selectedCliId; no paths, versions, command output, environment, tokens, installation, models, or execution fields.
- Never auto-select, auto-switch, or block Continue navigation.
- Scan PATH plus only approved fixed directories; never recurse. Probe only fixed --version, 3,000 ms, 64 KiB, shell false.
- Validate symbolic-link final targets with lstat, realpath, stat, and macOS X_OK, but run the original absolute candidate entry.
- Windows only considers PATHEXT intersection .COM/.EXE/.BAT/.CMD, no extensionless file. Batch uses absolute ComSpec/cmd.exe, /d /s /c, windowsVerbatimArguments true, shell false, and quoteCmdArgument.
- Never add, edit, delete, clean, or commit the existing untracked .superpowers directory.

---

## File structure mapping

| File | Action | Responsibility |
| --- | --- | --- |
| src/local-cli/scanner.js | Create | Fixed catalog, discovery/validation, native and batch version probes. |
| src/local-cli/index.js | Create | JSON default persistence and scan-validated state. |
| tests/local-cli-scanner.test.js | Create | Scanner, link, PATHEXT, and quoting tests. |
| tests/local-cli-selection.test.js | Create | Explicit selection, persistence, invalidation tests. |
| main.js | Modify | Create service from userData and register narrow handlers. |
| preload.js | Modify | Expose exactly three local-CLI calls. |
| tests/main-entry.test.js | Modify | Handler and preload boundary assertions. |
| app/环境检测.html | Modify | Local CLI region and stable test IDs. |
| app/env-check.js | Modify | Render, rescan, explicit selection, and error states. |
| tests/e2e/electron.fixture.js | Modify | Temporary CLI fixture PATH, userData reuse, restart. |
| tests/e2e/electron-main.js | Modify | Controlled outer scanner dependencies and counters. |
| tests/e2e/local-cli-flow.spec.js | Create | Real Electron user journeys. |
| docs/DEVELOPMENT_LOG.md | Modify | Existing delivery record. |
| docs/PROJECT_STATUS.md | Modify | Existing approved-stage status. |

### Task 1: Fixed scanner and safe version probes

**Files:**
- Create: src/local-cli/scanner.js
- Create: tests/local-cli-scanner.test.js

**Interfaces:**
- Produces CLI_DEFINITIONS, quoteCmdArgument(value), and createLocalCliScanner(dependencies).
- scanner.scan() returns Promise of ordered objects shaped { id, label }.

- [ ] **Step 1: Write failing unit tests**

~~~js
test('returns only successful fixed definitions in stable order', async () => {
  const calls = [];
  const scanner = createLocalCliScanner({
    platform: 'darwin', env: { PATH: '/tools' }, homeDir: '/home/a',
    fsApi: fixture({ '/tools/codex': 'file', '/tools/gemini': 'file' }),
    runNative: async (path, args, options) => { calls.push({ path, args, options }); return {}; },
    runBatch: async () => {}
  });
  assert.deepEqual(await scanner.scan(), [
    { id: 'codex', label: 'Codex CLI' }, { id: 'gemini', label: 'Gemini CLI' }
  ]);
  assert.deepEqual(calls.map((x) => [x.path, x.args, x.options]), [
    ['/tools/codex', ['--version'], { timeoutMs: 3000, maxBuffer: 65536, shell: false }],
    ['/tools/gemini', ['--version'], { timeoutMs: 3000, maxBuffer: 65536, shell: false }]
  ]);
});
test('validates a link target but probes the original macOS link', async () => {
  const seen = [];
  const scanner = createLocalCliScanner({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/h',
    fsApi: fixture({ '/bin/codex': { link: '/store/codex' }, '/store/codex': 'file' }),
    runNative: async (candidate) => { seen.push(candidate); return {}; }, runBatch: async () => {}
  });
  assert.deepEqual(await scanner.scan(), [{ id: 'codex', label: 'Codex CLI' }]);
  assert.deepEqual(seen, ['/bin/codex']);
});
test('rejects dangling and non-file symbolic-link targets', async () => {
  for (const target of ['missing', 'directory', 'device', 'fifo']) {
    const scanner = createLocalCliScanner({ platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/h',
      fsApi: fixture({ '/bin/codex': { link: '/target' }, '/target': target }),
      runNative: async () => { throw new Error('must not run'); }, runBatch: async () => {} });
    assert.deepEqual(await scanner.scan(), []);
  }
});
test('runs a cmd candidate through controlled cmd arguments', async () => {
  const batch = [];
  const scanner = createLocalCliScanner({ platform: 'win32',
    env: { Path: 'C:\\Tool & ^ % Space', PATHEXT: '.EXE;.CMD' },
    fsApi: fixture({ 'C:\\Tool & ^ % Space\\codex.cmd': 'file' }),
    comSpecPath: 'C:\\Windows\\System32\\cmd.exe',
    runNative: async () => { throw new Error('no native candidate'); },
    runBatch: async (program, args, options) => { batch.push({ program, args, options }); return {}; }
  });
  await scanner.scan();
  assert.deepEqual(batch[0].args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(batch[0].options.windowsVerbatimArguments, true);
  assert.equal(batch[0].options.shell, false);
  assert.match(batch[0].args[3], /^"/);
});
~~~

- [ ] **Step 2: Verify RED**

Run: node --test tests/local-cli-scanner.test.js

Expected: FAIL because src/local-cli/scanner.js does not exist.

- [ ] **Step 3: Implement minimum scanner**

~~~js
const nodePath = require('node:path');
const CLI_DEFINITIONS = [
  { id: 'codex', label: 'Codex CLI', command: 'codex' },
  { id: 'claude', label: 'Claude Code', command: 'claude' },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini' }
];
const PROBE = { timeoutMs: 3000, maxBuffer: 65536, shell: false };
function quoteCmdArgument(value) {
  const text = String(value);
  return /[\s"&<>|^%]/.test(text) ? '"' + text.replace(/"/g, '""').replace(/%/g, '"^%"') + '"' : text;
}
function createLocalCliScanner(deps) {
  const path = deps.platform === 'win32' ? nodePath.win32 : nodePath.posix;
  const extensions = deps.platform === 'win32'
    ? (deps.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((x) => x.toUpperCase()).filter((x) => ['.COM', '.EXE', '.BAT', '.CMD'].includes(x))
    : [''];
  async function valid(candidate) {
    try {
      const first = await deps.fsApi.lstat(candidate);
      const finalPath = first.isSymbolicLink() ? await deps.fsApi.realpath(candidate) : candidate;
      if (!(await deps.fsApi.stat(finalPath)).isFile()) return false;
      if (deps.platform !== 'win32') await deps.fsApi.access(finalPath, deps.xOk);
      return true;
    } catch (_) { return false; }
  }
  async function probe(candidate) {
    if (deps.platform === 'win32' && ['.CMD', '.BAT'].includes(path.extname(candidate).toUpperCase())) {
      const inner = quoteCmdArgument(candidate) + ' ' + quoteCmdArgument('--version');
      return deps.runBatch(deps.comSpecPath, ['/d', '/s', '/c', '"' + inner + '"'], { ...PROBE, windowsVerbatimArguments: true });
    }
    return deps.runNative(candidate, ['--version'], PROBE);
  }
  return { async scan() {
    const pathKey = deps.platform === 'win32' ? Object.keys(deps.env).find((key) => key.toLowerCase() === 'path') : 'PATH';
    const separator = deps.platform === 'win32' ? ';' : ':';
    const base = String(deps.env[pathKey] || '').split(separator).filter(Boolean);
    const fixed = deps.platform === 'win32'
      ? [deps.env.APPDATA && path.join(deps.env.APPDATA, 'npm'), deps.env.LOCALAPPDATA && path.join(deps.env.LOCALAPPDATA, 'Programs', 'nodejs'), deps.env.ProgramFiles && path.join(deps.env.ProgramFiles, 'nodejs'), deps.env['ProgramFiles(x86)'] && path.join(deps.env['ProgramFiles(x86)'], 'nodejs')]
      : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', deps.homeDir && path.join(deps.homeDir, '.local', 'bin')];
    const dirs = [...base, ...fixed.filter(Boolean)].filter((x, i, all) => all.indexOf(x) === i);
    const result = [];
    for (const item of CLI_DEFINITIONS) {
      const candidates = dirs.flatMap((dir) => extensions.map((ext) => path.join(dir, item.command + ext)));
      if (deps.platform === 'darwin' && item.id === 'codex') candidates.push('/Applications/Codex.app/Contents/Resources/codex', path.join(deps.homeDir || '', 'Applications/Codex.app/Contents/Resources/codex'));
      for (const candidate of candidates) try { if (await valid(candidate)) { await probe(candidate); result.push({ id: item.id, label: item.label }); break; } } catch (_) {}
    }
    return result;
  } };
}
module.exports = { CLI_DEFINITIONS, createLocalCliScanner, quoteCmdArgument };
~~~

Place this complete helper above the tests; its fixture platform paths intentionally match the scanner's deps.platform path implementation.

~~~js
function fixture(entries) {
  function missing() { const error = new Error('missing'); error.code = 'ENOENT'; throw error; }
  function entry(name) { if (!Object.prototype.hasOwnProperty.call(entries, name) || entries[name] === 'missing') missing(); return entries[name]; }
  function statFor(value) { return { isFile: () => value === 'file', isSymbolicLink: () => Boolean(value && value.link) }; }
  return { constants: { X_OK: 1 },
    async lstat(name) { return statFor(entry(name)); },
    async realpath(name) { const value = entry(name); if (!value || !value.link) return name; return value.link; },
    async stat(name) { return statFor(entry(name)); },
    async access(name, mode) { assert.equal(mode, 1); if (!(await this.stat(name)).isFile()) missing(); }
  };
}
~~~

- [ ] **Step 4: Verify GREEN and regression**

Run: node --test tests/local-cli-scanner.test.js && npm run test:unit

Expected: PASS. A failed candidate has no effect on other successful items.

- [ ] **Step 5: Commit this slice**

~~~bash
git add src/local-cli/scanner.js tests/local-cli-scanner.test.js
git commit -m "feat: add local CLI scanner"
~~~

### Task 2: Scan-validated default persistence

**Files:**
- Create: src/local-cli/index.js
- Create: tests/local-cli-selection.test.js

**Interfaces:**
- Consumes scanner.scan().
- Produces createLocalCliService({ scanner, fsApi, preferencePath }) with getState(), rescan(), select(id).

- [ ] **Step 1: Write failing tests**

~~~js
test('requires explicit selection and persists after a restart', async () => {
  const fsApi = memoryFile();
  const scanner = sequence([[{ id: 'codex', label: 'Codex CLI' }, { id: 'claude', label: 'Claude Code' }]]);
  const first = createLocalCliService({ scanner, fsApi, preferencePath: '/tmp/local-cli.json' });
  assert.equal((await first.getState()).selectedCliId, null);
  assert.equal((await first.select('claude')).selectedCliId, 'claude');
  const second = createLocalCliService({ scanner, fsApi, preferencePath: '/tmp/local-cli.json' });
  assert.equal((await second.getState()).selectedCliId, 'claude');
});
test('clears a disappeared selection and never selects remaining Codex', async () => {
  const service = createLocalCliService({ scanner: sequence([[{ id: 'codex', label: 'Codex CLI' }]]),
    fsApi: memoryFile({ selectedCliId: 'claude' }), preferencePath: '/tmp/local-cli.json' });
  assert.equal((await service.rescan()).selectedCliId, null);
});
test('rejects unavailable id without overwriting current selection', async () => {
  const service = createLocalCliService({ scanner: sequence([[{ id: 'codex', label: 'Codex CLI' }]]),
    fsApi: memoryFile({ selectedCliId: 'codex' }), preferencePath: '/tmp/local-cli.json' });
  await assert.rejects(() => service.select('gemini'), { code: 'LOCAL_CLI_NOT_AVAILABLE' });
  assert.equal((await service.getState()).selectedCliId, 'codex');
});
~~~

- [ ] **Step 2: Verify RED**

Run: node --test tests/local-cli-selection.test.js

Expected: FAIL because src/local-cli/index.js does not exist.

- [ ] **Step 3: Implement service**

~~~js
const path = require('node:path');
function persistenceError() { const error = new Error('Cannot persist local CLI preference'); error.code = 'LOCAL_CLI_PERSIST_FAILED'; return error; }
function createLocalCliService({ scanner, fsApi, preferencePath }) {
  async function read() { try { const json = JSON.parse(await fsApi.readFile(preferencePath, 'utf8')); return ['codex', 'claude', 'gemini'].includes(json.selectedCliId) ? json.selectedCliId : null; } catch (_) { return null; } }
  async function write(selectedCliId) {
    const temp = preferencePath + '.tmp';
    try { await fsApi.mkdir(path.dirname(preferencePath), { recursive: true }); await fsApi.writeFile(temp, JSON.stringify({ selectedCliId }), 'utf8'); await fsApi.rename(temp, preferencePath); }
    catch (_) { throw persistenceError(); }
  }
  async function state(requested) {
    const available = await scanner.scan(); let selectedCliId = await read();
    if (selectedCliId && !available.some((item) => item.id === selectedCliId)) { selectedCliId = null; await write(null); }
    if (requested !== undefined) {
      if (!available.some((item) => item.id === requested)) { const error = new Error('Selected local CLI is unavailable'); error.code = 'LOCAL_CLI_NOT_AVAILABLE'; throw error; }
      selectedCliId = requested; await write(selectedCliId);
    }
    return { available, selectedCliId };
  }
  return { getState: () => state(), rescan: () => state(), select: (id) => state(id) };
}
module.exports = { createLocalCliService };
~~~

Put these complete test helpers before the Task 2 tests:

~~~js
function sequence(results) { let index = 0; return { scan: async () => results[Math.min(index++, results.length - 1)] }; }
function memoryFile(initial = null) { let text = initial ? JSON.stringify(initial) : null; return {
  async readFile() { if (text === null) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } return text; },
  async mkdir() {}, async writeFile(_path, value) { text = value; }, async rename() {}
}; }
~~~

- [ ] **Step 4: Verify GREEN and commit**

Run: node --test tests/local-cli-selection.test.js && npm run test:unit

Expected: PASS; corrupt/missing preference is null, and write failure exposes LOCAL_CLI_PERSIST_FAILED only.

~~~bash
git add src/local-cli/index.js tests/local-cli-selection.test.js
git commit -m "feat: persist selected local CLI"
~~~

### Task 3: Narrow main-process and preload bridge

**Files:**
- Modify: main.js:1-18, 142-166
- Modify: preload.js:1-23
- Modify: tests/main-entry.test.js:1-120
- Modify: src/local-cli/scanner.js:1-90

**Interfaces:**
- Produces handlers local-cli:get-state, local-cli:rescan, local-cli:select and window.srtAPI methods getLocalCliState(), rescanLocalCli(), selectLocalCli(id).

- [ ] **Step 1: Add failing bridge tests**

~~~js
assert.deepEqual(localHandlers.sort(), ['local-cli:get-state', 'local-cli:rescan', 'local-cli:select']);
assert.match(preloadSource, /getLocalCliState: \(\) => ipcRenderer\.invoke\('local-cli:get-state'\)/);
assert.equal(preloadSource.includes('local-cli:exec'), false);
assert.equal(preloadSource.includes('local-cli:path'), false);
~~~

- [ ] **Step 2: Verify RED**

Run: node --test tests/main-entry.test.js

Expected: FAIL because no local-cli handler is registered.

- [ ] **Step 3: Implement bridge and production adapter**

~~~js
// main.js requires
const { createLocalCliScanner, createProductionLocalCliDependencies } = require('./src/local-cli/scanner');
const { createLocalCliService } = require('./src/local-cli');
// change signature to function startApplication({ environmentModule, localCliService: injectedLocalCliService } = {})
// inside startApplication after userDataDir
const localCliService = injectedLocalCliService || createLocalCliService({
  scanner: createLocalCliScanner(createProductionLocalCliDependencies({ userDataDir })),
  fsApi: fs.promises, preferencePath: path.join(userDataDir, 'local-cli.json')
});
ipcMain.handle('local-cli:get-state', () => localCliService.getState());
ipcMain.handle('local-cli:rescan', () => localCliService.rescan());
ipcMain.handle('local-cli:select', (_event, id) => localCliService.select(id));
~~~

Add this complete shared runner and production dependency adapter to scanner.js; both native and batch paths call it. ComSpec must be an absolute existing ordinary file, otherwise Windows batch candidates fail closed.

~~~js
const childProcess = require('node:child_process'); const fs = require('node:fs'); const os = require('node:os');
function createLimitedRunner(spawnImpl = childProcess.spawn) { return (program, args, options) => new Promise((resolve, reject) => {
  let total = 0; let done = false; const child = spawnImpl(program, args, { shell: false, windowsHide: true, windowsVerbatimArguments: Boolean(options.windowsVerbatimArguments) });
  const finish = (error) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve({}); };
  const fail = (code) => { const error = new Error(code); error.code = code; try { child.kill(); } finally { finish(error); } };
  const capture = (chunk) => { total += Buffer.byteLength(chunk); if (total > 65536) fail('ENOBUFS'); };
  child.once('error', (error) => finish(error)); child.stdout.on('data', capture); child.stderr.on('data', capture);
  child.once('close', (code) => { if (!done) code === 0 ? finish() : fail('ECOMMAND'); });
  const timer = setTimeout(() => fail('ETIMEDOUT'), 3000);
}); }
function createProductionLocalCliDependencies() {
  const comSpec = process.env.ComSpec;
  const validComSpec = process.platform !== 'win32' ? null : (typeof comSpec === 'string' && nodePath.win32.isAbsolute(comSpec) && fs.existsSync(comSpec) && fs.statSync(comSpec).isFile() ? comSpec : null);
  return { platform: process.platform, env: process.env, homeDir: os.homedir(), fsApi: fs.promises, xOk: fs.constants.X_OK,
    runNative: createLimitedRunner(), runBatch: async (program, args, options) => { if (!validComSpec || program !== validComSpec) { const error = new Error('invalid ComSpec'); error.code = 'ENOENT'; throw error; } return createLimitedRunner()(program, args, options); }, comSpecPath: validComSpec };
}
~~~

~~~js
// preload.js inside existing window.srtAPI object
getLocalCliState: () => ipcRenderer.invoke('local-cli:get-state'),
rescanLocalCli: () => ipcRenderer.invoke('local-cli:rescan'),
selectLocalCli: (id) => ipcRenderer.invoke('local-cli:select', id),
~~~

- [ ] **Step 4: Verify GREEN and commit**

Run: node --test tests/main-entry.test.js && npm run test:unit

Expected: PASS and no change to cli:exec, AI, or installation channels.

~~~bash
git add main.js preload.js tests/main-entry.test.js src/local-cli/scanner.js
git commit -m "feat: expose local CLI selection IPC"
~~~

### Task 4: Optional environment-page selection UI

**Files:**
- Modify: app/环境检测.html:124-218
- Modify: app/env-check.js:1-423
- Create: tests/e2e/local-cli-flow.spec.js

**Interfaces:**
- Consumes the three window.srtAPI local-CLI methods.
- Produces test IDs local-cli-section, local-cli-results, local-cli-rescan, and local-cli-{id}.

- [ ] **Step 1: Write the initial failing E2E UI assertion**

Create tests/e2e/local-cli-flow.spec.js with:

~~~js
const { test, expect } = require('./electron.fixture');
test('environment page has a local CLI section', async ({ window }) => {
  await expect(window.getByTestId('local-cli-section')).toBeVisible();
  await expect(window.getByTestId('local-cli-results')).toBeVisible();
  await expect(window.getByTestId('local-cli-rescan')).toBeVisible();
});
~~~

This UI is intentionally verified through real Electron, preload, and renderer rather than a DOM mock.

- [ ] **Step 2: Verify RED**

Run: npx playwright test tests/e2e/local-cli-flow.spec.js

Expected: FAIL because the local-CLI test IDs do not exist.

- [ ] **Step 3: Add markup and renderer functions**

~~~html
<section data-testid="local-cli-section" aria-labelledby="local-cli-title">
  <h2 id="local-cli-title">本地 CLI</h2>
  <p>目前仅支持 Codex CLI、Claude Code 和 Gemini CLI。</p>
  <div data-testid="local-cli-results" aria-live="polite"></div>
  <div data-testid="local-cli-feedback" aria-live="polite"></div>
  <button type="button" data-testid="local-cli-rescan">重新扫描</button>
</section>
~~~

~~~js
var localCliResults = document.querySelector('[data-testid="local-cli-results"]');
var localCliFeedback = document.querySelector('[data-testid="local-cli-feedback"]');
function setLocalCliLoading() { localCliFeedback.textContent = ''; localCliResults.textContent = '正在扫描本地 CLI…'; }
function renderLocalCli(state) {
  if (!state.available.length) { localCliResults.textContent = '未扫描到可用本地 CLI'; return; }
  localCliResults.innerHTML = state.available.map(function(item) {
    return '<button type="button" data-testid="local-cli-' + item.id + '" data-cli-id="' + item.id + '">' +
      escapeText(item.label) + (item.id === state.selectedCliId ? ' 已选为默认' : ' 可用') + '</button>';
  }).join('');
}
function loadLocalCli(rescan) {
  setLocalCliLoading();
  if (!window.srtAPI) { localCliResults.textContent = '本地 CLI 扫描失败，请重新扫描。'; return Promise.resolve(); }
  return (rescan ? window.srtAPI.rescanLocalCli() : window.srtAPI.getLocalCliState()).then(renderLocalCli)
    .catch(function() { localCliResults.textContent = '本地 CLI 扫描失败，请重新扫描。'; });
}
document.querySelector('[data-testid="local-cli-rescan"]').addEventListener('click', function() { loadLocalCli(true); });
localCliResults.addEventListener('click', function(event) {
  var button = event.target.closest('[data-cli-id]'); if (!button) return;
  window.srtAPI.selectLocalCli(button.dataset.cliId).then(renderLocalCli).catch(function() {
    localCliFeedback.textContent = '所选 CLI 当前不可用，请重新扫描。';
    setTimeout(function() { loadLocalCli(false); }, 0);
  });
});
loadLocalCli(false);
~~~

Keep existing Continue enabled and its navigation listener unchanged. Do not add unavailable cards, installation, login, model, run, or test-command controls.

- [ ] **Step 4: Verify GREEN and commit**

Run: npx playwright test tests/e2e/local-cli-flow.spec.js && npm run test:e2e

Expected: PASS; only success cards render and empty/error/unselected states still reach home.

~~~bash
git add app/环境检测.html app/env-check.js tests/e2e/local-cli-flow.spec.js
git commit -m "feat: render optional local CLI selection"
~~~

### Task 5: Full Electron E2E with temporary fixture CLIs

**Files:**
- Modify: tests/e2e/electron.fixture.js
- Modify: tests/e2e/electron-main.js
- Modify: tests/e2e/local-cli-flow.spec.js
- Modify: package.json:6-10

**Interfaces:**
- Uses real scanner, service, handlers, preload, and renderer.
- E2E state exposes localCliCalls with native, batch, cliExec, ai, installation counts for assertions only.

- [ ] **Step 1: Write failing journeys**

~~~js
const { test, expect } = require('./electron.fixture');
test.describe('local CLI journeys', () => {
  test.use({ scenario: 'local-cli-two' });
  test('shows only successful entries, persists explicit choice, and remains optional', async ({ window, restartElectron }) => {
    await expect(window.getByTestId('local-cli-codex')).toContainText('Codex CLI 可用');
    await expect(window.getByTestId('local-cli-claude')).toContainText('Claude Code 可用');
    await expect(window.getByTestId('local-cli-gemini')).toHaveCount(0);
    await window.getByTestId('local-cli-claude').click();
    await expect(window.getByTestId('local-cli-claude')).toContainText('已选为默认');
    const reopened = await restartElectron();
    await expect(reopened.getByTestId('local-cli-claude')).toContainText('已选为默认');
    await reopened.getByTestId('continue').click(); await expect(reopened.getByTestId('home-page')).toBeVisible();
  });
  test('clears missing Claude without selecting remaining Codex', async ({ window, setLocalCliScenario }) => {
    await window.getByTestId('local-cli-claude').click();
    await setLocalCliScenario('local-cli-codex-only');
    await window.getByTestId('local-cli-rescan').click();
    await expect(window.getByTestId('local-cli-claude')).toHaveCount(0);
    await expect(window.getByTestId('local-cli-codex')).not.toContainText('已选为默认');
  });
  test('uses exact empty copy and never invokes unrelated handlers', async ({ window, setLocalCliScenario, readScenarioState }) => {
    await setLocalCliScenario('local-cli-empty'); await window.getByTestId('local-cli-rescan').click();
    await expect(window.getByTestId('local-cli-results')).toHaveText('未扫描到可用本地 CLI');
    await window.getByTestId('continue').click(); await expect(window.getByTestId('home-page')).toBeVisible();
    expect((await readScenarioState()).localCliCalls).toMatchObject({ cliExec: 0, ai: 0, installation: 0 });
  });
});
~~~

- [ ] **Step 2: Verify RED**

Run: npx playwright test tests/e2e/local-cli-flow.spec.js

Expected: FAIL because restartElectron, setLocalCliScenario, and the injected fixture scenario do not yet exist.

- [ ] **Step 3: Implement controlled E2E setup**

Replace the fixture launch helper with a single launch(userDataDir, cliDir, scenario) function that calls electron.launch with PATH set to cliDir plus path.delimiter plus process.env.PATH. In the existing electronContext fixture create cliDir with fs.promises.mkdtemp(path.join(os.tmpdir(), 'srt-local-cli-')), pass it to launch, and add fs.promises.rm(cliDir, { recursive: true, force: true }) to cleanupElectronFixture. Expose restartElectron as async () => { await electronApp.close(); electronApp = await launch(userDataDir, cliDir, scenario); window = await electronApp.firstWindow(); return window; }; expose setLocalCliScenario as async (name) => electronApp.evaluate(({ app }, value) => app.__srtSetLocalCliScenario(value), name). This preserves the real scanner/service/IPC/preload/renderer and changes only outer fixture files/process state.

In electron-main.js import createLocalCliScanner and createLocalCliService, construct localCliService from fixture-backed fs/run dependencies, and call startApplication({ environmentModule, localCliService }). Define app.__srtSetLocalCliScenario = (name) => { state.localCliScenario = name; }; Make each outer runner increment state.localCliCalls.native or batch and return success only when the candidate exists in the current scenario. Wrap the existing cli:exec, AI, and installation handler registrations to increment state.localCliCalls.cliExec, ai, installation before delegating. Never replace scanner.scan, service methods, IPC, preload, or renderer.

Change package.json test:e2e exactly to: "test:e2e": "playwright test tests/e2e/environment-flow.spec.js tests/e2e/local-cli-flow.spec.js".

- [ ] **Step 4: Verify GREEN and E2E regression**

Run: npx playwright test tests/e2e/local-cli-flow.spec.js && npm run test:e2e

Expected: PASS; all fixture paths and userData are temporary.

- [ ] **Step 5: Commit this slice**

~~~bash
git add tests/e2e/electron.fixture.js tests/e2e/electron-main.js tests/e2e/local-cli-flow.spec.js package.json
git commit -m "test: cover local CLI Electron journeys"
~~~

### Task 6: Final acceptance and existing project records

**Files:**
- Modify: docs/DEVELOPMENT_LOG.md
- Modify: docs/PROJECT_STATUS.md

**Interfaces:**
- Consumes actual final output counts; does not create a new record system.

- [ ] **Step 1: Draft record after results are known**

Append a dated local-CLI section to DEVELOPMENT_LOG.md stating: fixed successful-only three-CLI detection; explicit Electron userData default and disappearance clearing; fixed PATH/directory scanning and controlled Windows batch invocation; and the exact unit/E2E outcomes from Step 2.

Replace PROJECT_STATUS.md conclusion with: 2026-09-05 已完成本地 CLI 检测与选择阶段：固定三项发现、显式全局默认值、失效清除、窄 IPC 与 Electron 端到端链路均通过验收。自然语言调用、认证、安装、模型与更多 CLI 仍未开始。 Add those five non-goals to its existing 范围控制 list.

- [ ] **Step 2: Run final acceptance**

Run: npm run test:unit

Expected: PASS, including local-cli-scanner and local-cli-selection tests.

Run: npx playwright test tests/e2e/local-cli-flow.spec.js && npm run test:e2e

Expected: PASS. Do not claim an unrun build, real-Mac smoke, or Windows smoke.

- [ ] **Step 3: Record observed counts and commit only records**

Add the exact passing counts from Step 2 to the record prose; do not write a count until it has been observed.

~~~bash
git add docs/DEVELOPMENT_LOG.md docs/PROJECT_STATUS.md
git commit -m "docs: record local CLI detection delivery"
~~~

- [ ] **Step 4: Verify worktree scope**

Run: git status --short && git log --oneline -6

Expected: task commits are visible; .superpowers remains untracked; no unrelated file is staged or modified.

## Plan self-review

- [ ] Coverage: Task 1 fixes catalog/order, PATH/fixed directories, Codex.app, links, PATHEXT, native/batch command rules, timeout/output/failure isolation; Task 2 handles persistence/invalidation/no auto-select; Task 3 owns IPC/preload; Task 4 owns successful-only UI/exact copy/non-blocking behavior; Task 5 proves full Electron behavior and no unrelated handler calls.
- [ ] Task 6 updates only existing DEVELOPMENT_LOG.md and PROJECT_STATUS.md; no new governance structure is introduced.
- [ ] Scan for TBD, TODO, similar, appropriate, as needed, and undefined interface names; correct every match before commit.
- [ ] Verify all later tasks use createLocalCliScanner, createLocalCliService, getLocalCliState, rescanLocalCli, selectLocalCli, available, and selectedCliId as defined above.

## Execution handoff

## Third-review authoritative corrections

This section supersedes every earlier abbreviated implementation fragment in this plan. The implementation must use `pathApi = platform === 'win32' ? nodePath.win32 : nodePath.posix`; scanner dependencies are `{ platform, env, fsApi, xOk, runNative, runBatch, homeDir, comSpecPath }`. Every macOS fixture passes `xOk: 1`; `fixture(entries, platform)` normalizes keys with `platform === 'win32' ? nodePath.win32.normalize(name).toLowerCase() : nodePath.posix.normalize(name)`, making the `codex.cmd` fixture match PATHEXT-generated `.CMD` candidates. Its full stat contract is `isFile: () => value === 'file'`, `isSymbolicLink: () => Boolean(value.link)`; `realpath` returns `value.link`; unknown entries throw an Error with `code = 'ENOENT'`.

The cmd assertion is exact: `assert.equal(batch[0].args[3], '""C:\\Tool "^&" "^^" "^%" Space\\codex.cmd" --version"')`; the Windows actual-launch test is `test('cmd launches', { skip: process.platform !== 'win32' }, async () => { /* use a temp .cmd that exits 0 */ })`, and it must never be counted as a macOS smoke result. Scanner RED coverage additionally creates tests for fixed Homebrew/local/Codex.app paths, missing PATHEXT defaults, a failed codex candidate followed by successful claude, ETIMEDOUT, ENOBUFS, and ECOMMAND.

`createLimitedRunner({ spawnImpl, env })` must pass `env`, create `let timer = null` before child listeners, count `Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)`, call `child.kill('SIGKILL')` exactly once for timeout/overflow/nonzero, and reject respectively with codes ETIMEDOUT, ENOBUFS, ECOMMAND. Its test injects an EventEmitter child with stdout/stderr EventEmitters and asserts kill signal, combined 65537 bytes, and timeout. `createProductionLocalCliDependencies({ platform = process.platform, env = process.env, fsApi = fs.promises, spawnImpl = childProcess.spawn, homeDir = os.homedir() })` passes `xOk: fs.constants.X_OK`; it reads `env.ComSpec || env.COMSPEC`, accepts it only when win32.isAbsolute and synchronous lstat confirms a regular non-link file, otherwise batch probes reject ENOENT.

Task 3 creates `tests/local-cli-ipc.test.js` instead of undefined localHandlers/preloadSource. Its helper stubs Electron via Module._load, captures `ipcMain.handle(name, fn)` in a Map, calls `startApplication({ environmentModule: fakeEnvironment, localCliService })`, asserts all three names, invokes each captured function and asserts delegation to getState/rescan/select, then reads preload.js with `fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8')` and asserts exactly the three invoke strings. `startApplication` has the sole injection signature `({ environmentModule, localCliService: injectedLocalCliService } = {})`; production creation is only the fallback. Task 3 files and commit include this test.

Task 5 uses a separate `localCliScenario` fixture option, never the existing environment `scenario`: every test declares `test.use({ scenario: 'mac-ready', localCliScenario: 'local-cli-two' })`. Its fixture launch function owns temp userData and cliDir, registers diagnostics after every launch, waits for environment-page loaded, and updates electronApp/window after restart. E2E injects the real scanner and service through Task 3's localCliService parameter; its outer fs API returns ENOENT for every non-fixture PATH/fixed directory, and outer runners only accept fixture paths. Before requiring main, the E2E entry wraps `ipcMain.handle` and increments counters for cli:exec, ai:config:query, ai:ollama:detect, ai:translate:cloud, ai:translate:ollama, installation:describe, and installation:execute before delegating. package.json is included in Task 5 and changes test:e2e to `playwright test tests/e2e/environment-flow.spec.js tests/e2e/local-cli-flow.spec.js`.

Plan complete and saved to docs/superpowers/plans/2026-09-05-local-cli-detection.md. Two execution options:

1. Subagent-Driven (recommended) — dispatch a fresh subagent per task and review between tasks.
2. Inline Execution — execute in this session using executing-plans, in batches with review checkpoints.
