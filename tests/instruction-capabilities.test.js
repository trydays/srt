const test = require('node:test');
const assert = require('node:assert/strict');
const { createCapabilityRegistry } = require('../src/edit-capabilities');
const { CAPABILITY_SCHEMAS, getCapabilitySchema, buildPrompt, parseInstruction } = require('../src/instruction-capabilities');

test('exports only the current registry prompt catalog', () => {
  assert.deepEqual(CAPABILITY_SCHEMAS, createCapabilityRegistry().promptDefinitions());
  assert.deepEqual(CAPABILITY_SCHEMAS.map((definition) => definition.id), [
    'subtitle.generate@1', 'video.color.adjust@1'
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
  assert.doesNotMatch(prompt, /color\.grade|fade\.|texture\.grain|vignette/);
  assert.doesNotMatch(prompt, /冷色.*能力|淡入.*能力/);
  assert.doesNotMatch(prompt, /撤销|叠加/);
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
  assert.doesNotMatch(prompt, /当前 revision|已应用编辑|对话历史/);
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
