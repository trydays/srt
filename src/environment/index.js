function createEnvironmentModule(dependencies) {
  const runOptions = { timeout: 5000, maxBuffer: 1024 * 1024 };

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

  return { detectEnvironment };
}

module.exports = { createEnvironmentModule };
