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
