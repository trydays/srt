const gibibyte = 1024 ** 3;
const SUBTITLE_MODEL_FILES = [
  'model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt'
];
const FASTER_WHISPER_PROBE =
  'import faster_whisper, importlib.metadata as m; print(m.version("faster-whisper"))';

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
    'windows-npm-missing': {
      platform: 'win32', arch: 'x64', version: '10.0.26100', chip: 'AMD Ryzen 9 9950X', cores: 16,
      memoryGB: 32, diskFreeGB: 240, diskTotalGB: 953, graphics: 'ready'
    },
    'mac-missing': {
      platform: 'darwin', arch: 'arm64', version: '15.6.1', chip: 'Apple M4', cores: 10,
      memoryGB: 24, diskFreeGB: 180, diskTotalGB: 494, graphics: 'ready'
    },
    'mac-ffmpeg-limited': {
      platform: 'darwin', arch: 'arm64', version: '15.6.1', chip: 'Apple M4', cores: 10,
      memoryGB: 24, diskFreeGB: 180, diskTotalGB: 494, graphics: 'ready'
    },
    'mac-degraded': {
      platform: 'darwin', arch: 'arm64', version: '15.6.1', chip: 'Apple M4', cores: 10,
      memoryGB: 6, diskFreeGB: 5, diskTotalGB: 494, graphics: 'probe_error'
    },
    'mac-whisper-retry': {
      platform: 'darwin', arch: 'arm64', version: '15.6.1', chip: 'Apple M4', cores: 10,
      memoryGB: 24, diskFreeGB: 180, diskTotalGB: 494, graphics: 'ready'
    }
  };
  const scenario = scenarios[name];
  if (!scenario) throw new Error(`Unknown E2E scenario: ${name}`);

  const state = {
    calls: [],
    confirmationCount: 0,
    ffmpegInstallCount: 0,
    nodeInstallCount: 0,
    managedPythonReady: false,
    whisperPackageReady: false,
    whisperModelReady: false,
    whisperDownloadAttempts: 0
  };
  const windowsNodeDir = 'C:\\Program Files\\nodejs';
  const windowsNodeExe = `${windowsNodeDir}\\node.exe`;
  const windowsNpmCli = `${windowsNodeDir}\\node_modules\\npm\\bin\\npm-cli.js`;

  function run(program, args) {
    const callArgs = Array.isArray(args) ? args.slice() : [];
    state.calls.push({ program, args: callArgs });

    if (program === 'brew' && scenario.platform !== 'darwin') {
      return Promise.reject(commandError('Homebrew is unavailable on this platform', 'ENOENT'));
    }
    if (program === 'winget' && scenario.platform !== 'win32') {
      return Promise.reject(commandError('winget is unavailable on this platform', 'ENOENT'));
    }

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

    const macFullFfmpeg = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
    const macFullFfprobe = '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe';
    const macFullReady = scenario.platform === 'darwin' &&
      (!['mac-missing', 'mac-ffmpeg-limited'].includes(name) || state.ffmpegInstallCount === 1);
    if (program === macFullFfmpeg && sameArgs(callArgs, ['-version']) && macFullReady) {
      return Promise.resolve(successful('ffmpeg version 7.1 Copyright FFmpeg developers'));
    }
    if (program === macFullFfmpeg && sameArgs(callArgs, ['-hide_banner', '-filters']) && macFullReady) {
      return Promise.resolve(successful('Filters:\n ... ass V->V'));
    }
    if (program === macFullFfmpeg && sameArgs(callArgs, ['-hide_banner', '-encoders']) && macFullReady) {
      return Promise.resolve(successful(' V..... libx264\n A..... aac'));
    }
    if (program === macFullFfmpeg && sameArgs(callArgs, ['-hide_banner', '-muxers']) && macFullReady) {
      return Promise.resolve(successful(' E mp4 MP4'));
    }
    if (program === macFullFfprobe && sameArgs(callArgs, ['-version']) && macFullReady) {
      return Promise.resolve(successful('ffprobe version 7.1'));
    }
    if ((program === macFullFfmpeg || program === macFullFfprobe) && !macFullReady) {
      return Promise.reject(commandError('ffmpeg-full is absent', 'ENOENT'));
    }
    if (program === 'ffmpeg' && sameArgs(callArgs, ['-version'])) {
      if (name === 'mac-missing' && state.ffmpegInstallCount !== 1) {
        return Promise.reject(commandError('ffmpeg is absent', 'ENOENT'));
      }
      return Promise.resolve(successful('ffmpeg version 7.1 Copyright FFmpeg developers'));
    }
    if (program === 'ffmpeg' && sameArgs(callArgs, ['-hide_banner', '-filters'])) {
      return Promise.resolve(successful(name === 'mac-ffmpeg-limited'
        ? 'Filters:\n ... scale V->V'
        : 'Filters:\n ... ass V->V'));
    }
    if (program === 'ffmpeg' && sameArgs(callArgs, ['-hide_banner', '-encoders'])) {
      return Promise.resolve(successful(' V..... libx264\n A..... aac'));
    }
    if (program === 'ffmpeg' && sameArgs(callArgs, ['-hide_banner', '-muxers'])) {
      return Promise.resolve(successful(' E mp4 MP4'));
    }
    if (program === 'ffprobe' && sameArgs(callArgs, ['-version'])) {
      return Promise.resolve(successful('ffprobe version 7.1'));
    }
    if (scenario.platform === 'win32' && program === windowsNodeExe && sameArgs(callArgs, ['--version'])) {
      if (name === 'windows-npm-missing' && state.nodeInstallCount === 1) {
        return Promise.resolve(successful('v22.18.0'));
      }
      return Promise.reject(commandError('standard Node installation is absent', 'ENOENT'));
    }
    if (scenario.platform === 'win32' && program === windowsNodeExe && sameArgs(callArgs, [windowsNpmCli, '--version'])) {
      if (name === 'windows-npm-missing' && state.nodeInstallCount === 1) {
        return Promise.resolve(successful('10.9.3'));
      }
      return Promise.reject(commandError('standard npm installation is absent', 'ENOENT'));
    }
    if (program === 'node' && sameArgs(callArgs, ['--version'])) {
      if (name === 'windows-npm-missing' && state.nodeInstallCount !== 1) {
        return Promise.reject(commandError('Node.js is absent', 'ENOENT'));
      }
      return Promise.resolve(successful('v22.18.0'));
    }
    if (scenario.platform === 'win32' && program === 'cmd.exe' && sameArgs(callArgs, ['/d', '/s', '/c', 'npm', '--version'])) {
      if (name === 'windows-ready') return Promise.resolve(successful('10.9.3'));
      return Promise.reject(commandError('npm is absent from inherited PATH', 'ECOMMAND'));
    }
    if (program === 'npm' && sameArgs(callArgs, ['--version'])) {
      if (name === 'windows-npm-missing') return Promise.reject(commandError('npm is absent', 'ENOENT'));
      return Promise.resolve(successful('10.9.3'));
    }

    const managedMacPython = scenario.platform === 'darwin' && /\/python\/bin\/python$/.test(program);
    const managedWindowsPython = scenario.platform === 'win32' && /\\python\\Scripts\\python\.exe$/.test(program);
    if ((managedMacPython || managedWindowsPython) && sameArgs(callArgs, ['--version'])) {
      if (name === 'mac-whisper-retry' && state.managedPythonReady) {
        return Promise.resolve(successful('Python 3.12.9'));
      }
      return Promise.reject(commandError('managed Python is absent', 'ENOENT'));
    }
    if (name === 'mac-whisper-retry' && managedMacPython &&
        sameArgs(callArgs, ['-c', FASTER_WHISPER_PROBE])) {
      return state.whisperPackageReady
        ? Promise.resolve(successful('1.2.1'))
        : Promise.reject(commandError('faster-whisper is absent', 'ECOMMAND'));
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
    if (program === 'brew' && sameArgs(callArgs, ['install', 'ffmpeg-full'])) {
      state.ffmpegInstallCount += 1;
      if (name === 'mac-missing' && state.ffmpegInstallCount > 1) {
        return Promise.reject(commandError('ffmpeg install ran more than once'));
      }
      return Promise.resolve(successful('ffmpeg installed'));
    }
    if (program === 'brew' && (
      sameArgs(callArgs, ['install', 'node@20']) || sameArgs(callArgs, ['install', 'python@3.12'])
    )) return Promise.resolve(successful('package installed'));
    if (program === 'winget' && sameArgs(callArgs, [
      'install', '--id', 'OpenJS.NodeJS.LTS', '--exact', '--accept-package-agreements', '--accept-source-agreements'
    ])) {
      state.nodeInstallCount += 1;
      if (name === 'windows-npm-missing' && state.nodeInstallCount > 1) {
        return Promise.reject(commandError('Node.js install ran more than once'));
      }
      return Promise.resolve(successful('package installed'));
    }
    if (program === 'winget' && (
      sameArgs(callArgs, ['install', '--id', 'Gyan.FFmpeg', '--exact', '--accept-package-agreements', '--accept-source-agreements']) ||
      sameArgs(callArgs, ['install', '--id', 'Python.Python.3.12', '--exact', '--accept-package-agreements', '--accept-source-agreements'])
    )) return Promise.resolve(successful('package installed'));
    if (program === 'python3.12' && callArgs[0] === '-m' && callArgs[1] === 'venv' && callArgs.length === 3) {
      if (name === 'mac-whisper-retry') state.managedPythonReady = true;
      return Promise.resolve(successful('environment created'));
    }
    if (program === 'py' && callArgs[0] === '-3.12' && callArgs[1] === '-m' && callArgs[2] === 'venv' && callArgs.length === 4) {
      return Promise.resolve(successful('environment created'));
    }
    if ((managedMacPython || managedWindowsPython) && sameArgs(callArgs, [
      '-m', 'pip', 'install', 'faster-whisper', 'soundfile', 'numpy'
    ])) {
      if (name === 'mac-whisper-retry') state.whisperPackageReady = true;
      return Promise.resolve(successful('dependencies installed'));
    }

    if (name === 'mac-whisper-retry' && managedMacPython && callArgs[0] === '-c' &&
        /snapshot_download/.test(callArgs[1] || '')) {
      state.whisperDownloadAttempts += 1;
      return new Promise((resolve, reject) => setTimeout(() => {
        if (state.whisperDownloadAttempts === 1) {
          reject(commandError('model download failed', 'ECOMMAND'));
          return;
        }
        state.whisperModelReady = true;
        resolve(successful('model ready'));
      }, 300));
    }

    return Promise.reject(commandError(`Unexpected E2E command: ${program} ${JSON.stringify(callArgs)}`));
  }

  const dependencies = {
    platform: scenario.platform,
    arch: scenario.arch,
    targetPath: '/scenario-target',
    userDataDir: '/scenario-user-data',
    windowsNodeDir: scenario.platform === 'win32' ? windowsNodeDir : null,
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
      }),
      stat: async (filePath) => {
        const required = SUBTITLE_MODEL_FILES.some((fileName) => filePath.endsWith(fileName));
        if (name !== 'mac-whisper-retry' || !state.whisperModelReady || !required) {
          throw commandError('model file is absent', 'ENOENT');
        }
        return { size: 1, isFile: () => true };
      }
    },
    run,
    getBundledTools: () => ({}),
    // Fixed environment-page scenario, not a claim about the host's renderer.
    // Real Remotion desktop cases resolve their tools through the production adapter.
    probeRemotionRuntime: async () => ({
      packages: { status: 'ready', reason: 'ok', version: '4.0.522' },
      playerBundle: { status: 'ready', reason: 'ok', path: '/scenario/player.js' },
      rendererBundle: { status: 'ready', reason: 'ok', path: '/scenario/render' },
      browser: { status: 'ready', reason: 'ok', path: '/scenario/chrome' }
    }),
    tokenFactory: () => `e2e-confirmation-${++state.confirmationCount}`
  };

  return { dependencies, state };
}

module.exports = { createScenarioDependencies };
