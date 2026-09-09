const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { translateCodex } = require('../src/codex-translation');

const answer = JSON.stringify({ kind: 'clarify', message: '连接完成' });
const item = { type: 'item.completed', item: { type: 'agent_message', text: answer } };
const done = { type: 'turn.completed' };

async function run(script, timeout = 1500) {
  let child;
  let closed = false;
  try {
    return await translateCodex((_file, _args, options, callback) => {
      child = execFile(process.execPath, ['-e', script], options, callback);
      child.on('close', () => { closed = true; });
      return child;
    }, 'codex', ['exec', '--json', 'test'], timeout);
  } finally {
    assert.equal(closed, true);
    if (child.pid) assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  }
}

function emit(events) {
  return `process.stdout.write(${JSON.stringify(events.map(e => JSON.stringify(e)).join('\n') + '\n')});`;
}

const reconnect = { type: 'error', message: 'Reconnecting... 2/5 (request timed out)' };

test('allows a reconnect notification followed by successful completion', async () => {
  assert.equal(await run(emit([reconnect]) + `setTimeout(() => {${emit([item, done])}}, 80);`), answer);
});

test('rejects a terminal turn failure after reconnecting', async () => {
  await assert.rejects(run(emit([reconnect, item, { type: 'turn.failed', error: { message: 'exhausted' } }])));
});

test('reconnect notifications do not reset the original deadline', async () => {
  await assert.rejects(run(`setInterval(() => {${emit([reconnect])}}, 30);`, 200), { code: 'ETIMEDOUT' });
});

test('handles UTF-8 and JSONL split across chunks, and a final line without newline', async () => {
  const bytes = Buffer.from([JSON.stringify(item), JSON.stringify(done)].join('\n'));
  assert.equal(await run(`
    const bytes = Buffer.from(${JSON.stringify([...bytes])});
    let i = 0;
    const timer = setInterval(() => {
      if (i === bytes.length) return clearInterval(timer);
      process.stdout.write(bytes.subarray(i, ++i));
    }, 1);
  `), answer);
});

for (const [name, script] of [
  ['turn.failed', emit([item, { type: 'turn.failed', error: { message: 'failed' } }])],
  ['error event', emit([{ type: 'error', message: 'failed' }])],
  ['completion without answer', emit([done])],
  ['answer without completion', emit([item])],
  ['plain JSON instead of protocol', `console.log(${JSON.stringify(answer)});`],
  ['broken JSONL', `console.log('{broken');`],
  ['nonzero exit before completion', emit([item]) + 'process.exitCode = 1;'],
  ['oversized answer', emit([{ ...item, item: { ...item.item, text: 'x'.repeat(65537) } }, done])],
  ['oversized unfinished line', "process.stdout.write('x'.repeat(270000));"]
]) {
  test(`rejects ${name} and closes the child`, async () => {
    await assert.rejects(run(script));
  });
}

test('times out an incomplete turn and cleans up a child ignoring SIGTERM', async () => {
  await assert.rejects(run(`process.on('SIGTERM', () => {});${emit([item])}setInterval(() => {}, 1000);`, 200), {
    code: 'ETIMEDOUT'
  });
});

test('ignores progress items and returns the last agent message', async () => {
  assert.equal(await run(emit([
    { type: 'thread.started', thread_id: 'test' },
    { type: 'item.completed', item: { type: 'reasoning', text: 'not an answer' } },
    { ...item, item: { ...item.item, text: 'earlier message' } }, item, done
  ])), answer);
});
