# AI 效果配方实时推导（积木组合层）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让本地 CLI 收到一个用户想要的效果时，实时推导出由底层能力（积木）组成的有序步骤、每个步骤的参数与时间区间，而不是从预设效果里查表。

**Architecture:** 把能力注册表从「id → 一句话」升级为「id → 参数模式声明」，提示词只教分解方法不教效果映射，输出协议仍为 clarify/instruction.steps，校验改为按每个能力声明的参数模式做白名单 + 类型/范围检查。只改推导层，不改渲染与导出。

**Tech Stack:** Node/Electron、node:test、本地 CLI（codex/claude/gemini exec）。

## Global Constraints

- 只实现“实时推导”这一段：注册表、提示词、输出协议、校验。
- 本轮新增三个可组合视觉积木：`color.grade@1`、`texture.grain@1`、`vignette@1`；保留 `subtitle.generate@1`、`fade.in@1`、`fade.out@1`。
- 所有参数值本轮只支持 `number`，带 `min/max/default/description`；时间统一用 `start`/`end`（秒）。
- 提示词禁止出现“预设效果 → 固定配方”映射；只给分解方法规则。
- 模型不得编造新能力 id；未知需求应输出 `clarify`。
- `parseInstruction` 对未知能力、未声明参数、越界参数、非法时间一律抛 `LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT`。
- 不改 `src/local-cli.js` 的调用方式、不改 renderer、不改渲染配方、不改 e2e stub。

---

## File Structure

- Modify: `src/instruction-capabilities.js` — 能力注册表 + 提示词 + 解析校验唯一入口。
- Test: `tests/instruction-capabilities.test.js` — 注册表、提示词、解析、样例推导契约。
- Modify: `tests/local-cli.test.js` — 服务层透传新积木配方的回归覆盖。

### Task 1: 参数化能力注册表 + 分解提示 + 模式校验

**Files:**
- Modify: `src/instruction-capabilities.js`
- Test: `tests/instruction-capabilities.test.js`

**Interfaces:**
- Consumes: 无（当前模块已是唯一入口）。
- Produces:
  - `CAPABILITY_SCHEMAS`：数组，元素为 `{ id, summary, timing, params }`。
  - `getCapabilitySchema(id)` → schema 对象或 `null`。
  - `buildPrompt(userText, history)` → string。
  - `parseInstruction(output)` → `{kind:'clarify',message}` 或 `{kind:'instruction',steps}`；非法时抛 `{code:'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT'}`。

- [ ] **Step 1: 写失败测试（覆盖全部新契约）**

用下面的完整内容覆盖 `tests/instruction-capabilities.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { CAPABILITY_SCHEMAS, getCapabilitySchema, buildPrompt, parseInstruction } = require('../src/instruction-capabilities');

test('registry declares the three existing capabilities and three visual primitives', () => {
  assert.deepEqual(CAPABILITY_SCHEMAS.map((schema) => schema.id).sort(), [
    'color.grade@1', 'fade.in@1', 'fade.out@1',
    'subtitle.generate@1', 'texture.grain@1', 'vignette@1'
  ].sort());
});

test('every capability carries timing and a declared numeric param mode', () => {
  const color = getCapabilitySchema('color.grade@1');
  assert.ok(color);
  assert.equal(color.timing, true);
  assert.deepEqual(Object.keys(color.params).sort(), ['contrast', 'saturation', 'warmth']);
  assert.equal(color.params.warmth.type, 'number');
  assert.equal(color.params.warmth.min, -1);
  assert.equal(color.params.warmth.max, 1);
  assert.equal(color.params.warmth.default, 0);
  assert.equal(getCapabilitySchema('texture.grain@1').params.amount.max, 1);
  assert.equal(getCapabilitySchema('vignette@1').params.strength.min, 0);
  assert.equal(getCapabilitySchema('subtitle.generate@1').timing, true);
  assert.equal(getCapabilitySchema('missing@1'), null);
});

test('buildPrompt lists every primitive, param meaning, decomposition rules, and the two output kinds', () => {
  const prompt = buildPrompt('把 12 到 18 秒做成复古胶片感，片尾淡出');
  assert.match(prompt, /color\.grade@1/);
  assert.match(prompt, /texture\.grain@1/);
  assert.match(prompt, /vignette@1/);
  assert.match(prompt, /fade\.in@1/);
  assert.match(prompt, /fade\.out@1/);
  assert.match(prompt, /subtitle\.generate@1/);
  assert.match(prompt, /warmth/);
  assert.match(prompt, /saturation/);
  assert.match(prompt, /contrast/);
  assert.match(prompt, /amount/);
  assert.match(prompt, /strength/);
  assert.match(prompt, /start/);
  assert.match(prompt, /end/);
  assert.match(prompt, /clarify/);
  assert.match(prompt, /steps/);
  assert.match(prompt, /实时拆解/);
  assert.match(prompt, /不要创建新的能力/);
  assert.match(prompt, /把 12 到 18 秒做成复古胶片感，片尾淡出/);
});

test('buildPrompt includes conversation history when provided', () => {
  const prompt = buildPrompt('对', [
    { role: 'user', text: '做个效果' },
    { role: 'assistant', text: '你要什么氛围？' }
  ]);
  assert.match(prompt, /用户：做个效果/);
  assert.match(prompt, /助手：你要什么氛围？/);
  assert.match(prompt, /用户当前请求：对/);
});

test('buildPrompt ignores a non-array history', () => {
  const prompt = buildPrompt('加字幕', '不是数组');
  assert.match(prompt, /加字幕/);
  assert.doesNotMatch(prompt, /对话历史/);
});

test('parseInstruction parses a clarify turn and trims its message', () => {
  assert.deepEqual(parseInstruction('{"kind":"clarify","message":"你想要什么氛围？"}'), {
    kind: 'clarify', message: '你想要什么氛围？'
  });
  assert.deepEqual(parseInstruction('{"kind":"clarify","message":"  好  "}'), {
    kind: 'clarify', message: '好'
  });
});

test('parseInstruction parses an AI-derived retro film recipe with primitives, params and order', () => {
  const recipe = {
    kind: 'instruction',
    steps: [
      { capability: 'color.grade@1', params: { warmth: 0.18, saturation: 0.8, contrast: 1.1, start: 12, end: 18 } },
      { capability: 'texture.grain@1', params: { amount: 0.22, start: 12, end: 18 } },
      { capability: 'vignette@1', params: { strength: 0.35, start: 12, end: 18 } },
      { capability: 'fade.out@1', params: { start: 18, end: 20 } }
    ]
  };
  assert.deepEqual(parseInstruction(JSON.stringify(recipe)), recipe);
});

test('parseInstruction preserves order and accepts omitted optional params', () => {
  assert.deepEqual(parseInstruction(JSON.stringify({
    kind: 'instruction',
    steps: [
      { capability: 'texture.grain@1', params: {} },
      { capability: 'vignette@1', params: { strength: 0.2 } }
    ]
  })), {
    kind: 'instruction',
    steps: [
      { capability: 'texture.grain@1', params: {} },
      { capability: 'vignette@1', params: { strength: 0.2 } }
    ]
  });
});

test('parseInstruction rejects out-of-range and undeclared params', () => {
  for (const output of [
    '{"kind":"instruction","steps":[{"capability":"color.grade@1","params":{"warmth":2}}]}',
    '{"kind":"instruction","steps":[{"capability":"color.grade@1","params":{"contrast":-0.5}}]}',
    '{"kind":"instruction","steps":[{"capability":"texture.grain@1","params":{"amount":1.2}}]}',
    '{"kind":"instruction","steps":[{"capability":"vignette@1","params":{"speed":2}}]}',
    '{"kind":"instruction","steps":[{"capability":"retro.film@1","params":{}}]}'
  ]) {
    assert.throws(() => parseInstruction(output), { code: 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT' });
  }
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
  '{"kind":"instruction","steps":[{"capability":"fade.in@1","params":{"start":5,"end":5}}]}',
  '{"kind":"instruction","steps":[{"capability":"color.grade@1","params":[]}]}',
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
Expected: FAIL（注册表仍是 3 个能力、无 `CAPABILITY_SCHEMAS`/`getCapabilitySchema` 导出）

- [ ] **Step 3: 写最小实现**

用下面的完整内容覆盖 `src/instruction-capabilities.js`：

```js
var CAPABILITY_SCHEMAS = Object.freeze([
  Object.freeze({
    id: 'subtitle.generate@1',
    summary: '给视频（或指定时间区间）生成字幕',
    timing: true,
    params: Object.freeze({})
  }),
  Object.freeze({
    id: 'fade.in@1',
    summary: '画面从黑场淡入（或指定时间区间淡入）',
    timing: true,
    params: Object.freeze({})
  }),
  Object.freeze({
    id: 'fade.out@1',
    summary: '画面淡出到黑场（或指定时间区间淡出）',
    timing: true,
    params: Object.freeze({})
  }),
  Object.freeze({
    id: 'color.grade@1',
    summary: '调整画面整体色调',
    timing: true,
    params: Object.freeze({
      warmth: Object.freeze({
        type: 'number', min: -1, max: 1, default: 0,
        description: '正值偏暖色，负值偏冷色'
      }),
      saturation: Object.freeze({
        type: 'number', min: 0, max: 2, default: 1,
        description: '1 为原饱和度，0 为黑白，大于 1 更鲜艳'
      }),
      contrast: Object.freeze({
        type: 'number', min: 0, max: 2, default: 1,
        description: '1 为原对比度，大于 1 更强，小于 1 更柔和'
      })
    })
  }),
  Object.freeze({
    id: 'texture.grain@1',
    summary: '叠加胶片颗粒质感',
    timing: true,
    params: Object.freeze({
      amount: Object.freeze({
        type: 'number', min: 0, max: 1, default: 0,
        description: '0 无颗粒，1 颗粒最强'
      })
    })
  }),
  Object.freeze({
    id: 'vignette@1',
    summary: '为画面四周添加暗角',
    timing: true,
    params: Object.freeze({
      strength: Object.freeze({
        type: 'number', min: 0, max: 1, default: 0,
        description: '0 无暗角，1 暗角最强'
      })
    })
  })
]);

var SCHEMA_BY_ID = (function () {
  var map = {};
  for (var i = 0; i < CAPABILITY_SCHEMAS.length; i++) {
    map[CAPABILITY_SCHEMAS[i].id] = CAPABILITY_SCHEMAS[i];
  }
  return map;
})();

function getCapabilitySchema(id) {
  return SCHEMA_BY_ID[id] || null;
}

function describeParam(key, spec) {
  var range = typeof spec.min === 'number' ? ' ' + spec.min + '~' + spec.max : '';
  return key + '(' + spec.type + range + ', 默认 ' + spec.default + ')：' + spec.description;
}

function capabilityLine(schema) {
  var ownParams = Object.keys(schema.params).map(function (key) {
    return describeParam(key, schema.params[key]);
  });
  var text = '- ' + schema.id + '：' + schema.summary;
  if (ownParams.length) text += '；参数：' + ownParams.join('，');
  if (schema.timing) text += '；可带 start/end 时间区间（秒）';
  return text;
}

function isPlainObject(value) {
  return value && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function invalidInstructionError() {
  var error = new Error('Invalid local CLI instruction output');
  error.code = 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT';
  return error;
}

function buildPrompt(userText, history) {
  var lines = [
    '你是视频剪辑配方推导器。把用户想要的效果实时拆解成底层能力的有序组合，不要输出“预设效果名”。',
    '推导规则：',
    '- 先判断这个效果由哪些底层画面变化构成，再选择能力；一个能力只负责一种变化。',
    '- 颜色变化优先选 color.grade@1；颗粒质感选 texture.grain@1；暗角选 vignette@1；明暗过渡选 fade.in@1/fade.out@1；需要画面文字时选 subtitle.generate@1。',
    '- 必须只使用下面“可用能力（底层积木）”中列出的 id；没有合适能力时输出 clarify 追问，不要创建新的能力。',
    '- 一个步骤只能调用一个能力，只能输出该能力声明过的参数；没有把握的强度参数就用能力声明的默认值，不要写。',
    '- 需要限定作用时间时，只使用 start/end（数字秒，start 大于等于 0，end 大于 start）；不限定就不写。',
    '- 多个步骤按实际施加顺序排列：先发生的在前，整体过渡（如淡出）放最后。',
    '可用能力（底层积木）：'
  ];

  for (var i = 0; i < CAPABILITY_SCHEMAS.length; i++) {
    lines.push(capabilityLine(CAPABILITY_SCHEMAS[i]));
  }

  lines = lines.concat([
    '每次只输出一个 JSON 对象，只能是下面两种之一：',
    '1. 信息不足、需要向用户追问时：{"kind":"clarify","message":"追问内容"}',
    '2. 信息已经足够时：{"kind":"instruction","steps":[{"capability":"能力id","params":{}}]}',
    'steps 是一组按顺序执行的能力，可以包含一条或多条。',
    '不要输出命令、Markdown、代码块或任何额外解释，只输出 JSON。'
  ]);

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

function validateNumericValue(key, value, spec) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidInstructionError();
  }
  if (typeof spec.min === 'number' && value < spec.min) throw invalidInstructionError();
  if (typeof spec.max === 'number' && value > spec.max) throw invalidInstructionError();
}

function normalizeParams(schema, params) {
  if (!isPlainObject(params)) throw invalidInstructionError();
  var allowed = {};
  Object.keys(schema.params).forEach(function (key) { allowed[key] = true; });
  if (schema.timing) {
    allowed.start = true;
    allowed.end = true;
  }
  Object.keys(params).forEach(function (key) {
    if (!allowed[key]) throw invalidInstructionError();
  });

  var out = {};
  Object.keys(schema.params).forEach(function (key) {
    if (params[key] === undefined) return;
    validateNumericValue(key, params[key], schema.params[key]);
    out[key] = params[key];
  });

  if (schema.timing) {
    if (params.start !== undefined) {
      validateNumericValue('start', params.start, { min: 0 });
      out.start = params.start;
    }
    if (params.end !== undefined) {
      validateNumericValue('end', params.end, { min: 0 });
      out.end = params.end;
    }
    if (out.start !== undefined && out.end !== undefined && out.end <= out.start) {
      throw invalidInstructionError();
    }
  }
  return out;
}

function normalizeStep(step) {
  if (!isPlainObject(step)) throw invalidInstructionError();
  var keys = Object.keys(step).sort();
  if (keys.length !== 2 || keys[0] !== 'capability' || keys[1] !== 'params') {
    throw invalidInstructionError();
  }
  var schema = getCapabilitySchema(step.capability);
  if (!schema) throw invalidInstructionError();
  return {
    capability: step.capability,
    params: normalizeParams(schema, step.params)
  };
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
  CAPABILITY_SCHEMAS: CAPABILITY_SCHEMAS,
  getCapabilitySchema: getCapabilitySchema,
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
git commit -m "feat: parameterized capability registry with AI composition prompt and schema validation"
```

### Task 2: local-cli 服务层透传新积木配方回归

**Files:**
- Modify: `tests/local-cli.test.js`

**Interfaces:**
- Consumes: Task 1 的 `parseInstruction`（同一返回形状，能力白名单扩到 6 个）。
- Produces: 服务层可透传多积木配方，不因新能力 id 报错。

- [ ] **Step 1: 追加透传测试**

在 `tests/local-cli.test.js` 的 `translates a fade request into fade.in instruction` 测试之后插入：

```js
test('passes through an AI-derived multi-primitive recipe in order', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const { run } = fakeTranslator(JSON.stringify({
    kind: 'instruction',
    steps: [
      { capability: 'color.grade@1', params: { warmth: 0.18, saturation: 0.8, contrast: 1.1, start: 12, end: 18 } },
      { capability: 'texture.grain@1', params: { amount: 0.22, start: 12, end: 18 } },
      { capability: 'vignette@1', params: { strength: 0.35, start: 12, end: 18 } },
      { capability: 'fade.out@1', params: { start: 18, end: 20 } }
    ]
  }));
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  await service.select('codex');
  assert.deepEqual(await service.translateInstruction('把 12 到 18 秒做成复古胶片感，片尾淡出'), {
    kind: 'instruction',
    steps: [
      { capability: 'color.grade@1', params: { warmth: 0.18, saturation: 0.8, contrast: 1.1, start: 12, end: 18 } },
      { capability: 'texture.grain@1', params: { amount: 0.22, start: 12, end: 18 } },
      { capability: 'vignette@1', params: { strength: 0.35, start: 12, end: 18 } },
      { capability: 'fade.out@1', params: { start: 18, end: 20 } }
    ]
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

Run: `node --test tests/local-cli.test.js tests/instruction-capabilities.test.js`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add tests/local-cli.test.js
git commit -m "test: cover AI-derived multi-primitive recipe passthrough in local-cli service"
```

### Task 3: 全量回归 + 真实 CLI 冒烟验收

**Files:** 无代码改动。

- [ ] **Step 1: 全量单测**

Run: `npm test`
Expected: 全绿；新增指令能力测试全部通过。

- [ ] **Step 2: 真实本地 CLI 冒烟（人工验收）**

在已配置本地 CLI 的应用对话里输入：

`把 12 到 18 秒做成复古胶片感，片尾淡出`

验收标准：主进程把本地 CLI 返回结果解析成 instruction 且 steps 包含 `color.grade@1`、`texture.grain@1`、`vignette@1`、`fade.out@1`（数量与顺序可不同，但必须由 AI 实时组合，而不是返回“复古胶片感”这个能力 id）。

- [ ] **Step 3: 全量回归后提交收尾（如无未提交改动则跳过）**

```bash
git status --short
git log --oneline -3
```

## Self-Review

- **Spec coverage:** Task 1 覆盖四个实现结构：参数化积木注册表（`CAPABILITY_SCHEMAS`）、只教分解方法的提示词、steps 输出协议、按参数模式的白名单/范围校验；Task 2 覆盖服务层透传；Task 3 覆盖全量回归与真实 CLI 冒烟。
- **Placeholder scan:** 无 TBD/TODO；源码与测试均为完整内容。
- **Type consistency:** `CAPABILITY_SCHEMAS`/`getCapabilitySchema`/`buildPrompt`/`parseInstruction` 名称与导出在 Task 1 测试、实现、Task 2 用例间一致；能力 id 沿用 `lowercase.name@1`，步骤参数只含声明键与可选 `start`/`end`。
