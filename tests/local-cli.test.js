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

test('translates a subtitle request into subtitle.generate instruction', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const { calls, run } = fakeTranslator('{"kind":"instruction","steps":[{"capability":"subtitle.generate@1","params":{}}]}');
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  await service.select('codex');
  assert.deepEqual(await service.translateInstruction('给视频加字幕'), {
    kind: 'instruction', steps: [{ capability: 'subtitle.generate@1', params: {} }]
  });
  assert.equal(calls.length, 1);
});

test('rejects a fade recipe returned for an unavailable request', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const { run } = fakeTranslator('{"kind":"instruction","steps":[{"capability":"fade.in@1","params":{}}]}');
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  await service.select('codex');
  await assert.rejects(() => service.translateInstruction('给片头添加淡入'), {
    code: 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT'
  });
});

test('rejects an unavailable multi-effect recipe', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const { run } = fakeTranslator(JSON.stringify({
    kind: 'instruction',
    steps: [
      { capability: 'color.grade@1', params: { warmth: 0.18, saturation: 0.8, contrast: 1.1, start: 12, end: 18 } },
      { capability: 'texture.grain@1', params: { amount: 0.22, start: 12, end: 18 } },
      { capability: 'vignette@1', params: { strength: 0.35, start: 12, end: 18 } },
      { capability: 'fade.out@1', params: { start: 18, end: 20 } }
    ]
  }));
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  await service.select('codex');
  await assert.rejects(() => service.translateInstruction('把 12 到 18 秒做成复古胶片感，片尾淡出'), {
    code: 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT'
  });
});

test('returns a clarify turn when the CLI asks a follow-up', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const { run } = fakeTranslator('{"kind":"clarify","message":"你想要字幕还是淡入？"}');
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  await service.select('codex');
  assert.deepEqual(await service.translateInstruction('做个效果'), {
    kind: 'clarify', message: '你想要字幕还是淡入？'
  });
});

test('forwards conversation history into the generated prompt', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const { calls, run } = fakeTranslator('{"kind":"clarify","message":"再说清楚点"}');
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  await service.select('codex');
  await service.translateInstruction('对', [
    { role: 'user', text: '做个效果' },
    { role: 'assistant', text: '你想要字幕还是淡入？' }
  ]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].args[1], /做个效果/);
  assert.match(calls[0].args[1], /你想要字幕还是淡入？/);
});

test('forwards unified project context into the generated prompt', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const { calls, run } = fakeTranslator('{"kind":"instruction","steps":[{"capability":"subtitle.generate@1","params":{}}]}');
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  await service.select('codex');
  await service.translateInstruction('重新生成字幕', [], {
    revision: 3,
    video: { durationSeconds: 75, width: 1280, height: 720 },
    playheadSeconds: 12,
    operations: [{ id: 'tx-1', capability: 'subtitle.generate@1' }],
    edits: [{ id: 'edit-1', type: 'subtitle.track@1', range: { start: 0, end: 75 }, payload: { segments: [{ text: '不要重复' }] } }],
    subtitles: [{ index: 1, start: 2, end: 5, text: '大家好' }],
    subtitleTotal: 1
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].args[1], /当前 revision：3/);
  assert.match(calls[0].args[1], /视频总时长：75 秒/);
  assert.match(calls[0].args[1], /视频分辨率：1280x720/);
  assert.match(calls[0].args[1], /播放头位置：12 秒/);
  assert.match(calls[0].args[1], /1\. edit-1，subtitle\.track@1，范围 \[0–75 秒\]/);
  assert.match(calls[0].args[1], /字幕轨（共 1 段）/);
  assert.match(calls[0].args[1], /第1段 \[2–5 秒\]：大家好/);
  assert.doesNotMatch(calls[0].args[1], /不要重复/);
});

test('forwards a validated fourth-argument skill into the actual generated prompt', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const { calls, run } = fakeTranslator('{"kind":"clarify","message":"需要重新推导"}');
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  const skill = {
    name: '旧卡片', intent: '强调重点', preferences: { description: '白字黑底' },
    referenceRecipe: { kind: 'instruction', steps: [{ capability: 'retired.card@1', params: {} }] },
    capabilityVersions: ['retired.card@1']
  };
  await service.select('codex');
  await service.translateInstruction('在片尾使用', [], {
    video: { durationSeconds: 3, width: 360, height: 640 }
  }, skill);
  assert.equal(calls.length, 1);
  assert.match(calls[0].args[1], /个人剪辑技能/);
  assert.match(calls[0].args[1], /360x640/);
  assert.ok(calls[0].args[1].includes(JSON.stringify(skill)));
});

test('rejects invalid skill context before invoking the translation process', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const { calls, run } = fakeTranslator('{"kind":"clarify","message":"不应调用"}');
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  await service.select('codex');
  await assert.rejects(() => service.translateInstruction('继续', [], {}, {
    name: '坏技能', intent: '无效', preferences: { description: '' },
    referenceRecipe: { kind: 'instruction', steps: [{ capability: 'old@1', params: {} }] },
    capabilityVersions: ['forged@1']
  }), { code: 'SKILL_INVALID' });
  assert.equal(calls.length, 0);
});

test('reports a killed CLI translation as a timeout', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const timeout = Object.assign(new Error('timed out'), { killed: true });
  const { run } = fakeTranslator(timeout);
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  await service.select('codex');
  await assert.rejects(
    () => service.translateInstruction('给视频加字幕'),
    { code: 'LOCAL_CLI_TRANSLATION_TIMEOUT' }
  );
});

for (const output of ['not json', '[]', '{"kind":"instruction","steps":[{"capability":"trim@1","params":{}}]}', '{"kind":"instruction","steps":[{"capability":123,"params":{}}]}']) {
  test(`rejects unsupported instruction output: ${output}`, async () => {
    const fsApi = fakeFs(['/bin/codex']);
    const { run } = fakeTranslator(output);
    const service = createLocalCliService({
      platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
      fsApi, run: async () => ({ exitCode: 0 }), translate: run
    });
    await service.select('codex');
    await assert.rejects(
      () => service.translateInstruction('任意请求'),
      { code: 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT' }
    );
  });
}

test('translate ignores stdin so interactive CLI prompts do not hang', async () => {
  const calls = [];
  const execFile = (file, args, options, callback) => {
    calls.push({ file, args, options });
    callback(null, '{"kind":"instruction","steps":[{"capability":"subtitle.generate@1","params":{}}]}', '');
  };
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi: fakeFs(['/bin/claude']),
    run: async () => ({ exitCode: 0 }),
    execFile
  });
  await service.select('claude');
  await service.translateInstruction('加字幕');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
});

test('waits up to 60s for a local CLI translation response', async () => {
  const calls = [];
  const execFile = (file, args, options, callback) => {
    calls.push({ file, args, options });
    callback(null, '{"kind":"instruction","steps":[{"capability":"subtitle.generate@1","params":{}}]}', '');
  };
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi: fakeFs(['/bin/claude']),
    run: async () => ({ exitCode: 0 }),
    execFile
  });
  await service.select('claude');
  await service.translateInstruction('加字幕');
  assert.equal(calls[0].options.timeout, 60000);
});
