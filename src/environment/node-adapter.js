const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createEnvironmentModule } = require('./index');

const DEFAULT_MAX_BUFFER = 1024 * 1024;
const TERMINATION_CLEANUP_MS = 100;
const REMOTION_PACKAGES = [
  'remotion', '@remotion/player', '@remotion/renderer', '@remotion/bundler'
];

function runnerError(message, code, reason, stdout, stderr) {
  const error = new Error(message);
  error.code = code;
  error.reason = reason;
  error.stdout = stdout;
  error.stderr = stderr;
  return error;
}

function createNodeRunner(spawnImpl = childProcess.spawn, baseEnv = process.env, platform = process.platform) {
  return function run(program, args, options = {}) {
    if (!Array.isArray(args)) {
      return Promise.reject(runnerError('Command arguments must be an array', 'EINVAL', 'probe_error', '', ''));
    }

    const env = { ...baseEnv };
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
    if (platform === 'darwin') {
      const existing = env[pathKey] || '';
      const entries = existing.split(':').filter(Boolean);
      for (const entry of [
        '/usr/local/bin',
        '/opt/homebrew/bin',
        '/usr/local/opt/node@20/bin',
        '/opt/homebrew/opt/node@20/bin'
      ]) {
        if (!entries.includes(entry)) entries.unshift(entry);
      }
      env[pathKey] = entries.join(':');
    }

    const timeoutMs = options.timeoutMs === undefined ? options.timeout : options.timeoutMs;
    const maxBuffer = Math.min(
      Number.isFinite(options.maxBuffer) && options.maxBuffer > 0 ? options.maxBuffer : DEFAULT_MAX_BUFFER,
      DEFAULT_MAX_BUFFER
    );

    return new Promise((resolve, reject) => {
      let child;
      let settled = false;
      let timer = null;
      let pendingFailure = null;
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);

      function outputText(buffer) {
        return buffer.toString('utf8');
      }

      function removeStreamListeners() {
        if (child && child.stdout) child.stdout.removeListener('data', onStdout);
        if (child && child.stderr) child.stderr.removeListener('data', onStderr);
      }

      function cleanup() {
        if (timer) clearTimeout(timer);
        timer = null;
        removeStreamListeners();
        if (child) {
          child.removeListener('error', onError);
          child.removeListener('exit', onExit);
          child.removeListener('close', onClose);
        }
      }

      function finish(error) {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          error.stdout = outputText(stdout);
          error.stderr = outputText(stderr);
          reject(error);
          return;
        }
        resolve({ stdout: outputText(stdout), stderr: outputText(stderr) });
      }

      function requestTermination(error) {
        if (settled || pendingFailure) return;
        pendingFailure = error;
        if (timer) clearTimeout(timer);
        timer = null;
        removeStreamListeners();

        let killed;
        try {
          killed = child && typeof child.kill === 'function' && child.kill('SIGKILL');
        } catch (_) {
          finish(runnerError('Unable to terminate command', 'EKILL', 'probe_error', '', ''));
          return;
        }
        if (killed !== true) {
          finish(runnerError('Unable to terminate command', 'EKILL', 'probe_error', '', ''));
          return;
        }
        if (!settled) timer = setTimeout(() => finish(pendingFailure), TERMINATION_CLEANUP_MS);
      }

      function capture(channel, chunk) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const current = channel === 'stdout' ? stdout : stderr;
        const remaining = Math.max(0, maxBuffer - current.length);
        const next = remaining ? Buffer.concat([current, value.subarray(0, remaining)]) : current;
        if (channel === 'stdout') stdout = next;
        else stderr = next;
        if (value.length > remaining) {
          const error = runnerError('Command output exceeded the limit', 'ENOBUFS', 'probe_error', '', '');
          requestTermination(error);
        }
      }

      function onStdout(chunk) {
        capture('stdout', chunk);
      }

      function onStderr(chunk) {
        capture('stderr', chunk);
      }

      function onError(error) {
        if (pendingFailure) return;
        error.reason = error.code === 'ENOENT' ? 'absent' : 'probe_error';
        finish(error);
      }

      function onExit() {
        if (pendingFailure) finish(pendingFailure);
      }

      function onClose(exitCode, signal) {
        if (pendingFailure) {
          finish(pendingFailure);
          return;
        }
        if (exitCode === 0) {
          finish(null);
          return;
        }
        const error = runnerError(
          `Command failed with exit code ${exitCode === null ? 'unknown' : exitCode}`,
          'ECOMMAND',
          'probe_error',
          '',
          ''
        );
        error.exitCode = exitCode;
        error.signal = signal;
        finish(error);
      }

      try {
        child = spawnImpl(program, args.slice(), {
          shell: false,
          windowsHide: true,
          env
        });
      } catch (error) {
        error.reason = error.code === 'ENOENT' ? 'absent' : 'probe_error';
        finish(error);
        return;
      }

      if (child.stdout) child.stdout.on('data', onStdout);
      if (child.stderr) child.stderr.on('data', onStderr);
      child.on('error', onError);
      child.once('exit', onExit);
      child.once('close', onClose);

      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => {
          requestTermination(runnerError('Command timed out', 'ETIMEDOUT', 'probe_error', '', ''));
        }, timeoutMs);
      }
    });
  };
}

function isPathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function inspectBundledTools(bundledRoot, platform = process.platform, fsApi = fs) {
  if (platform !== 'win32' || typeof bundledRoot !== 'string' || !bundledRoot) return {};
  const resolvedRoot = path.resolve(bundledRoot);
  const manifestPath = path.join(resolvedRoot, 'tools-versions.json');
  let manifest;
  let canonicalRoot;
  try {
    const rootStat = fsApi.lstatSync(resolvedRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return {};
    canonicalRoot = fsApi.realpathSync(resolvedRoot);

    const manifestStat = fsApi.lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) return {};
    const canonicalManifest = fsApi.realpathSync(manifestPath);
    if (!isPathWithin(canonicalRoot, canonicalManifest)) return {};
    manifest = JSON.parse(fsApi.readFileSync(canonicalManifest, 'utf8'));
  } catch (_) {
    return {};
  }
  if (!manifest || manifest.version !== 1 || !manifest.bundled || typeof manifest.bundled !== 'object') return {};

  const tools = {};
  for (const [name, entry] of Object.entries(manifest.bundled)) {
    if (name === '.' || name === '..' || !entry || typeof entry.exe !== 'string' ||
        entry.exe === '.' || entry.exe === '..' || entry.exe.includes('/') || entry.exe.includes('\\') ||
        typeof entry.version !== 'string' || !Number.isFinite(entry.size) || entry.size < 0) {
      continue;
    }
    const candidatePath = path.resolve(resolvedRoot, entry.exe);
    if (!isPathWithin(resolvedRoot, candidatePath)) continue;
    try {
      const stat = fsApi.lstatSync(candidatePath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const canonicalCandidate = fsApi.realpathSync(candidatePath);
      if (!isPathWithin(canonicalRoot, canonicalCandidate)) continue;
      if (stat.size !== entry.size) {
        tools[name] = { available: true, version: null, path: candidatePath, reason: 'incompatible' };
        continue;
      }
      tools[name] = { available: true, version: entry.version, path: candidatePath };
    } catch (_) {
      tools[name] = { available: false, version: null, path: candidatePath };
    }
  }
  return tools;
}

function regularNonemptyFile(filePath, fsApi = fs) {
  try {
    const stat = fsApi.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0;
  } catch (_) {
    return false;
  }
}

function inspectRemotionPackages(appRoot, {
  fsApi = fs,
  resolvePackage = (request) => require.resolve(request, { paths: [appRoot] })
} = {}) {
  const versions = [];
  try {
    for (const packageName of REMOTION_PACKAGES) {
      const packageFile = resolvePackage(`${packageName}/package.json`);
      const stat = fsApi.lstatSync(packageFile);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        return { status: 'missing', reason: 'remotion_packages_missing', version: null };
      }
      const manifest = JSON.parse(fsApi.readFileSync(packageFile, 'utf8'));
      if (!manifest || typeof manifest.version !== 'string' || !manifest.version) {
        return { status: 'missing', reason: 'remotion_packages_missing', version: null };
      }
      versions.push(manifest.version);
    }
  } catch (_) {
    return { status: 'missing', reason: 'remotion_packages_missing', version: null };
  }
  if (new Set(versions).size !== 1) {
    return { status: 'limited', reason: 'remotion_versions_incoherent', version: null };
  }
  return { status: 'ready', reason: 'ok', version: versions[0] };
}

function inspectRemotionBundles(appRoot, fsApi = fs) {
  const playerPath = path.join(appRoot, 'app', 'remotion-built', 'player.js');
  const rendererPath = path.join(appRoot, 'app', 'remotion-built', 'render');
  const rendererReady = regularNonemptyFile(path.join(rendererPath, 'index.html'), fsApi)
    && regularNonemptyFile(path.join(rendererPath, 'bundle.js'), fsApi);
  return {
    playerBundle: regularNonemptyFile(playerPath, fsApi)
      ? { status: 'ready', reason: 'ok', path: playerPath }
      : { status: 'missing', reason: 'remotion_player_bundle_missing' },
    rendererBundle: rendererReady
      ? { status: 'ready', reason: 'ok', path: rendererPath }
      : { status: 'missing', reason: 'remotion_renderer_bundle_missing' }
  };
}

function resolveInstalledRemotionBrowser(appRoot, {
  fsApi = fs,
  platform = process.platform,
  arch = process.arch,
  resolvePackage = (request) => require.resolve(request, { paths: [appRoot] }),
  loadBrowserFetcher = (modulePath) => require(modulePath)
} = {}) {
  try {
    const rendererPackage = resolvePackage('@remotion/renderer/package.json');
    const fetcherPath = path.join(path.dirname(rendererPackage), 'dist', 'browser', 'BrowserFetcher.js');
    const fetcher = loadBrowserFetcher(fetcherPath);
    const platformKey = platform === 'darwin'
      ? arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
      : platform === 'linux'
        ? arch === 'arm64' ? 'linux-arm64' : 'linux64'
        : platform === 'win32' && arch === 'x64' ? 'win64' : null;
    if (!platformKey) return null;
    const dependencyRoot = path.resolve(path.dirname(rendererPackage), '..', '..');
    const cacheRoot = path.join(dependencyRoot, '.remotion', 'chrome-headless-shell');
    const executableName = platformKey === 'win64'
      ? 'chrome-headless-shell.exe'
      : platformKey === 'linux-arm64' ? 'headless_shell' : 'chrome-headless-shell';
    const executablePath = path.join(
      cacheRoot, platformKey, `chrome-headless-shell-${platformKey}`, executableName
    );
    const versionPath = path.join(cacheRoot, 'VERSION');
    if (!regularNonemptyFile(executablePath, fsApi) || !regularNonemptyFile(versionPath, fsApi)) return null;
    const actualVersion = fsApi.readFileSync(versionPath, 'utf8').trim();
    return {
      path: executablePath,
      version: actualVersion,
      compatible: actualVersion === fetcher.TESTED_VERSION
    };
  } catch (_) {
    return null;
  }
}

function createRemotionBrowserProbe({
  run = createNodeRunner(childProcess.spawn, process.env, process.platform),
  makeTempDir = () => fs.promises.mkdtemp(path.join(os.tmpdir(), 'srt-remotion-browser-')),
  removeTempDir = (directory) => fs.promises.rm(directory, { recursive: true, force: true })
} = {}) {
  return async function probeBrowser(browserExecutable, { timeoutMs = 10000 } = {}) {
    const profileDirectory = await makeTempDir();
    try {
      const output = await run(browserExecutable, [
        '--headless',
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-component-update',
        '--no-first-run',
        '--dump-dom',
        `--user-data-dir=${profileDirectory}`,
        'data:text/html,%3Ctitle%3Esrt-remotion-probe%3C%2Ftitle%3E'
      ], { timeoutMs, maxBuffer: 1024 * 1024 });
      const stdout = String(output && output.stdout !== undefined ? output.stdout : output || '');
      if (!stdout.includes('<title>srt-remotion-probe</title>')) {
        throw new Error('Remotion browser did not render the local probe');
      }
    } finally {
      await removeTempDir(profileDirectory);
    }
  };
}

async function inspectRemotionRuntime({
  appRoot,
  fsApi = fs,
  resolvePackage,
  inspectPackages,
  inspectBundles,
  resolveBrowser,
  probeBrowser
} = {}) {
  const root = path.resolve(appRoot || path.join(__dirname, '..', '..'));
  const packageOptions = { fsApi, ...(resolvePackage ? { resolvePackage } : {}) };
  const packages = inspectPackages
    ? inspectPackages()
    : inspectRemotionPackages(root, packageOptions);
  const bundles = inspectBundles
    ? inspectBundles()
    : inspectRemotionBundles(root, fsApi);
  const browserResolver = resolveBrowser
    || (() => resolveInstalledRemotionBrowser(root, packageOptions));
  const candidate = browserResolver();
  let browser;
  if (!candidate || !candidate.path || !regularNonemptyFile(candidate.path, fsApi)) {
    browser = { status: 'missing', reason: 'remotion_browser_missing' };
  } else if (!candidate.compatible) {
    browser = { status: 'limited', reason: 'remotion_browser_unusable', path: candidate.path };
  } else {
    try {
      const browserProbe = probeBrowser || createRemotionBrowserProbe();
      await browserProbe(candidate.path, { timeoutMs: 10000 });
      browser = {
        status: 'ready', reason: 'ok', path: candidate.path,
        ...(candidate.version ? { version: candidate.version } : {})
      };
    } catch (_) {
      browser = { status: 'limited', reason: 'remotion_browser_unusable', path: candidate.path };
    }
  }
  return { packages, ...bundles, browser };
}

function createProductionEnvironment({ targetPath, userDataDir, bundledRoot, appRoot } = {}) {
  const bundledTools = inspectBundledTools(bundledRoot, process.platform);
  const windowsNodeDir = process.platform === 'win32'
    ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs')
    : null;
  return createEnvironmentModule({
    platform: process.platform,
    arch: process.arch,
    targetPath: targetPath || userDataDir,
    userDataDir,
    windowsNodeDir,
    osApi: os,
    fsApi: {
      statfs: fs.promises.statfs.bind(fs.promises),
      stat: fs.promises.stat.bind(fs.promises)
    },
    run: createNodeRunner(childProcess.spawn, process.env, process.platform),
    tokenFactory: crypto.randomUUID,
    getBundledTools: () => bundledTools,
    probeRemotionRuntime: () => inspectRemotionRuntime({ appRoot })
  });
}

module.exports = {
  createNodeRunner,
  createRemotionBrowserProbe,
  createProductionEnvironment,
  inspectBundledTools,
  inspectRemotionRuntime,
  resolveInstalledRemotionBrowser
};
