const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalCliService } = require('../src/local-cli');

function fakeFs(files) {
  const entries = new Set(files);
  let preference = null;
  return {
    async stat(file) {
      if (!entries.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { isFile: () => true };
    },
    async readFile() {
      if (preference === null) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return preference;
    },
    async mkdir() {},
    async writeFile(_file, value) { preference = value; },
    remove(file) { entries.delete(file); }
  };
}

function fakeTranslator(result) {
  const calls = [];
  return {
    calls,
    run: async (file, args, options) => {
      calls.push({ file, args, options });
      if (result instanceof Error) throw result;
      return result;
    }
  };
}

test('returns only successful fixed CLIs in catalog order', async () => {
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi: fakeFs(['/bin/codex', '/bin/gemini']), run: async () => ({ exitCode: 0 })
  });

  assert.deepEqual((await service.getState()).available, [
    { id: 'codex', label: 'Codex CLI' },
    { id: 'gemini', label: 'Gemini CLI' }
  ]);
  assert.equal((await service.getState()).selectedCliId, null);
});

test('omits a fixed CLI when its --version probe rejects', async () => {
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi: fakeFs(['/bin/codex', '/bin/claude']),
    run: async (file) => {
      if (file === '/bin/claude') throw new Error('version probe failed');
      return { exitCode: 0 };
    }
  });

  assert.deepEqual((await service.getState()).available, [{ id: 'codex', label: 'Codex CLI' }]);
});

test('persists only an explicit available selection and clears a missing one', async () => {
  const fsApi = fakeFs(['/bin/codex', '/bin/claude']);
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs', fsApi,
    run: async () => ({ exitCode: 0 })
  });

  assert.equal((await service.select('claude')).selectedCliId, 'claude');
  fsApi.remove('/bin/claude');
  assert.equal((await service.rescan()).selectedCliId, null);
  await assert.rejects(() => service.select('gemini'), { code: 'LOCAL_CLI_NOT_AVAILABLE' });
});

test('uses Windows Path and PATHEXT only as a minimal compatibility branch', async () => {
  const calls = [];
  const execFile = (file, args, options, callback) => {
    calls.push({ file, args, options });
    callback(null, '', '');
  };
  const service = createLocalCliService({
    platform: 'win32', env: { Path: 'C:\\tools', PATHEXT: '.EXE;.CMD' }, homeDir: '', userDataDir: 'C:\\prefs',
    fsApi: fakeFs(['C:\\tools\\codex.EXE']),
    execFile
  });

  assert.deepEqual((await service.getState()).available, [{ id: 'codex', label: 'Codex CLI' }]);
  assert.deepEqual(calls, [{
    file: 'C:\\tools\\codex.EXE',
    args: ['--version'],
    options: { timeout: 3000, maxBuffer: 64 * 1024, windowsHide: true }
  }]);
});

test('probes a fixed Windows CMD shim through ComSpec and rejects command metacharacter paths', async () => {
  const calls = [];
  const execFile = (file, args, options, callback) => {
    calls.push({ file, args, options });
    callback(null, '', '');
  };
  const service = createLocalCliService({
    platform: 'win32',
    env: { Path: 'C:\\tool space', PATHEXT: '.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    homeDir: '', userDataDir: 'C:\\prefs', fsApi: fakeFs(['C:\\tool space\\codex.CMD']), execFile
  });

  assert.deepEqual((await service.getState()).available, [{ id: 'codex', label: 'Codex CLI' }]);
  assert.deepEqual(calls, [{
    file: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', '""C:\\tool space\\codex.CMD" --version"'],
    options: { timeout: 3000, maxBuffer: 64 * 1024, windowsHide: true, windowsVerbatimArguments: true }
  }]);

  const unsafe = createLocalCliService({
    platform: 'win32',
    env: { Path: 'C:\\tool!bad', PATHEXT: '.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    homeDir: '', userDataDir: 'C:\\prefs', fsApi: fakeFs(['C:\\tool!bad\\codex.CMD']), execFile
  });
  assert.deepEqual((await unsafe.getState()).available, []);
  assert.equal(calls.length, 1);
});

test('omits a candidate when a probe resolves with a nonzero exit code', async () => {
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi: fakeFs(['/bin/codex', '/bin/claude']),
    run: async (file) => ({ exitCode: file === '/bin/codex' ? 1 : 0 })
  });

  assert.deepEqual((await service.getState()).available, [{ id: 'claude', label: 'Claude Code' }]);
});

test('translates a selected local CLI effect into the only allowed instruction', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const { calls, run } = fakeTranslator('{"type":"add_effect","effect":"fade_in"}');
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });

  await service.select('codex');
  assert.deepEqual(await service.translateEffect('添加淡入'), { type: 'add_effect', effect: 'fade_in' });
  assert.equal(calls.length > 0, true);
});

for (const [name, output] of [
  ['rejects non-json effect output', 'not json'],
  ['rejects effect output with extra fields', '{"type":"add_effect","effect":"fade_in","extra":true}'],
  ['rejects array effect output', '[{"type":"add_effect","effect":"fade_in"}]']
]) {
  test(name, async () => {
    const fsApi = fakeFs(['/bin/codex']);
    const { run } = fakeTranslator(output);
    const service = createLocalCliService({
      platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
      fsApi, run: async () => ({ exitCode: 0 }), translate: run
    });

    await service.select('codex');
    await assert.rejects(
      () => service.translateEffect('添加淡入'),
      { code: 'LOCAL_CLI_INVALID_EFFECT_OUTPUT' }
    );
  });
}
