const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createEnvironmentModule } = require('./index');

const DEFAULT_MAX_BUFFER = 1024 * 1024;

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
      for (const entry of ['/opt/homebrew/bin', '/usr/local/bin']) {
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
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);

      function outputText(buffer) {
        return buffer.toString('utf8');
      }

      function finish(error) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (error) {
          error.stdout = outputText(stdout);
          error.stderr = outputText(stderr);
          reject(error);
          return;
        }
        resolve({ stdout: outputText(stdout), stderr: outputText(stderr) });
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
          if (child && typeof child.kill === 'function') child.kill();
          finish(error);
        }
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

      if (child.stdout) child.stdout.on('data', (chunk) => capture('stdout', chunk));
      if (child.stderr) child.stderr.on('data', (chunk) => capture('stderr', chunk));
      child.once('error', (error) => {
        error.reason = error.code === 'ENOENT' ? 'absent' : 'probe_error';
        finish(error);
      });
      child.once('close', (exitCode, signal) => {
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
      });

      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => {
          const error = runnerError('Command timed out', 'ETIMEDOUT', 'probe_error', '', '');
          if (typeof child.kill === 'function') child.kill();
          finish(error);
        }, timeoutMs);
      }
    });
  };
}

function inspectBundledTools(bundledRoot, platform = process.platform, fsApi = fs) {
  if (platform !== 'win32' || typeof bundledRoot !== 'string' || !bundledRoot) return {};
  const resolvedRoot = path.resolve(bundledRoot);
  const manifestPath = path.join(resolvedRoot, 'tools-versions.json');
  let manifest;
  try {
    manifest = JSON.parse(fsApi.readFileSync(manifestPath, 'utf8'));
  } catch (_) {
    return {};
  }
  if (!manifest || manifest.version !== 1 || !manifest.bundled || typeof manifest.bundled !== 'object') return {};

  const tools = {};
  for (const [name, entry] of Object.entries(manifest.bundled)) {
    if (!entry || typeof entry.exe !== 'string' || path.basename(entry.exe) !== entry.exe ||
        typeof entry.version !== 'string' || !Number.isFinite(entry.size) || entry.size < 0) {
      continue;
    }
    const candidatePath = path.join(resolvedRoot, entry.exe);
    try {
      const stat = fsApi.lstatSync(candidatePath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
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

function createProductionEnvironment({ targetPath, userDataDir, bundledRoot } = {}) {
  const bundledTools = inspectBundledTools(bundledRoot, process.platform);
  return createEnvironmentModule({
    platform: process.platform,
    arch: process.arch,
    targetPath: targetPath || userDataDir,
    userDataDir,
    osApi: os,
    fsApi: { statfs: fs.promises.statfs.bind(fs.promises) },
    run: createNodeRunner(childProcess.spawn, process.env, process.platform),
    tokenFactory: crypto.randomUUID,
    getBundledTools: () => bundledTools
  });
}

module.exports = {
  createNodeRunner,
  createProductionEnvironment,
  inspectBundledTools
};
