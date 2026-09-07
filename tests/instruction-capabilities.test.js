const test = require('node:test');
const assert = require('node:assert/strict');
const { INSTRUCTION_CAPABILITIES, buildPrompt, parseInstruction } = require('../src/instruction-capabilities');

test('registry declares only subtitle.generate and fade.in', () => {
  assert.deepEqual(Object.keys(INSTRUCTION_CAPABILITIES).sort(), ['fade.in@1', 'subtitle.generate@1']);
});

test('buildPrompt lists every capability and the two output kinds', () => {
  const prompt = buildPrompt('给视频加字幕');
  assert.match(prompt, /subtitle\.generate@1/);
  assert.match(prompt, /fade\.in@1/);
  assert.match(prompt, /给视频加字幕/);
  assert.match(prompt, /clarify/);
  assert.match(prompt, /instruction/);
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

test('parseInstruction parses an instruction turn with params', () => {
  assert.deepEqual(parseInstruction('{"kind":"instruction","capability":"subtitle.generate@1","params":{}}'), {
    kind: 'instruction', capability: 'subtitle.generate@1', params: {}
  });
});

test('parseInstruction defaults params to an empty object when missing or non-object', () => {
  assert.deepEqual(parseInstruction('{"kind":"instruction","capability":"fade.in@1"}'), {
    kind: 'instruction', capability: 'fade.in@1', params: {}
  });
  assert.deepEqual(parseInstruction('{"kind":"instruction","capability":"fade.in@1","params":[]}'), {
    kind: 'instruction', capability: 'fade.in@1', params: {}
  });
});

for (const output of [
  'not json',
  '[]',
  '{"kind":"clarify","message":""}',
  '{"kind":"clarify","message":"   "}',
  '{"kind":"clarify"}',
  '{"kind":"instruction","capability":"trim@1"}',
  '{"kind":"instruction","capability":123}',
  '{"kind":"unknown"}',
  '{"capability":"fade.in@1","params":{}}',
  '{"capability":null}'
]) {
  test(`parseInstruction rejects invalid output: ${output}`, () => {
    assert.throws(() => parseInstruction(output), { code: 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT' });
  });
}
