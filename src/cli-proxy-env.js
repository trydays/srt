const { execFile } = require('node:child_process');

function readMacSystemProxy() {
  return new Promise((resolve, reject) => {
    execFile('/usr/sbin/scutil', ['--proxy'], { timeout: 3000, maxBuffer: 64 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

async function resolveCliEnv(env, platform, readSystemProxy = readMacSystemProxy) {
  const resolved = { ...env };
  const hasExplicitProxy = Object.keys(env).some(key =>
    /^(https?|all)_proxy$/i.test(key) && env[key]);
  if (platform !== 'darwin' || hasExplicitProxy) return resolved;
  let output;
  try { output = await readSystemProxy(); } catch { return resolved; }
  const fields = Object.fromEntries(String(output).split('\n').flatMap(line => {
    const match = line.match(/^\s*(HTTPS?(?:Enable|Proxy|Port))\s*:\s*(.*?)\s*$/);
    return match ? [[match[1], match[2]]] : [];
  }));
  // Only static HTTP(S) system proxies are translated; no PAC execution.
  for (const kind of ['HTTP', 'HTTPS']) {
    const host = fields[`${kind}Proxy`];
    const port = Number(fields[`${kind}Port`]);
    if (fields[`${kind}Enable`] !== '1' || !host ||
        !/^[a-zA-Z0-9.:[\]-]+$/.test(host) ||
        !Number.isInteger(port) || port < 1 || port > 65535) continue;
    try {
      const proxy = new URL(`http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`);
      const value = proxy.origin;
      resolved[`${kind}_PROXY`] = value;
      resolved[`${kind.toLowerCase()}_proxy`] = value;
    } catch { /* Invalid system endpoint: preserve the inherited environment. */ }
  }
  return resolved;
}

module.exports = { resolveCliEnv };
