const test = require('node:test');
const assert = require('node:assert/strict');

const { createEnvironmentModule } = require('../src/environment');

function commandError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function installFixture(platform, options) {
  const settings = options || {};
  const calls = [];
  let token = 0;
  const manager = platform === 'win32' ? 'winget' : 'brew';
  const dependencies = {
    platform,
    userDataDir: platform === 'win32' ? 'C:\\user-data' : '/user-data',
    tokenFactory: () => `confirmation-${++token}`,
    run: async (program, args, runOptions) => {
      calls.push({ program, args, timeoutMs: runOptions.timeoutMs });
      if (program === manager && args.length === 1 && args[0] === '--version') {
        if (settings.managerAvailable === false) throw commandError('ENOENT');
        return `${manager} 1.0`;
      }
      if (settings.runAction) return settings.runAction(program, args, calls.length);
      return '';
    }
  };
  return { environment: createEnvironmentModule(dependencies), calls };
}

test('计划可读但不泄露可执行动作', async () => {
  const { environment } = installFixture('darwin');
  const plan = await environment.describeInstall('ffmpeg');
  assert.equal(plan.toolId, 'ffmpeg');
  assert.equal(plan.canAutomate, true);
  assert.match(plan.summary, /Homebrew/);
  assert.equal(typeof plan.downloadEstimate, 'string');
  assert.equal(typeof plan.installLocation, 'string');
  assert.equal(typeof plan.durationEstimate, 'string');
  assert.ok(plan.steps.length > 0);
  assert.equal(typeof plan.confirmationId, 'string');
  assert.equal('command' in plan, false);
  assert.equal('actions' in plan, false);
});

test('一份确认最多执行一次固定动作', async () => {
  const { environment, calls } = installFixture('darwin');
  const plan = await environment.describeInstall('ffmpeg');
  assert.deepEqual(
    await environment.installTool({ toolId: 'ffmpeg', confirmationId: plan.confirmationId }),
    { ok: true, toolId: 'ffmpeg' }
  );
  assert.deepEqual(calls.at(-1), { program: 'brew', args: ['install', 'ffmpeg'], timeoutMs: 300000 });
  await assert.rejects(
    () => environment.installTool({ toolId: 'ffmpeg', confirmationId: plan.confirmationId }),
    /已使用/
  );
});

test('未知工具和额外请求字段在执行前被拒绝', async () => {
  const { environment, calls } = installFixture('darwin');
  await assert.rejects(() => environment.describeInstall('custom-tool'), /不支持/);
  assert.equal(calls.length, 0);

  const plan = await environment.describeInstall('ffmpeg');
  const callsBeforeRequest = calls.length;
  await assert.rejects(
    () => environment.installTool({
      toolId: 'ffmpeg',
      confirmationId: plan.confirmationId,
      command: 'malicious --argument'
    }),
    /请求格式/
  );
  await assert.rejects(
    () => environment.installTool({ toolId: 'custom-tool', confirmationId: plan.confirmationId }),
    /不支持/
  );
  assert.equal(calls.length, callsBeforeRequest);
});

test('安装请求必须恰好包含两个字符串字段且不会提前执行', async () => {
  const { environment, calls } = installFixture('darwin');
  const plan = await environment.describeInstall('ffmpeg');
  const invalidRequests = [
    { confirmationId: plan.confirmationId },
    { toolId: 'ffmpeg' },
    { toolId: 42, confirmationId: plan.confirmationId },
    { toolId: 'ffmpeg', confirmationId: 42 }
  ];

  for (const request of invalidRequests) {
    await assert.rejects(() => environment.installTool(request), /请求格式/);
  }

  assert.equal(calls.filter((call) => call.timeoutMs === 300000).length, 0);
  assert.equal(calls.length, 1);
});

test('伪造确认和工具不匹配的确认在执行前被拒绝', async () => {
  const { environment, calls } = installFixture('darwin');
  const plan = await environment.describeInstall('ffmpeg');
  const callsBeforeRequest = calls.length;
  await assert.rejects(
    () => environment.installTool({ toolId: 'ffmpeg', confirmationId: 'forged-confirmation' }),
    /确认无效/
  );
  await assert.rejects(
    () => environment.installTool({ toolId: 'node', confirmationId: plan.confirmationId }),
    /工具不匹配/
  );
  assert.equal(calls.length, callsBeforeRequest);
});

test('缺少平台包管理器时仅返回对应的手动指引', async () => {
  const mac = installFixture('darwin', { managerAvailable: false });
  const macPlan = await mac.environment.describeInstall('ffmpeg');
  assert.equal(macPlan.canAutomate, false);
  assert.equal(macPlan.confirmationId, null);
  assert.match(macPlan.summary, /Homebrew/);
  assert.match(macPlan.steps.join(' '), /brew\.sh/);

  const windows = installFixture('win32', { managerAvailable: false });
  const windowsPlan = await windows.environment.describeInstall('node');
  assert.equal(windowsPlan.canAutomate, false);
  assert.equal(windowsPlan.confirmationId, null);
  assert.match(windowsPlan.summary, /winget/);
  assert.match(windowsPlan.steps.join(' '), /Microsoft Store|应用安装程序/);
});

test('自动与手动计划都只公开固定的可读字段', async () => {
  const expectedKeys = [
    'canAutomate',
    'confirmationId',
    'downloadEstimate',
    'durationEstimate',
    'installLocation',
    'steps',
    'summary',
    'toolId'
  ];
  const automatic = await installFixture('darwin').environment.describeInstall('ffmpeg');
  const manual = await installFixture('win32', { managerAvailable: false }).environment.describeInstall('whisper');

  assert.deepEqual(Object.keys(automatic).sort(), expectedKeys);
  assert.deepEqual(Object.keys(manual).sort(), expectedKeys);
  assert.equal(typeof automatic.confirmationId, 'string');
  assert.equal(manual.confirmationId, null);
  for (const plan of [automatic, manual]) {
    assert.equal(typeof plan.summary, 'string');
    assert.equal(typeof plan.downloadEstimate, 'string');
    assert.equal(typeof plan.installLocation, 'string');
    assert.equal(typeof plan.durationEstimate, 'string');
    assert.ok(Array.isArray(plan.steps) && plan.steps.length > 0);
    assert.equal('program' in plan, false);
    assert.equal('args' in plan, false);
    assert.equal('arguments' in plan, false);
    assert.equal('command' in plan, false);
    assert.equal('actions' in plan, false);
  }
});

test('Whisper 首个固定动作失败时不会启动后续动作', async () => {
  const { environment, calls } = installFixture('darwin', {
    runAction: async () => {
      throw new Error('first action failed');
    }
  });
  const plan = await environment.describeInstall('whisper');
  const result = await environment.installTool({ toolId: 'whisper', confirmationId: plan.confirmationId });

  assert.equal(result.ok, false);
  assert.deepEqual(calls.slice(1), [
    { program: 'brew', args: ['install', 'python@3.12'], timeoutMs: 300000 }
  ]);
});

test('固定动作失败后停止且只返回通用错误', async () => {
  let actionNumber = 0;
  const { environment, calls } = installFixture('darwin', {
    runAction: async () => {
      actionNumber += 1;
      if (actionNumber === 2) throw new Error('secret at /Users/private/project and full command log');
      return '';
    }
  });
  const plan = await environment.describeInstall('whisper');
  const result = await environment.installTool({ toolId: 'whisper', confirmationId: plan.confirmationId });
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.doesNotMatch(JSON.stringify(result), /Users|private|command log/);
  assert.deepEqual(calls.slice(1), [
    { program: 'brew', args: ['install', 'python@3.12'], timeoutMs: 300000 },
    { program: 'python3.12', args: ['-m', 'venv', '/user-data/python'], timeoutMs: 300000 }
  ]);
  await assert.rejects(
    () => environment.installTool({ toolId: 'whisper', confirmationId: plan.confirmationId }),
    /已使用/
  );
  assert.equal(calls.length, 3);
});

test('macOS 的简单工具动作完全来自固定白名单', async () => {
  const expected = {
    ffmpeg: ['brew', ['install', 'ffmpeg']],
    node: ['brew', ['install', 'node@20']],
    python: ['brew', ['install', 'python@3.12']]
  };
  for (const [toolId, [program, args]] of Object.entries(expected)) {
    const { environment, calls } = installFixture('darwin');
    const plan = await environment.describeInstall(toolId);
    await environment.installTool({ toolId, confirmationId: plan.confirmationId });
    assert.deepEqual(calls.at(-1), { program, args, timeoutMs: 300000 });
  }
});

test('Windows 的简单工具动作完全来自固定白名单', async () => {
  const common = ['--exact', '--accept-package-agreements', '--accept-source-agreements'];
  const expected = {
    ffmpeg: ['Gyan.FFmpeg'],
    node: ['OpenJS.NodeJS.LTS'],
    python: ['Python.Python.3.12']
  };
  for (const [toolId, [packageId]] of Object.entries(expected)) {
    const { environment, calls } = installFixture('win32');
    const plan = await environment.describeInstall(toolId);
    await environment.installTool({ toolId, confirmationId: plan.confirmationId });
    assert.deepEqual(calls.at(-1), {
      program: 'winget',
      args: ['install', '--id', packageId, ...common],
      timeoutMs: 300000
    });
  }
});

test('Whisper 在两个平台按固定顺序创建托管环境并安装依赖', async () => {
  const mac = installFixture('darwin');
  const macPlan = await mac.environment.describeInstall('whisper');
  await mac.environment.installTool({ toolId: 'whisper', confirmationId: macPlan.confirmationId });
  assert.deepEqual(mac.calls.slice(1), [
    { program: 'brew', args: ['install', 'python@3.12'], timeoutMs: 300000 },
    { program: 'python3.12', args: ['-m', 'venv', '/user-data/python'], timeoutMs: 300000 },
    {
      program: '/user-data/python/bin/python',
      args: ['-m', 'pip', 'install', 'faster-whisper', 'soundfile', 'numpy'],
      timeoutMs: 300000
    }
  ]);

  const windows = installFixture('win32');
  const windowsPlan = await windows.environment.describeInstall('whisper');
  await windows.environment.installTool({ toolId: 'whisper', confirmationId: windowsPlan.confirmationId });
  assert.deepEqual(windows.calls.slice(1), [
    {
      program: 'winget',
      args: ['install', '--id', 'Python.Python.3.12', '--exact', '--accept-package-agreements', '--accept-source-agreements'],
      timeoutMs: 300000
    },
    { program: 'py', args: ['-3.12', '-m', 'venv', 'C:\\user-data\\python'], timeoutMs: 300000 },
    {
      program: 'C:\\user-data\\python\\Scripts\\python.exe',
      args: ['-m', 'pip', 'install', 'faster-whisper', 'soundfile', 'numpy'],
      timeoutMs: 300000
    }
  ]);
});
