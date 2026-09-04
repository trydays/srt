const gibibyte = 1024 ** 3;

function commandError(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

function successful(stdout) {
  return { stdout, stderr: '', exitCode: 0 };
}

function sameArgs(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function createScenarioDependencies(name) {
  const scenarios = {
    'mac-ready': {
      platform: 'darwin', arch: 'arm64', version: '15.6.1', chip: 'Apple M4', cores: 10,
      memoryGB: 24, diskFreeGB: 180, diskTotalGB: 494, graphics: 'ready'
    },
    'windows-ready': {
      platform: 'win32', arch: 'x64', version: '10.0.26100', chip: 'AMD Ryzen 9 9950X', cores: 16,
      memoryGB: 32, diskFreeGB: 240, diskTotalGB: 953, graphics: 'ready'
    },
    'mac-missing': {
      platform: 'darwin', arch: 'arm64', version: '15.6.1', chip: 'Apple M4', cores: 10,
      memoryGB: 24, diskFreeGB: 180, diskTotalGB: 494, graphics: 'ready'
    },
    'mac-degraded': {
      platform: 'darwin', arch: 'arm64', version: '15.6.1', chip: 'Apple M4', cores: 10,
      memoryGB: 6, diskFreeGB: 5, diskTotalGB: 494, graphics: 'probe_error'
    }
  };
  const scenario = scenarios[name];
  if (!scenario) throw new Error(`Unknown E2E scenario: ${name}`);

  const state = {
    calls: [],
    confirmationCount: 0,
    ffmpegInstallCount: 0
  };

  function run(program, args) {
    const callArgs = Array.isArray(args) ? args.slice() : [];
    state.calls.push({ program, args: callArgs });

    if (scenario.platform === 'darwin' && program === 'system_profiler' && sameArgs(callArgs, ['SPDisplaysDataType', '-json'])) {
      if (scenario.graphics === 'probe_error') throw commandError('graphics probe failed', 'EIO');
      return Promise.resolve(successful(JSON.stringify({
        SPDisplaysDataType: [{ _name: 'Apple M4', spdisplays_metal: 'Supported, Metal 3' }]
      })));
    }
    if (scenario.platform === 'win32' && program === 'powershell.exe' && sameArgs(callArgs, [
      '-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name'
    ])) {
      return Promise.resolve(successful('NVIDIA GeForce RTX 4090'));
    }

    if (program === 'ffmpeg' && sameArgs(callArgs, ['-version'])) {
      if (name === 'mac-missing' && state.ffmpegInstallCount !== 1) {
        return Promise.reject(commandError('ffmpeg is absent', 'ENOENT'));
      }
      return Promise.resolve(successful('ffmpeg version 7.1 Copyright FFmpeg developers'));
    }
    if (program === 'node' && sameArgs(callArgs, ['--version'])) return Promise.resolve(successful('v22.18.0'));
    if (program === 'npm' && sameArgs(callArgs, ['--version'])) return Promise.resolve(successful('10.9.3'));

    const managedMacPython = scenario.platform === 'darwin' && /\/python\/bin\/python$/.test(program);
    const managedWindowsPython = scenario.platform === 'win32' && /\\python\\Scripts\\python\.exe$/.test(program);
    if ((managedMacPython || managedWindowsPython) && sameArgs(callArgs, ['--version'])) {
      return Promise.reject(commandError('managed Python is absent', 'ENOENT'));
    }
    if (scenario.platform === 'darwin' && program === 'python3' && sameArgs(callArgs, ['--version'])) {
      return Promise.resolve(successful('Python 3.12.9'));
    }
    if (scenario.platform === 'darwin' && program === 'python3' && sameArgs(callArgs, ['-m', 'pip', 'show', 'faster-whisper'])) {
      return Promise.resolve(successful('Name: faster-whisper\nVersion: 1.1.1'));
    }
    if (scenario.platform === 'win32' && program === 'py' && sameArgs(callArgs, ['-3', '--version'])) {
      return Promise.resolve(successful('Python 3.12.9'));
    }
    if (scenario.platform === 'win32' && program === 'py' && sameArgs(callArgs, ['-3', '-m', 'pip', 'show', 'faster-whisper'])) {
      return Promise.resolve(successful('Name: faster-whisper\nVersion: 1.1.1'));
    }

    if (program === 'brew' && sameArgs(callArgs, ['--version'])) return Promise.resolve(successful('Homebrew 4.6.0'));
    if (program === 'winget' && sameArgs(callArgs, ['--version'])) return Promise.resolve(successful('v1.10.340'));
    if (program === 'brew' && sameArgs(callArgs, ['install', 'ffmpeg'])) {
      state.ffmpegInstallCount += 1;
      if (name === 'mac-missing' && state.ffmpegInstallCount > 1) {
        return Promise.reject(commandError('ffmpeg install ran more than once'));
      }
      return Promise.resolve(successful('ffmpeg installed'));
    }
    if (program === 'brew' && (
      sameArgs(callArgs, ['install', 'node@20']) || sameArgs(callArgs, ['install', 'python@3.12'])
    )) return Promise.resolve(successful('package installed'));
    if (program === 'winget' && (
      sameArgs(callArgs, ['install', '--id', 'Gyan.FFmpeg', '--exact', '--accept-package-agreements', '--accept-source-agreements']) ||
      sameArgs(callArgs, ['install', '--id', 'OpenJS.NodeJS.LTS', '--exact', '--accept-package-agreements', '--accept-source-agreements']) ||
      sameArgs(callArgs, ['install', '--id', 'Python.Python.3.12', '--exact', '--accept-package-agreements', '--accept-source-agreements'])
    )) return Promise.resolve(successful('package installed'));
    if (program === 'python3.12' && callArgs[0] === '-m' && callArgs[1] === 'venv' && callArgs.length === 3) {
      return Promise.resolve(successful('environment created'));
    }
    if (program === 'py' && callArgs[0] === '-3.12' && callArgs[1] === '-m' && callArgs[2] === 'venv' && callArgs.length === 4) {
      return Promise.resolve(successful('environment created'));
    }
    if ((managedMacPython || managedWindowsPython) && sameArgs(callArgs, [
      '-m', 'pip', 'install', 'faster-whisper', 'soundfile', 'numpy'
    ])) return Promise.resolve(successful('dependencies installed'));

    return Promise.reject(commandError(`Unexpected E2E command: ${program} ${JSON.stringify(callArgs)}`));
  }

  const dependencies = {
    platform: scenario.platform,
    arch: scenario.arch,
    targetPath: '/scenario-target',
    userDataDir: '/scenario-user-data',
    osApi: {
      version: () => scenario.version,
      release: () => scenario.version,
      cpus: () => Array.from({ length: scenario.cores }, () => ({ model: scenario.chip })),
      totalmem: () => scenario.memoryGB * gibibyte
    },
    fsApi: {
      statfs: async () => ({
        bsize: 4096,
        blocks: scenario.diskTotalGB * gibibyte / 4096,
        bavail: scenario.diskFreeGB * gibibyte / 4096,
        bfree: scenario.diskFreeGB * gibibyte / 4096
      })
    },
    run,
    getBundledTools: () => ({}),
    tokenFactory: () => `e2e-confirmation-${++state.confirmationCount}`
  };

  return { dependencies, state };
}

module.exports = { createScenarioDependencies };
