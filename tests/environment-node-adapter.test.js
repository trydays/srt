const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createNodeRunner,
  inspectBundledTools
} = require('../src/environment/node-adapter');

function fakeSpawn(calls, behavior = {}) {
  return (program, args, options) => {
    calls.push({ program, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      process.nextTick(() => child.emit('close', null, 'SIGTERM'));
      return true;
    };

    process.nextTick(() => {
      if (behavior.spawnError) {
        child.emit('error', behavior.spawnError);
        return;
      }
      if (behavior.stdout) child.stdout.write(behavior.stdout);
      if (behavior.stderr) child.stderr.write(behavior.stderr);
      if (!behavior.hang) child.emit('close', behavior.exitCode || 0, null);
    });
    return child;
  };
}

test('Node runner always uses an argument array and shell false', async () => {
  const calls = [];
  const runner = createNodeRunner(fakeSpawn(calls), { PATH: '/usr/bin' }, 'darwin');
  await runner('node', ['--version'], { timeoutMs: 1000 });
  assert.equal(calls[0].program, 'node');
  assert.deepEqual(calls[0].args, ['--version']);
  assert.equal(calls[0].options.shell, false);
  assert.match(calls[0].options.env.PATH, /\/opt\/homebrew\/bin/);
  assert.match(calls[0].options.env.PATH, /\/usr\/local\/bin/);
});

test('Node runner maps missing programs and command failures to probe reasons', async () => {
  const missing = new Error('not found');
  missing.code = 'ENOENT';
  await assert.rejects(
    createNodeRunner(fakeSpawn([], { spawnError: missing }), {}, 'win32')('missing.exe', [], {}),
    (error) => error.code === 'ENOENT' && error.reason === 'absent'
  );
  await assert.rejects(
    createNodeRunner(fakeSpawn([], { exitCode: 2 }), {}, 'win32')('broken.exe', [], {}),
    (error) => error.reason === 'probe_error'
  );
  await assert.rejects(
    createNodeRunner(fakeSpawn([], { hang: true }), {}, 'win32')('slow.exe', [], { timeoutMs: 5 }),
    (error) => error.reason === 'probe_error' && error.code === 'ETIMEDOUT'
  );
});

test('Node runner bounds captured stdout and stderr to one MiB', async () => {
  const oversized = Buffer.alloc(1024 * 1024 + 1024, 120);
  await assert.rejects(
    createNodeRunner(fakeSpawn([], { stdout: oversized, stderr: oversized }), {}, 'win32')('noisy.exe', [], {}),
    (error) => {
      assert.equal(error.reason, 'probe_error');
      assert.ok(Buffer.byteLength(error.stdout || '') <= 1024 * 1024);
      assert.ok(Buffer.byteLength(error.stderr || '') <= 1024 * 1024);
      return true;
    }
  );
});

test('Windows bundled tools are read only from an explicit resources/tools root', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'srt-bundled-tools-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await fs.promises.writeFile(path.join(root, 'ffmpeg.exe'), '123456');
  await fs.promises.writeFile(path.join(root, 'node.exe'), 'too-small');
  await fs.promises.writeFile(path.join(root, 'tools-versions.json'), JSON.stringify({
    version: 1,
    bundled: {
      ffmpeg: { version: '8.0.1', exe: 'ffmpeg.exe', size: 6 },
      node: { version: '20.18.1', exe: 'node.exe', size: 100 }
    }
  }));

  const tools = await inspectBundledTools(root, 'win32');
  assert.deepEqual(tools.ffmpeg, {
    available: true,
    version: '8.0.1',
    path: path.join(root, 'ffmpeg.exe')
  });
  assert.equal(tools.node.available, true);
  assert.equal(tools.node.version, null);
  assert.equal(tools.node.reason, 'incompatible');
  assert.equal(Object.keys(await inspectBundledTools(root, 'darwin')).length, 0);
});

test('Adapter source has no AppData fallback path', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'environment', 'node-adapter.js'), 'utf8');
  assert.doesNotMatch(source, /APPDATA|AppData|getAppDataDir|tools-versions\.json.*userData/i);
});
