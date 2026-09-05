# 本地 CLI 单效果指令 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已选本地 CLI 将一句效果描述转换为一个经验证的 `add_effect` 指令，并在编辑器新增一个时间轴效果标记。

**Architecture:** `src/local-cli.js` 在不暴露程序路径的前提下，找到已选 CLI 的固定可执行文件并用固定提示取回 JSON。主进程只转发经过白名单校验的结果；preload 仅暴露专用翻译入口；编辑器只把成功的 `fade_in` 指令转成现有 marker，不调用 shell 或渲染程序。

**Tech Stack:** Electron 33、Node.js 内置 `node:test`、Playwright Electron E2E、现有原生 DOM JavaScript。

## Global Constraints

- 唯一操作是 `{ type: 'add_effect', effect: 'fade_in' }`；任何数组、额外字段、未知效果、非 JSON 或缺失字段均拒绝且不改时间轴。
- 必须使用环境页中已显式选择、当前仍可用的 CLI；不得自动切换、回退云端/Ollama，或泄露路径、原始输出、环境变量或令牌。
- CLI 仅输出意图：不得执行 shell/FFmpeg/Remotion、写文件、安装、登录、模型控制或多轮 agent。
- 先完成成功流、非法输出拒绝流和 Mac 手工验证；满足验收立即停止。支撑工作超过预估两倍时停止报告。
- 新流程可见且可验证后才移除环境页旧的云端/Ollama “AI 效果翻译”界面；本期保留旧后端接口，不作重构或删除。

---

## File Structure

- `src/local-cli.js`：保留扫描/显式选择，并新增私有可执行文件解析、固定单效果提示、超时调用和最小 JSON 校验。
- `main.js`：注册单一 `local-cli:translate-effect` IPC handler。
- `preload.js`：只暴露 `translateLocalCliEffect(text)`，不暴露路径或通用执行接口。
- `app/editor-timeline.js`：将提交按钮的自然语言分支改为调用专用 IPC；成功后追加现有时间轴 marker。
- `app/剪辑.html`：为 E2E 增加稳定的输入、状态与 marker 定位标识。
- `app/环境检测.html`、`app/env-check.js`：在新流程 E2E 已通过后，仅移除旧 AI 翻译配置 UI 与对应 renderer 逻辑。
- `tests/local-cli.test.js`、`tests/main-entry.test.js`：覆盖服务、IPC 暴露面和拒绝边界。
- `tests/e2e/electron-main.js`、`tests/e2e/local-cli-effect-flow.spec.js`：提供确定性 fake 翻译结果并验证成功/失败可见行为。

### Task 1: 本地 CLI 的单效果翻译服务

**Files:**
- Modify: `src/local-cli.js:1-137`
- Test: `tests/local-cli.test.js`

**Interfaces:**
- Consumes: 已有 `createLocalCliService({ userDataDir, run, execFile })`、已持久化的 `selectedCliId`。
- Produces: `translateEffect(text): Promise<{ type: 'add_effect', effect: 'fade_in' }>`；失败时抛出带 `code` 的错误：`LOCAL_CLI_NOT_SELECTED`、`LOCAL_CLI_NOT_AVAILABLE`、`LOCAL_CLI_INVALID_EFFECT_OUTPUT` 或 `LOCAL_CLI_TRANSLATION_FAILED`。

- [ ] **Step 1: 写入服务层失败测试**

  在 `tests/local-cli.test.js` 追加固定 fake 文件系统和执行器：选择 `codex` 后，fake 执行器返回 `'{"type":"add_effect","effect":"fade_in"}'`，断言 `translateEffect('添加淡入')` 只返回该对象；再分别传入 `not json`、带 `extra: true` 的 JSON、数组 JSON，断言每一种都以 `LOCAL_CLI_INVALID_EFFECT_OUTPUT` 拒绝。

  ```js
  await assert.rejects(
    () => service.translateEffect('添加淡入'),
    { code: 'LOCAL_CLI_INVALID_EFFECT_OUTPUT' }
  );
  ```

- [ ] **Step 2: 运行失败测试，确认当前没有接口**

  Run: `node --test tests/local-cli.test.js`

  Expected: FAIL，提示 `service.translateEffect is not a function`。

- [ ] **Step 3: 实现受限调用与精确校验**

  在 `src/local-cli.js` 中让扫描的内部结果保留 `{ id, label, file }`，但 `getState`、`rescan`、`select` 继续仅映射为 `{ id, label }`。新增只供测试注入的 `translate` 参数；默认调用使用 `execFile(file, args, { timeout: 15000, maxBuffer: 64 * 1024, windowsHide: true }, callback)`，不经过 shell。

  使用当前已选 CLI 的固定参数表（仅已有三个 ID）：

  ```js
  const EFFECT_PROMPT = '只输出一个 JSON 对象：{"type":"add_effect","effect":"fade_in"}。只允许淡入；不要解释、Markdown、命令或其他字段。用户请求：';
  const EFFECT_ARGS = {
    codex: (prompt) => ['exec', prompt],
    claude: (prompt) => ['-p', prompt],
    gemini: (prompt) => ['-p', prompt]
  };
  ```

  校验函数必须逐项比较对象原型、键名数量和键顺序无关的键集合，且只接受如下结果：

  ```js
  function parseEffectInstruction(output) {
    let value;
    try { value = JSON.parse(String(output).trim()); } catch (_) { throw invalidEffectOutputError(); }
    if (!value || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalidEffectOutputError();
    const keys = Object.keys(value).sort();
    if (keys.length !== 2 || keys[0] !== 'effect' || keys[1] !== 'type') throw invalidEffectOutputError();
    if (value.type !== 'add_effect' || value.effect !== 'fade_in') throw invalidEffectOutputError();
    return { type: 'add_effect', effect: 'fade_in' };
  }
  ```

  `translateEffect` 必须在调用前重新扫描、确认选择仍有效；没有选择抛 `LOCAL_CLI_NOT_SELECTED`，失效选择抛 `LOCAL_CLI_NOT_AVAILABLE`，非零退出、超时或启动错误统一抛 `LOCAL_CLI_TRANSLATION_FAILED`。不得在错误对象中拼接 CLI 路径或原始输出。

- [ ] **Step 4: 运行单元测试，确认通过**

  Run: `node --test tests/local-cli.test.js`

  Expected: PASS，包含原有扫描/选择测试和新增的合法、非 JSON、额外字段、数组拒绝测试。

- [ ] **Step 5: 提交服务层最小变更**

  ```bash
  git add src/local-cli.js tests/local-cli.test.js
  git commit -m "feat: translate a single local CLI effect"
  ```

### Task 2: 窄 IPC 与编辑器时间轴可见流程

**Files:**
- Modify: `main.js:223-242`
- Modify: `preload.js:3-13`
- Modify: `app/剪辑.html:164-187`
- Modify: `app/editor-timeline.js:93-229`
- Modify: `tests/main-entry.test.js:10-21`
- Modify: `tests/e2e/electron-main.js:46-68`
- Create: `tests/e2e/local-cli-effect-flow.spec.js`

**Interfaces:**
- Consumes: `activeLocalCliService.translateEffect(text)` from Task 1.
- Produces: `window.srtAPI.translateLocalCliEffect(text): Promise<{ type: 'add_effect', effect: 'fade_in' }>`；成功时 DOM 新增 `[data-testid="timeline-effect-fade-in"]` 且状态显示“已生成编辑指令”。

- [ ] **Step 1: 写入 IPC 面与 E2E 的失败测试**

  在 `tests/main-entry.test.js` 断言存在：

  ```js
  assert.match(mainSource, /ipcMain\.handle\('local-cli:translate-effect'/);
  assert.match(preloadSource, /translateLocalCliEffect: \(text\) => ipcRenderer\.invoke\('local-cli:translate-effect', text\)/);
  assert.equal(preloadSource.includes('local-cli:exec'), false);
  ```

  新建 `tests/e2e/local-cli-effect-flow.spec.js`。复用 `localCliMode: 'two'`，进入编辑页，选择 `codex`，填入“添加淡入”，点击 `generateBtn`，断言状态文字和一个 fade-in marker；另一个测试让 fake 服务返回非法 JSON，断言错误状态且 marker 数为零：

  ```js
  await expect(window.getByTestId('effect-status')).toHaveText('已生成编辑指令');
  await expect(window.getByTestId('timeline-effect-fade-in')).toHaveCount(1);
  ```

- [ ] **Step 2: 运行测试，确认接口尚未存在**

  Run: `node --test tests/main-entry.test.js && npx playwright test tests/e2e/local-cli-effect-flow.spec.js`

  Expected: FAIL，缺少 `local-cli:translate-effect` 与对应 UI 状态。

- [ ] **Step 3: 实现专用 IPC 和纯 marker 应用**

  在 `main.js` 注册唯一 handler：

  ```js
  ipcMain.handle('local-cli:translate-effect', (_event, text) => activeLocalCliService.translateEffect(text));
  ```

  在 `preload.js` 增加：

  ```js
  translateLocalCliEffect: (text) => ipcRenderer.invoke('local-cli:translate-effect', text),
  ```

  在 `app/剪辑.html` 的输入区增加一个不含敏感输出的状态元素：

  ```html
  <div id="effectStatus" data-testid="effect-status" aria-live="polite"></div>
  ```

  在 `app/editor-timeline.js` 新增一个小函数，只接受 Task 1 的精确对象，并复用 `timelineEffects.push(ef); addMarker(ef);`：

  ```js
  function applyLocalCliEffect(instruction) {
    if (!instruction || instruction.type !== 'add_effect' || instruction.effect !== 'fade_in') return false;
    var ef = { name: '淡入', time: videoDuration ? videoEl.currentTime : 0, color: 'var(--accent)' };
    timelineEffects.push(ef);
    var marker = addMarker(ef);
    marker.dataset.testid = 'timeline-effect-fade-in';
    return true;
  }
  ```

  同时把 `addMarker` 改为 `return track.appendChild(...)`。提交按钮对非命令文本仅调用 `window.srtAPI.translateLocalCliEffect(t)`；成功显示“已生成编辑指令”，失败显示“未能生成编辑指令，请先选择可用的本地 CLI 或重试。”，不回退现有云端/Ollama 或 `translateEffect`/FFmpeg 执行路径。E2E fake `localCliService` 增加 `translateEffect`，依据 `SRT_E2E_EFFECT_RESULT` 返回合法对象或抛 `LOCAL_CLI_INVALID_EFFECT_OUTPUT`；fixture 透传该变量。

- [ ] **Step 4: 运行接口和 E2E 测试，确认通过**

  Run: `node --test tests/main-entry.test.js && npx playwright test tests/e2e/local-cli-effect-flow.spec.js`

  Expected: PASS；成功用例只有一个 marker，非法结果用例 marker 数仍为零。

- [ ] **Step 5: 提交可见最小流程**

  ```bash
  git add main.js preload.js app/剪辑.html app/editor-timeline.js tests/main-entry.test.js tests/e2e/electron-main.js tests/e2e/electron.fixture.js tests/e2e/local-cli-effect-flow.spec.js
  git commit -m "feat: show local CLI effect instruction"
  ```

### Task 3: 在新流程验收后移除旧环境页翻译 UI

**Files:**
- Modify: `app/环境检测.html`（旧 “AI 效果翻译” `<details id="aiCollapse">` 区块）
- Modify: `app/env-check.js`（只删除与该 UI 的 DOM 查询、渲染、事件监听和初始化调用）
- Modify: `tests/e2e/environment-flow.spec.js`

**Interfaces:**
- Consumes: Task 2 已通过的本地 CLI 编辑器流程。
- Produces: 环境页不再展示云端/Ollama “AI 效果翻译”配置；旧 main/preload 后端接口仍保持原样。

- [ ] **Step 1: 写旧 UI 消失的失败 E2E 断言**

  在 `tests/e2e/environment-flow.spec.js` 的 macOS ready journey 中替换旧 AI 配置断言，保留环境检测与继续按钮断言，并加入：

  ```js
  await expect(window.locator('#aiCollapse')).toHaveCount(0);
  await expect(window.locator('body')).not.toContainText('AI 效果翻译');
  ```

- [ ] **Step 2: 运行 E2E，确认旧 UI 仍导致失败**

  Run: `npx playwright test tests/e2e/environment-flow.spec.js`

  Expected: FAIL，因为 `#aiCollapse` 目前存在。

- [ ] **Step 3: 删除旧 renderer UI，不触碰后端**

  从 `app/环境检测.html` 删除只包含云端/Ollama 状态、配置和手动输入的 `#aiCollapse` 区块；从 `app/env-check.js` 删除只服务该块的变量、`queryAIConfig`/`detectOllama` 调用、渲染函数和监听器。保留本地 CLI 列表、扫描、选择和环境检测流程。不得修改 `main.js` 中 `ai:*` handlers 或 `preload.js` 中旧 `ai:*` 方法。

- [ ] **Step 4: 运行完整自动验证**

  Run: `npm run test:unit && npm run test:e2e`

  Expected: PASS；环境页不出现旧翻译 UI，本地 CLI 选择与单效果 E2E 均通过。

- [ ] **Step 5: 做一次手工 Mac 验证并立即止损**

  Run: `SRT_REAL_MAC_SMOKE=1 npm run test:e2e:real-mac`

  Expected: PASS；随后在已安装 CLI 的应用中手动选择 CLI、输入“添加淡入”，确认出现“已生成编辑指令”和一个淡入 marker。确认后不继续加入更多指令或清理旧后端。

- [ ] **Step 6: 提交旧 UI 剥离与验证结果**

  ```bash
  git add app/环境检测.html app/env-check.js tests/e2e/environment-flow.spec.js
  git commit -m "refactor: remove legacy AI translation UI"
  ```
