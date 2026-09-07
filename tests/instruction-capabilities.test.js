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

test('buildPrompt includes video project context when provided', () => {
  const prompt = buildPrompt('片尾淡出', [], {
    video: { durationSeconds: 75, width: 1280, height: 720 },
    playheadSeconds: 12
  });
  assert.match(prompt, /当前编辑上下文/);
  assert.match(prompt, /视频总时长：75 秒/);
  assert.match(prompt, /视频分辨率：1280x720/);
  assert.match(prompt, /播放头位置：12 秒/);
  assert.match(prompt, /能根据上面编辑上下文确定的时间与参数就直接推导/);
  assert.match(prompt, /片尾淡出/);
});

test('buildPrompt omits project context when none is provided', () => {
  const prompt = buildPrompt('加字幕');
  assert.doesNotMatch(prompt, /当前编辑上下文/);
  assert.doesNotMatch(prompt, /能根据上面编辑上下文确定的时间与参数/);
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
