# Local CLI Detection and Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect the fixed Codex CLI, Claude Code, and Gemini CLI catalog and let the user explicitly save one optional local default.

**Architecture:** Add one small CommonJS module that owns the fixed scan and scan-validated preference state. `main.js` exposes its three narrow operations through the existing Electron pattern; `preload.js` exposes matching methods; the existing environment page renders only returned successful results. Reuse `node:test` and the current Playwright Electron fixture—no framework or lifecycle expansion.

**Tech Stack:** Electron 33, Node.js CommonJS and built-in `fs`/`child_process`, `node:test`, Playwright Electron.

## Global Constraints

- Support only `codex`, `claude`, and `gemini`, in that order; probe each candidate only with fixed `--version` and a short fixed timeout.
- Search ordinary `PATH` plus a few fixed common directories; do not recurse or accept user paths, commands, or registry entries.
- Render only successful results. The exact empty result is `未扫描到可用本地 CLI`; display `目前仅支持 Codex CLI、Claude Code 和 Gemini CLI。`.
- Selection is explicit and global: persist `selectedCliId`, never auto-select or auto-switch, and clear it when the selected CLI is absent from a later scan.
- CLI detection/selection never blocks the existing Continue navigation or other SRTP use.
- macOS is the manual verification target. Keep only a minimal `Path`/`PATHEXT` Windows branch with focused unit coverage; no Windows E2E or platform-grade claim.
- Do not implement CLI invocation, natural-language translation, Remotion integration, installation/login/model UI, generic platform/plugin design, combined-stream runner, atomic writes, exhaustive Windows quoting, special-file/link validation, dynamic/restart harnesses, handler-call assertions, or unrelated refactors.
- Time limit: visible page checkpoint by 60–90 minutes, hard stop at 3 hours, support work at most 25%; if support work exceeds twice its estimate, stop and report. Once acceptance passes, stop.
- Preserve the untracked `.superpowers/` directory completely.

---

## Current file mapping

| File | Action | Responsibility |
| --- | --- | --- |
| `src/local-cli.js` | Create | Fixed catalog, ordinary path candidate scan, fixed probe, and simple preference state. |
| `tests/local-cli.test.js` | Create | Scanner and explicit-selection unit tests, including minimal Windows path/extension behavior. |
| `main.js` | Modify | Construct the local CLI service from Electron `userData` and register three IPC handlers. |
| `preload.js` | Modify | Add three fixed local-CLI bridge methods to the existing `srtAPI`. |
| `tests/main-entry.test.js` | Modify | Assert the main entry registers the new channels and preload source has only the narrow calls. |
| `app/环境检测.html` | Modify | Add a small local CLI region after existing environment information. |
| `app/env-check.js` | Modify | Load, render, rescan, and explicitly select through the bridge without changing Continue behavior. |
| `tests/e2e/electron-main.js` | Modify | Inject a deterministic local CLI service into the existing Electron E2E entry. |
| `tests/e2e/electron.fixture.js` | Modify | Add one optional fixed local-CLI mode and pass it as an Electron environment variable. |
| `tests/e2e/local-cli-flow.spec.js` | Create | Exactly one empty-state E2E and one choose-and-persist E2E. |
| `package.json` | Modify | Include the new E2E file in the existing `test:e2e` script. |

### Task 1: Fixed scanner and explicit persisted state

**Files:**
- Create: `src/local-cli.js`
- Create: `tests/local-cli.test.js`

**Interfaces:**
- Produces `CLI_DEFINITIONS`, `createLocalCliService(options)`.
- `createLocalCliService({ platform, env, homeDir, userDataDir, fsApi, run })` returns `{ getState(), rescan(), select(id) }`.
- Each returned state is `{ available: Array<{id: string, label: string}>, selectedCliId: string|null }`.

- [ ] **Step 1: Write failing unit tests for fixed results and selection invalidation**

```js
test('returns only successful fixed CLIs in catalog order', async () => {
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi: fakeFs(['/bin/codex', '/bin/gemini']), run: async () => ({ exitCode: 0 })
  });
  assert.deepEqual((await service.getState()).available, [
    { id: 'codex', label: 'Codex CLI' }, { id: 'gemini', label: 'Gemini CLI' }
  ]);
  assert.equal((await service.getState()).selectedCliId, null);
});

test('persists only an explicit available selection and clears a missing one', async () => {
  const fsApi = fakeFs(['/bin/codex', '/bin/claude']);
  const service = createLocalCliService({ platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs', fsApi, run: async () => ({ exitCode: 0 }) });
  assert.equal((await service.select('claude')).selectedCliId, 'claude');
  fsApi.remove('/bin/claude');
  assert.equal((await service.rescan()).selectedCliId, null);
  await assert.rejects(() => service.select('gemini'), { code: 'LOCAL_CLI_NOT_AVAILABLE' });
});

test('uses Windows Path and PATHEXT only as a minimal compatibility branch', async () => {
  const calls = [];
  const service = createLocalCliService({ platform: 'win32', env: { Path: 'C:\\tools', PATHEXT: '.EXE;.CMD' }, homeDir: '', userDataDir: 'C:\\prefs', fsApi: fakeFs(['C:\\tools\\codex.EXE']), run: async (file, args) => { calls.push([file, args]); return { exitCode: 0 }; } });
  assert.deepEqual((await service.getState()).available, [{ id: 'codex', label: 'Codex CLI' }]);
  assert.deepEqual(calls, [['C:\\tools\\codex.EXE', ['--version']]]);
});
```

- [ ] **Step 2: Run the focused unit test (RED)**

Run: `node --test tests/local-cli.test.js`

Expected: FAIL with `Cannot find module '../src/local-cli'`.

- [ ] **Step 3: Implement the smallest service and built-in probe**

```js
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI_DEFINITIONS = [
  { id: 'codex', label: 'Codex CLI', command: 'codex' },
  { id: 'claude', label: 'Claude Code', command: 'claude' },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini' }
];

function defaultRun(file, args) {
  return new Promise((resolve, reject) => childProcess.execFile(file, args, { timeout: 3000, windowsHide: true },
    (error) => error ? reject(error) : resolve({ exitCode: 0 })));
}

function createLocalCliService({ platform = process.platform, env = process.env, homeDir = os.homedir(), userDataDir, fsApi = fs.promises, run = defaultRun }) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const preferencePath = pathApi.join(userDataDir, 'local-cli.json');
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
  const extensions = platform === 'win32' ? String(env.PATHEXT || '.EXE;.CMD').split(';').filter((item) => /^\.(EXE|CMD)$/i.test(item)) : [''];
  const extras = platform === 'win32'
    ? [env.APPDATA && pathApi.join(env.APPDATA, 'npm'), env.LOCALAPPDATA && pathApi.join(env.LOCALAPPDATA, 'Programs', 'nodejs')]
    : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', homeDir && pathApi.join(homeDir, '.local', 'bin')];
  async function scan() {
    const dirs = String(env[pathKey] || '').split(platform === 'win32' ? ';' : ':').concat(extras).filter(Boolean);
    const available = [];
    for (const definition of CLI_DEFINITIONS) {
      const candidates = dirs.flatMap((dir) => extensions.map((ext) => pathApi.join(dir, definition.command + ext)));
      if (platform === 'darwin' && definition.id === 'codex') candidates.push('/Applications/Codex.app/Contents/Resources/codex', homeDir && pathApi.join(homeDir, 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'));
      for (const file of candidates.filter(Boolean)) {
        try { if ((await fsApi.stat(file)).isFile()) { await run(file, ['--version']); available.push({ id: definition.id, label: definition.label }); break; } } catch (_) {}
      }
    }
    return available;
  }
  async function read() { try { const value = JSON.parse(await fsApi.readFile(preferencePath, 'utf8')).selectedCliId; return CLI_DEFINITIONS.some((item) => item.id === value) ? value : null; } catch (_) { return null; } }
  async function write(selectedCliId) { await fsApi.mkdir(pathApi.dirname(preferencePath), { recursive: true }); await fsApi.writeFile(preferencePath, JSON.stringify({ selectedCliId }), 'utf8'); }
  async function state(requested) { const available = await scan(); let selectedCliId = await read(); if (selectedCliId && !available.some((item) => item.id === selectedCliId)) { selectedCliId = null; await write(null); } if (requested !== undefined) { if (!available.some((item) => item.id === requested)) { const error = new Error('Local CLI unavailable'); error.code = 'LOCAL_CLI_NOT_AVAILABLE'; throw error; } selectedCliId = requested; await write(selectedCliId); } return { available, selectedCliId }; }
  return { getState: () => state(), rescan: () => state(), select: (id) => state(id) };
}
module.exports = { CLI_DEFINITIONS, createLocalCliService };
```

Place this complete fixture above the tests; it deliberately provides only the built-in filesystem surface used by the service:

```js
function fakeFs(files) {
  const entries = new Set(files); let preference = null;
  return {
    async stat(file) { if (!entries.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return { isFile: () => true }; },
    async readFile() { if (preference === null) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return preference; },
    async mkdir() {}, async writeFile(_file, value) { preference = value; },
    remove(file) { entries.delete(file); }
  };
}
```

Do not add a process runner abstraction beyond the injected `run` seam above.

- [ ] **Step 4: Verify GREEN and regression**

Run: `node --test tests/local-cli.test.js && npm run test:unit`

Expected: PASS. The focused test proves no auto-selection, only successful entries, persistence, invalidation, and the minimal Windows branch.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/local-cli.js tests/local-cli.test.js
git commit -m "feat: add fixed local CLI detection"
```

### Task 2: Narrow Electron bridge and visible optional page checkpoint

**Files:**
- Modify: `main.js:1-18,222-250`
- Modify: `preload.js:3-22`
- Modify: `tests/main-entry.test.js`
- Modify: `app/环境检测.html:130-202`
- Modify: `app/env-check.js:1-405`

**Interfaces:**
- `startApplication({ environmentModule, localCliService })` accepts an optional injected service for E2E.
- IPC channels: `local-cli:get-state`, `local-cli:rescan`, `local-cli:select`.
- Preload methods: `getLocalCliState()`, `rescanLocalCli()`, `selectLocalCli(id)`.

- [ ] **Step 1: Write failing bridge/page assertions**

```js
assert.match(mainSource, /ipcMain\.handle\('local-cli:get-state'/);
assert.match(preloadSource, /getLocalCliState: \(\) => ipcRenderer\.invoke\('local-cli:get-state'\)/);
assert.match(preloadSource, /selectLocalCli: \(id\) => ipcRenderer\.invoke\('local-cli:select', id\)/);
assert.equal(preloadSource.includes('local-cli:exec'), false);
```

Add a page-level E2E assertion in Task 3; at this checkpoint, start the app and visually confirm the new static heading, support copy, rescan button, and enabled Continue control appear by 60–90 minutes.

- [ ] **Step 2: Run bridge test (RED)**

Run: `node --test tests/main-entry.test.js`

Expected: FAIL because no `local-cli:*` channel or preload methods exist.

- [ ] **Step 3: Implement the three-channel bridge and local region**

```js
// main.js, beside existing environment construction
const { createLocalCliService } = require('./src/local-cli');
function startApplication({ environmentModule, localCliService } = {}) {
  const userDataDir = app.getPath('userData');
  const activeLocalCliService = localCliService || createLocalCliService({ userDataDir });
  ipcMain.handle('local-cli:get-state', () => activeLocalCliService.getState());
  ipcMain.handle('local-cli:rescan', () => activeLocalCliService.rescan());
  ipcMain.handle('local-cli:select', (_event, id) => activeLocalCliService.select(id));
  // retain existing environment handlers and lifecycle unchanged
}

// preload.js, inside window.srtAPI
getLocalCliState: () => ipcRenderer.invoke('local-cli:get-state'),
rescanLocalCli: () => ipcRenderer.invoke('local-cli:rescan'),
selectLocalCli: (id) => ipcRenderer.invoke('local-cli:select', id),
```

```html
<section class="report-section" data-testid="local-cli-section">
  <div class="mode-label">本地 CLI</div>
  <p>目前仅支持 Codex CLI、Claude Code 和 Gemini CLI。</p>
  <div id="localCliResults" data-testid="local-cli-results" aria-live="polite"></div>
  <button class="btn-retry" id="localCliRescan" data-testid="local-cli-rescan" type="button">重新扫描</button>
</section>
```

```js
function renderLocalCli(state) {
  var available = state && state.available || [];
  if (!available.length) { localCliResults.textContent = '未扫描到可用本地 CLI'; return; }
  localCliResults.innerHTML = available.map(function(item) {
    return '<button type="button" data-cli-id="' + escapeText(item.id) + '" data-testid="local-cli-' + escapeText(item.id) + '">' + escapeText(item.label) + (item.id === state.selectedCliId ? ' 已选为默认' : ' 可用') + '</button>';
  }).join('');
}
function loadLocalCli(rescan) {
  var call = rescan ? window.srtAPI.rescanLocalCli : window.srtAPI.getLocalCliState;
  return call().then(renderLocalCli).catch(function() { localCliResults.textContent = '本地 CLI 扫描失败，请重新扫描。'; });
}
localCliRescan.addEventListener('click', function() { loadLocalCli(true); });
localCliResults.addEventListener('click', function(event) { var button = event.target.closest('[data-cli-id]'); if (button) window.srtAPI.selectLocalCli(button.dataset.cliId).then(renderLocalCli); });
loadLocalCli(false);
```

Keep the existing `btnConfirm` listener and environment/install/AI sections unchanged. The renderer must not create cards for missing entries and must not add installation, login, model, run, or test-command controls.

- [ ] **Step 4: Verify GREEN and checkpoint**

Run: `node --test tests/main-entry.test.js && npm run test:unit`

Expected: PASS. Then run `npm start` and manually confirm the visible page checkpoint and that Continue still reaches the home page with no local CLI selected.

- [ ] **Step 5: Commit Task 2**

```bash
git add main.js preload.js tests/main-entry.test.js app/环境检测.html app/env-check.js
git commit -m "feat: show optional local CLI selection"
```

### Task 3: Two focused Electron journeys and final Mac acceptance

**Files:**
- Modify: `tests/e2e/electron-main.js:1-47`
- Modify: `tests/e2e/electron.fixture.js:109-147`
- Create: `tests/e2e/local-cli-flow.spec.js`
- Modify: `package.json:5-10`

**Interfaces:**
- E2E entry passes an injected `localCliService` with deterministic `getState`, `rescan`, and `select` behavior; it does not replace preload or renderer.
- Test IDs: `local-cli-section`, `local-cli-results`, `local-cli-rescan`, `local-cli-codex`, `local-cli-claude`, `local-cli-gemini`.

- [ ] **Step 1: Write exactly the two failing E2E scenarios**

```js
const { test, expect } = require('./electron.fixture');

test('empty local CLI result uses the exact copy and remains optional', async ({ window }) => {
  await expect(window.getByTestId('local-cli-results')).toHaveText('未扫描到可用本地 CLI');
  await expect(window.getByTestId('local-cli-codex')).toHaveCount(0);
  await window.getByTestId('continue').click();
  await expect(window.getByTestId('home-page')).toBeVisible();
});

test.describe('two available CLIs', () => {
  test.use({ localCliMode: 'two' });
  test('visible explicit choice persists across a rescan', async ({ window }) => {
    await expect(window.getByTestId('local-cli-codex')).toContainText('可用');
    await expect(window.getByTestId('local-cli-claude')).toContainText('可用');
    await window.getByTestId('local-cli-claude').click();
    await expect(window.getByTestId('local-cli-claude')).toContainText('已选为默认');
    await window.getByTestId('local-cli-rescan').click();
    await expect(window.getByTestId('local-cli-claude')).toContainText('已选为默认');
  });
});
```

- [ ] **Step 2: Run E2E (RED)**

Run: `npx playwright test tests/e2e/local-cli-flow.spec.js`

Expected: FAIL because the E2E entry does not yet inject deterministic empty/two-CLI local states.

- [ ] **Step 3: Add only an injected service fixture and script inclusion**

```js
// tests/e2e/electron-main.js, before startApplication
const localCliStates = process.env.SRT_E2E_LOCAL_CLI === 'two'
  ? [{ id: 'codex', label: 'Codex CLI' }, { id: 'claude', label: 'Claude Code' }]
  : [];
let selectedCliId = null;
const localCliService = {
  async getState() { return { available: localCliStates, selectedCliId }; },
  async rescan() { return { available: localCliStates, selectedCliId }; },
  async select(id) { if (!localCliStates.some((item) => item.id === id)) { const error = new Error('Local CLI unavailable'); error.code = 'LOCAL_CLI_NOT_AVAILABLE'; throw error; } selectedCliId = id; return { available: localCliStates, selectedCliId }; }
};
startApplication({ environmentModule, localCliService });
```

Add one option to the existing `base.extend` call and one launch environment property; do not add process restart or scenario mutation helpers:

```js
localCliMode: ['empty', { option: true }],
electronContext: async ({ scenario, realEnvironment, localCliMode }, use, testInfo) => {
  // retain the existing launch and cleanup code
  electronApp = await electron.launch({ args: [path.join(__dirname, 'electron-main.js')], env: {
    ...process.env,
    SRT_E2E_USER_DATA: userDataDir,
    SRT_E2E_LOCAL_CLI: localCliMode,
    SRT_E2E_REAL_MAC: realEnvironment ? '1' : '0',
    SRT_E2E_SCENARIO: realEnvironment ? '' : scenario
  }});
}
```

Change the existing script to:

```json
"test:e2e": "playwright test tests/e2e/environment-flow.spec.js tests/e2e/local-cli-flow.spec.js"
```

- [ ] **Step 4: Verify GREEN and all accepted checks**

Run: `npx playwright test tests/e2e/local-cli-flow.spec.js && npm run test:e2e && npm run test:unit`

Expected: PASS. Run `SRT_REAL_MAC_SMOKE=1 npm run test:e2e:real-mac` for the existing environment smoke, then manually verify on this Mac: scan the three fixed definitions, observe only successful cards, choose one, rescan, make the selected executable unavailable if safely possible, rescan and observe the cleared selection, and enter the home page in both empty and unselected states.

- [ ] **Step 5: Stop/commit gate**

Before committing, confirm all completion criteria from the approved design are met. If acceptance passes, stop; do not add scope. If support work has exceeded twice estimate or the 3-hour cap, stop and report instead.

```bash
git add tests/e2e/electron-main.js tests/e2e/electron.fixture.js tests/e2e/local-cli-flow.spec.js package.json
git commit -m "test: cover local CLI selection journeys"
```

## Plan self-review

- **Spec coverage:** Task 1 covers the fixed catalog, ordinary scan/probe, only-success return, simple persistence, explicit choice, no auto-select, selected-item clearing, and minimum Windows branch. Task 2 covers the three narrow Electron calls, successful-results-only UI, exact copy, and optional/nonblocking behavior. Task 3 supplies exactly one empty-state E2E, one visible choose-and-persist E2E, plus manual Mac acceptance.
- **Explicit deferrals:** Global constraints and task steps exclude every deferred item: invocation/translation/Remotion, install/login/model UI, catalog expansion, generic architecture, complex runner/Windows/filesystem behavior, atomic writes, dynamic/restart harnesses, handler counts, real Windows E2E, and unrelated refactors.
- **Consistency:** The state field is consistently `selectedCliId`; service methods are consistently `getState`, `rescan`, and `select`; the renderer and IPC use only the same three names. The exact empty copy is identical in every occurrence.
- **Placeholder scan:** No `TBD`, `TODO`, “implement later”, or undefined interface is left in this plan.
