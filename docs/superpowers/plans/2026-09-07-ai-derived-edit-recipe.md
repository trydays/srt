# AI 实时推导编辑步骤：底层能力当积木 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把本地 CLI 的编辑翻译从「单步、空参数、字幕/淡入二选一」升级为「AI 把字幕、淡入、淡出三块底层能力组合成一条带时间区间的多步骤编辑指令」。

**Architecture:** 保持「能力注册表 + 生成式提示词 + 白名单校验」结构不变，只把注册表扩到三块能力、输出协议从单个 capability 改为 steps 数组、params 从空对象升级为可选时间区间；renderer 逐条受控执行到时间轴 marker。不新增 shell/ffmpeg 通道、不改渲染导出层。

**Tech Stack:** Node/Electron（main + preload + renderer）、node:test、Playwright。

## 冻结范围（本阶段）

- 唯一目的：让 AI 能把自然语言组合成多步骤、带时间区间的编辑指令，并受控落到时间轴。
- 可直接查看/运行的成果：`npm test` 全绿；编辑器输入「从 12 到 18 秒加字幕，片尾淡出」得到字幕流程加淡出 marker；未知能力被拒绝。
- 明确不做什么：不建效果库、不搬回 24 个预设、不裁切字幕时间区间、不做视频区间渲染、不让 AI 输出 shell/ffmpeg、不改 render-recipe.js 渲染导出层。
- 时间上限：≤ 3 小时。
- 立即结束条件：单测全绿 + e2e 聚焦清单全绿 + 工作区干净提交。

## 全局约束

- 能力 id 统一 `lowercase.name@版本`，与渲染层同命名风格。
- 本轮能力恰三块：`subtitle.generate@1`、`fade.in@1`、`fade.out@1`。
- params 只允许可选键 `start`、`end`（数字秒）；`start>=0`，`end>start`。
- 输出只有两种：`{kind:'clarify',message}` 或 `{kind:'instruction',steps:[...]}`。
- 不在 preload/renderer 暴露 raw shell/ffmpeg 通道。

---

### Task 1: 恢复工作区，移除 main.js 临时调试日志

**Files:**
- Modify: `main.js`

**Interfaces:**
- Consumes: 无（纯清理）。
- Produces: 干净的 `local-cli:translate-instruction` handler，行为与 HEAD 一致。

- [ ] **Step 1: 用 apply_patch 移除调试日志**

把 `main.js` 里的 handler 从带 `/tmp/srt-debug.log` 写入的版本恢复为干净版本：

```js
  ipcMain.handle('local-cli:translate-instruction', async (_event, payload) => {
    const request = payload && typeof payload === 'object' ? payload : {};
    try {
      const instruction = await activeLocalCliService.translateInstruction(request.text, request.history);
      return { ok: true, instruction };
    } catch (error) {
      return publicFailure(error, 'LOCAL_CLI_TRANSLATION_FAILED');
    }
  });
```

即删除 `require('fs').appendFileSync('/tmp/srt-debug.log', ...)` 三处写入，以及 catch 里包裹调试写入的 `try { ... } catch (_) {}`。

- [ ] **Step 2: 运行主进程测试确认无回归**

Run: `node --test tests/main-entry.test.js tests/local-cli.test.js`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add main.js
git commit -m "chore: remove temporary local-cli IPC debug logging"
```

---

### Task 2: 指令能力注册表升级为三积木 + 多步 recipe + 时间区间

**Files:**
- Modify: `src/instruction-capabilities.js`
- Test: `tests/instruction-capabilities.test.js`

**Interfaces:**
- Consumes: 无（纯模块）。
- Produces:
  - `INSTRUCTION_CAPABILITIES`：三块能力的 `{ id: 说明 }`。
  - `CAPABILITY_PARAM_KEYS`：`['start','end']`。
  - `buildPrompt(userText, history)` → string。
  - `parseInstruction(output)` → `{kind:'clarify',message}` 或 `{kind:'instruction',steps:[{capability,params}]}`，非法时抛 `{code:'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT'}`。

- [ ] **Step 1: 写失败测试**

用下面的完整内容覆盖 `tests/instruction-capabilities.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { INSTRUCTION_CAPABILITIES, buildPrompt, parseInstruction } = require('../src/instruction-capabilities');

test('registry declares the three bottom-level capabilities', () => {
  assert.deepEqual(Object.keys(INSTRUCTION_CAPABILITIES).sort(),
    ['fade.in@1', 'fade.out@1', 'subtitle.generate@1']);
});

test('buildPrompt lists every capability, time ranges, and the two output kinds', () => {
  const prompt = buildPrompt('从 12 到 18 秒加字幕，片头淡入');
  assert.match(prompt, /subtitle\.generate@1/);
  assert.match(prompt, /fade\.in@1/);
  assert.match(prompt, /fade\.out@1/);
  assert.match(prompt, /start/);
  assert.match(prompt, /end/);
  assert.match(prompt, /clarify/);
  assert.match(prompt, /steps/);
  assert.match(prompt, /从 12 到 18 秒加字幕，片头淡入/);
});

test('buildPrompt includes conversation history when provided', () => {
  const prompt = buildPrompt('对', [
    { role: 'user', text: '做个效果' },
    { role: 'assistant', text: '你想要字幕还是淡入？' }
  ]);
  assert.match(prompt, /用户：做个效果/);
  assert.match(prompt, /助手：你想要字幕还是淡入？/);
  assert.match(prompt, /用户当前请求：对/);
});

test('buildPrompt ignores a non-array history', () => {
  const prompt = buildPrompt('加字幕', '不是数组');
  assert.match(prompt, /加字幕/);
  assert.doesNotMatch(prompt, /对话历史/);
});

test('parseInstruction parses a clarify turn and trims its message', () => {
  assert.deepEqual(parseInstruction('{"kind":"clarify","message":"你想要字幕还是淡入？"}'), {
    kind: 'clarify', message: '你想要字幕还是淡入？'
  });
  assert.deepEqual(parseInstruction('{"kind":"clarify","message":"  好  "}'), {
    kind: 'clarify', message: '好'
  });
});

test('parseInstruction parses a multi-step instruction with time ranges', () => {
  assert.deepEqual(parseInstruction(JSON.stringify({
    kind: 'instruction',
    steps: [
      { capability: 'subtitle.generate@1', params: { start: 12, end: 18 } },
      { capability: 'fade.in@1', params: {} }
    ]
  })), {
    kind: 'instruction',
    steps: [
      { capability: 'subtitle.generate@1', params: { start: 12, end: 18 } },
      { capability: 'fade.in@1', params: {} }
    ]
  });
});

test('parseInstruction accepts a single-step instruction', () => {
  assert.deepEqual(
    parseInstruction('{"kind":"instruction","steps":[{"capability":"fade.out@1","params":{}}]}'),
    { kind: 'instruction', steps: [{ capability: 'fade.out@1', params: {} }] }
  );
});

test('parseInstruction rejects a start greater than or equal to end', () => {
  assert.throws(
    () => parseInstruction('{"kind":"instruction","steps":[{"capability":"fade.in@1","params":{"start":5,"end":5}}]}'),
    { code: 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT' }
  );
});

for (const output of [
  'not json',
  '[]',
  '{"kind":"clarify","message":""}',
  '{"kind":"clarify","message":"   "}',
  '{"kind":"clarify"}',
  '{"kind":"instruction","steps":[]}',
  '{"kind":"instruction","steps":[{"capability":"trim@1","params":{}}]}',
  '{"kind":"instruction","steps":[{"capability":123,"params":{}}]}',
  '{"kind":"instruction","steps":[{"capability":"fade.in@1","params":{"speed":2}}]}',
  '{"kind":"instruction","steps":[{"capability":"fade.in@1","params":{"start":-1}}]}',
  '{"kind":"instruction","steps":[{"capability":"fade.in@1","params":{"end":"later"}}]}',
  '{"kind":"unknown"}',
  '{"capability":"fade.in@1","params":{}}'
]) {
  test(`parseInstruction rejects invalid output: ${output}`, () => {
    assert.throws(() => parseInstruction(output), { code: 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT' });
  });
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/instruction-capabilities.test.js`
Expected: FAIL（旧实现仍只认单步 `capability`，不认 `steps`）

- [ ] **Step 3: 写最小实现**

用下面的完整内容覆盖 `src/instruction-capabilities.js`：

```js
var INSTRUCTION_CAPABILITIES = Object.freeze({
  'subtitle.generate@1': '给视频（或指定时间区间）生成字幕',
  'fade.in@1': '在片头（或指定时间区间）添加淡入',
  'fade.out@1': '在片尾（或指定时间区间）添加淡出'
});

var CAPABILITY_PARAM_KEYS = Object.freeze(['start', 'end']);

function isPlainObject(value) {
  return value && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function invalidInstructionError() {
  var error = new Error('Invalid local CLI instruction output');
  error.code = 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT';
  return error;
}

function buildPrompt(userText, history) {
  var list = Object.keys(INSTRUCTION_CAPABILITIES).map(function (id) {
    return '- ' + id + '：' + INSTRUCTION_CAPABILITIES[id];
  }).join('\n');

  var lines = [
    '你是视频编辑对话助手，负责把用户的剪辑需求澄清成一组按顺序执行的可编辑步骤。',
    '可用能力（底层积木）：',
    list,
    '每条能力可以带可选时间区间参数，形如 {"start": 开始秒数, "end": 结束秒数}。',
    'start 与 end 都必须是数字（秒），start 必须大于等于 0，end 必须大于 start；不需要区间时用 {}。',
    '每次只输出一个 JSON 对象，只能是下面两种之一：',
    '1. 信息不足、需要向用户追问时：{"kind":"clarify","message":"追问内容"}',
    '2. 信息已经足够时：{"kind":"instruction","steps":[{"capability":"能力id","params":{}}]}',
    'steps 是一组按顺序执行的能力，可以包含一条或多条。',
    '不要输出命令、Markdown、代码块或任何额外解释，只输出 JSON。'
  ];

  if (Array.isArray(history) && history.length) {
    lines.push('对话历史：');
    history.forEach(function (turn) {
      var roleLabel = turn && turn.role === 'assistant' ? '助手' : '用户';
      lines.push(roleLabel + '：' + String((turn && turn.text) || ''));
    });
  }

  lines.push('用户当前请求：' + String(userText || ''));
  return lines.join('\n');
}

function normalizeParams(params) {
  var keys = Object.keys(params);
  for (var i = 0; i < keys.length; i++) {
    if (CAPABILITY_PARAM_KEYS.indexOf(keys[i]) === -1) throw invalidInstructionError();
  }
  var out = {};
  if (params.start !== undefined) {
    if (typeof params.start !== 'number' || !Number.isFinite(params.start) || params.start < 0) {
      throw invalidInstructionError();
    }
    out.start = params.start;
  }
  if (params.end !== undefined) {
    if (typeof params.end !== 'number' || !Number.isFinite(params.end)) {
      throw invalidInstructionError();
    }
    if (out.start !== undefined && params.end <= out.start) throw invalidInstructionError();
    out.end = params.end;
  }
  return out;
}

function normalizeStep(step) {
  if (!isPlainObject(step)) throw invalidInstructionError();
  var keys = Object.keys(step).sort();
  if (keys.length !== 2 || keys[0] !== 'capability' || keys[1] !== 'params') {
    throw invalidInstructionError();
  }
  if (typeof step.capability !== 'string' || !INSTRUCTION_CAPABILITIES[step.capability]) {
    throw invalidInstructionError();
  }
  if (!isPlainObject(step.params)) throw invalidInstructionError();
  return { capability: step.capability, params: normalizeParams(step.params) };
}

function parseInstruction(output) {
  var value;
  try {
    value = JSON.parse(String(output).trim());
  } catch (_) {
    throw invalidInstructionError();
  }
  if (!isPlainObject(value)) throw invalidInstructionError();

  if (value.kind === 'clarify') {
    if (typeof value.message !== 'string' || !value.message.trim()) {
      throw invalidInstructionError();
    }
    return { kind: 'clarify', message: value.message.trim() };
  }

  if (value.kind === 'instruction') {
    if (!Array.isArray(value.steps) || value.steps.length === 0) throw invalidInstructionError();
    return { kind: 'instruction', steps: value.steps.map(normalizeStep) };
  }

  throw invalidInstructionError();
}

module.exports = {
  INSTRUCTION_CAPABILITIES: INSTRUCTION_CAPABILITIES,
  CAPABILITY_PARAM_KEYS: CAPABILITY_PARAM_KEYS,
  buildPrompt: buildPrompt,
  parseInstruction: parseInstruction
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/instruction-capabilities.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/instruction-capabilities.js tests/instruction-capabilities.test.js
git commit -m "feat: expand instruction registry to subtitle, fade-in, fade-out with ranged steps"
```

---

### Task 3: 适配 local-cli 服务层测试到多步契约

**Files:**
- Modify: `tests/local-cli.test.js`

**Interfaces:**
- Consumes: Task 2 的 `parseInstruction` 新返回形状（`{kind:'instruction',steps}`）。
- Produces: 服务层 `translateInstruction` 测试断言与真实实现一致；无源码改动。

> 本任务只改测试。Task 2 改完协议后，`tests/local-cli.test.js` 的旧断言会失败；本任务把断言与 stub 输出统一到 steps 形状。

- [ ] **Step 1: 更新 fakeTranslator 输出与断言到 steps 形状**

把下面四个位置从旧单步形状改成 steps 形状：

1. `translates a subtitle request into subtitle.generate instruction` 里：

```js
  const { calls, run } = fakeTranslator('{"kind":"instruction","capability":"subtitle.generate@1","params":{}}');
```
改为：
```js
  const { calls, run } = fakeTranslator('{"kind":"instruction","steps":[{"capability":"subtitle.generate@1","params":{}}]}');
```

并把断言：
```js
  assert.deepEqual(await service.translateInstruction('给视频加字幕'), {
    kind: 'instruction', capability: 'subtitle.generate@1', params: {}
  });
```
改为：
```js
  assert.deepEqual(await service.translateInstruction('给视频加字幕'), {
    kind: 'instruction', steps: [{ capability: 'subtitle.generate@1', params: {} }]
  });
```

2. `translates a fade request into fade.in instruction` 里，fakeTranslator 字符串与断言同理改为 steps 形状（capability 为 `fade.in@1`）：

```js
  const { run } = fakeTranslator('{"kind":"instruction","steps":[{"capability":"fade.in@1","params":{}}]}');
```
```js
  assert.deepEqual(await service.translateInstruction('给片头添加淡入'), {
    kind: 'instruction', steps: [{ capability: 'fade.in@1', params: {} }]
  });
```

3. `translate ignores stdin` 测试里的 callback 返回字符串：

```js
    callback(null, '{"kind":"instruction","capability":"fade.in@1","params":{}}', '');
```
改为：
```js
    callback(null, '{"kind":"instruction","steps":[{"capability":"fade.in@1","params":{}}]}', '');
```

4. 末尾 reject 循环的输出列表：

```js
for (const output of ['not json', '[]', '{"kind":"instruction","capability":"trim@1"}', '{"kind":"instruction","capability":123}']) {
```
改为：
```js
for (const output of ['not json', '[]', '{"kind":"instruction","steps":[{"capability":"trim@1","params":{}}]}', '{"kind":"instruction","steps":[{"capability":123,"params":{}}]}']) {
```

- [ ] **Step 2: 运行测试确认通过**

Run: `node --test tests/local-cli.test.js tests/instruction-capabilities.test.js`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add tests/local-cli.test.js
git commit -m "test: align local-cli tests with ranged multi-step instruction contract"
```

---

### Task 4: renderer 按 steps 逐条执行，支持淡入淡出与时间区间

**Files:**
- Modify: `app/editor-timeline.js`
- Modify: `tests/e2e/electron-main.js`
- Test: `tests/e2e/local-cli-effect-flow.spec.js`

**Interfaces:**
- Consumes: Task 2 的 `parseInstruction` 返回 `{kind:'instruction',steps:[{capability,params}]}`；preload 的 `translateInstruction` 透传。
- Produces: renderer 内 `applyEffectStep(step)`（淡入/淡出 → marker）、`applyInstructionSteps(steps)`（跳过字幕步骤并逐个加 marker）、`translateAndApply` 按 steps 分发字幕与效果。

- [ ] **Step 1: 改 e2e stub 返回 steps 并新增 multi-step 分支**

用下面完整方法覆盖 `tests/e2e/electron-main.js` 里的 `translateInstruction`：

```js
  async translateInstruction(text, history) {
    if (process.env.SRT_E2E_EFFECT_RESULT === 'invalid') {
      const error = new Error('Invalid local CLI instruction output');
      error.code = 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT';
      throw error;
    }
    if (process.env.SRT_E2E_EFFECT_RESULT === 'clarify-once') {
      if (!Array.isArray(history) || history.length <= 1) {
        return { kind: 'clarify', message: '你想要字幕还是淡入？' };
      }
      return { kind: 'instruction', steps: [{ capability: 'fade.in@1', params: {} }] };
    }
    if (process.env.SRT_E2E_EFFECT_RESULT === 'multi-step') {
      return { kind: 'instruction', steps: [
        { capability: 'subtitle.generate@1', params: { start: 12, end: 18 } },
        { capability: 'fade.out@1', params: { start: 18, end: 20 } }
      ] };
    }
    if (/字幕/.test(text)) {
      return { kind: 'instruction', steps: [{ capability: 'subtitle.generate@1', params: {} }] };
    }
    if (/淡出/.test(text)) {
      return { kind: 'instruction', steps: [{ capability: 'fade.out@1', params: {} }] };
    }
    return { kind: 'instruction', steps: [{ capability: 'fade.in@1', params: {} }] };
  }
```

- [ ] **Step 2: 在 spec 新增多步 + 淡出流程（先写失败断言）**

在 `tests/e2e/local-cli-effect-flow.spec.js` 末尾（`multi-turn clarify` describe 之后）追加：

```js
  test.describe('multi-step ranged instruction', () => {
    test.use({ localCliEffectResult: 'multi-step' });

    test('generates subtitles and adds a fade-out marker in one request', async ({ window }) => {
      await openEditorWithCodex(window);
      await window.locator('.input-editor').fill('从 12 到 18 秒加字幕，片尾淡出');
      await window.locator('#generateBtn').click();
      await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
      await expect(window.getByTestId('timeline-effect-fade-out')).toHaveCount(1);
    });
  });
```

- [ ] **Step 3: 运行 e2e 确认失败**

Run: `npx playwright test tests/e2e/local-cli-effect-flow.spec.js`
Expected: FAIL（renderer 仍读 `turn.capability`，不认 `steps`）

- [ ] **Step 4: 改 renderer**

把 `app/editor-timeline.js` 里的 `applyInstruction` 整体替换为：

```js
function effectName(step) {
  var params = step.params || {};
  var base = step.capability === 'fade.in@1' ? '淡入' : '淡出';
  if (typeof params.start === 'number' && typeof params.end === 'number') {
    return base + ' ' + formatDur(params.start) + '–' + formatDur(params.end);
  }
  return base;
}

function applyEffectStep(step) {
  if (!step || (step.capability !== 'fade.in@1' && step.capability !== 'fade.out@1')) {
    return false;
  }
  var params = step.params || {};
  var time = typeof params.start === 'number' ? params.start
    : (videoDuration ? videoEl.currentTime : 0);
  var effect = { name: effectName(step), time: time, color: 'var(--accent)' };
  var marker = createMarkerDOM(effect, timelineEffects.length);
  marker.dataset.testid = step.capability === 'fade.in@1'
    ? 'timeline-effect-fade-in' : 'timeline-effect-fade-out';
  track.appendChild(marker);
  timelineEffects.push(effect);
  return true;
}

function applyInstructionSteps(steps) {
  var appliedAny = false;
  for (var i = 0; i < steps.length; i++) {
    if (steps[i].capability === 'subtitle.generate@1') continue;
    if (applyEffectStep(steps[i])) appliedAny = true;
  }
  return appliedAny;
}
```

再把 `translateAndApply` 里从 `record.instructionStatus = 'success';` 到该函数末尾的分支替换为：

```js
  record.instructionStatus = 'success';
  var steps = turn.steps || [];
  var hasSubtitle = steps.some(function (step) {
    return step.capability === 'subtitle.generate@1';
  });
  var effectSteps = steps.filter(function (step) {
    return step.capability !== 'subtitle.generate@1';
  });
  if (hasSubtitle) {
    await runSubtitleInstruction(record, card);
    applyInstructionSteps(effectSteps);
    return;
  }
  record.subtitleRequest = false;
  updateRequestStatus(record, card, {
    instructionStatus: 'success', timelineStatus: 'applying', error: ''
  });
  var applied = applyInstructionSteps(effectSteps);
  updateRequestStatus(record, card, applied
    ? { timelineStatus: 'success', error: '' }
    : { timelineStatus: 'failed', error: '编辑指令未能应用到时间轴。' });
```

- [ ] **Step 5: 运行单测与 e2e 确认通过**

Run: `npm test`
Run: `npx playwright test tests/e2e/local-cli-effect-flow.spec.js`
Expected: 单测全绿；e2e 全绿（fade-in / invalid / clarify-once / multi-step 四个场景）

- [ ] **Step 6: 提交**

```bash
git add app/editor-timeline.js tests/e2e/electron-main.js tests/e2e/local-cli-effect-flow.spec.js
git commit -m "feat: apply multi-step instructions with fade-out and time ranges in editor"
```

---

## Self-Review

- **Spec coverage:** 三块积木（Task 2 注册表）、多步 steps 协议（Task 2 解析）、时间区间校验（Task 2 normalizeParams）、服务层透传（Task 3 测试）、renderer 逐条执行与淡出（Task 4），覆盖「AI 推导 + 组合 + 受控执行」核心闭环；「未知能力拒绝」由 Task 2 白名单与 e2e invalid 场景覆盖。
- **Placeholder scan:** 无 TBD/TODO；所有代码块完整。
- **Type consistency:** `{kind:'instruction',steps:[{capability,params}]}` 在 instruction-capabilities、local-cli、e2e stub、renderer 四处一致；`CAPABILITY_PARAM_KEYS` 只在 normalizeParams 使用；`applyEffectStep`/`applyInstructionSteps` 名称前后一致。
