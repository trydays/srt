# SRTP 跨平台环境检测精简实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Every behavior change follows `test-driven-development`; every completion claim follows `verification-before-completion`.

**Goal:** 在不重写编辑器的前提下，让 SRTP 的同一个 Electron 环境页正确识别 Windows 与 macOS，提供三档非阻断提示，并在明确确认后最多执行一次固定安装动作。

**Architecture:** 用一个深模块 `src/environment/index.js` 封装检测、评估、安装计划和一次性确认；调用者只需理解三个方法。`src/environment/node-adapter.js` 是真实 Node/macOS/Windows 适配器。测试只替换最外层 OS、文件系统和进程边界，不伪造三个公共方法。

**Tech Stack:** Electron 33.4.11, CommonJS, Node `node:test`, vanilla HTML/CSS/JavaScript, Playwright Electron.

## 范围冻结

| 项目 | 本阶段决定 |
|---|---|
| 唯一目的 | 让 Windows/macOS 环境检测、确认安装与继续进入编辑器的链路真实可用。 |
| 可见成果 | 当前 Mac 的 Electron 页面能显示真实设备和工具，并能从首次启动走到编辑器。 |
| 明确不做 | 不重写媒体执行、时间轴、AI 翻译、更新、通用安装平台、CI 矩阵或 macOS 签名发布。 |
| 投入上限 | 六个纵向切片；任一支撑性切片超出计划两倍时立即停止并报告。 |
| 结束条件 | 本计划末尾的五项验收全部通过后立即结束，不因“还能更完善”继续扩张。 |

### 延期清单

- 桌面端现有媒体命令执行链的重写与通用命令解析器。
- 确认标识过期、并发争用、持久化恢复和跨项目安装平台。
- 电池、温度、风扇、外接盘健康和 CUDA 强制要求。
- 新的 GitHub Actions 双系统矩阵、macOS 签名/公证和发布流程。
- 除下文四条完整链路以外的穷举异常场景。

## 稳定公共接口

```js
const environment = createEnvironmentModule(dependencies);
await environment.detectEnvironment();
await environment.describeInstall(toolId);
await environment.installTool({ toolId, confirmationId });
```

- `detectEnvironment()` 始终尽力返回完整报告；单项失败用 `reason: 'probe_error'` 表示。
- `describeInstall(toolId)` 只返回用户可读计划和确认标识，不返回程序或参数。
- `installTool(request)` 只接受两个字段，一份确认最多执行一次。
- 状态只能是 `ready` / `limited` / `missing`。
- 原因只能是 `ok` / `absent` / `incompatible` / `probe_error` / `unsupported`。

## 文件地图

**新增生产文件：**

- `src/environment/index.js` — 环境深模块。
- `src/environment/node-adapter.js` — 真实 OS/进程/捆绑工具适配器。

**修改生产文件：**

- `main.js`, `preload.js`, `server.js`, `package.json`, `package-lock.json`
- `app/环境检测.html`, `app/env-check.js`, `app/shared.js`, `app/主页.html`, `app/剪辑.html`

**测试文件：**

- `tests/environment.test.js`
- `tests/environment-install.test.js`
- `tests/environment-node-adapter.test.js`
- `tests/server-security.test.js`
- `tests/e2e/scenario-dependencies.js`
- `tests/e2e/electron-main.js`
- `tests/e2e/electron.fixture.js`
- `tests/e2e/environment-flow.spec.js`
- `tests/e2e/real-mac-smoke.spec.js`
- `playwright.config.js`

---

### Task 0: 恢复可信的测试基线

**Files:**
- Modify: `tests/tools-versions.test.js`
- Modify: `tests/config-loader.test.js`
- Modify: `package.json`

**用户可见成果：** 无；这是唯一个纯支撑性切片，完成后下一切片必须产生真实环境报告。

- [ ] **Step 1: 记录当前 RED 基线**

Run:

```bash
node --test "tests/*.test.js"
```

Expected: 26 项中 24 项通过；两项失败均来自 `tests/tools-versions.test.js` 读取 Windows `AppData`。若实际结果不同，停止并记录新基线。

- [ ] **Step 2: 去掉机器全局状态污染**

In `tests/tools-versions.test.js`:

1. 保留前五项 `tools-versions.json` 文件与 schema 检查。
2. 删除 `appdataDir` / `appdataVersions` 常量。
3. 删除四项依赖真实 `resources`/`AppData` 副作用的测试：工具文件存在、AppData 文件就位、AppData 版本一致、`ensureTools` 幂等。
4. 新的捆绑工具行为在 Task 1 通过环境模块的公共接口测试，不为旧启动副作用保留测试。

In `tests/config-loader.test.js`, every test that writes `.srt.config.json`, `.env`, or `.claude/credentials.json` must use:

```js
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srt-config-'));
t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
```

Never write shared fixed names directly under `os.tmpdir()`.

- [ ] **Step 3: 添加统一单测入口**

Add to `package.json > scripts`:

```json
"test": "node --test \"tests/*.test.js\"",
"test:unit": "node --test \"tests/*.test.js\""
```

- [ ] **Step 4: 验证 GREEN**

Run:

```bash
npm test
```

Expected: all remaining baseline tests pass; no test reads real `AppData` or shared temporary filenames.

- [ ] **Step 5: 提交基线**

```bash
git add tests/tools-versions.test.js tests/config-loader.test.js package.json
git commit -m "test: make baseline deterministic"
```

---

### Task 1: 以 TDD 实现跨平台环境深模块

**Files:**
- Create: `src/environment/index.js`
- Create: `tests/environment.test.js`

**Interface:** `createEnvironmentModule(dependencies).detectEnvironment()`.

**Dependencies:**

```js
{
  platform, arch, targetPath, userDataDir,
  osApi: { version, release, cpus, totalmem },
  fsApi: { statfs },
  run(program, args, options),
  getBundledTools()
}
```

- [ ] **Step 1: 先写公共行为测试**

Create `tests/environment.test.js`. Tests must call only `createEnvironmentModule(...).detectEnvironment()` and cover:

```js
test('macOS 识别 Apple/Metal 与工具语义', async () => {
  const environment = createEnvironmentModule(macFixture({
    versions: { ffmpeg: '8.0.1', node: '26.4.0', npm: '11.17.0', python3: '3.14.6' }
  }));
  const report = await environment.detectEnvironment();
  assert.equal(report.platform.os, 'darwin');
  assert.equal(report.hardware.chip.name, 'Apple M4');
  assert.equal(report.hardware.graphics.metal, true);
  assert.equal(report.hardware.disk.path, '/app-data');
  assert.equal(report.tools.node.status, 'ready');
  assert.deepEqual(
    { status: report.tools.python.status, reason: report.tools.python.reason, command: report.tools.python.command },
    { status: 'limited', reason: 'incompatible', command: 'python3' }
  );
  assert.equal(report.canContinue, true);
});

test('Windows 优先使用校验通过的捆绑工具', async () => {
  const fixture = windowsFixture({ bundled: { ffmpeg: { available: true, version: '8.0.1', path: 'C:\\\\bundle\\\\ffmpeg.exe' } } });
  const report = await createEnvironmentModule(fixture).detectEnvironment();
  assert.equal(report.platform.os, 'win32');
  assert.equal(report.hardware.graphics.name, 'NVIDIA RTX');
  assert.equal(report.tools.ffmpeg.source, 'bundled');
  assert.equal(fixture.calls.some((call) => call.program === 'ffmpeg'), false);
});

test('低资源与探测失败有不同 reason，但都不阻止继续', async () => {
  const report = await createEnvironmentModule(degradedMacFixture()).detectEnvironment();
  assert.deepEqual(
    { status: report.hardware.memory.status, reason: report.hardware.memory.reason },
    { status: 'missing', reason: 'ok' }
  );
  assert.deepEqual(
    { status: report.hardware.graphics.status, reason: report.hardware.graphics.reason },
    { status: 'missing', reason: 'probe_error' }
  );
  assert.equal(report.canContinue, true);
});
```

Add assertions for these exact policies:

- Memory: `ready >= 16 GB`, `limited = 8–15.9 GB`, `missing < 8 GB`.
- Free disk: `ready >= 30 GB`, `limited = 10–29.9 GB`, `missing < 10 GB`.
- Architecture: macOS `arm64`/`x64` and Windows `x64` are ready; `ia32` is limited; other architectures are missing with `unsupported`.
- Basic mode requires FFmpeg; Remotion mode requires Node.js 20+ and npm; subtitles require compatible Python 3.12 and `faster-whisper`.
- Probe the app-managed Python first when present; otherwise macOS probes `python3` before `python`, and Windows probes `py -3` before `python`. Whisper is probed through the same selected Python candidate.
- A successful but unparsable/incompatible version is `limited/incompatible`; an `ENOENT` result is `missing/absent`; timeout/parse/probe failure is `missing/probe_error`.
- Individual failures never reject the whole report.

- [ ] **Step 2: 运行 RED**

```bash
node --test tests/environment.test.js
```

Expected: FAIL because `src/environment/index.js` does not exist.

- [ ] **Step 3: 在单一深模块内实现最小逻辑**

Create `src/environment/index.js` with only one export:

```js
module.exports = { createEnvironmentModule };
```

Keep the following implementation details private in that file:

1. Fixed probe catalog:
   - FFmpeg: `ffmpeg ['-version']`
   - Node.js: `node ['--version']`
   - npm: `npm ['--version']`
   - macOS Python: `${userDataDir}/python/bin/python ['--version']`, then `python3 ['--version']`, then `python ['--version']`
   - Windows Python: `${userDataDir}\\python\\Scripts\\python.exe ['--version']`, then `py ['-3', '--version']`, then `python ['--version']`
   - Whisper: the selected Python program and its prefix arguments plus `['-m', 'pip', 'show', 'faster-whisper']`
   - macOS graphics: `system_profiler ['SPDisplaysDataType', '-json']`
   - Windows graphics: `powershell.exe ['-NoProfile', '-Command', FIXED_GPU_SCRIPT]`
2. Version parsing and the exact compatibility rules above.
3. Safe wrappers around CPU, memory, disk and graphics so each failed read becomes a structured item.
4. Three-level hardware and mode evaluation.
5. Read-only bundled candidates supplied by `getBundledTools()`; never copy or delete a tool.

Return this exact report shape:

```js
{
  platform: { os, version, arch },
  hardware: {
    chip: { name, cores, status, reason },
    memory: { totalGB, status, reason },
    disk: { path, freeGB, totalGB, status, reason },
    graphics: { name, supported, metal, status, reason }
  },
  tools: {
    ffmpeg: { installed, compatible, version, command, source, status, reason },
    node: { installed, compatible, version, command, source, status, reason },
    npm: { installed, compatible, version, command, source, status, reason },
    python: { installed, compatible, version, command, source, status, reason },
    whisper: { installed, compatible, version, command, source, status, reason }
  },
  modes: {
    ffmpeg: { status, reason, blockers },
    remotion: { status, reason, blockers },
    subtitles: { status, reason, blockers }
  },
  canContinue: true
}
```

- [ ] **Step 4: 验证 GREEN 和回归**

```bash
node --test tests/environment.test.js
npm test
```

Expected: both pass.

- [ ] **Step 5: 提交可见检测核心**

```bash
git add src/environment/index.js tests/environment.test.js
git commit -m "feat: detect Windows and macOS environments"
```

---

### Task 2: 以 TDD 实现最小充分的确认安装

**Files:**
- Modify: `src/environment/index.js`
- Create: `tests/environment-install.test.js`

**Interface:** `describeInstall(toolId)` and `installTool({ toolId, confirmationId })` on the same deep module.

- [ ] **Step 1: 先写五条安全底线测试**

Create `tests/environment-install.test.js` and assert:

```js
test('计划可读但不泄露可执行动作', async () => {
  const { environment } = installFixture('darwin');
  const plan = await environment.describeInstall('ffmpeg');
  assert.equal(plan.toolId, 'ffmpeg');
  assert.equal(plan.canAutomate, true);
  assert.match(plan.summary, /Homebrew/);
  assert.equal(typeof plan.downloadEstimate, 'string');
  assert.equal(typeof plan.installLocation, 'string');
  assert.equal(typeof plan.durationEstimate, 'string');
  assert.ok(plan.steps.length > 0);
  assert.equal(typeof plan.confirmationId, 'string');
  assert.equal('command' in plan, false);
  assert.equal('actions' in plan, false);
});

test('一份确认最多执行一次固定动作', async () => {
  const { environment, calls } = installFixture('darwin');
  const plan = await environment.describeInstall('ffmpeg');
  assert.deepEqual(await environment.installTool({ toolId: 'ffmpeg', confirmationId: plan.confirmationId }), { ok: true, toolId: 'ffmpeg' });
  assert.deepEqual(calls.at(-1), { program: 'brew', args: ['install', 'ffmpeg'], timeoutMs: 300000 });
  await assert.rejects(
    () => environment.installTool({ toolId: 'ffmpeg', confirmationId: plan.confirmationId }),
    /已使用/
  );
});
```

Also test:

- Unknown tool IDs and any request with extra keys such as `command` are rejected before `run`.
- A forged confirmation is rejected before `run`.
- A confirmation for FFmpeg cannot install Node.js.
- When `brew --version` or `winget --version` is unavailable, the plan has `canAutomate: false`, `confirmationId: null`, and platform-specific manual guidance.
- A failed fixed action returns `{ ok: false }`, never starts a second action, and never reports success.

- [ ] **Step 2: 运行 RED**

```bash
node --test tests/environment-install.test.js
```

Expected: FAIL because the two methods are not implemented.

- [ ] **Step 3: 在原模块内增加私有白名单**

Use these exact automatic actions; no other program/arguments may be derived from renderer input:

| Tool | macOS | Windows |
|---|---|---|
| FFmpeg | `brew ['install', 'ffmpeg']` | `winget ['install', '--id', 'Gyan.FFmpeg', '--exact', '--accept-package-agreements', '--accept-source-agreements']` |
| Node.js | `brew ['install', 'node@20']` | `winget ['install', '--id', 'OpenJS.NodeJS.LTS', '--exact', '--accept-package-agreements', '--accept-source-agreements']` |
| Python | `brew ['install', 'python@3.12']` | `winget ['install', '--id', 'Python.Python.3.12', '--exact', '--accept-package-agreements', '--accept-source-agreements']` |
| Whisper | run `brew ['install', 'python@3.12']`; then run `python3.12` with `['-m', 'venv', userDataDir + '/python']`; then run the managed Python with `['-m', 'pip', 'install', 'faster-whisper', 'soundfile', 'numpy']` | run the fixed winget Python 3.12 action; then run `py` with `['-3.12', '-m', 'venv', userDataDir + '\\python']`; then run the managed Python with the same pip arguments |

Implementation invariants:

1. The confirmation map is private and in memory: `{ confirmationId -> { toolId, used } }`.
2. No expiration, persistence, concurrency recovery, retry scheduler, or generic recipe plug-in system is added.
3. `installTool` accepts exactly two string fields.
4. Set `used = true` before the first action starts.
5. Execute actions sequentially with a five-minute per-action timeout.
6. Return a short generic failure message; do not return environment variables, secrets, home-directory paths, or full logs.
7. UI-triggered full re-detection is implemented in Task 4, not hidden inside this method.
8. Every public plan includes `summary`, `downloadEstimate`, `installLocation`, `durationEstimate`, and `steps`; it excludes the private action arrays.

- [ ] **Step 4: 验证 GREEN 和回归**

```bash
node --test tests/environment-install.test.js
npm test
```

- [ ] **Step 5: 提交安装底线**

```bash
git add src/environment/index.js tests/environment-install.test.js
git commit -m "feat: confirm whitelisted tool installation"
```

---

### Task 3: 接入真实 Node 适配器与 Electron

**Files:**
- Create: `src/environment/node-adapter.js`
- Create: `tests/environment-node-adapter.test.js`
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `package.json`

**User-visible result:** Electron no longer falls back to Windows-only renderer commands; it calls the real environment module through `window.srtAPI`.

- [ ] **Step 1: 先写适配器测试**

Create `tests/environment-node-adapter.test.js` covering:

```js
test('Node runner always uses an argument array and shell false', async () => {
  const calls = [];
  const runner = createNodeRunner(fakeSpawn(calls), { PATH: '/usr/bin' }, 'darwin');
  await runner('node', ['--version'], { timeoutMs: 1000 });
  assert.equal(calls[0].program, 'node');
  assert.deepEqual(calls[0].args, ['--version']);
  assert.equal(calls[0].options.shell, false);
  assert.match(calls[0].options.env.PATH, /\/opt\/homebrew\/bin/);
  assert.match(calls[0].options.env.PATH, /\/usr\/local\/bin/);
});
```

Also assert:

- `ENOENT` becomes `absent`; timeout/non-zero becomes `probe_error`.
- stdout/stderr are bounded to 1 MiB.
- Windows bundled tools are inspected only from an explicitly supplied `resources/tools` root and matching manifest; size mismatch is `incompatible`.
- No adapter path contains or reads the old user `AppData` tools directory.

- [ ] **Step 2: 运行 RED**

```bash
node --test tests/environment-node-adapter.test.js
```

- [ ] **Step 3: 实现真实适配器**

Create `src/environment/node-adapter.js` exporting only:

```js
module.exports = {
  createNodeRunner,
  createProductionEnvironment,
  inspectBundledTools
};
```

`createProductionEnvironment({ targetPath, userDataDir, bundledRoot })` composes `createEnvironmentModule` with Node's `os`, `fs.promises.statfs`, the safe runner, `crypto.randomUUID`, and a read-only bundled-tool inspector. The default disk target is the passed Electron user-data directory.

- [ ] **Step 4: 用一个可注入启动函数改造 `main.js`**

1. Remove `getAppDataDir`, `getToolsVersionsPath`, `ensureVCRedist`, `ensureTools`, `cleanupBundledTools`, `ensureWhisper`, and their startup calls.
2. Remove the legacy `tools:queryBundled` and `tools:install` handlers.
3. Keep existing dialog, AI, update, and desktop media execution behavior unchanged.
4. Export `startApplication({ environmentModule } = {})`.
5. Inside `startApplication`, read `app.getPath('userData')` once, create the production environment when none is injected, register the following handlers, then call the existing `app.whenReady()`/window lifecycle:

```js
ipcMain.handle('environment:detect', () => environmentModule.detectEnvironment());
ipcMain.handle('installation:describe', (_event, toolId) => environmentModule.describeInstall(toolId));
ipcMain.handle('installation:execute', (_event, request) => environmentModule.installTool(request));
```

6. Production uses `targetPath: userDataDir` and the platform's explicit packaged/development `resources/tools` root.
7. Call `startApplication()` only when `main.js` is the Electron entry module; the test entry in Task 4 imports it after setting isolated user data.

- [ ] **Step 5: 统一 preload 名称**

In `preload.js`, keep unrelated methods and replace the old environment/install methods with:

```js
detectEnvironment: () => ipcRenderer.invoke('environment:detect'),
describeInstall: (toolId) => ipcRenderer.invoke('installation:describe', toolId),
installTool: (toolId, confirmationId) => ipcRenderer.invoke(
  'installation:execute',
  { toolId, confirmationId }
),
```

There must be no renderer method that accepts an installation command string.

- [ ] **Step 6: 包含新模块并使用本地 Electron**

In `package.json`:

```json
"start": "electron .",
"dev": "electron . --dev"
```

Add `"src/**/*"` to `build.files`. Do not modify the existing dirty `package-lock.json` in this task.

- [ ] **Step 7: 验证并提交**

```bash
node --test tests/environment-node-adapter.test.js
npm test
git add src/environment/node-adapter.js tests/environment-node-adapter.test.js main.js preload.js package.json
git commit -m "feat: connect environment detection to Electron"
```

---

### Task 4: 先写 Electron RED 测试，再完成环境页

**Files:**
- Create: `playwright.config.js`
- Create: `tests/e2e/scenario-dependencies.js`
- Create: `tests/e2e/electron-main.js`
- Create: `tests/e2e/electron.fixture.js`
- Create: `tests/e2e/environment-flow.spec.js`
- Create: `tests/server-security.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `app/环境检测.html`
- Modify: `app/env-check.js`
- Modify: `app/shared.js`
- Modify: `server.js`

**User-visible result:** the actual page shows platform, hardware, tools, three capability modes, confirmation dialog, and an always-available Continue button.

- [ ] **Step 1: 安装唯一新测试依赖**

```bash
npm install --save-dev @playwright/test@1.62.1
```

This intentionally adopts the existing `package-lock.json` diff; do not overwrite or regenerate unrelated lockfile content.

Add scripts:

```json
"test:e2e": "playwright test tests/e2e/environment-flow.spec.js",
"test:e2e:real-mac": "SRT_REAL_MAC_SMOKE=1 playwright test tests/e2e/real-mac-smoke.spec.js"
```

Create `playwright.config.js` with `testDir: './tests/e2e'`, `workers: 1`, `fullyParallel: false`, `timeout: 60000`, `outputDir: 'test-results/e2e'`, and a line reporter. Do not add a CI matrix in this phase.

- [ ] **Step 2: 创建只替换外层边界的测试入口**

`tests/e2e/scenario-dependencies.js` exports `createScenarioDependencies(name)` for exactly:

- `mac-ready`
- `windows-ready`
- `mac-missing`
- `mac-degraded`

It returns `{ dependencies, state }`. `dependencies` contains only `platform`, `arch`, `targetPath`, `userDataDir`, `osApi`, `fsApi`, `run`, `getBundledTools`, and `tokenFactory`; it must not implement `detectEnvironment`, `describeInstall`, or `installTool`.

The fake `run` recognizes only the fixed production probes and installation actions. In `mac-missing`, `ffmpeg -version` fails until exactly `brew ['install', 'ffmpeg']` runs once. `state.calls` records `{ program, args }` for assertions.

`tests/e2e/electron-main.js` performs this order:

```js
const { app } = require('electron');
const userDataDir = process.env.SRT_E2E_USER_DATA;
if (!userDataDir) throw new Error('SRT_E2E_USER_DATA is required');
app.setPath('userData', userDataDir);

const { createEnvironmentModule } = require('../../src/environment');
const { startApplication } = require('../../main');
const { dependencies, state } = require('./scenario-dependencies')
  .createScenarioDependencies(process.env.SRT_E2E_SCENARIO);
const environmentModule = createEnvironmentModule({ ...dependencies, targetPath: userDataDir, userDataDir });
app.__srtE2EState = state;
startApplication({ environmentModule });
```

`tests/e2e/electron.fixture.js` creates a fresh `fs.promises.mkdtemp()` user-data directory for every test, launches the explicit `electron-main.js`, captures child stderr plus renderer `console`/`pageerror`, takes a screenshot on unexpected failure, always closes Electron, and removes only that test's temporary directory. It waits for `[data-testid="environment-page"][data-state="loaded"]`; it never uses a fixed sleep.

- [ ] **Step 3: 先写第一条页面 RED 测试**

In `tests/e2e/environment-flow.spec.js`:

```js
test.describe('macOS ready', () => {
  test.use({ scenario: 'mac-ready' });
  test('首次启动显示真实语义的环境报告', async ({ window }) => {
    await expect(window.getByTestId('platform-summary')).toContainText('macOS');
    await expect(window.getByTestId('platform-summary')).toContainText('Apple M4');
    await expect(window.getByTestId('row-graphics')).toContainText('Metal');
    await expect(window.getByTestId('row-node')).toHaveAttribute('data-status', 'ready');
    await expect(window.getByTestId('row-python')).toHaveAttribute('data-status', 'ready');
    await expect(window.getByTestId('continue')).toBeEnabled();
  });
});
```

Run:

```bash
npm run test:e2e
```

Expected: RED at the first missing page selector/wiring.

- [ ] **Step 4: 最小改写环境页**

In `app/环境检测.html`:

1. Add `data-testid="environment-page" data-state="loading"` to the panel.
2. Remove static `C:/D:/E:/F:` drive chips and Windows-only rows.
3. Add stable containers/test IDs: `platform-summary`, `hardware-list`, `tool-list`, `mode-list`, `continue`, `install-dialog`, `install-cancel`, `install-confirm`, and `install-error`.
4. Keep the existing `cli`/`browser` render-mode chooser and `RENDER_MODE` behavior; the three capability modes are read-only status cards, not a new selection system.

Replace the environment part of `app/env-check.js` so it:

1. Calls only `window.srtAPI.detectEnvironment()` in Electron.
2. Maps `ready/limited/missing` to `满足/可用但受限/不满足`.
3. Maps `absent/incompatible/probe_error/unsupported` to distinct Chinese explanations; never label `probe_error` as `未安装`.
4. Renders hardware, tool, and mode rows using text escaping.
5. Shows install buttons only for `ffmpeg`, `node`, `python`, and `whisper` when not ready.
6. Calls `describeInstall`, shows the returned human-readable plan, and does nothing on Cancel.
7. On Confirm, disables the button, shows an indeterminate busy label, calls `installTool`, then calls `detectEnvironment()` again and re-renders the complete report.
8. On installation failure, shows the short error/manual guidance and never changes the row to ready.
9. Sets the page state to `loaded` after a complete or partial report, and to `error` only when the whole call fails; Continue remains enabled in both states.
10. On Continue, writes `ENV_DONE` and preserves the existing `RENDER_MODE` selection; do not add `FEATURE_MODE`.
11. Migrates the existing AI section from `window.electronAPI` to the already exposed `window.srtAPI.detectOllama()` and `window.srtAPI.queryAIConfig()` without changing AI behavior.
12. Outside Electron, displays `请在桌面版运行完整检测`, leaves Continue enabled, and never calls a native-command HTTP endpoint.

- [ ] **Step 5: 关闭开发服务器的现实安全风险**

Write `tests/server-security.test.js` first. It must prove:

- imported `server.js` does not listen automatically;
- the explicit server binds `127.0.0.1`;
- `/api/exec` and `/api/install` both return 404;
- no permissive `Access-Control-Allow-Origin: *` header exists;
- `/` serves `app/主页.html`, not the repository root.

Then refactor `server.js` to export `createStaticServer({ root = path.join(__dirname, 'app') } = {})` and `startStaticServer({ port = 3456 } = {})`. The second function must always call `server.listen(port, '127.0.0.1')`; invoke it only inside `if (require.main === module)`. Remove both command endpoints and CORS headers. In `app/shared.js`, the non-Electron `cliExec` fallback returns a clear `请在桌面版执行媒体命令` result instead of calling `/api/exec`. Keep Electron `window.srtAPI.execCommand` as the existing editor compatibility path; its redesign stays deferred.

- [ ] **Step 6: 运行 GREEN 并提交第一个可见页面**

```bash
node --test tests/server-security.test.js
npm test
npm run test:e2e
git add package.json package-lock.json playwright.config.js tests/e2e tests/server-security.test.js app/环境检测.html app/env-check.js app/shared.js server.js
git commit -m "feat: show safe cross-platform environment page"
```

---

### Task 5: 补齐四条完整链路并在当前 Mac 验证

**Files:**
- Modify: `tests/e2e/environment-flow.spec.js`
- Create: `tests/e2e/real-mac-smoke.spec.js`
- Modify: `tests/e2e/electron-main.js`
- Modify: `tests/e2e/electron.fixture.js`
- Modify: `app/主页.html`
- Modify: `app/剪辑.html`
- Modify: `.gitignore`
- Modify: `README.md`

**User-visible result:** one deterministic test proves the whole first-launch-to-editor path, and one read-only smoke test proves this Mac is detected for real.

- [ ] **Step 1: 先写完整链路 RED 测试**

Extend the macOS page test from Task 4 into the full journey below, then add the other three tests. The final suite has exactly four tests, each with a fresh Electron process/user-data directory:

1. **Full macOS journey (`mac-ready`):** retain the platform/tool assertions, then Continue to home, upload an in-memory `video/mp4`, click Start Editing, and assert the editor root is visible.
2. **Windows ready:** Windows/CPU/GPU/disk language renders; no Apple/Metal requirement appears.
3. **Missing FFmpeg:** open plan, Cancel, assert no `brew install` call and row remains missing; open a new plan, Confirm, assert exactly one fixed `brew ['install', 'ffmpeg']`, assert a complete second detection occurred, and row/mode become ready.
4. **Degraded Mac:** memory/disk are below threshold while graphics probe has `probe_error`; page distinguishes those causes, remains loaded, and Continue opens home.

Do not add separate Electron processes for forged IDs, extra request fields, every threshold boundary, or every probe exception; those are already covered at the deep-module interface.

- [ ] **Step 2: 添加稳定导航选择器**

- Add `data-testid="home-page"` to the existing home `<main>`.
- Add `data-testid="video-input"` to the dynamically created file input.
- Add `data-testid="start-editing"` to the dynamically created start button.
- Add `data-testid="editor-page"` to the primary editor `<main>`.

These are selector-only changes; do not alter upload, IndexedDB, project, or editor logic.

- [ ] **Step 3: 只在失败时保留最小诊断材料**

In `tests/e2e/electron.fixture.js`, attach child stderr and renderer `pageerror` text plus one screenshot only when a test fails. Do not build trace viewers, video recording, log dashboards, retry orchestration, or artifact upload infrastructure.

Add to `.gitignore`:

```gitignore
test-results/
playwright-report/
```

- [ ] **Step 4: 运行四条确定性 E2E**

```bash
npm run test:e2e
```

Expected: all four journeys pass; install action count is exactly one.

- [ ] **Step 5: 添加当前 Mac 只读烟雾测试**

`tests/e2e/real-mac-smoke.spec.js` skips unless `process.platform === 'darwin'` and `SRT_REAL_MAC_SMOKE === '1'`. Launch the test entry with a fresh user-data directory and the real `createProductionEnvironment`, then call:

```js
const report = await window.evaluate(() => window.srtAPI.detectEnvironment());
```

Assert:

- `report.platform.os === 'darwin'`.
- Node.js and Python are not `missing` on this Mac.
- disk path does not contain Windows drive semantics.
- graphics is recognized as Apple/Metal and is not `probe_error`.
- no installation method is invoked.

Run:

```bash
npm run test:e2e:real-mac
```

- [ ] **Step 6: 更新最小用户文档**

Add a short `Windows 与 macOS 环境检测` section to `README.md` explaining the three statuses, non-blocking Continue behavior, confirmation-before-install behavior, and these commands:

```bash
npm test
npm run test:e2e
```

Do not promise a signed macOS installer; current release packaging remains Windows-only.

- [ ] **Step 7: 最终验证闸门**

Run in this order:

```bash
npm test
npm run test:e2e
npm run test:e2e:real-mac
npm run build -- --dir
git diff --check
git status --short
```

Expected:

- Unit/integration tests pass.
- Four deterministic Electron journeys pass.
- Current-Mac smoke passes.
- Directory build succeeds and contains `src/environment/**`.
- Diff check prints nothing.
- Test artifacts are ignored.
- No unrelated user files are staged.

- [ ] **Step 8: 人工打开一次并立即止损**

Run `npm run dev` and verify only:

1. Current Mac name, memory, disk, Metal, Node.js and Python appear.
2. No static Windows drives, `wmic`, required CUDA, or `AppData` path appears.
3. Continue opens home and an uploaded test video opens the editor.
4. Missing-tool action shows a plan before any execution.

If these and the automated gates pass, stop. Do not add deferred reliability or platform work.

- [ ] **Step 9: 提交交付物并请求最终审查**

```bash
git add tests/e2e app/主页.html app/剪辑.html .gitignore README.md
git commit -m "test: verify environment flow end to end"
```

Review the branch only against the five exit conditions below. Findings about deferred items go to a later-work list and do not block this phase unless they reveal a present safety or data-loss risk.

## 五项退出条件

1. Windows/macOS 环境报告正确区分平台、硬件、工具、三档状态和探测失败。
2. 所有硬件结果只提示，不禁止继续。
3. 安装前必须显示计划并获得确认；页面不能提交命令字符串。
4. 一份确认最多执行一次；失败不显示成功，成功后全量重检。
5. 四条 Electron E2E、当前 Mac 只读烟雾、现有回归测试和目录构建全部通过。
