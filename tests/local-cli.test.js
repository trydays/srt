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
  const service = createLocalCliService({
    platform: 'win32', env: { Path: 'C:\\tools', PATHEXT: '.EXE;.CMD' }, homeDir: '', userDataDir: 'C:\\prefs',
    fsApi: fakeFs(['C:\\tools\\codex.EXE']),
    run: async (file, args) => { calls.push([file, args]); return { exitCode: 0 }; }
  });

  assert.deepEqual((await service.getState()).available, [{ id: 'codex', label: 'Codex CLI' }]);
  assert.deepEqual(calls, [['C:\\tools\\codex.EXE', ['--version']]]);
});

test('probes a fixed Windows CMD shim through ComSpec and rejects command metacharacter paths', async () => {
  const calls = [];
  const execFile = (file, args, options, callback) => {
    calls.push({ file, args, options });
    callback(null, '', '');
  };
  const service = createLocalCliService({
    platform: 'win32',
    env: { Path: 'C:\\tools', PATHEXT: '.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    homeDir: '', userDataDir: 'C:\\prefs', fsApi: fakeFs(['C:\\tools\\codex.CMD']), execFile
  });

  assert.deepEqual((await service.getState()).available, [{ id: 'codex', label: 'Codex CLI' }]);
  assert.deepEqual(calls, [{
    file: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', '"C:\\tools\\codex.CMD" --version'],
    options: { timeout: 3000, maxBuffer: 64 * 1024, windowsHide: true }
  }]);

  const unsafe = createLocalCliService({
    platform: 'win32',
    env: { Path: 'C:\\tool&bad', PATHEXT: '.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    homeDir: '', userDataDir: 'C:\\prefs', fsApi: fakeFs(['C:\\tool&bad\\codex.CMD']), execFile
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
