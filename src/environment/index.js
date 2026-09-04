function createEnvironmentModule(dependencies) {
  const runOptions = { timeout: 5000, maxBuffer: 1024 * 1024 };
  const installRunOptions = { timeoutMs: 300000 };
  const confirmations = new Map();

  function installationCatalog() {
    const managedPython = dependencies.platform === 'win32'
      ? `${dependencies.userDataDir}\\python\\Scripts\\python.exe`
      : `${dependencies.userDataDir}/python/bin/python`;
    const managedDirectory = dependencies.platform === 'win32'
      ? `${dependencies.userDataDir}\\python`
      : `${dependencies.userDataDir}/python`;
    const wingetAgreements = ['--exact', '--accept-package-agreements', '--accept-source-agreements'];
    const pipPackages = ['-m', 'pip', 'install', 'faster-whisper', 'soundfile', 'numpy'];

    return {
      darwin: {
        ffmpeg: {
          label: 'FFmpeg', downloadEstimate: '约 100–200 MB', installLocation: '由 Homebrew 管理', durationEstimate: '约 2–10 分钟',
          steps: ['通过 Homebrew 下载并安装 FFmpeg。'],
          actions: [{ program: 'brew', args: ['install', 'ffmpeg'] }]
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
          label: 'Whisper', downloadEstimate: '约 1.5 GB', installLocation: '应用管理的 Python 环境', durationEstimate: '约 5–20 分钟',
          steps: ['确保 Python 3.12 可用。', '创建应用专用的隔离 Python 环境。', '在隔离环境中安装语音识别依赖。'],
          actions: [
            { program: 'brew', args: ['install', 'python@3.12'] },
            { program: 'python3.12', args: ['-m', 'venv', managedDirectory] },
            { program: managedPython, args: pipPackages }
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
          label: 'Whisper', downloadEstimate: '约 1.5 GB', installLocation: '应用管理的 Python 环境', durationEstimate: '约 5–20 分钟',
          steps: ['确保 Python 3.12 可用。', '创建应用专用的隔离 Python 环境。', '在隔离环境中安装语音识别依赖。'],
          actions: [
            { program: 'winget', args: ['install', '--id', 'Python.Python.3.12', ...wingetAgreements] },
            { program: 'py', args: ['-3.12', '-m', 'venv', managedDirectory] },
            { program: managedPython, args: pipPackages }
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
    if (bundled) return bundled;
    try {
      const output = await dependencies.run(program, args, runOptions);
      return evaluatedTool(program, 'system', output && output.stdout !== undefined ? output.stdout : output, compatible);
    } catch (error) {
      return blankTool(program, 'system', errorReason(error));
    }
  }

  async function probePython() {
    const isWindows = dependencies.platform === 'win32';
    const managed = isWindows
      ? `${dependencies.userDataDir}\\python\\Scripts\\python.exe`
      : `${dependencies.userDataDir}/python/bin/python`;
    const candidates = isWindows
      ? [{ program: managed, args: [], source: 'managed' }, { program: 'py', args: ['-3'], source: 'system' }, { program: 'python', args: [], source: 'system' }]
      : [{ program: managed, args: [], source: 'managed' }, { program: 'python3', args: [], source: 'system' }, { program: 'python', args: [], source: 'system' }];

    let last = blankTool(candidates[candidates.length - 1].program, 'system', 'absent');
    for (const candidate of candidates) {
      try {
        const output = await dependencies.run(candidate.program, candidate.args.concat('--version'), runOptions);
        const tool = evaluatedTool(candidate.program, candidate.source, output && output.stdout !== undefined ? output.stdout : output, (version) => {
          const [major, minor] = version.split('.').map(Number);
          return major === 3 && minor === 12;
        });
        tool.prefixArgs = candidate.args;
        return tool;
      } catch (error) {
        last = blankTool(candidate.program, candidate.source, errorReason(error));
      }
    }
    last.prefixArgs = [];
    return last;
  }

  async function probeWhisper(python) {
    if (!python.installed) return blankTool(python.command, python.source, python.reason);
    try {
      const args = (python.prefixArgs || []).concat(['-m', 'pip', 'show', 'faster-whisper']);
      const output = await dependencies.run(python.command, args, runOptions);
      const text = output && output.stdout !== undefined ? output.stdout : output;
      const nameMatches = /(^|\n)Name:\s*faster-whisper\s*$/im.test(String(text));
      const versionLine = String(text).match(/(^|\n)Version:\s*([^\r\n]+)/i);
      const version = versionLine && versionFrom(versionLine[2]);
      const installed = Boolean(nameMatches);
      const compatible = Boolean(nameMatches && version);
      return {
        installed,
        compatible,
        version: version || null,
        command: python.command,
        source: python.source,
        status: compatible ? 'ready' : 'limited',
        reason: compatible ? 'ok' : 'incompatible'
      };
    } catch (error) {
      return blankTool(python.command, python.source, errorReason(error));
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
      const metal = /^supported(?:\s*,|\s*$)/i.test(String(display.spdisplays_metal || '').trim());
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

    const [graphics, ffmpeg, node, npm, python] = await Promise.all([
      probeGraphics(),
      probeTool('ffmpeg', 'ffmpeg', ['-version'], () => true),
      probeTool('node', 'node', ['--version'], (version) => versionAtLeast(version, 20, 0)),
      probeTool('npm', 'npm', ['--version'], () => true),
      probePython()
    ]);
    const whisper = await probeWhisper(python);
    delete python.prefixArgs;

    return {
      platform,
      hardware: { chip, memory, disk, graphics },
      tools: { ffmpeg, node, npm, python, whisper },
      modes: {
        ffmpeg: mode({ ffmpeg }),
        remotion: mode({ node, npm }),
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
        ? `${installation.label} 将通过 ${managerName} 安装。`
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
        await dependencies.run(action.program, action.args.slice(), installRunOptions);
      }
      return { ok: true, toolId: request.toolId };
    } catch (_) {
      return { ok: false, error: '安装失败，请稍后重试。' };
    }
  }

  return { detectEnvironment, describeInstall, installTool };
}

module.exports = { createEnvironmentModule };
