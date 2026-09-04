const test = require('node:test');
const assert = require('node:assert/strict');

const { createEnvironmentModule } = require('../src/environment');

function commandError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function makeFixture(overrides) {
  const options = overrides || {};
  const calls = [];
  const commandResults = options.commandResults || {};
  const platform = options.platform || 'darwin';
  const fixture = {
    platform,
    arch: options.arch || (platform === 'win32' ? 'x64' : 'arm64'),
    targetPath: options.targetPath || (platform === 'win32' ? 'C:\\app-data' : '/app-data'),
    userDataDir: options.userDataDir || (platform === 'win32' ? 'C:\\user-data' : '/user-data'),
    osApi: {
      version: () => options.version || 'macOS 15.6',
      release: () => options.release || '24.6.0',
      cpus: () => options.cpus || [{ model: platform === 'win32' ? 'AMD Ryzen' : 'Apple M4' }, { model: platform === 'win32' ? 'AMD Ryzen' : 'Apple M4' }],
      totalmem: () => options.totalmem === undefined ? 16 * 1024 ** 3 : options.totalmem
    },
    fsApi: {
      statfs: () => options.statfs || { bsize: 1024 ** 3, blocks: 100, bfree: 40 }
    },
    run: async (program, args, runOptions) => {
      calls.push({ program, args, options: runOptions });
      const key = [program].concat(args).join(' ');
      const result = commandResults[key];
      if (result instanceof Error) throw result;
      if (result === undefined) throw commandError('ENOENT');
      return result;
    },
    getBundledTools: () => options.bundled || {}
  };
  fixture.calls = calls;
  return fixture;
}

function macFixture(options) {
  const settings = options || {};
  const versions = settings.versions || {};
  const whisperOutput = settings.whisperVersion
    ? `Name: faster-whisper\nVersion: ${settings.whisperVersion}`
    : settings.whisper ? 'Name: faster-whisper' : commandError('ENOENT');
  return makeFixture({
    ...settings,
    platform: 'darwin',
    commandResults: {
      'ffmpeg -version': versions.ffmpeg ? `ffmpeg version ${versions.ffmpeg}` : commandError('ENOENT'),
      'node --version': versions.node ? `v${versions.node}` : commandError('ENOENT'),
      'npm --version': versions.npm || commandError('ENOENT'),
      '/user-data/python/bin/python --version': settings.managedPython ? `Python ${settings.managedPython}` : commandError('ENOENT'),
      'python3 --version': versions.python3 ? `Python ${versions.python3}` : commandError('ENOENT'),
      'python --version': versions.python ? `Python ${versions.python}` : commandError('ENOENT'),
      '/user-data/python/bin/python -m pip show faster-whisper': whisperOutput,
      'python3 -m pip show faster-whisper': whisperOutput,
      'python -m pip show faster-whisper': whisperOutput,
      'system_profiler SPDisplaysDataType -json': settings.graphics === 'error'
        ? new Error('probe failed')
        : JSON.stringify({ SPDisplaysDataType: [{ _name: 'Apple M4', spdisplays_metal: 'Supported, feature set macOS GPUFamily2 v1' }] }),
      ...(settings.commandResults || {})
    }
  });
}

function windowsFixture(options) {
  const settings = options || {};
  const versions = settings.versions || {};
  const whisperOutput = settings.whisperVersion
    ? `Name: faster-whisper\nVersion: ${settings.whisperVersion}`
    : settings.whisper ? 'Name: faster-whisper' : commandError('ENOENT');
  return makeFixture({
    ...settings,
    platform: 'win32',
    commandResults: {
      'ffmpeg -version': versions.ffmpeg ? `ffmpeg version ${versions.ffmpeg}` : commandError('ENOENT'),
      'node --version': versions.node ? `v${versions.node}` : commandError('ENOENT'),
      'npm --version': versions.npm || commandError('ENOENT'),
      'C:\\user-data\\python\\Scripts\\python.exe --version': settings.managedPython ? `Python ${settings.managedPython}` : commandError('ENOENT'),
      'py -3 --version': versions.py ? `Python ${versions.py}` : commandError('ENOENT'),
      'python --version': versions.python ? `Python ${versions.python}` : commandError('ENOENT'),
      'C:\\user-data\\python\\Scripts\\python.exe -m pip show faster-whisper': whisperOutput,
      'py -3 -m pip show faster-whisper': whisperOutput,
      'python -m pip show faster-whisper': whisperOutput,
      'powershell.exe -NoProfile -Command Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name': settings.graphics === 'error' ? new Error('probe failed') : 'NVIDIA RTX\r\n',
      ...(settings.commandResults || {})
    }
  });
}

function degradedMacFixture() {
  return macFixture({
    totalmem: 4 * 1024 ** 3,
    statfs: { bsize: 1024 ** 3, blocks: 100, bfree: 5 },
    graphics: 'error'
  });
}

test('macOS 识别 Apple/Metal 与工具语义', async () => {
  const environment = createEnvironmentModule(macFixture({
    versions: { ffmpeg: '8.0.1', node: '26.4.0', npm: '11.17.0', python3: '3.14.6' }
  }));
  const report = await environment.detectEnvironment();
  assert.equal(report.platform.os, 'darwin');
  assert.equal(report.hardware.chip.name, 'Apple M4');
  assert.equal(report.hardware.graphics.metal, true);
  assert.equal(report.hardware.disk.path, '/app-data');
  assert.equal(report.tools.node.status, 'ready');
  assert.deepEqual(
    { status: report.tools.python.status, reason: report.tools.python.reason, command: report.tools.python.command },
    { status: 'limited', reason: 'incompatible', command: 'python3' }
  );
  assert.equal(report.canContinue, true);
});

test('Windows 优先使用校验通过的捆绑工具', async () => {
  const fixture = windowsFixture({ bundled: { ffmpeg: { available: true, version: '8.0.1', path: 'C:\\bundle\\ffmpeg.exe' } } });
  const report = await createEnvironmentModule(fixture).detectEnvironment();
  assert.equal(report.platform.os, 'win32');
  assert.equal(report.hardware.graphics.name, 'NVIDIA RTX');
  assert.equal(report.tools.ffmpeg.source, 'bundled');
  assert.equal(fixture.calls.some((call) => call.program === 'ffmpeg'), false);
});

test('低资源与探测失败有不同 reason，但都不阻止继续', async () => {
  const report = await createEnvironmentModule(degradedMacFixture()).detectEnvironment();
  assert.deepEqual(
    { status: report.hardware.memory.status, reason: report.hardware.memory.reason },
    { status: 'missing', reason: 'ok' }
  );
  assert.deepEqual(
    { status: report.hardware.graphics.status, reason: report.hardware.graphics.reason },
    { status: 'missing', reason: 'probe_error' }
  );
  assert.equal(report.canContinue, true);
});

test('硬件阈值和架构按三级策略评估', async () => {
  const ready = await createEnvironmentModule(macFixture({ totalmem: 16 * 1024 ** 3, statfs: { bsize: 1024 ** 3, blocks: 100, bfree: 30 } })).detectEnvironment();
  const limited = await createEnvironmentModule(macFixture({ totalmem: 8 * 1024 ** 3, statfs: { bsize: 1024 ** 3, blocks: 100, bfree: 10 }, arch: 'ia32' })).detectEnvironment();
  const unsupported = await createEnvironmentModule(windowsFixture({ arch: 'arm64' })).detectEnvironment();
  assert.deepEqual([ready.hardware.memory.status, ready.hardware.disk.status, ready.hardware.chip.status], ['ready', 'ready', 'ready']);
  assert.deepEqual([limited.hardware.memory.status, limited.hardware.disk.status, limited.hardware.chip.status], ['limited', 'limited', 'limited']);
  assert.deepEqual([unsupported.hardware.chip.status, unsupported.hardware.chip.reason], ['missing', 'unsupported']);
});

test('模式只由各自所需的兼容工具决定', async () => {
  const report = await createEnvironmentModule(macFixture({
    versions: { ffmpeg: '8.0.1', node: '18.0.0', npm: '11.17.0', python3: '3.12.4' },
    whisper: false
  })).detectEnvironment();
  assert.deepEqual(report.modes.ffmpeg, { status: 'ready', reason: 'ok', blockers: [] });
  assert.deepEqual(report.modes.remotion, { status: 'limited', reason: 'incompatible', blockers: ['node'] });
  assert.deepEqual(report.modes.subtitles, { status: 'missing', reason: 'absent', blockers: ['whisper'] });
});

test('Python 按平台顺序选择候选项，并用候选项探测 Whisper', async () => {
  const mac = macFixture({ versions: { python: '3.12.4' }, whisper: true });
  const macReport = await createEnvironmentModule(mac).detectEnvironment();
  const windows = windowsFixture({ versions: { py: '3.12.4' } });
  const windowsReport = await createEnvironmentModule(windows).detectEnvironment();
  assert.equal(macReport.tools.python.command, 'python');
  assert.ok(mac.calls.some((call) => call.program === 'python' && call.args.join(' ') === '-m pip show faster-whisper'));
  assert.equal(windowsReport.tools.python.command, 'py');
  assert.deepEqual(windows.calls.find((call) => call.program === 'py').args, ['-3', '--version']);
});

test('探测结果区分不兼容、缺失和探测失败且不拒绝报告', async () => {
  const fixture = macFixture({
    commandResults: {
      'ffmpeg -version': 'unrecognizable output',
      'node --version': commandError('ENOENT'),
      'npm --version': new Error('timeout')
    }
  });
  const report = await createEnvironmentModule(fixture).detectEnvironment();
  assert.deepEqual([report.tools.ffmpeg.status, report.tools.ffmpeg.reason], ['limited', 'incompatible']);
  assert.deepEqual([report.tools.node.status, report.tools.node.reason], ['missing', 'absent']);
  assert.deepEqual([report.tools.npm.status, report.tools.npm.reason], ['missing', 'probe_error']);
});

test('捆绑工具目录读取失败不会阻断环境报告', async () => {
  const fixture = macFixture({ versions: { ffmpeg: '8.0.1' } });
  fixture.getBundledTools = () => { throw new Error('directory unavailable'); };
  const report = await createEnvironmentModule(fixture).detectEnvironment();
  assert.equal(report.tools.ffmpeg.status, 'ready');
  assert.equal(report.canContinue, true);
});

test('Whisper 解析版本，成功但不可解析的输出为不兼容', async () => {
  const ready = await createEnvironmentModule(macFixture({ versions: { python3: '3.12.4' }, whisperVersion: '1.2.3' })).detectEnvironment();
  const malformed = await createEnvironmentModule(macFixture({ versions: { python3: '3.12.4' }, whisper: true })).detectEnvironment();
  assert.deepEqual([ready.tools.whisper.status, ready.tools.whisper.reason, ready.tools.whisper.version], ['ready', 'ok', '1.2.3']);
  assert.deepEqual([malformed.tools.whisper.status, malformed.tools.whisper.reason], ['limited', 'incompatible']);
});

test('Metal 仅接受明确的 Supported 状态', async () => {
  const unsupported = await createEnvironmentModule(macFixture({
    commandResults: { 'system_profiler SPDisplaysDataType -json': JSON.stringify({ SPDisplaysDataType: [{ _name: 'Intel GPU', spdisplays_metal: 'Unsupported' }] }) }
  })).detectEnvironment();
  const unsupportedToken = await createEnvironmentModule(macFixture({
    commandResults: { 'system_profiler SPDisplaysDataType -json': JSON.stringify({ SPDisplaysDataType: [{ _name: 'Intel GPU', spdisplays_metal: 'spdisplays_unsupported' }] }) }
  })).detectEnvironment();
  assert.deepEqual([unsupported.hardware.graphics.metal, unsupported.hardware.graphics.status, unsupported.hardware.graphics.reason], [false, 'limited', 'unsupported']);
  assert.deepEqual([unsupportedToken.hardware.graphics.metal, unsupportedToken.hardware.graphics.status, unsupportedToken.hardware.graphics.reason], [false, 'limited', 'unsupported']);
});

test('Metal 识别 system_profiler 的明确支持令牌', async () => {
  const report = await createEnvironmentModule(macFixture({
    commandResults: { 'system_profiler SPDisplaysDataType -json': JSON.stringify({ SPDisplaysDataType: [{ _name: 'Apple M4', spdisplays_metal: 'spdisplays_supported' }] }) }
  })).detectEnvironment();
  assert.deepEqual(
    [report.hardware.graphics.name, report.hardware.graphics.metal, report.hardware.graphics.supported, report.hardware.graphics.status, report.hardware.graphics.reason],
    ['Apple M4', true, true, 'ready', 'ok']
  );
});

test('app-managed Python 优先于系统 Python，并用于 Whisper 探测', async () => {
  const fixture = macFixture({ versions: { python3: '3.12.4' }, managedPython: '3.12.2', whisperVersion: '1.2.3' });
  const report = await createEnvironmentModule(fixture).detectEnvironment();
  assert.equal(report.tools.python.command, '/user-data/python/bin/python');
  assert.equal(fixture.calls.some((call) => call.program === 'python3' && call.args.join(' ') === '--version'), false);
  assert.ok(fixture.calls.some((call) => call.program === '/user-data/python/bin/python' && call.args.join(' ') === '-m pip show faster-whisper'));
});

test('Windows py 候选项以 -3 前缀探测 Whisper', async () => {
  const fixture = windowsFixture({ versions: { py: '3.12.4' }, whisperVersion: '1.2.3' });
  const report = await createEnvironmentModule(fixture).detectEnvironment();
  assert.equal(report.tools.python.command, 'py');
  assert.ok(fixture.calls.some((call) => call.program === 'py' && call.args.join(' ') === '-3 -m pip show faster-whisper'));
});

test('macOS x64 和 Windows x64 都是支持的架构，磁盘低于 10GB 为缺失', async () => {
  const mac = await createEnvironmentModule(macFixture({ arch: 'x64', statfs: { bsize: 1024 ** 3, blocks: 100, bfree: 9 } })).detectEnvironment();
  const windows = await createEnvironmentModule(windowsFixture({ arch: 'x64' })).detectEnvironment();
  assert.deepEqual([mac.hardware.chip.status, mac.hardware.disk.status], ['ready', 'missing']);
  assert.equal(windows.hardware.chip.status, 'ready');
});

test('CPU、内存与异步磁盘探测失败分别成为结构化结果', async () => {
  const fixture = macFixture();
  fixture.osApi.cpus = () => { throw new Error('cpu unavailable'); };
  fixture.osApi.totalmem = () => { throw new Error('memory unavailable'); };
  fixture.fsApi.statfs = () => Promise.reject(new Error('disk unavailable'));
  const report = await createEnvironmentModule(fixture).detectEnvironment();
  assert.deepEqual(
    [report.hardware.chip.reason, report.hardware.memory.reason, report.hardware.disk.reason],
    ['probe_error', 'probe_error', 'probe_error']
  );
  assert.equal(report.canContinue, true);
});

test('环境报告完整且没有额外公共字段', async () => {
  const report = await createEnvironmentModule(macFixture({ versions: { ffmpeg: '8.0.1', node: '20.0.0', npm: '11.0.0', python3: '3.12.4' }, whisperVersion: '1.2.3' })).detectEnvironment();
  const keys = (value) => Object.keys(value).sort();
  assert.deepEqual(keys(report), ['canContinue', 'hardware', 'modes', 'platform', 'tools']);
  assert.deepEqual(keys(report.platform), ['arch', 'os', 'version']);
  assert.deepEqual(keys(report.hardware), ['chip', 'disk', 'graphics', 'memory']);
  assert.deepEqual(keys(report.hardware.chip), ['cores', 'name', 'reason', 'status']);
  assert.deepEqual(keys(report.hardware.memory), ['reason', 'status', 'totalGB']);
  assert.deepEqual(keys(report.hardware.disk), ['freeGB', 'path', 'reason', 'status', 'totalGB']);
  assert.deepEqual(keys(report.hardware.graphics), ['metal', 'name', 'reason', 'status', 'supported']);
  assert.deepEqual(keys(report.tools), ['ffmpeg', 'node', 'npm', 'python', 'whisper']);
  assert.deepEqual(keys(report.modes), ['ffmpeg', 'remotion', 'subtitles']);
  for (const tool of Object.values(report.tools)) {
    assert.deepEqual(keys(tool), ['command', 'compatible', 'installed', 'reason', 'source', 'status', 'version']);
  }
  for (const mode of Object.values(report.modes)) {
    assert.deepEqual(keys(mode), ['blockers', 'reason', 'status']);
  }
});
