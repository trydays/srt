const test = require('node:test');
const assert = require('node:assert/strict');

const { createEnvironmentModule } = require('../src/environment');

const SUBTITLE_MODEL_FILES = [
  'model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt'
];
const FASTER_WHISPER_PROBE =
  'import faster_whisper, importlib.metadata as m; print(m.version("faster-whisper"))';

function completeSubtitleModelFiles() {
  return Object.fromEntries(SUBTITLE_MODEL_FILES.map((name) => [name, 1]));
}

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
  const userDataDir = options.userDataDir ||
    (platform === 'win32' ? 'C:\\user-data' : '/user-data');
  const modelFiles = options.modelFiles || {};
  const fixture = {
    platform,
    arch: options.arch || (platform === 'win32' ? 'x64' : 'arm64'),
    targetPath: options.targetPath || (platform === 'win32' ? 'C:\\app-data' : '/app-data'),
    userDataDir,
    windowsNodeDir: options.windowsNodeDir,
    osApi: {
      version: () => options.version || 'macOS 15.6',
      release: () => options.release || '24.6.0',
      cpus: () => options.cpus || [{ model: platform === 'win32' ? 'AMD Ryzen' : 'Apple M4' }, { model: platform === 'win32' ? 'AMD Ryzen' : 'Apple M4' }],
      totalmem: () => options.totalmem === undefined ? 16 * 1024 ** 3 : options.totalmem
    },
    fsApi: {
      statfs: () => options.statfs || { bsize: 1024 ** 3, blocks: 100, bfree: 40 },
      stat: async (filePath) => {
        const fileName = SUBTITLE_MODEL_FILES.find((name) => filePath.endsWith(name));
        if (!fileName || !Object.prototype.hasOwnProperty.call(modelFiles, fileName)) {
          throw commandError('ENOENT');
        }
        return { size: modelFiles[fileName], isFile: () => true };
      }
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
    ? settings.whisperVersion
    : commandError('ECOMMAND');
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
      [`/user-data/python/bin/python -c ${FASTER_WHISPER_PROBE}`]: whisperOutput,
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
  const nodeDir = settings.windowsNodeDir || 'C:\\Program Files\\nodejs';
  const nodeExe = `${nodeDir}\\node.exe`;
  const npmCli = `${nodeDir}\\node_modules\\npm\\bin\\npm-cli.js`;
  const whisperOutput = settings.whisperVersion
    ? settings.whisperVersion
    : commandError('ECOMMAND');
  return makeFixture({
    ...settings,
    platform: 'win32',
    windowsNodeDir: nodeDir,
    commandResults: {
      'ffmpeg -version': versions.ffmpeg ? `ffmpeg version ${versions.ffmpeg}` : commandError('ENOENT'),
      [`${nodeExe} --version`]: versions.node ? `v${versions.node}` : commandError('ENOENT'),
      [`${nodeExe} ${npmCli} --version`]: versions.npm || commandError('ENOENT'),
      'node --version': versions.node ? `v${versions.node}` : commandError('ENOENT'),
      'cmd.exe /d /s /c npm --version': versions.npm || commandError('ECOMMAND'),
      'npm --version': versions.npm || commandError('ENOENT'),
      'C:\\user-data\\python\\Scripts\\python.exe --version': settings.managedPython ? `Python ${settings.managedPython}` : commandError('ENOENT'),
      'py -3 --version': versions.py ? `Python ${versions.py}` : commandError('ENOENT'),
      'python --version': versions.python ? `Python ${versions.python}` : commandError('ENOENT'),
      [`C:\\user-data\\python\\Scripts\\python.exe -c ${FASTER_WHISPER_PROBE}`]: whisperOutput,
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

test('installed FFmpeg is not necessarily ready for subtitle export', async () => {
  const fixture = macFixture({
    versions: { ffmpeg: '9.0.1' },
    commandResults: {
      'ffmpeg -hide_banner -filters': 'Filters:\n ... scale V->V',
      'ffmpeg -hide_banner -encoders': ' V..... libx264\n A..... aac',
      'ffmpeg -hide_banner -muxers': ' E mp4 MP4',
      'ffprobe -version': 'ffprobe version 9.0.1'
    }
  });
  const environment = createEnvironmentModule(fixture);
  const report = await environment.detectEnvironment();
  assert.equal(report.tools.ffmpeg.installed, true);
  assert.equal(report.modes.subtitleExport.status, 'limited');
  assert.equal(report.modes.subtitleExport.reason, 'subtitle_filter_missing');
  await assert.rejects(environment.getExportTools(), {
    code: 'EXPORT_RUNTIME_NOT_READY'
  });
  assert.equal(report.canContinue, true);
});

test('subtitle export returns the exact ready FFmpeg and sibling ffprobe paths', async () => {
  const ffmpegPath = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
  const ffprobePath = '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe';
  const fixture = macFixture({
    commandResults: {
      [`${ffmpegPath} -version`]: 'ffmpeg version 9.0.1',
      [`${ffmpegPath} -hide_banner -filters`]: 'Filters:\n ... ass V->V',
      [`${ffmpegPath} -hide_banner -encoders`]: ' V..... libx264\n A..... aac',
      [`${ffmpegPath} -hide_banner -muxers`]: ' E mp4 MP4',
      [`${ffprobePath} -version`]: 'ffprobe version 9.0.1'
    }
  });
  const environment = createEnvironmentModule(fixture);
  const report = await environment.detectEnvironment();

  assert.deepEqual(report.modes.subtitleExport, { status: 'ready', reason: 'ok', blockers: [] });
  assert.equal(report.tools.ffmpeg.command, ffmpegPath);
  assert.deepEqual(await environment.getExportTools(), { ffmpegPath, ffprobePath });
  assert.equal(fixture.calls.some((call) => call.program === 'ffmpeg'), false);
});

test('absolute FFmpeg does not mix with PATH ffprobe when its sibling is missing', async () => {
  const ffmpegPath = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
  const siblingFfprobe = '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe';
  const fixture = macFixture({
    commandResults: {
      [`${ffmpegPath} -version`]: 'ffmpeg version 9.0.1',
      [`${ffmpegPath} -hide_banner -filters`]: 'Filters:\n ... ass V->V',
      [`${ffmpegPath} -hide_banner -encoders`]: ' V..... libx264\n A..... aac',
      [`${ffmpegPath} -hide_banner -muxers`]: ' E mp4 MP4',
      [`${siblingFfprobe} -version`]: commandError('ENOENT'),
      'ffprobe -version': 'ffprobe version 9.0.1'
    }
  });
  const environment = createEnvironmentModule(fixture);
  const report = await environment.detectEnvironment();

  assert.equal(report.tools.ffmpeg.command, ffmpegPath);
  assert.deepEqual(report.modes.subtitleExport, {
    status: 'limited', reason: 'ffprobe_missing', blockers: ['ffmpeg']
  });
  await assert.rejects(environment.getExportTools(), { code: 'EXPORT_RUNTIME_NOT_READY' });
  assert.equal(fixture.calls.some((call) => call.program === 'ffprobe'), false);
});

test('subtitle export requires ass even when the subtitles filter is present', async () => {
  const fixture = macFixture({
    versions: { ffmpeg: '9.0.1' },
    commandResults: {
      'ffmpeg -hide_banner -filters': 'Filters:\n ... subtitles V->V',
      'ffmpeg -hide_banner -encoders': ' V..... libx264\n A..... aac',
      'ffmpeg -hide_banner -muxers': ' E mp4 MP4',
      'ffprobe -version': 'ffprobe version 9.0.1'
    }
  });
  const report = await createEnvironmentModule(fixture).detectEnvironment();
  assert.deepEqual(report.modes.subtitleExport, {
    status: 'limited', reason: 'subtitle_filter_missing', blockers: ['ffmpeg']
  });
});

test('subtitle export distinguishes encoder, ffprobe, and probe failures', async () => {
  const shared = {
    'ffmpeg -hide_banner -filters': 'Filters:\n ... ass V->V',
    'ffmpeg -hide_banner -encoders': ' V..... libx264',
    'ffmpeg -hide_banner -muxers': ' E mp4 MP4',
    'ffprobe -version': 'ffprobe version 9.0.1'
  };
  const cases = [
    { commandResults: shared, reason: 'encoder_missing' },
    {
      commandResults: { ...shared, 'ffmpeg -hide_banner -encoders': ' V..... libx264\n A..... aac', 'ffprobe -version': commandError('ENOENT') },
      reason: 'ffprobe_missing'
    },
    {
      commandResults: { ...shared, 'ffmpeg -hide_banner -filters': commandError('EIO') },
      reason: 'probe_error'
    }
  ];

  for (const item of cases) {
    const environment = createEnvironmentModule(macFixture({
      versions: { ffmpeg: '9.0.1' },
      commandResults: item.commandResults
    }));
    const report = await environment.detectEnvironment();
    assert.equal(report.tools.ffmpeg.installed, true);
    assert.deepEqual(report.modes.subtitleExport, {
      status: 'limited', reason: item.reason, blockers: ['ffmpeg']
    });
    await assert.rejects(environment.getExportTools(), { code: 'EXPORT_RUNTIME_NOT_READY' });
  }
});

test('Windows 优先使用校验通过的捆绑工具', async () => {
  const fixture = windowsFixture({
    bundled: { ffmpeg: { available: true, version: '8.0.1', path: 'C:\\bundle\\ffmpeg.exe' } },
    commandResults: {
      'C:\\bundle\\ffmpeg.exe -version': 'ffmpeg version 8.0.1',
      'C:\\bundle\\ffmpeg.exe -hide_banner -filters': 'Filters:\n ... ass V->V',
      'C:\\bundle\\ffmpeg.exe -hide_banner -encoders': ' V..... libx264\n A..... aac',
      'C:\\bundle\\ffmpeg.exe -hide_banner -muxers': ' E mp4 MP4',
      'C:\\bundle\\ffprobe.exe -version': 'ffprobe version 8.0.1'
    }
  });
  const report = await createEnvironmentModule(fixture).detectEnvironment();
  assert.equal(report.platform.os, 'win32');
  assert.equal(report.hardware.graphics.name, 'NVIDIA RTX');
  assert.equal(report.tools.ffmpeg.source, 'bundled');
  assert.equal(fixture.calls.some((call) => call.program === 'ffmpeg'), false);
});

test('Windows 校验失败的捆绑 FFmpeg、Node 与 Python 不会遮蔽可用的系统工具', async () => {
  const fixture = windowsFixture({
    bundled: {
      ffmpeg: {
        available: true,
        version: null,
        path: 'C:\\bundle\\ffmpeg.exe',
        reason: 'incompatible'
      },
      node: { available: true, version: null, path: 'C:\\bundle\\node.exe', reason: 'incompatible' },
      python: { available: true, version: null, path: 'C:\\bundle\\python.exe', reason: 'incompatible' }
    },
    versions: { ffmpeg: '8.0.1', node: '22.18.0', py: '3.12.9' },
    commandResults: {
      'ffmpeg -hide_banner -filters': 'Filters:\n ... ass V->V',
      'ffmpeg -hide_banner -encoders': ' V..... libx264\n A..... aac',
      'ffmpeg -hide_banner -muxers': ' E mp4 MP4',
      'ffprobe -version': 'ffprobe version 8.0.1'
    }
  });
  const report = await createEnvironmentModule(fixture).detectEnvironment();
  for (const toolId of ['ffmpeg', 'node', 'python']) {
    assert.deepEqual([report.tools[toolId].status, report.tools[toolId].source], ['ready', 'system']);
  }
  assert.equal(fixture.calls.some((call) => call.program === 'ffmpeg'), true);
});

test('Windows 系统候选都失败时保留捆绑 FFmpeg、Node 与 Python 的不兼容状态', async () => {
  const fixture = windowsFixture({
    bundled: {
      ffmpeg: { available: true, version: null, path: 'C:\\bundle\\ffmpeg.exe', reason: 'incompatible' },
      node: { available: true, version: null, path: 'C:\\bundle\\node.exe', reason: 'incompatible' },
      python: { available: true, version: null, path: 'C:\\bundle\\python.exe', reason: 'incompatible' }
    }
  });
  const report = await createEnvironmentModule(fixture).detectEnvironment();
  for (const toolId of ['ffmpeg', 'node', 'python']) {
    assert.deepEqual(
      [report.tools[toolId].status, report.tools[toolId].reason, report.tools[toolId].source],
      ['limited', 'incompatible', 'bundled']
    );
  }
  assert.equal(fixture.calls.some((call) => call.program === 'C:\\bundle\\python.exe'), false);
});

test('Windows 多个系统候选失败时 probe_error 不会被后续 absent 覆盖', async () => {
  const nodeExe = 'C:\\Program Files\\nodejs\\node.exe';
  const fixture = windowsFixture({
    commandResults: {
      [`${nodeExe} --version`]: commandError('EACCES'),
      'node --version': commandError('ENOENT')
    }
  });
  const report = await createEnvironmentModule(fixture).detectEnvironment();
  assert.deepEqual(
    [report.tools.node.status, report.tools.node.reason, report.tools.node.command],
    ['missing', 'probe_error', nodeExe]
  );
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

test('Python 按平台顺序选择候选项，Whisper 仅由托管环境决定', async () => {
  const mac = macFixture({ versions: { python: '3.12.4' }, whisper: true });
  const macReport = await createEnvironmentModule(mac).detectEnvironment();
  const windows = windowsFixture({ versions: { py: '3.12.4' } });
  const windowsReport = await createEnvironmentModule(windows).detectEnvironment();
  assert.equal(macReport.tools.python.command, 'python');
  assert.equal(macReport.tools.whisper.status, 'missing');
  assert.equal(mac.calls.some((call) => call.program === 'python' && call.args[0] === '-c'), false);
  assert.equal(windowsReport.tools.python.command, 'py');
  assert.deepEqual(windows.calls.find((call) => call.program === 'py').args, ['-3', '--version']);
  assert.equal(windowsReport.tools.whisper.status, 'missing');
  assert.equal(windows.calls.some((call) => call.program === 'py' && call.args.includes('-c')), false);
});

test('Windows 使用校验通过的捆绑 Python，Whisper 仍要求托管环境', async () => {
  const fixture = windowsFixture({
    bundled: {
      python: { available: true, version: '3.12.4', path: 'C:\\bundle\\python.exe' }
    }
  });
  const report = await createEnvironmentModule(fixture).detectEnvironment();
  assert.deepEqual(
    [report.tools.python.status, report.tools.python.source, report.tools.python.command],
    ['ready', 'bundled', 'C:\\bundle\\python.exe']
  );
  assert.equal(report.tools.whisper.status, 'missing');
  assert.equal(fixture.calls.some((call) => call.program === 'C:\\bundle\\python.exe'), false);
  assert.equal(fixture.calls.some((call) => call.program === 'py'), false);
});

test('Windows 应用管理的 Python 优先于捆绑 Python', async () => {
  const fixture = windowsFixture({
    managedPython: '3.12.9',
    whisperVersion: '1.2.3',
    bundled: {
      python: { available: true, version: '3.12.4', path: 'C:\\bundle\\python.exe' }
    }
  });
  const report = await createEnvironmentModule(fixture).detectEnvironment();
  assert.deepEqual(
    [report.tools.python.status, report.tools.python.source, report.tools.python.command],
    ['ready', 'managed', 'C:\\user-data\\python\\Scripts\\python.exe']
  );
  assert.equal(fixture.calls.some((call) => call.program === 'C:\\bundle\\python.exe'), false);
});

test('Windows 确认 Node 白名单安装后同一环境全量复检可恢复 node 与 npm', async () => {
  const nodeDir = 'C:\\Program Files\\nodejs';
  const nodeExe = `${nodeDir}\\node.exe`;
  const npmCli = `${nodeDir}\\node_modules\\npm\\bin\\npm-cli.js`;
  const fixture = windowsFixture({
    windowsNodeDir: nodeDir,
    versions: { py: '3.12.9' }
  });
  const baseRun = fixture.run;
  let installCount = 0;
  fixture.run = async (program, args, options) => {
    const joinedArgs = args.join(' ');
    if (program === 'winget' && joinedArgs === '--version') {
      fixture.calls.push({ program, args, options });
      return 'v1.10.340';
    }
    if (program === 'winget' && joinedArgs === 'install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements') {
      fixture.calls.push({ program, args, options });
      installCount += 1;
      return 'installed';
    }
    if (program === nodeExe && joinedArgs === '--version') {
      fixture.calls.push({ program, args, options });
      if (installCount === 1) return 'v22.18.0';
      throw commandError('ENOENT');
    }
    if (program === nodeExe && args.length === 2 && args[0] === npmCli && args[1] === '--version') {
      fixture.calls.push({ program, args, options });
      if (installCount === 1) return '10.9.3';
      throw commandError('ENOENT');
    }
    if (program === 'cmd.exe' && joinedArgs === '/d /s /c npm --version') {
      fixture.calls.push({ program, args, options });
      throw commandError('ECOMMAND');
    }
    return baseRun(program, args, options);
  };

  const environment = createEnvironmentModule({ ...fixture, tokenFactory: () => 'node-install' });
  const before = await environment.detectEnvironment();
  assert.deepEqual([before.tools.node.status, before.tools.npm.status], ['missing', 'missing']);
  assert.deepEqual(
    fixture.calls.find((call) => call.program === 'cmd.exe').args,
    ['/d', '/s', '/c', 'npm', '--version']
  );

  const plan = await environment.describeInstall('node');
  assert.deepEqual(await environment.installTool({ toolId: 'node', confirmationId: plan.confirmationId }), {
    ok: true,
    toolId: 'node'
  });

  const after = await environment.detectEnvironment();
  assert.deepEqual(
    [after.tools.node.status, after.tools.node.command, after.tools.npm.status, after.tools.npm.command],
    ['ready', nodeExe, 'ready', npmCli]
  );
  assert.equal(installCount, 1);
  assert.equal(fixture.calls.filter((call) => call.program === 'winget' && call.args[0] === 'install').length, 1);
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

test('Whisper 只在托管 Python 可导入且四文件非空时可用', async () => {
  const complete = completeSubtitleModelFiles();
  const cases = [
    { modelFiles: {}, expected: 'missing' },
    { modelFiles: { ...complete, 'model.bin': 0 }, expected: 'missing' },
    {
      modelFiles: {
        'model.bin': 1,
        'config.json': 1,
        'tokenizer.json': 1,
        'vocabulary.json': 1
      },
      expected: 'missing'
    },
    { modelFiles: complete, expected: 'ready' }
  ];

  for (const item of cases) {
    const report = await createEnvironmentModule(macFixture({
      managedPython: '3.12.4',
      whisperVersion: '1.2.3',
      modelFiles: item.modelFiles
    })).detectEnvironment();
    assert.equal(report.tools.whisper.status, item.expected);
    assert.equal(report.modes.subtitles.status, item.expected);
  }
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

test('Metal 识别 Electron 的明确 Metal family 令牌', async () => {
  const reportForFamily = async (family) => createEnvironmentModule(macFixture({
    commandResults: { 'system_profiler SPDisplaysDataType -json': JSON.stringify({ SPDisplaysDataType: [{ _name: 'Apple M4', spdisplays_mtlgpufamilysupport: family }] }) }
  })).detectEnvironment();
  const supported = await reportForFamily('spdisplays_metal4');
  const unsupported = await reportForFamily('spdisplays_unsupported');
  const unknown = await reportForFamily('spdisplays_metal');
  assert.deepEqual(
    [supported.hardware.graphics.name, supported.hardware.graphics.metal, supported.hardware.graphics.supported, supported.hardware.graphics.status, supported.hardware.graphics.reason],
    ['Apple M4', true, true, 'ready', 'ok']
  );
  assert.deepEqual([unsupported.hardware.graphics.metal, unsupported.hardware.graphics.status, unsupported.hardware.graphics.reason], [false, 'limited', 'unsupported']);
  assert.deepEqual([unknown.hardware.graphics.metal, unknown.hardware.graphics.status, unknown.hardware.graphics.reason], [false, 'limited', 'unsupported']);
});

test('Metal primary 状态优先于 Electron Metal family 令牌', async () => {
  const report = await createEnvironmentModule(macFixture({
    commandResults: { 'system_profiler SPDisplaysDataType -json': JSON.stringify({ SPDisplaysDataType: [{
      _name: 'Apple M4',
      spdisplays_metal: 'Unsupported',
      spdisplays_mtlgpufamilysupport: 'spdisplays_metal4'
    }] }) }
  })).detectEnvironment();
  assert.deepEqual([report.hardware.graphics.metal, report.hardware.graphics.supported, report.hardware.graphics.status, report.hardware.graphics.reason], [false, false, 'limited', 'unsupported']);
});

test('app-managed Python 优先于系统 Python，并用于 Whisper 探测', async () => {
  const fixture = macFixture({
    versions: { python3: '3.12.4' },
    managedPython: '3.12.2',
    whisperVersion: '1.2.3',
    modelFiles: completeSubtitleModelFiles()
  });
  const report = await createEnvironmentModule(fixture).detectEnvironment();
  assert.equal(report.tools.python.command, '/user-data/python/bin/python');
  assert.equal(fixture.calls.some((call) => call.program === 'python3' && call.args.join(' ') === '--version'), false);
  assert.ok(fixture.calls.some((call) => (
    call.program === '/user-data/python/bin/python' &&
    call.args[0] === '-c' &&
    call.args[1] === FASTER_WHISPER_PROBE
  )));
});

test('macOS 安装 node@20 后完整复检可发现 Apple Silicon 与 Intel Formula 路径', async () => {
  for (const [arch, prefix] of [['arm64', '/opt/homebrew'], ['x64', '/usr/local']]) {
    const fixture = macFixture({ arch });
    const baseRun = fixture.run;
    let installed = false;
    fixture.run = async (program, args, options) => {
      if (program === 'brew' && args.join(' ') === '--version') {
        fixture.calls.push({ program, args, options });
        return 'Homebrew 4.6.0';
      }
      if (program === 'brew' && args.join(' ') === 'install node@20') {
        fixture.calls.push({ program, args, options });
        installed = true;
        return 'installed';
      }
      if (program === `${prefix}/opt/node@20/bin/node` && args.join(' ') === '--version') {
        fixture.calls.push({ program, args, options });
        if (installed) return 'v20.18.1';
        throw commandError('ENOENT');
      }
      if (program === `${prefix}/opt/node@20/bin/npm` && args.join(' ') === '--version') {
        fixture.calls.push({ program, args, options });
        if (installed) return '10.8.2';
        throw commandError('ENOENT');
      }
      return baseRun(program, args, options);
    };

    const environment = createEnvironmentModule({ ...fixture, tokenFactory: () => `node-${arch}` });
    const before = await environment.detectEnvironment();
    assert.deepEqual([before.tools.node.status, before.tools.npm.status], ['missing', 'missing']);

    const plan = await environment.describeInstall('node');
    assert.deepEqual(await environment.installTool({ toolId: 'node', confirmationId: plan.confirmationId }), {
      ok: true,
      toolId: 'node'
    });

    const after = await environment.detectEnvironment();
    assert.deepEqual(
      [after.tools.node.status, after.tools.node.command, after.tools.npm.status, after.tools.npm.command],
      ['ready', `${prefix}/opt/node@20/bin/node`, 'ready', `${prefix}/opt/node@20/bin/npm`]
    );
  }
});

test('macOS 安装 python@3.12 后完整复检可发现 Apple Silicon 与 Intel Formula 路径', async () => {
  for (const [arch, prefix] of [['arm64', '/opt/homebrew'], ['x64', '/usr/local']]) {
    const fixture = macFixture({ arch });
    const baseRun = fixture.run;
    let installed = false;
    fixture.run = async (program, args, options) => {
      if (program === 'brew' && args.join(' ') === '--version') {
        fixture.calls.push({ program, args, options });
        return 'Homebrew 4.6.0';
      }
      if (program === 'brew' && args.join(' ') === 'install python@3.12') {
        fixture.calls.push({ program, args, options });
        installed = true;
        return 'installed';
      }
      if (program === `${prefix}/opt/python@3.12/bin/python3.12` && args.join(' ') === '--version') {
        fixture.calls.push({ program, args, options });
        if (installed) return 'Python 3.12.9';
        throw commandError('ENOENT');
      }
      return baseRun(program, args, options);
    };

    const environment = createEnvironmentModule({ ...fixture, tokenFactory: () => `python-${arch}` });
    const before = await environment.detectEnvironment();
    assert.equal(before.tools.python.status, 'missing');

    const plan = await environment.describeInstall('python');
    assert.deepEqual(await environment.installTool({ toolId: 'python', confirmationId: plan.confirmationId }), {
      ok: true,
      toolId: 'python'
    });

    const after = await environment.detectEnvironment();
    assert.deepEqual(
      [after.tools.python.status, after.tools.python.command],
      ['ready', `${prefix}/opt/python@3.12/bin/python3.12`]
    );
  }
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
  assert.deepEqual(keys(report.modes), ['ffmpeg', 'remotion', 'subtitleExport', 'subtitles']);
  for (const tool of Object.values(report.tools)) {
    assert.deepEqual(keys(tool), ['command', 'compatible', 'installed', 'reason', 'source', 'status', 'version']);
  }
  for (const mode of Object.values(report.modes)) {
    assert.deepEqual(keys(mode), ['blockers', 'reason', 'status']);
  }
});
