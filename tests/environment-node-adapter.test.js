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
    child.killCalls = [];
    child.kill = (signal) => {
      child.killCalls.push(signal);
      if (behavior.killThrows) throw new Error('kill failed');
      if (behavior.killResult === false) return false;
      if (behavior.closeOnKill !== false) {
        process.nextTick(() => child.emit('close', null, signal));
      }
      return true;
    };
    if (behavior.onChild) behavior.onChild(child);

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recordingFs(records) {
  return {
    readFileSync(filePath, encoding) {
      records.push({ operation: 'readFileSync', path: filePath });
      return fs.readFileSync(filePath, encoding);
    },
    lstatSync(filePath) {
      records.push({ operation: 'lstatSync', path: filePath });
      return fs.lstatSync(filePath);
    },
    realpathSync(filePath) {
      records.push({ operation: 'realpathSync', path: filePath });
      return fs.realpathSync(filePath);
    }
  };
}

function isWithin(root, candidate) {
  const relative = path.relative(root, path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function recordsStayWithin(records, root) {
  const suppliedRoot = path.resolve(root);
  const canonicalRoot = fs.realpathSync(root);
  return records.every((record) => isWithin(suppliedRoot, record.path) || isWithin(canonicalRoot, record.path));
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

test('Node runner waits for close after forced timeout termination', async () => {
  let child;
  const runner = createNodeRunner(fakeSpawn([], {
    hang: true,
    closeOnKill: false,
    onChild(value) { child = value; }
  }), {}, 'win32');
  const result = runner('slow.exe', [], { timeoutMs: 5 });
  let settled = false;
  result.then(() => { settled = true; }, () => { settled = true; });

  await delay(15);
  assert.deepEqual(child.killCalls, ['SIGKILL']);
  assert.equal(settled, false);
  child.emit('error', new Error('late process error'));
  await delay(0);
  assert.equal(settled, false);
  child.emit('close', null, 'SIGKILL');
  await assert.rejects(result, (error) => error.code === 'ETIMEDOUT' && error.reason === 'probe_error');
  assert.equal(child.listenerCount('close'), 0);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.stdout.listenerCount('data'), 0);
  assert.equal(child.stderr.listenerCount('data'), 0);
});

test('Node runner rejects without hanging when forced termination fails', { timeout: 250 }, async () => {
  for (const behavior of [{ killResult: false }, { killThrows: true }]) {
    let child;
    const runner = createNodeRunner(fakeSpawn([], {
      ...behavior,
      hang: true,
      onChild(value) { child = value; }
    }), {}, 'win32');
    await assert.rejects(
      runner('unkillable.exe', [], { timeoutMs: 5 }),
      (error) => error.reason === 'probe_error'
    );
    assert.equal(child.listenerCount('close'), 0);
    assert.equal(child.listenerCount('error'), 0);
    assert.equal(child.stdout.listenerCount('data'), 0);
    assert.equal(child.stderr.listenerCount('data'), 0);
  }
});

test('Node runner cleans listeners and timeout after a normal close', async () => {
  let child;
  const runner = createNodeRunner(fakeSpawn([], {
    onChild(value) { child = value; }
  }), {}, 'win32');
  await runner('quick.exe', [], { timeoutMs: 10 });
  await delay(20);
  assert.deepEqual(child.killCalls, []);
  assert.equal(child.listenerCount('close'), 0);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.stdout.listenerCount('data'), 0);
  assert.equal(child.stderr.listenerCount('data'), 0);
});

test('Node runner independently bounds stdout and stderr to one MiB', async () => {
  const oversized = Buffer.alloc(1024 * 1024 + 1024, 120);
  for (const channel of ['stdout', 'stderr']) {
    const behavior = { hang: true, [channel]: oversized };
    await assert.rejects(
      createNodeRunner(fakeSpawn([], behavior), {}, 'win32')('noisy.exe', [], {}),
      (error) => {
        assert.equal(error.reason, 'probe_error');
        assert.equal(Buffer.byteLength(error[channel]), 1024 * 1024);
        assert.equal(Buffer.byteLength(error[channel === 'stdout' ? 'stderr' : 'stdout']), 0);
        return true;
      }
    );
  }
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

  const records = [];
  const tools = await inspectBundledTools(root, 'win32', recordingFs(records));
  assert.deepEqual(tools.ffmpeg, {
    available: true,
    version: '8.0.1',
    path: path.join(root, 'ffmpeg.exe')
  });
  assert.equal(tools.node.available, true);
  assert.equal(tools.node.version, null);
  assert.equal(tools.node.reason, 'incompatible');
  assert.equal(Object.keys(await inspectBundledTools(root, 'darwin')).length, 0);
  assert.ok(records.length > 0);
  assert.ok(recordsStayWithin(records, root));
  assert.ok(records.every((record) => !/[\\/]AppData(?:[\\/]|$)/i.test(record.path)));
});

test('Bundled inspector rejects traversal without accessing outside the supplied root', async (t) => {
  const outer = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'srt-bundle-boundary-'));
  const root = path.join(outer, 'resources', 'tools');
  await fs.promises.mkdir(root, { recursive: true });
  t.after(() => fs.promises.rm(outer, { recursive: true, force: true }));
  await fs.promises.writeFile(path.join(outer, 'outside.exe'), '123456');
  await fs.promises.writeFile(path.join(root, 'tools-versions.json'), JSON.stringify({
    version: 1,
    bundled: {
      dot: { version: '1.0.0', exe: '.', size: 6 },
      parent: { version: '1.0.0', exe: '..', size: 6 },
      escape: { version: '1.0.0', exe: '../../outside.exe', size: 6 }
    }
  }));

  const records = [];
  const tools = inspectBundledTools(root, 'win32', recordingFs(records));
  assert.deepEqual(tools, {});
  assert.ok(recordsStayWithin(records, root));
});

test('Bundled inspector rejects a symlinked manifest before reading it', async (t) => {
  const outer = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'srt-manifest-link-'));
  const root = path.join(outer, 'resources', 'tools');
  await fs.promises.mkdir(root, { recursive: true });
  t.after(() => fs.promises.rm(outer, { recursive: true, force: true }));
  const outsideManifest = path.join(outer, 'outside.json');
  await fs.promises.writeFile(outsideManifest, JSON.stringify({ version: 1, bundled: {} }));
  await fs.promises.symlink(outsideManifest, path.join(root, 'tools-versions.json'));

  const records = [];
  assert.deepEqual(inspectBundledTools(root, 'win32', recordingFs(records)), {});
  assert.equal(records.some((record) => record.operation === 'readFileSync'), false);
  assert.ok(recordsStayWithin(records, root));
});

test('Bundled inspector rejects symlinked tool entries', async (t) => {
  const outer = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'srt-tool-link-'));
  const root = path.join(outer, 'resources', 'tools');
  await fs.promises.mkdir(root, { recursive: true });
  t.after(() => fs.promises.rm(outer, { recursive: true, force: true }));
  const outsideTool = path.join(outer, 'outside.exe');
  await fs.promises.writeFile(outsideTool, '123456');
  await fs.promises.symlink(outsideTool, path.join(root, 'ffmpeg.exe'));
  await fs.promises.writeFile(path.join(root, 'tools-versions.json'), JSON.stringify({
    version: 1,
    bundled: { ffmpeg: { version: '8.0.1', exe: 'ffmpeg.exe', size: 6 } }
  }));

  const records = [];
  assert.deepEqual(inspectBundledTools(root, 'win32', recordingFs(records)), {});
  assert.ok(recordsStayWithin(records, root));
});
