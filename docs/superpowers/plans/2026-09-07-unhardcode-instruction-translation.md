# 去掉「淡入」写死：指令能力注册表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把本地 CLI 的自然语言翻译从「写死淡入/字幕二选一」改成数据驱动的能力注册表 + 生成式提示词 + 白名单校验。

**Architecture:** 新建 CommonJS 能力注册表模块（仅 main 进程 require），提示词由注册表动态生成；AI 输出 `{capability, params}`；软件按白名单校验，未知能力一律拒绝，已知能力在 renderer 按 id 路由到各自执行器。顺带删除 effects.js 预设库与旧 translateEffect 死路径。

**Tech Stack:** Node/Electron（main + preload + renderer）、node:test、Playwright。

## 冻结范围（本阶段）

- 唯一目的：消灭指令翻译硬编码，建立「能力注册表 + 生成提示词 + 白名单校验」最小闭环。
- 可直接查看/运行的成果：`node --test tests/*.test.js` 全绿；编辑器输入「给视频加字幕」走字幕管线、「片头淡入」走淡入标记、其他请求得到「暂不支持」提示；工作区干净提交。
- 明确不做什么：不建效果库、不搬 effects.js 的 24 个预设、不做时间区间参数抽取、不让 AI 输出 shell/ffmpeg、不建代码沙箱、不改渲染层 recipe。
- 时间上限：≤ 3 小时（4 个任务）。
- 立即结束条件：单测全绿 + `npx playwright test tests/e2e/auto-subtitles-flow.spec.js tests/e2e/video-export-flow.spec.js` 全绿，且无未提交改动。

## 全局约束

- 能力 id 统一 `lowercase.name@版本`，与渲染层 render-recipe.js 同命名风格。
- 翻译结果只有三种：`{capability, params}`（支持）、`{capability:null}`（不支持）、抛 `LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT`（非法/未知能力）。
- 本阶段能力仅两个：`subtitle.generate@1`、`fade.in@1`，两者 params 均为空对象。
- 不在 preload/renderer 暴露 raw shell/ffmpeg 通道。

---

### Task 1: 新增指令能力注册表模块

**Files:**
- Create: `src/instruction-capabilities.js`
- Test: `tests/instruction-capabilities.test.js`

**Interfaces:**
- Produces: `INSTRUCTION_CAPABILITIES`、`buildPrompt(userText)`、`parseInstruction(output)`。
- `buildPrompt(userText)` → string；`parseInstruction(output)` → `{capability, params}` 或 `{capability:null}`，非法时抛 `{code:'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT'}`。

- [ ] **Step 1: 写失败测试**

```js
// tests/instruction-capabilities.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { INSTRUCTION_CAPABILITIES, buildPrompt, parseInstruction } = require('../src/instruction-capabilities');

test('registry declares only subtitle.generate and fade.in', () => {
  assert.deepEqual(Object.keys(INSTRUCTION_CAPABILITIES).sort(), ['fade.in@1', 'subtitle.generate@1']);
});

test('buildPrompt lists every capability and echoes the request', () => {
  const prompt = buildPrompt('给视频加字幕');
  assert.match(prompt, /subtitle\.generate@1/);
  assert.match(prompt, /fade\.in@1/);
  assert.match(prompt, /给视频加字幕/);
});

test('parseInstruction returns a known capability with empty params', () => {
  assert.deepEqual(parseInstruction('{"capability":"fade.in@1","params":{}}'), {
    capability: 'fade.in@1', params: {}
  });
});

test('parseInstruction treats capability null as unsupported', () => {
  assert.deepEqual(parseInstruction('{"capability":null}'), { capability: null });
});

for (const output of ['not json', '[]', '{"capability":"trim@1"}', '{"capability":123}']) {
  test(`parseInstruction rejects invalid output: ${output}`, () => {
    assert.throws(() => parseInstruction(output), { code: 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT' });
  });
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/instruction-capabilities.test.js`
Expected: FAIL（`Cannot find module '../src/instruction-capabilities'`）

- [ ] **Step 3: 写最小实现**

```js
// src/instruction-capabilities.js
var INSTRUCTION_CAPABILITIES = Object.freeze({
  'subtitle.generate@1': '给整段视频生成字幕',
  'fade.in@1': '片头添加淡入'
});

function isPlainObject(value) {
  return value && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function invalidInstructionError() {
  var error = new Error('Invalid local CLI instruction output');
  error.code = 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT';
  return error;
}

function buildPrompt(userText) {
  var list = Object.keys(INSTRUCTION_CAPABILITIES).map(function (id) {
    return '- ' + id + '：' + INSTRUCTION_CAPABILITIES[id];
  }).join('\n');
  return [
    '你是视频编辑指令解析器，把用户请求映射为下列能力之一。',
    '可用能力：',
    list,
    '只输出一个 JSON 对象：{"capability":"<能力id>","params":{}}；',
    '无法匹配时输出 {"capability":null}。',
    '不要输出命令、Markdown 或解释。',
    '用户请求：' + String(userText || '')
  ].join('\n');
}

function parseInstruction(output) {
  var value;
  try {
    value = JSON.parse(String(output).trim());
  } catch (_) {
    throw invalidInstructionError();
  }
  if (!isPlainObject(value)) throw invalidInstructionError();
  if (value.capability === null || value.capability === undefined) {
    return { capability: null };
  }
  if (typeof value.capability !== 'string' || !INSTRUCTION_CAPABILITIES[value.capability]) {
    throw invalidInstructionError();
  }
  return { capability: value.capability, params: isPlainObject(value.params) ? value.params : {} };
}

module.exports = {
  INSTRUCTION_CAPABILITIES: INSTRUCTION_CAPABILITIES,
  buildPrompt: buildPrompt,
  parseInstruction: parseInstruction
};
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/instruction-capabilities.test.js`
Expected: PASS（5 tests）

- [ ] **Step 5: 提交**

```bash
git add src/instruction-capabilities.js tests/instruction-capabilities.test.js
git commit -m "feat: add instruction capability registry"
```

---

### Task 2: 让 local-cli 走能力注册表

**Files:**
- Modify: `src/local-cli.js`
- Test: `tests/local-cli.test.js`

**Interfaces:**
- Consumes: `buildPrompt`、`parseInstruction`（Task 1）。
- Produces: `createLocalCliService(...)` 返回 `{ getState, rescan, select, translateInstruction }`；`translateInstruction(text)` → `{capability, params}` | `{capability:null}`，错误码沿用 `LOCAL_CLI_NOT_SELECTED` / `LOCAL_CLI_NOT_AVAILABLE` / `LOCAL_CLI_TRANSLATION_FAILED` / `LOCAL_CLI_TRANSLATION_TIMEOUT` / `LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT`。

- [ ] **Step 1: 写失败测试（替换旧断言）**

删除 `tests/local-cli.test.js` 中所有 `translateEffect` 与 `translateSubtitleOrFadeIn` 相关测试，替换为：

```js
test('translates a subtitle request into subtitle.generate capability', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const { calls, run } = fakeTranslator('{"capability":"subtitle.generate@1","params":{}}');
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  await service.select('codex');
  assert.deepEqual(await service.translateInstruction('给视频加字幕'), {
    capability: 'subtitle.generate@1', params: {}
  });
  assert.equal(calls.length, 1);
});

test('translates a fade request into fade.in capability', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const { run } = fakeTranslator('{"capability":"fade.in@1","params":{}}');
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  await service.select('codex');
  assert.deepEqual(await service.translateInstruction('给片头添加淡入'), {
    capability: 'fade.in@1', params: {}
  });
});

test('returns unsupported when the CLI answers capability null', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const { run } = fakeTranslator('{"capability":null}');
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  await service.select('codex');
  assert.deepEqual(await service.translateInstruction('做个三明治'), { capability: null });
});

test('reports a killed CLI translation as a timeout', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const timeout = Object.assign(new Error('timed out'), { killed: true });
  const { run } = fakeTranslator(timeout);
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  await service.select('codex');
  await assert.rejects(
    () => service.translateInstruction('给视频加字幕'),
    { code: 'LOCAL_CLI_TRANSLATION_TIMEOUT' }
  );
});

for (const output of ['not json', '[]', '{"capability":"trim@1"}', '{"capability":123}']) {
  test(`rejects unsupported instruction output: ${output}`, async () => {
    const fsApi = fakeFs(['/bin/codex']);
    const { run } = fakeTranslator(output);
    const service = createLocalCliService({
      platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
      fsApi, run: async () => ({ exitCode: 0 }), translate: run
    });
    await service.select('codex');
    await assert.rejects(
      () => service.translateInstruction('任意请求'),
      { code: 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT' }
    );
  });
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/local-cli.test.js`
Expected: FAIL（`service.translateInstruction is not a function`）

- [ ] **Step 3: 写最小实现**

在 `src/local-cli.js` 顶部 require 注册表：

```js
const { buildPrompt, parseInstruction } = require('./instruction-capabilities');
```

删除 `EFFECT_PROMPT`、`SUBTITLE_OR_FADE_IN_PROMPT` 两个常量；`EFFECT_ARGS` 名称保持不变。

删除 `invalidEffectOutputError`、`invalidInstructionOutputError`、`parseEffectInstruction`、`parseSubtitleOrFadeInInstruction` 四个函数。

删除 `translateEffect` 与 `translateSubtitleOrFadeIn`，替换为：

```js
async function translateInstruction(text) {
  const available = await scan();
  const selectedCliId = await readSelection();
  if (!selectedCliId) throw notSelectedError();
  const selectedCli = available.find((item) => item.id === selectedCliId);
  if (!selectedCli) throw unavailableError();
  const argsFactory = EFFECT_ARGS[selectedCliId];
  if (typeof argsFactory !== 'function') throw translationFailedError();
  let output;
  try {
    output = await translateEffectOutput(selectedCli.file, argsFactory(buildPrompt(text)));
  } catch (error) {
    throw instructionTranslationError(error);
  }
  return parseInstruction(output);
}
```

返回对象改为：

```js
return {
  getState: () => state(),
  rescan: () => state(),
  select: (id) => state(id),
  translateInstruction
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/local-cli.test.js`
Expected: PASS（新增 6 个翻译测试通过，原有 getState/select 测试不变）

- [ ] **Step 5: 提交**

```bash
git add src/local-cli.js tests/local-cli.test.js
git commit -m "refactor: translate instructions via capability registry"
```

---

### Task 3: 收敛 IPC 为单一翻译通道

**Files:**
- Modify: `main.js:271-280`
- Modify: `preload.js:11-12`
- Test: `tests/main-entry.test.js`

**Interfaces:**
- Consumes: `translateInstruction`（Task 2）。
- Produces: preload 暴露 `translateInstruction(text) => ipcRenderer.invoke('local-cli:translate-instruction', text)`；main 暴露 `ipcMain.handle('local-cli:translate-instruction', …)`。

- [ ] **Step 1: 写失败测试**

在 `tests/main-entry.test.js` 的 `'main and preload expose only narrow local CLI operations'` 测试里，把两处 translate-effect / translate-subtitle-or-fade-in 断言替换为：

```js
  assert.match(mainSource, /ipcMain\.handle\('local-cli:translate-instruction'/);
  assert.equal(mainSource.includes("local-cli:translate-effect"), false);
  assert.equal(mainSource.includes("local-cli:translate-subtitle-or-fade-in"), false);
  assert.match(preloadSource, /translateInstruction: \(text\) => ipcRenderer\.invoke\('local-cli:translate-instruction', text\)/);
  assert.equal(preloadSource.includes('translateLocalCliEffect'), false);
  assert.equal(preloadSource.includes('translateSubtitleOrFadeIn'), false);
```

同时把两处 `inertLocalCli` stub（约第 128、175 行）的 `translateEffect() {}, translateSubtitleOrFadeIn() {}` 改为 `translateInstruction() {}`。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/main-entry.test.js`
Expected: FAIL（断言找不到 `local-cli:translate-instruction`）

- [ ] **Step 3: 写最小实现**

`main.js` 删除 `local-cli:translate-effect` 与 `local-cli:translate-subtitle-or-fade-in` 两个 handler，替换为：

```js
  ipcMain.handle('local-cli:translate-instruction', async (_event, text) => {
    try {
      return { ok: true, instruction: await activeLocalCliService.translateInstruction(text) };
    } catch (error) {
      return publicFailure(error, 'LOCAL_CLI_TRANSLATION_FAILED');
    }
  });
```

`preload.js` 把 `translateLocalCliEffect` 与 `translateSubtitleOrFadeIn` 两行替换为：

```js
  translateInstruction: (text) => ipcRenderer.invoke('local-cli:translate-instruction', text),
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/main-entry.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add main.js preload.js tests/main-entry.test.js
git commit -m "refactor: expose single instruction translation IPC"
```

---

### Task 4: renderer 按能力路由并删除 effects.js

**Files:**
- Modify: `app/editor-timeline.js:47-53`、`app/editor-timeline.js:405-430`
- Delete: `app/effects.js`、`tests/effects.test.js`
- Modify: `tests/e2e/electron-main.js:67-83`
- Modify: `tests/e2e/video-export-flow.spec.js:96`
- Test: `tests/e2e/auto-subtitles-flow.spec.js`、`tests/e2e/video-export-flow.spec.js`

**Interfaces:**
- Consumes: preload 的 `translateInstruction`（Task 3）；renderer 内部 `runSubtitleInstruction(record, card)`（已存在）。
- Produces: `applyInstruction(instruction)` 被 `translateAndApply` 调用，返回 boolean。

- [ ] **Step 1: 写失败测试（改 e2e stub 与断言）**

`tests/e2e/electron-main.js` 删除 `translateEffect` 与 `translateSubtitleOrFadeIn`，替换为：

```js
  async translateInstruction(text) {
    if (process.env.SRT_E2E_EFFECT_RESULT === 'invalid') {
      const error = new Error('Invalid local CLI instruction output');
      error.code = 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT';
      throw error;
    }
    if (/字幕/.test(text)) return { capability: 'subtitle.generate@1', params: {} };
    return { capability: 'fade.in@1', params: {} };
  }
```

`tests/e2e/video-export-flow.spec.js` 第 96 行把 `applyLocalCliEffect({ type: 'add_effect', effect: 'fade_in' })` 替换为 `applyInstruction({ capability: 'fade.in@1', params: {} })`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx playwright test tests/e2e/auto-subtitles-flow.spec.js tests/e2e/video-export-flow.spec.js`
Expected: FAIL（renderer 里 `applyInstruction` 未定义、`translateInstruction` 未定义）

- [ ] **Step 3: 写最小实现**

`app/editor-timeline.js` 把 `applyLocalCliEffect` 整体替换为：

```js
function applyInstruction(instruction) {
  if (!instruction || instruction.capability !== 'fade.in@1') return false;
  var effect = { name: '淡入', time: videoDuration ? videoEl.currentTime : 0,
    color: 'var(--accent)' };
  var marker = createMarkerDOM(effect, timelineEffects.length);
  marker.dataset.testid = 'timeline-effect-fade-in';
  track.appendChild(marker);
  timelineEffects.push(effect);
  return true;
}
```

把 `translateAndApply` 整体替换为：

```js
async function translateAndApply(text, record, card) {
  var translated = await window.srtAPI.translateInstruction(text);
  if (!translated.ok) {
    updateRequestStatus(record, card, {
      instructionStatus: 'failed', timelineStatus: 'not_run',
      error: instructionErrorMessage(translated.errorCode)
    });
    return;
  }
  var instruction = translated.instruction;
  if (!instruction || instruction.capability === null) {
    updateRequestStatus(record, card, {
      instructionStatus: 'failed', timelineStatus: 'not_run',
      error: '暂不支持这个编辑操作，试试「生成字幕」或「淡入」。'
    });
    return;
  }
  record.instructionStatus = 'success';
  if (instruction.capability === 'subtitle.generate@1') {
    await runSubtitleInstruction(record, card);
    return;
  }
  record.subtitleRequest = false;
  updateRequestStatus(record, card, {
    instructionStatus: 'success', timelineStatus: 'applying', error: ''
  });
  var applied = applyInstruction(instruction);
  updateRequestStatus(record, card, applied
    ? { timelineStatus: 'success', error: '' }
    : { timelineStatus: 'failed', error: '编辑指令未能应用到时间轴。' });
}
```

从 `app/剪辑.html` 第 308 行附近删除 `<script src="effects.js"></script>`；删除 `app/effects.js` 与 `tests/effects.test.js`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/*.test.js` 与 `npx playwright test tests/e2e/auto-subtitles-flow.spec.js tests/e2e/video-export-flow.spec.js`
Expected: 单测全绿；两条 e2e 全绿。

- [ ] **Step 5: 提交**

```bash
git add app/editor-timeline.js app/剪辑.html tests/e2e/electron-main.js tests/e2e/video-export-flow.spec.js
git rm app/effects.js tests/effects.test.js
git commit -m "refactor: route renderer instructions by capability; remove effects.js"
```

---

## Self-Review

- **Spec coverage:** 四个任务分别覆盖注册表模块、local-cli 改造、IPC 收敛、renderer 路由 + effects.js 删除，与「去写死」四点边界一一对应。
- **Placeholder scan:** 无 TBD/TODO，所有代码块完整。
- **Type consistency:** `translateInstruction` 在 local-cli / main / preload / e2e stub / renderer 五处名称一致；`parseInstruction` 的 `{capability, params}` 与 `{capability:null}` 两种形状在各处一致；`applyInstruction` 仅接受 `{capability:'fade.in@1', params:{}}`。
