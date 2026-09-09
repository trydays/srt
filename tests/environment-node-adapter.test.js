const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createRemotionBrowserProbe,
  createNodeRunner,
  inspectBundledTools,
  inspectRemotionRuntime,
  resolveInstalledRemotionBrowser
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
      if (behavior.exitOnKill) {
        process.nextTick(() => child.emit('exit', null, signal));
      }
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

async function settleWithin(promise, timeoutMs) {
  let deadline;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('runner did not settle')), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(deadline);
  }
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
  assert.match(calls[0].options.env.PATH, /\/opt\/homebrew\/opt\/node@20\/bin/);
  assert.match(calls[0].options.env.PATH, /\/usr\/local\/opt\/node@20\/bin/);
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

test('Node runner settles forced termination when exit arrives without close', async () => {
  let child;
  const result = createNodeRunner(fakeSpawn([], {
    hang: true,
    closeOnKill: false,
    exitOnKill: true,
    onChild(value) { child = value; }
  }), {}, 'win32')('slow.exe', [], { timeoutMs: 5 });

  await assert.rejects(
    settleWithin(result, 200),
    (error) => error.code === 'ETIMEDOUT' && error.reason === 'probe_error'
  );
  assert.deepEqual(child.killCalls, ['SIGKILL']);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('close'), 0);
  assert.equal(child.listenerCount('error'), 0);
});

test('Node runner has a bounded fallback when forced termination emits no terminal event', { timeout: 350 }, async () => {
  let child;
  const result = createNodeRunner(fakeSpawn([], {
    hang: true,
    closeOnKill: false,
    onChild(value) { child = value; }
  }), {}, 'win32')('silent.exe', [], { timeoutMs: 5 });

  await assert.rejects(
    settleWithin(result, 300),
    (error) => error.code === 'ETIMEDOUT' && error.reason === 'probe_error'
  );
  assert.deepEqual(child.killCalls, ['SIGKILL']);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('close'), 0);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.stdout.listenerCount('data'), 0);
  assert.equal(child.stderr.listenerCount('data'), 0);
});

test('Node runner ignores late events after bounded termination cleanup', { timeout: 350 }, async () => {
  let child;
  let settlements = 0;
  const result = createNodeRunner(fakeSpawn([], {
    hang: true,
    closeOnKill: false,
    onChild(value) { child = value; }
  }), {}, 'win32')('silent.exe', [], { timeoutMs: 5 });
  result.then(() => { settlements += 1; }, () => { settlements += 1; });

  await assert.rejects(settleWithin(result, 300), (error) => error.reason === 'probe_error');
  child.emit('exit', null, 'SIGKILL');
  child.emit('close', null, 'SIGKILL');
  child.stdout.write('late stdout');
  child.stderr.write('late stderr');
  await delay(0);

  assert.equal(settlements, 1);
  assert.equal(child.listenerCount('exit'), 0);
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

test('Remotion inspector requires coherent packages and both local bundles', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'srt-remotion-runtime-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const versions = {
    remotion: '4.0.522',
    '@remotion/player': '4.0.522',
    '@remotion/renderer': '4.0.522',
    '@remotion/bundler': '4.0.522'
  };
  const packageFiles = {};
  for (const [name, version] of Object.entries(versions)) {
    const packageFile = path.join(root, 'packages', name.replace('/', '__'), 'package.json');
    await fs.promises.mkdir(path.dirname(packageFile), { recursive: true });
    await fs.promises.writeFile(packageFile, JSON.stringify({ version }));
    packageFiles[`${name}/package.json`] = packageFile;
  }
  const playerPath = path.join(root, 'app/remotion-built/player.js');
  const renderPath = path.join(root, 'app/remotion-built/render');
  await fs.promises.mkdir(renderPath, { recursive: true });
  await fs.promises.writeFile(playerPath, 'player');
  await fs.promises.writeFile(path.join(renderPath, 'index.html'), '<script src="./bundle.js"></script>');
  await fs.promises.writeFile(path.join(renderPath, 'bundle.js'), 'renderer');
  const browserPath = path.join(root, 'chrome-headless-shell');
  await fs.promises.writeFile(browserPath, 'browser');

  const probeCalls = [];
  const ready = await inspectRemotionRuntime({
    appRoot: root,
    resolvePackage: (request) => packageFiles[request],
    resolveBrowser: () => ({ path: browserPath, version: '149.0.7790.0', compatible: true }),
    probeBrowser: async (executablePath) => { probeCalls.push(executablePath); }
  });
  assert.deepEqual(ready, {
    packages: { status: 'ready', reason: 'ok', version: '4.0.522' },
    playerBundle: { status: 'ready', reason: 'ok', path: playerPath },
    rendererBundle: { status: 'ready', reason: 'ok', path: renderPath },
    browser: { status: 'ready', reason: 'ok', path: browserPath, version: '149.0.7790.0' }
  });
  assert.deepEqual(probeCalls, [browserPath]);

  versions['@remotion/player'] = '4.0.521';
  await fs.promises.writeFile(packageFiles['@remotion/player/package.json'], JSON.stringify({ version: '4.0.521' }));
  const incoherent = await inspectRemotionRuntime({
    appRoot: root,
    resolvePackage: (request) => packageFiles[request],
    resolveBrowser: () => ({ path: browserPath, version: '149.0.7790.0', compatible: true }),
    probeBrowser: async () => { throw new Error('must not launch when packages mismatch'); }
  });
  assert.deepEqual(incoherent.packages, {
    status: 'limited', reason: 'remotion_versions_incoherent', version: null
  });
});

test('Remotion browser resolution is bound to the app package root, not the process cwd', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'srt-remotion-app-root-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const rendererPackage = path.join(root, 'node_modules/@remotion/renderer/package.json');
  const browserPath = path.join(
    root, 'node_modules/.remotion/chrome-headless-shell/mac-arm64',
    'chrome-headless-shell-mac-arm64/chrome-headless-shell'
  );
  await fs.promises.mkdir(path.dirname(rendererPackage), { recursive: true });
  await fs.promises.mkdir(path.dirname(browserPath), { recursive: true });
  await fs.promises.writeFile(rendererPackage, JSON.stringify({ version: '4.0.522' }));
  await fs.promises.writeFile(browserPath, 'browser');
  await fs.promises.writeFile(
    path.join(root, 'node_modules/.remotion/chrome-headless-shell/VERSION'),
    '149.0.7790.0'
  );

  const resolved = resolveInstalledRemotionBrowser(root, {
    platform: 'darwin',
    arch: 'arm64',
    resolvePackage: () => rendererPackage,
    loadBrowserFetcher: () => ({
      TESTED_VERSION: '149.0.7790.0',
      getRevisionInfo: () => ({ local: false, executablePath: '/private/tmp/wrong-cache/chrome' }),
      readVersionFile: () => null
    })
  });

  assert.deepEqual(resolved, {
    path: browserPath,
    version: '149.0.7790.0',
    compatible: true
  });
});

test('Remotion browser probe always uses a resolved local executable and never ensures a download', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'srt-remotion-browser-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const browserPath = path.join(root, 'chrome-headless-shell');
  await fs.promises.writeFile(browserPath, 'browser');
  const calls = [];
  const result = await inspectRemotionRuntime({
    appRoot: root,
    inspectPackages: () => ({ status: 'ready', reason: 'ok', version: '4.0.522' }),
    inspectBundles: () => ({
      playerBundle: { status: 'ready', reason: 'ok', path: '/player.js' },
      rendererBundle: { status: 'ready', reason: 'ok', path: '/render' }
    }),
    resolveBrowser: () => ({ path: browserPath, version: '149.0.7790.0', compatible: true }),
    probeBrowser: async (executablePath, options) => calls.push({ executablePath, options })
  });
  assert.equal(result.browser.status, 'ready');
  assert.deepEqual(calls, [{ executablePath: browserPath, options: { timeoutMs: 10000 } }]);
});

test('Remotion browser process probe uses only fixed local-render arguments and cleans its profile', async () => {
  const calls = [];
  const removed = [];
  const probe = createRemotionBrowserProbe({
    run: async (program, args, options) => {
      calls.push({ program, args, options });
      return { stdout: '<html><title>srt-remotion-probe</title></html>' };
    },
    makeTempDir: async () => '/tmp/srt-remotion-profile-fixed',
    removeTempDir: async (directory) => { removed.push(directory); }
  });

  await probe('/fixed/local/chrome', { timeoutMs: 25 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].program, '/fixed/local/chrome');
  assert.equal(calls[0].options.timeoutMs, 25);
  assert.ok(calls[0].args.includes('--disable-background-networking'));
  assert.ok(calls[0].args.includes('--dump-dom'));
  assert.ok(calls[0].args.includes('--user-data-dir=/tmp/srt-remotion-profile-fixed'));
  assert.equal(calls[0].args.some((arg) => /^https?:/.test(arg)), false);
  assert.deepEqual(removed, ['/tmp/srt-remotion-profile-fixed']);
});

test('Remotion browser process probe cleans its profile when the bounded runner rejects', async () => {
  const removed = [];
  const probe = createRemotionBrowserProbe({
    run: async () => { const error = new Error('timed out'); error.code = 'ETIMEDOUT'; throw error; },
    makeTempDir: async () => '/tmp/srt-remotion-profile-failed',
    removeTempDir: async (directory) => { removed.push(directory); }
  });

  await assert.rejects(
    probe('/fixed/local/chrome', { timeoutMs: 10 }),
    (error) => error.code === 'ETIMEDOUT'
  );
  assert.deepEqual(removed, ['/tmp/srt-remotion-profile-failed']);
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
