const test = require('node:test');
const assert = require('node:assert/strict');
const { createCapabilityRegistry } = require('../src/edit-capabilities');
const { CAPABILITY_SCHEMAS, getCapabilitySchema, buildPrompt, parseInstruction } = require('../src/instruction-capabilities');

test('exports only the current registry prompt catalog', () => {
  assert.deepEqual(CAPABILITY_SCHEMAS, createCapabilityRegistry().promptDefinitions());
  assert.deepEqual(CAPABILITY_SCHEMAS.map((definition) => definition.id), [
    'subtitle.generate@1', 'video.color.adjust@1', 'video.transform@1', 'video.noise@1',
    'video.vignette@1', 'visual.shape@1', 'visual.text@1', 'visual.group@1'
  ]);
  assert.equal(getCapabilitySchema('subtitle.generate@1').range.allowed, false);
  assert.equal(getCapabilitySchema('video.color.adjust@1').range.allowed, true);
  for (const id of ['fade.in@1', 'fade.out@1', 'color.grade@1', 'texture.grain@1', 'vignette@1']) {
    assert.equal(getCapabilitySchema(id), null);
  }
  assert.equal(getCapabilitySchema('__proto__'), null);
});

test('buildPrompt teaches typed color parameters, ranges and multi-step output without effect mappings', () => {
  const prompt = buildPrompt('做成冷色并在片头淡入');
  assert.match(prompt, /拆解/);
  assert.match(prompt, /subtitle\.generate@1/);
  assert.match(prompt, /整段视频/);
  assert.match(prompt, /当前能力未接通/);
  assert.match(prompt, /clarify/);
  assert.match(prompt, /替换.*字幕轨/);
  assert.match(prompt, /video\.color\.adjust@1/);
  for (const name of ['temperature', 'brightness', 'saturation', 'contrast']) {
    assert.match(prompt, new RegExp(name + '.*type.*number.*minimum.*maximum.*default.*description'));
  }
  assert.match(prompt, /顶层 range\.start\/end/);
  assert.match(prompt, /一个或多个步骤/);
  assert.doesNotMatch(prompt, /color\.grade|fade\.|texture\.grain@1|(?:^|[^.])vignette@1/);
  assert.doesNotMatch(prompt, /冷色.*能力|淡入.*能力/);
  assert.doesNotMatch(prompt, /撤销/);
  assert.doesNotMatch(prompt, /冷色.*temperature|复古.*saturation|效果名.*参数/);
});

test('buildPrompt preserves conversation history', () => {
  const prompt = buildPrompt('对', [
    { role: 'user', text: '做个效果' },
    { role: 'assistant', text: '当前能力未接通，你要改为生成字幕吗？' }
  ]);
  assert.match(prompt, /用户：做个效果/);
  assert.match(prompt, /助手：当前能力未接通/);
  assert.match(prompt, /用户当前请求：对/);
});

test('group prompt serializes the full strict schema and describes timing and additive limits', () => {
  const prompt = buildPrompt('新增组合');
  const definition = getCapabilitySchema('visual.group@1');
  assert.ok(definition, 'group is available after both executable paths are wired');
  assert.ok(prompt.includes(JSON.stringify(definition.params)), 'full nested schema reaches the CLI');
  assert.doesNotMatch(prompt, /\[object Object\]|type: undefined|description: undefined/);
  assert.match(prompt, /相对.*range.start/);
  assert.match(prompt, /目标关键帧.*easing.*进入/);
  assert.match(prompt, /固定.*pivotX.*pivotY/);
  assert.match(prompt, /不能.*原位修改.*已有.*clarify/);
  assert.match(prompt, /新增.*组合.*追加/);
  const schema = definition.params;
  assert.deepEqual(schema.properties.scale.oneOf[1].properties.keyframes.items.properties.easing.enum,
    ['linear', 'ease-out', 'back-out']);
  assert.equal(schema.properties.layers.items.oneOf[0].additionalProperties, false);
});

test('group context preserves nested valid payloads and omits undeclared or malformed values', () => {
  const layers = [{ kind: 'shape', params: { color: '#123456', width: .4 } },
    { kind: 'text', params: { text: '重点', fontSize: .08 } }];
  const scale = { keyframes: [{ time: 0, value: .5 }, { time: 1, value: 1, easing: 'back-out' }] };
  const prompt = buildPrompt('继续', [], { operations: [
    { capability: 'visual.group@1', range: { start: 2, end: 4 }, params: { layers, scale, pivotX: .3, unexpected: 'secret-top' } },
    { capability: 'visual.group@1', params: { layers: [{ kind: 'text', params: { text: 'ok', font: 'secret-nested' } }],
      opacity: { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1, easing: 'secret-curve' }] }, scale: 1 } }
  ] });
  const context = prompt.split('当前编辑上下文：')[1];
  assert.ok(context, 'valid nested operations enter the prompt');
  assert.ok(context.includes(JSON.stringify(layers))); assert.ok(context.includes(JSON.stringify(scale)));
  assert.match(context, /"pivotX":0.3/); assert.match(context, /"scale":1/);
  assert.doesNotMatch(context, /secret-|unexpected|font"/);
});

test('parseInstruction accepts the nested group schema and rejects unknown child or easing fields', () => {
  const recipe = { kind: 'instruction', steps: [{ capability: 'visual.group@1', range: { start: 1, end: 3 }, params: {
    layers: [{ kind: 'text', params: { text: '重点' } }],
    opacity: { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1, easing: 'ease-out' }] }
  } }] };
  assert.deepEqual(parseInstruction(JSON.stringify(recipe)), recipe);
  for (const mutate of [
    p => { p.layers[0].params.html = 'bad'; },
    p => { p.opacity.keyframes[1].easing = 'custom'; },
    p => { p.layers[0].id = 'existing-edit'; }
  ]) {
    const invalid = structuredClone(recipe); mutate(invalid.steps[0].params);
    assert.throws(() => parseInstruction(JSON.stringify(invalid)), { code: 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT' });
  }
  for (const id of ['video.noise@1', 'video.vignette@1']) {
    assert.ok(CAPABILITY_SCHEMAS.some(schema => schema.id === id), id + ' is in the AI catalog');
  }
});

test('buildPrompt defines incremental actions without removing applied context', () => {
  const context = { revision: 1, operations: [{ capability: 'video.transform@1',
    range: { start: 1, end: 3 }, params: { flipHorizontal: true, flipVertical: false, scale: 1.25 } }] };
  for (const current of [undefined, context]) {
    const prompt = buildPrompt('保留刚才已经执行的编辑，在第3到4秒新增垂直翻转', [], current);
    assert.match(prompt, /steps 只包含本次需要新执行的动作，不是完整项目配方/);
    assert.match(prompt, /已应用状态.*不是待执行任务/);
    assert.match(prompt, /禁止为了保留旧操作而将其复制到 steps/);
    assert.match(prompt, /未被本次动作替换的已应用状态由软件保留/);
    assert.match(prompt, /画面操作.*按顺序追加.*叠加/);
    assert.match(prompt, /重新生成字幕.*替换.*字幕轨/);
    if (current) {
      assert.match(prompt, /当前 revision：1/);
      assert.match(prompt, /已应用操作（按顺序）：\n.*video\.transform@1.*"flipHorizontal":true.*"flipVertical":false.*"scale":1.25/);
    }
  }
});

test('buildPrompt permits explicitly requested repeated effects with identical parameters', () => {
  const prompt = buildPrompt('再做一次刚才的画面变换');
  assert.match(prompt, /只有用户本次明确要求.*再次执行.*重复叠加/);
  assert.match(prompt, /参数相同也要保留这次明确要求的新动作/);
});

test('buildPrompt keeps an unchanged project on clarify without inventing a step', () => {
  const prompt = buildPrompt('就保持现在这样');
  assert.match(prompt, /信息不足或无需变更.*"kind":"clarify"/);
  assert.match(prompt, /仅要求保持现状.*没有要求执行新动作.*clarify.*不要编造步骤/);
});

test('buildPrompt includes revision, media facts, ordered edit metadata and capped subtitles', () => {
  const prompt = buildPrompt('重新生成字幕', [], {
    revision: 4,
    video: { durationSeconds: 75, width: 1280, height: 720 },
    playheadSeconds: 12,
    operations: [{ id: 'tx-1', capability: 'subtitle.generate@1' }],
    edits: [{
      id: 'edit-1', type: 'subtitle.track@1', range: { start: 0, end: 75 },
      payload: { segments: Array.from({ length: 1000 }, (_, i) => ({ text: '不应重复-' + i })) }
    }],
    subtitles: [{ id: 'segment-1', start: 2, end: 5, text: '大家好' }],
    subtitleTotal: 24,
    videoPath: '/secret/movie.mp4'
  });
  assert.match(prompt, /当前 revision：4/);
  assert.match(prompt, /视频总时长：75 秒/);
  assert.match(prompt, /视频分辨率：1280x720/);
  assert.match(prompt, /播放头位置：12 秒/);
  assert.match(prompt, /已应用编辑（按顺序）/);
  assert.match(prompt, /1\. edit-1，subtitle\.track@1，范围 \[0–75 秒\]/);
  assert.match(prompt, /字幕轨（共 24 段，仅列出前 1 段）/);
  assert.match(prompt, /第1段 \[2–5 秒\]：大家好/);
  assert.doesNotMatch(prompt, /\/secret\/movie\.mp4|不应重复-/);
});

test('buildPrompt omits malformed or absent project context', () => {
  const prompt = buildPrompt('加字幕', 'not history', { revision: '4', edits: [{}] });
  assert.doesNotMatch(prompt, /当前 revision|已应用编辑（按顺序）：|对话历史：/);
});

test('buildPrompt serializes ordered applied operations using only declared scalar parameters', () => {
  const prompt = buildPrompt('继续调整', [], {
    operations: [
      { capability: 'video.color.adjust@1', range: { start: 1, end: 3 },
        params: { temperature: -0.6, brightness: 0.2, saturation: 1, contrast: 1.3,
          videoPath: '/secret/input.mp4', unexpected: '不允许的参数' } },
      { capability: 'subtitle.generate@1', range: { start: 0, end: 4 },
        params: { segments: [{ text: '不得展开正文' }], style: { font: '不得展开样式' } } },
      { capability: 'video.color.adjust@1', range: { start: 2, end: 4 },
        params: { temperature: '/secret/value.mp4', brightness: 0.1 } },
      { capability: 'unknown@1', params: { secret: '未知操作' } }
    ],
    subtitles: Array.from({ length: 501 }, (_, i) => ({ start: i, end: i + 1,
      text: '字'.repeat(80) + '不应溢出' })),
    subtitleTotal: 501
  });
  const context = prompt.split('当前编辑上下文：')[1];
  assert.match(context, /video\.color\.adjust@1.*\[1–3 秒\].*"temperature":-0.6.*"brightness":0.2.*"saturation":1.*"contrast":1.3/);
  assert.match(context, /subtitle\.generate@1.*\[0–4 秒\].*\{\}/);
  assert.ok(context.indexOf('[1–3 秒]') < context.indexOf('[0–4 秒]'));
  assert.doesNotMatch(context, /secret|不允许|不得展开|unknown@1|未知操作|不应溢出|第501段/);
  assert.match(context, /第500段/);
});

test('texture schemas and canonical scalar state reach the next instruction context', () => {
  const prompt = buildPrompt('继续', [], { operations: [
    { capability: 'video.noise@1', range: { start: 0, end: 2 }, params: { amount: 0.4, seed: 9 } },
    { capability: 'video.vignette@1', range: { start: 1, end: 3 }, params: { strength: 0.7, center: 0.2 } }
  ] });
  assert.match(prompt, /video\.noise@1.*"amount".*"required":\["amount"\]/);
  assert.match(prompt, /video\.vignette@1.*"strength".*"required":\["strength"\]/);
  const context = prompt.split('当前编辑上下文：')[1];
  assert.match(context, /video\.noise@1.*\[0–2 秒\].*"amount":0.4/);
  assert.match(context, /video\.vignette@1.*\[1–3 秒\].*"strength":0.7/);
  assert.doesNotMatch(context, /seed|center/);
});

test('parseInstruction parses and trims a clarify turn', () => {
  assert.deepEqual(parseInstruction('{"kind":"clarify","message":"  当前能力未接通，请改为生成字幕。  "}'), {
    kind: 'clarify', message: '当前能力未接通，请改为生成字幕。'
  });
});

test('parseInstruction accepts only the full-video subtitle recipe', () => {
  const recipe = { kind: 'instruction', steps: [{ capability: 'subtitle.generate@1', params: {} }] };
  assert.deepEqual(parseInstruction(JSON.stringify(recipe)), recipe);
});

test('parseInstruction accepts multiple color steps with optional top-level ranges', () => {
  const recipe = {
    kind: 'instruction',
    steps: [
      { capability: 'video.color.adjust@1', range: { start: 0, end: 2 },
        params: { brightness: 0.2 } },
      { capability: 'video.color.adjust@1', params: { saturation: 1.4, contrast: 1.1 } }
    ]
  };
  assert.deepEqual(parseInstruction(JSON.stringify(recipe)), recipe);
});

for (const output of [
  'not json',
  '[]',
  '{"kind":"clarify","message":""}',
  '{"kind":"clarify","message":"ok","extra":true}',
  '{"kind":"instruction","steps":[]}',
  '{"kind":"instruction","steps":[{"capability":"subtitle.generate@1","params":{"start":0}}]}',
  '{"kind":"instruction","steps":[{"capability":"video.color.adjust@1","params":{}}]}',
  '{"kind":"instruction","steps":[{"capability":"video.color.adjust@1","params":{"brightness":2}}]}',
  '{"kind":"instruction","steps":[{"capability":"video.color.adjust@1","range":{"start":2,"end":2},"params":{"brightness":0.2}}]}',
  '{"kind":"instruction","steps":[{"capability":"subtitle.generate@1","range":{"start":0,"end":2},"params":{}}]}',
  '{"kind":"instruction","steps":[{"capability":"fade.in@1","params":{}}]}',
  '{"kind":"instruction","steps":[{"capability":"color.grade@1","params":{"warmth":-1}}]}',
  '{"kind":"unknown"}'
]) {
  test(`parseInstruction rejects invalid or unavailable output: ${output}`, () => {
    assert.throws(() => parseInstruction(output), { code: 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT' });
  });
}
