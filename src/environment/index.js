const path = require('node:path');

const SUBTITLE_MODEL_FILES = [
  'model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt'
];
const FASTER_WHISPER_PROBE =
  'import faster_whisper, importlib.metadata as m; print(m.version("faster-whisper"))';

function createEnvironmentModule(dependencies) {
  const runOptions = { timeout: 5000, maxBuffer: 1024 * 1024 };
  const installRunOptions = { timeoutMs: 300000 };
  const confirmations = new Map();
  const pathApi = dependencies.platform === 'win32' ? path.win32 : path.posix;
  const managedDirectory = pathApi.join(dependencies.userDataDir, 'python');
  const managedPython = dependencies.platform === 'win32'
    ? pathApi.join(managedDirectory, 'Scripts', 'python.exe')
    : pathApi.join(managedDirectory, 'bin', 'python');
  const subtitleModelDir = pathApi.join(
    dependencies.userDataDir, 'models', 'faster-whisper-small'
  );

  function installationCatalog() {
    const wingetAgreements = ['--exact', '--accept-package-agreements', '--accept-source-agreements'];
    const pipPackages = ['-m', 'pip', 'install', 'faster-whisper', 'soundfile', 'numpy'];
    const downloadModelCode = [
      'from pathlib import Path',
      'from huggingface_hub import snapshot_download',
      'from huggingface_hub.utils import disable_progress_bars',
      'import faster_whisper',
      `target=Path(${JSON.stringify(subtitleModelDir)})`,
      `required=${JSON.stringify(SUBTITLE_MODEL_FILES)}`,
      'disable_progress_bars()',
      'snapshot_download(repo_id="Systran/faster-whisper-small", local_dir=str(target), allow_patterns=required)',
      'if not all((target/name).is_file() and (target/name).stat().st_size > 0 for name in required): raise RuntimeError("incomplete model")'
    ].join('\n');
    const downloadModelAction = {
      program: managedPython,
      args: ['-c', downloadModelCode],
      timeoutMs: 1200000
    };

    return {
      darwin: {
        ffmpeg: {
          label: 'FFmpeg', downloadEstimate: '约 100–200 MB', installLocation: 'Homebrew ffmpeg-full 独立目录', durationEstimate: '约 2–10 分钟',
          steps: ['通过 Homebrew 安装包含字幕滤镜依赖的 ffmpeg-full，并直接使用其独立目录。'],
          actions: [{ program: 'brew', args: ['install', 'ffmpeg-full'] }]
        },
        node: {
          label: 'Node.js', downloadEstimate: '约 50 MB', installLocation: '由 Homebrew 管理', durationEstimate: '约 1–5 分钟',
          steps: ['通过 Homebrew 下载并安装 Node.js 20。'],
          actions: [{ program: 'brew', args: ['install', 'node@20'] }]
        },
        python: {
          label: 'Python', downloadEstimate: '约 100 MB', installLocation: '由 Homebrew 管理', durationEstimate: '约 1–5 分钟',
          steps: ['通过 Homebrew 下载并安装 Python 3.12。'],
          actions: [{ program: 'brew', args: ['install', 'python@3.12'] }]
        },
        whisper: {
          label: 'Whisper 字幕', downloadEstimate: '约 486 MB', installLocation: '应用管理的 Python 与模型目录', durationEstimate: '约 5–20 分钟',
          steps: ['准备应用专用的 Python 3.12 环境。', '安装 faster-whisper 运行依赖。', '下载固定的 Small 本地模型，完成后可离线使用。'],
          actions: [
            { program: 'brew', args: ['install', 'python@3.12'] },
            { program: 'python3.12', args: ['-m', 'venv', managedDirectory] },
            { program: managedPython, args: pipPackages },
            downloadModelAction
          ]
        }
      },
      win32: {
        ffmpeg: {
          label: 'FFmpeg', downloadEstimate: '约 100–200 MB', installLocation: '由 Windows 包管理器管理', durationEstimate: '约 2–10 分钟',
          steps: ['通过 Windows 包管理器下载并安装 FFmpeg。'],
          actions: [{ program: 'winget', args: ['install', '--id', 'Gyan.FFmpeg', ...wingetAgreements] }]
        },
        node: {
          label: 'Node.js', downloadEstimate: '约 50 MB', installLocation: '由 Windows 包管理器管理', durationEstimate: '约 1–5 分钟',
          steps: ['通过 Windows 包管理器下载并安装 Node.js LTS。'],
          actions: [{ program: 'winget', args: ['install', '--id', 'OpenJS.NodeJS.LTS', ...wingetAgreements] }]
        },
        python: {
          label: 'Python', downloadEstimate: '约 100 MB', installLocation: '由 Windows 包管理器管理', durationEstimate: '约 1–5 分钟',
          steps: ['通过 Windows 包管理器下载并安装 Python 3.12。'],
          actions: [{ program: 'winget', args: ['install', '--id', 'Python.Python.3.12', ...wingetAgreements] }]
        },
        whisper: {
          label: 'Whisper 字幕', downloadEstimate: '约 486 MB', installLocation: '应用管理的 Python 与模型目录', durationEstimate: '约 5–20 分钟',
          steps: ['准备应用专用的 Python 3.12 环境。', '安装 faster-whisper 运行依赖。', '下载固定的 Small 本地模型，完成后可离线使用。'],
          actions: [
            { program: 'winget', args: ['install', '--id', 'Python.Python.3.12', ...wingetAgreements] },
            { program: 'py', args: ['-3.12', '-m', 'venv', managedDirectory] },
            { program: managedPython, args: pipPackages },
            downloadModelAction
          ]
        }
      }
    };
  }

  function versionFrom(output) {
    const match = String(output || '').match(/(?:^|[^0-9])(\d+)\.(\d+)(?:\.(\d+))?/);
    return match ? `${match[1]}.${match[2]}.${match[3] || '0'}` : null;
  }

  function versionAtLeast(version, major, minor) {
    if (!version) return false;
    const parts = version.split('.').map(Number);
    return parts[0] > major || (parts[0] === major && parts[1] >= minor);
  }

  function errorReason(error) {
    return error && error.code === 'ENOENT' ? 'absent' : 'probe_error';
  }

  function blankTool(command, source, reason) {
    return {
      installed: false,
      compatible: false,
      version: null,
      command: command || null,
      source: source || 'system',
      status: 'missing',
      reason
    };
  }

  function evaluatedTool(command, source, output, compatible) {
    const version = versionFrom(output);
    if (!version) {
      return {
        installed: true, compatible: false, version: null, command, source,
        status: 'limited', reason: 'incompatible'
      };
    }
    const isCompatible = compatible(version);
    return {
      installed: true,
      compatible: isCompatible,
      version,
      command,
      source,
      status: isCompatible ? 'ready' : 'limited',
      reason: isCompatible ? 'ok' : 'incompatible'
    };
  }

  function bundledTool(name, compatible) {
    let bundled = {};
    try {
      bundled = dependencies.getBundledTools ? dependencies.getBundledTools() || {} : {};
    } catch (_) {
      return null;
    }
    const candidate = bundled[name];
    if (!candidate || !candidate.available) return null;
    return evaluatedTool(candidate.path || name, 'bundled', candidate.version, compatible);
  }

  async function probeTool(name, program, args, compatible) {
    const bundled = bundledTool(name, compatible);
    if (bundled && bundled.compatible) return bundled;
    const candidates = (Array.isArray(program) ? program : [program]).map((candidate) => (
      typeof candidate === 'string'
        ? { program: candidate, args, command: candidate }
        : { program: candidate.program, args: candidate.args, command: candidate.command || candidate.program }
    ));
    let installedFallback = bundled || null;
    let strongestFailure = blankTool(candidates[candidates.length - 1].command, 'system', 'absent');
    for (const candidate of candidates) {
      try {
        const output = await dependencies.run(candidate.program, candidate.args, runOptions);
        const tool = evaluatedTool(candidate.command, 'system', output && output.stdout !== undefined ? output.stdout : output, compatible);
        if (tool.compatible) return tool;
        if (!installedFallback) installedFallback = tool;
      } catch (error) {
        const failure = blankTool(candidate.command, 'system', errorReason(error));
        if (strongestFailure.reason !== 'probe_error' || failure.reason === 'probe_error') {
          strongestFailure = failure;
        }
      }
    }
    return installedFallback || strongestFailure;
  }

  function listingHas(output, name) {
    const pattern = new RegExp(`^\\s*[.A-Z]+\\s+${name}(?:\\s|$)`, 'i');
    return String(output && output.stdout !== undefined ? output.stdout : output || '')
      .split(/\r?\n/)
      .some((line) => pattern.test(line));
  }

  function exportCandidates(bundled) {
    const candidates = [];
    if (dependencies.platform === 'darwin') {
      candidates.push(
        { command: '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', source: 'system' },
        { command: '/usr/local/opt/ffmpeg-full/bin/ffmpeg', source: 'system' }
      );
    }
    if (bundled && bundled.compatible) {
      candidates.push({ command: bundled.command, source: 'bundled' });
    }
    candidates.push({ command: 'ffmpeg', source: 'system' });
    return candidates;
  }

  function ffprobeCandidates(ffmpegPath) {
    if (pathApi.isAbsolute(ffmpegPath)) {
      return [pathApi.join(
        pathApi.dirname(ffmpegPath),
        dependencies.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
      )];
    }
    return ['ffprobe'];
  }

  async function probeFfprobe(ffmpegPath) {
    let sawProbeError = false;
    for (const ffprobePath of ffprobeCandidates(ffmpegPath)) {
      try {
        await dependencies.run(ffprobePath, ['-version'], runOptions);
        return { ready: true, ffprobePath };
      } catch (error) {
        if (errorReason(error) === 'probe_error') sawProbeError = true;
      }
    }
    return { ready: false, reason: sawProbeError ? 'probe_error' : 'ffprobe_missing' };
  }

  function exportMode(status, reason) {
    return {
      status,
      reason,
      blockers: status === 'ready' ? [] : ['ffmpeg']
    };
  }

  async function probeExportCandidate(candidate) {
    let ffmpeg;
    try {
      const output = await dependencies.run(candidate.command, ['-version'], runOptions);
      ffmpeg = evaluatedTool(
        candidate.command,
        candidate.source,
        output && output.stdout !== undefined ? output.stdout : output,
        () => true
      );
    } catch (error) {
      const reason = errorReason(error);
      return {
        ffmpeg: blankTool(candidate.command, candidate.source, reason),
        mode: exportMode('missing', reason)
      };
    }

    if (!ffmpeg.compatible) {
      return { ffmpeg, mode: exportMode('limited', 'probe_error') };
    }

    let filters;
    let encoders;
    let muxers;
    try {
      [filters, encoders, muxers] = await Promise.all([
        dependencies.run(candidate.command, ['-hide_banner', '-filters'], runOptions),
        dependencies.run(candidate.command, ['-hide_banner', '-encoders'], runOptions),
        dependencies.run(candidate.command, ['-hide_banner', '-muxers'], runOptions)
      ]);
    } catch (_) {
      return { ffmpeg, mode: exportMode('limited', 'probe_error') };
    }

    if (!listingHas(filters, 'ass')) {
      return { ffmpeg, mode: exportMode('limited', 'subtitle_filter_missing') };
    }
    if (!listingHas(encoders, 'libx264') || !listingHas(encoders, 'aac') || !listingHas(muxers, 'mp4')) {
      return { ffmpeg, mode: exportMode('limited', 'encoder_missing') };
    }

    const ffprobe = await probeFfprobe(candidate.command);
    if (!ffprobe.ready) {
      return { ffmpeg, mode: exportMode('limited', ffprobe.reason) };
    }
    return {
      ffmpeg,
      ffmpegPath: candidate.command,
      ffprobePath: ffprobe.ffprobePath,
      mode: exportMode('ready', 'ok')
    };
  }

  async function probeExportTools() {
    const bundled = bundledTool('ffmpeg', () => true);
    let installedFallback = null;
    let strongestFailure = null;
    for (const candidate of exportCandidates(bundled)) {
      const result = await probeExportCandidate(candidate);
      if (result.mode.status === 'ready') return result;
      if (result.ffmpeg.installed && !installedFallback) installedFallback = result;
      if (!strongestFailure || result.mode.reason === 'probe_error') strongestFailure = result;
    }
    if (installedFallback) return installedFallback;
    if (bundled && !bundled.compatible) {
      return { ffmpeg: bundled, mode: exportMode('limited', 'probe_error') };
    }
    return strongestFailure;
  }

  async function probeMediaTools() {
    const bundled = bundledTool('ffmpeg', () => true);
    let installedFallback = null;
    let strongestFailure = null;
    for (const candidate of exportCandidates(bundled)) {
      let ffmpeg;
      try {
        const output = await dependencies.run(candidate.command, ['-version'], runOptions);
        ffmpeg = evaluatedTool(
          candidate.command,
          candidate.source,
          output && output.stdout !== undefined ? output.stdout : output,
          () => true
        );
      } catch (error) {
        const reason = errorReason(error);
        const failure = {
          ffmpeg: blankTool(candidate.command, candidate.source, reason),
          mode: { status: 'missing', reason, blockers: ['mediaProbe'] }
        };
        if (!strongestFailure || reason === 'probe_error') strongestFailure = failure;
        continue;
      }
      if (!ffmpeg.compatible) {
        if (!installedFallback) {
          installedFallback = {
            ffmpeg,
            mode: { status: 'limited', reason: 'probe_error', blockers: ['mediaProbe'] }
          };
        }
        continue;
      }
      const ffprobe = await probeFfprobe(candidate.command);
      if (ffprobe.ready) {
        return {
          ffmpeg,
          ffprobePath: ffprobe.ffprobePath,
          mode: { status: 'ready', reason: 'ok', blockers: [] }
        };
      }
      const failure = {
        ffmpeg,
        mode: { status: ffprobe.reason === 'ffprobe_missing' ? 'missing' : 'limited', reason: ffprobe.reason, blockers: ['mediaProbe'] }
      };
      if (!installedFallback || ffprobe.reason === 'probe_error') installedFallback = failure;
    }
    return installedFallback || strongestFailure || {
      ffmpeg: blankTool('ffmpeg', 'system', 'absent'),
      mode: { status: 'missing', reason: 'absent', blockers: ['mediaProbe'] }
    };
  }

  async function probeRemotionRuntime() {
    if (typeof dependencies.probeRemotionRuntime !== 'function') {
      return {
        packages: { status: 'missing', reason: 'remotion_packages_missing' },
        playerBundle: { status: 'missing', reason: 'remotion_player_bundle_missing' },
        rendererBundle: { status: 'missing', reason: 'remotion_renderer_bundle_missing' },
        browser: { status: 'missing', reason: 'remotion_browser_missing' }
      };
    }
    try {
      return await dependencies.probeRemotionRuntime();
    } catch (_) {
      return {
        packages: { status: 'missing', reason: 'probe_error' },
        playerBundle: { status: 'missing', reason: 'probe_error' },
        rendererBundle: { status: 'missing', reason: 'probe_error' },
        browser: { status: 'missing', reason: 'probe_error' }
      };
    }
  }

  function remotionMode(runtime, mediaTools) {
    return mode({
      packages: runtime.packages,
      playerBundle: runtime.playerBundle,
      rendererBundle: runtime.rendererBundle,
      browser: runtime.browser,
      mediaProbe: mediaTools.mode
    });
  }

  async function getRemotionTools() {
    const [runtime, mediaTools] = await Promise.all([
      probeRemotionRuntime(),
      probeMediaTools()
    ]);
    if (remotionMode(runtime, mediaTools).status !== 'ready') {
      const error = new Error('Remotion 渲染运行环境未就绪');
      error.code = 'EXPORT_RUNTIME_NOT_READY';
      throw error;
    }
    return {
      ffprobePath: mediaTools.ffprobePath,
      browserExecutable: runtime.browser.path,
      bundlePath: runtime.rendererBundle.path
    };
  }

  async function getExportTools() {
    const result = await probeExportTools();
    if (result && result.mode.status === 'ready') {
      return { ffmpegPath: result.ffmpegPath, ffprobePath: result.ffprobePath };
    }
    const error = new Error('字幕导出运行环境未就绪');
    error.code = 'EXPORT_RUNTIME_NOT_READY';
    throw error;
  }

  async function probePython() {
    const isWindows = dependencies.platform === 'win32';
    const compatible = (version) => {
      const [major, minor] = version.split('.').map(Number);
      return major === 3 && minor === 12;
    };
    const bundled = isWindows ? bundledTool('python', compatible) : null;
    const candidates = isWindows
      ? [
          { program: managedPython, args: [], source: 'managed' },
          ...(bundled ? [{ tool: bundled }] : []),
          { program: 'py', args: ['-3'], source: 'system' },
          { program: 'python', args: [], source: 'system' }
        ]
      : [
          { program: managedPython, args: [], source: 'managed' },
          { program: '/opt/homebrew/opt/python@3.12/bin/python3.12', args: [], source: 'system' },
          { program: '/usr/local/opt/python@3.12/bin/python3.12', args: [], source: 'system' },
          { program: 'python3.12', args: [], source: 'system' },
          { program: 'python3', args: [], source: 'system' },
          { program: 'python', args: [], source: 'system' }
        ];

    let strongestFailure = blankTool(candidates[candidates.length - 1].program, 'system', 'absent');
    let installedFallback = null;
    for (const candidate of candidates) {
      if (candidate.tool) {
        if (candidate.tool.compatible) {
          candidate.tool.prefixArgs = [];
          return candidate.tool;
        }
        candidate.tool.prefixArgs = [];
        if (!installedFallback) installedFallback = candidate.tool;
        continue;
      }
      try {
        const output = await dependencies.run(candidate.program, candidate.args.concat('--version'), runOptions);
        const tool = evaluatedTool(candidate.program, candidate.source, output && output.stdout !== undefined ? output.stdout : output, compatible);
        tool.prefixArgs = candidate.args;
        if (tool.compatible) return tool;
        if (!installedFallback) installedFallback = tool;
      } catch (error) {
        const failure = blankTool(candidate.program, candidate.source, errorReason(error));
        if (strongestFailure.reason !== 'probe_error' || failure.reason === 'probe_error') {
          strongestFailure = failure;
        }
      }
    }
    if (installedFallback) return installedFallback;
    strongestFailure.prefixArgs = [];
    return strongestFailure;
  }

  async function isSubtitleModelReady() {
    if (!dependencies.fsApi || typeof dependencies.fsApi.stat !== 'function') return false;
    try {
      const stats = await Promise.all(SUBTITLE_MODEL_FILES.map((fileName) => (
        dependencies.fsApi.stat(pathApi.join(subtitleModelDir, fileName))
      )));
      return stats.every((stat) => stat && stat.isFile() && stat.size > 0);
    } catch (_) {
      return false;
    }
  }

  async function probeWhisper(python) {
    if (!python.installed || !python.compatible || python.source !== 'managed') {
      return blankTool(managedPython, 'managed', 'absent');
    }
    try {
      const output = await dependencies.run(
        managedPython, ['-c', FASTER_WHISPER_PROBE], runOptions
      );
      const text = output && output.stdout !== undefined ? output.stdout : output;
      const version = versionFrom(text);
      if (!await isSubtitleModelReady()) {
        return {
          installed: true, compatible: false, version, command: managedPython,
          source: 'managed', status: 'missing', reason: 'absent'
        };
      }
      return {
        installed: true, compatible: true, version, command: managedPython,
        source: 'managed', status: 'ready', reason: 'ok'
      };
    } catch (_) {
      return blankTool(managedPython, 'managed', 'probe_error');
    }
  }

  function hardwareStatus(value, readyAt, limitedAt) {
    if (value >= readyAt) return 'ready';
    if (value >= limitedAt) return 'limited';
    return 'missing';
  }

  function architectureStatus() {
    const { platform, arch } = dependencies;
    if ((platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) || (platform === 'win32' && arch === 'x64')) {
      return { status: 'ready', reason: 'ok' };
    }
    if (arch === 'ia32') return { status: 'limited', reason: 'ok' };
    return { status: 'missing', reason: 'unsupported' };
  }

  async function probeGraphics() {
    const isWindows = dependencies.platform === 'win32';
    const program = isWindows ? 'powershell.exe' : 'system_profiler';
    const args = isWindows
      ? ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name']
      : ['SPDisplaysDataType', '-json'];
    try {
      const output = await dependencies.run(program, args, runOptions);
      const text = String(output && output.stdout !== undefined ? output.stdout : output || '');
      if (isWindows) {
        const name = text.trim().split(/\r?\n/)[0];
        if (!name) return { name: null, supported: false, metal: false, status: 'limited', reason: 'unsupported' };
        return { name, supported: true, metal: false, status: 'ready', reason: 'ok' };
      }
      const displays = JSON.parse(text).SPDisplaysDataType || [];
      const display = displays[0] || {};
      const name = display._name || display.sppci_model || null;
      const metalStatus = String(display.spdisplays_metal || '').trim();
      const metalFamilyStatus = String(display.spdisplays_mtlgpufamilysupport || '').trim();
      const primaryMetalStatusPresent = Object.prototype.hasOwnProperty.call(display, 'spdisplays_metal');
      const metal = primaryMetalStatusPresent
        ? metalStatus === 'spdisplays_supported' || /^supported(?:\s*,|\s*$)/i.test(metalStatus)
        : /^spdisplays_metal\d+$/.test(metalFamilyStatus);
      return { name, supported: metal, metal, status: metal ? 'ready' : 'limited', reason: metal ? 'ok' : 'unsupported' };
    } catch (_) {
      return { name: null, supported: false, metal: false, status: 'missing', reason: 'probe_error' };
    }
  }

  function mode(required) {
    const blockers = Object.keys(required).filter((key) => required[key].status !== 'ready');
    if (!blockers.length) return { status: 'ready', reason: 'ok', blockers };
    const missing = blockers.find((key) => required[key].status === 'missing');
    const first = required[missing || blockers[0]];
    return { status: missing ? 'missing' : 'limited', reason: first.reason, blockers };
  }

  async function detectEnvironment() {
    const platform = { os: dependencies.platform, version: null, arch: dependencies.arch };
    try { platform.version = dependencies.osApi.version(); } catch (_) {
      try { platform.version = dependencies.osApi.release(); } catch (_) { platform.version = null; }
    }

    const architecture = architectureStatus();
    let chip;
    try {
      const cpus = dependencies.osApi.cpus();
      chip = { name: cpus[0] && cpus[0].model || null, cores: cpus.length, ...architecture };
    } catch (_) {
      chip = { name: null, cores: 0, status: 'missing', reason: 'probe_error' };
    }

    let memory;
    try {
      const totalGB = dependencies.osApi.totalmem() / 1024 ** 3;
      memory = { totalGB, status: hardwareStatus(totalGB, 16, 8), reason: 'ok' };
    } catch (_) {
      memory = { totalGB: null, status: 'missing', reason: 'probe_error' };
    }

    let disk;
    try {
      const stat = await dependencies.fsApi.statfs(dependencies.targetPath);
      const totalGB = stat.blocks * stat.bsize / 1024 ** 3;
      const freeGB = (stat.bavail === undefined ? stat.bfree : stat.bavail) * stat.bsize / 1024 ** 3;
      disk = { path: dependencies.targetPath, freeGB, totalGB, status: hardwareStatus(freeGB, 30, 10), reason: 'ok' };
    } catch (_) {
      disk = { path: dependencies.targetPath, freeGB: null, totalGB: null, status: 'missing', reason: 'probe_error' };
    }

    const isWindows = dependencies.platform === 'win32';
    const windowsNodeDir = String(dependencies.windowsNodeDir || 'C:\\Program Files\\nodejs').replace(/[\\/]+$/, '');
    const windowsNodeExe = `${windowsNodeDir}\\node.exe`;
    const windowsNpmCli = `${windowsNodeDir}\\node_modules\\npm\\bin\\npm-cli.js`;
    const nodePrograms = dependencies.platform === 'darwin'
      ? ['/opt/homebrew/opt/node@20/bin/node', '/usr/local/opt/node@20/bin/node', 'node']
      : isWindows
        ? [{ program: windowsNodeExe, args: ['--version'] }, 'node']
        : 'node';
    const npmPrograms = dependencies.platform === 'darwin'
      ? ['/opt/homebrew/opt/node@20/bin/npm', '/usr/local/opt/node@20/bin/npm', 'npm']
      : isWindows
        ? [
            { program: windowsNodeExe, args: [windowsNpmCli, '--version'], command: windowsNpmCli },
            { program: 'cmd.exe', args: ['/d', '/s', '/c', 'npm', '--version'], command: 'npm' }
          ]
        : 'npm';
    const [graphics, exportTools, mediaTools, remotionRuntime, node, npm, python] = await Promise.all([
      probeGraphics(),
      probeExportTools(),
      probeMediaTools(),
      probeRemotionRuntime(),
      probeTool('node', nodePrograms, ['--version'], (version) => versionAtLeast(version, 20, 0)),
      probeTool('npm', npmPrograms, ['--version'], () => true),
      probePython()
    ]);
    const ffmpeg = exportTools.ffmpeg;
    const whisper = await probeWhisper(python);
    delete python.prefixArgs;

    return {
      platform,
      hardware: { chip, memory, disk, graphics },
      tools: { ffmpeg, node, npm, python, whisper },
      modes: {
        ffmpeg: mode({ ffmpeg }),
        subtitleExport: exportTools.mode,
        remotion: remotionMode(remotionRuntime, mediaTools),
        subtitles: mode({ python, whisper })
      },
      canContinue: true
    };
  }

  function requestedInstallation(toolId) {
    if (typeof toolId !== 'string') throw new Error('不支持的工具');
    const catalog = installationCatalog();
    const platformCatalog = catalog[dependencies.platform];
    if (!platformCatalog || !Object.prototype.hasOwnProperty.call(platformCatalog, toolId)) {
      throw new Error('不支持的工具');
    }
    return platformCatalog[toolId];
  }

  async function describeInstall(toolId) {
    const installation = requestedInstallation(toolId);
    const isWindows = dependencies.platform === 'win32';
    const manager = isWindows ? 'winget' : 'brew';
    let canAutomate = true;
    try {
      await dependencies.run(manager, ['--version'], { timeoutMs: 5000 });
    } catch (_) {
      canAutomate = false;
    }

    let confirmationId = null;
    if (canAutomate) {
      confirmationId = dependencies.tokenFactory();
      if (typeof confirmationId !== 'string' || !confirmationId) throw new Error('无法创建安装确认');
      confirmations.set(confirmationId, { toolId, used: false });
    }

    const managerName = isWindows ? 'winget' : 'Homebrew';
    const manualSteps = isWindows
      ? ['请从 Microsoft Store 安装“应用安装程序”以启用 winget。', '安装完成后返回并重新检查环境。']
      : ['请访问 Homebrew 官方网站 https://brew.sh/ 并按官方说明安装。', '安装完成后返回并重新检查环境。'];
    return {
      toolId,
      canAutomate,
      summary: canAutomate
        ? toolId === 'whisper'
          ? '将在应用管理目录准备 faster-whisper 与固定 Small 模型。'
          : `${installation.label} 将通过 ${managerName} 安装。`
        : `未检测到 ${managerName}，无法自动安装 ${installation.label}。`,
      downloadEstimate: installation.downloadEstimate,
      installLocation: installation.installLocation,
      durationEstimate: installation.durationEstimate,
      steps: canAutomate ? installation.steps.slice() : manualSteps,
      confirmationId
    };
  }

  async function installTool(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('安装请求格式无效');
    const keys = Object.keys(request).sort();
    if (keys.length !== 2 || keys[0] !== 'confirmationId' || keys[1] !== 'toolId' ||
        typeof request.toolId !== 'string' || typeof request.confirmationId !== 'string') {
      throw new Error('安装请求格式无效');
    }

    const installation = requestedInstallation(request.toolId);
    const confirmation = confirmations.get(request.confirmationId);
    if (!confirmation) throw new Error('安装确认无效');
    if (confirmation.used) throw new Error('安装确认已使用');
    if (confirmation.toolId !== request.toolId) throw new Error('安装确认与工具不匹配');
    confirmation.used = true;

    try {
      for (const action of installation.actions) {
        await dependencies.run(action.program, action.args.slice(), {
          ...installRunOptions,
          ...(action.timeoutMs ? { timeoutMs: action.timeoutMs } : {})
        });
      }
      return { ok: true, toolId: request.toolId };
    } catch (_) {
      return { ok: false, error: '安装失败，请稍后重试。' };
    }
  }

  return { detectEnvironment, getExportTools, getRemotionTools, describeInstall, installTool };
}

module.exports = { createEnvironmentModule };
