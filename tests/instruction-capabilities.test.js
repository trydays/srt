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
