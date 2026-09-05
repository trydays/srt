const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI_DEFINITIONS = [
  { id: 'codex', label: 'Codex CLI', command: 'codex' },
  { id: 'claude', label: 'Claude Code', command: 'claude' },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini' }
];

const EFFECT_PROMPT = '只输出一个 JSON 对象：{"type":"add_effect","effect":"fade_in"}。只允许淡入；不要解释、Markdown、命令或其他字段。用户请求：';
const EFFECT_ARGS = {
  codex: (prompt) => ['exec', prompt],
  claude: (prompt) => ['-p', prompt],
  gemini: (prompt) => ['-p', prompt]
};

function createDefaultRun(execFile, platform, env) {
  return function run(file, args) {
    let program = file;
    let probeArgs = args;
    let windowsVerbatimArguments = false;

    if (platform === 'win32' && path.win32.extname(file).toUpperCase() === '.CMD') {
      const comSpec = env.ComSpec || env.COMSPEC;
      if (typeof comSpec !== 'string' || !path.win32.isAbsolute(comSpec) || /[\r\n"!&|<>^%]/.test(file)) {
        return Promise.reject(new Error('Unsafe Windows command shim'));
      }
      program = comSpec;
      probeArgs = ['/d', '/s', '/c', '""' + file + '" --version"'];
      windowsVerbatimArguments = true;
    }

    return new Promise((resolve, reject) => {
      const options = { timeout: 3000, maxBuffer: 64 * 1024, windowsHide: true };
      if (windowsVerbatimArguments) options.windowsVerbatimArguments = true;
      execFile(program, probeArgs, options, (error) => {
        if (error) reject(error);
        else resolve({ exitCode: 0 });
      });
    });
  };
}

function createDefaultTranslate(execFile) {
  return function translate(file, args) {
    return new Promise((resolve, reject) => {
      execFile(file, args, { timeout: 15000, maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
  };
}

function unavailableError() {
  const error = new Error('Local CLI unavailable');
  error.code = 'LOCAL_CLI_NOT_AVAILABLE';
  return error;
}

function notSelectedError() {
  const error = new Error('Local CLI not selected');
  error.code = 'LOCAL_CLI_NOT_SELECTED';
  return error;
}

function invalidEffectOutputError() {
  const error = new Error('Invalid local CLI effect output');
  error.code = 'LOCAL_CLI_INVALID_EFFECT_OUTPUT';
  return error;
}

function translationFailedError() {
  const error = new Error('Local CLI translation failed');
  error.code = 'LOCAL_CLI_TRANSLATION_FAILED';
  return error;
}

function parseEffectInstruction(output) {
  let value;

  try {
    value = JSON.parse(String(output).trim());
  } catch (_) {
    throw invalidEffectOutputError();
  }

  if (!value || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw invalidEffectOutputError();
  }

  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'effect' || keys[1] !== 'type') {
    throw invalidEffectOutputError();
  }

  if (value.type !== 'add_effect' || value.effect !== 'fade_in') {
    throw invalidEffectOutputError();
  }

  return { type: 'add_effect', effect: 'fade_in' };
}

function createLocalCliService({
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir(),
  userDataDir,
  fsApi = fs.promises,
  run,
  execFile = childProcess.execFile,
  translate
}) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const preferencePath = pathApi.join(userDataDir, 'local-cli.json');
  const probe = run || createDefaultRun(execFile, platform, env);
  const translateEffectOutput = translate || createDefaultTranslate(execFile);
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
  const extensions = platform === 'win32'
    ? String(env.PATHEXT || '.EXE;.CMD').split(';').filter((item) => /^\.(EXE|CMD)$/i.test(item))
    : [''];
  const extras = platform === 'win32'
    ? [
        env.APPDATA && pathApi.join(env.APPDATA, 'npm'),
        env.LOCALAPPDATA && pathApi.join(env.LOCALAPPDATA, 'Programs', 'nodejs')
      ]
    : [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        homeDir && pathApi.join(homeDir, '.local', 'bin')
      ];

  async function scan() {
    const separator = platform === 'win32' ? ';' : ':';
    const directories = String(env[pathKey] || '').split(separator).concat(extras).filter(Boolean);
    const available = [];

    for (const definition of CLI_DEFINITIONS) {
      const candidates = directories.flatMap((directory) => extensions.map((extension) => (
        pathApi.join(directory, definition.command + extension)
      )));
      if (platform === 'darwin' && definition.id === 'codex') {
        candidates.push(
          '/Applications/ChatGPT.app/Contents/Resources/codex',
          homeDir && pathApi.join(homeDir, 'Applications', 'ChatGPT.app', 'Contents', 'Resources', 'codex')
        );
      }

      for (const file of candidates.filter(Boolean)) {
        try {
          if (!(await fsApi.stat(file)).isFile()) continue;
          const result = await probe(file, ['--version']);
          if (!result || result.exitCode !== 0) continue;
          available.push({ id: definition.id, label: definition.label, file });
          break;
        } catch (_) {
          // A missing, non-file, or failing fixed probe is simply unavailable.
        }
      }
    }

    return available;
  }

  function publicAvailable(available) {
    return available.map(({ id, label }) => ({ id, label }));
  }

  async function readSelection() {
    try {
      const selectedCliId = JSON.parse(await fsApi.readFile(preferencePath, 'utf8')).selectedCliId;
      return CLI_DEFINITIONS.some((definition) => definition.id === selectedCliId) ? selectedCliId : null;
    } catch (_) {
      return null;
    }
  }

  async function writeSelection(selectedCliId) {
    await fsApi.mkdir(pathApi.dirname(preferencePath), { recursive: true });
    await fsApi.writeFile(preferencePath, JSON.stringify({ selectedCliId }), 'utf8');
  }

  async function state(requestedCliId) {
    const available = await scan();
    let selectedCliId = await readSelection();

    if (selectedCliId && !available.some((item) => item.id === selectedCliId)) {
      selectedCliId = null;
      await writeSelection(null);
    }

    if (requestedCliId !== undefined) {
      if (!available.some((item) => item.id === requestedCliId)) throw unavailableError();
      selectedCliId = requestedCliId;
      await writeSelection(selectedCliId);
    }

    return { available: publicAvailable(available), selectedCliId };
  }

  async function translateEffect(text) {
    const available = await scan();
    const selectedCliId = await readSelection();

    if (!selectedCliId) {
      throw notSelectedError();
    }

    const selectedCli = available.find((item) => item.id === selectedCliId);
    if (!selectedCli) {
      throw unavailableError();
    }

    const argsFactory = EFFECT_ARGS[selectedCliId];
    if (typeof argsFactory !== 'function') {
      throw translationFailedError();
    }

    let output;
    try {
      output = await translateEffectOutput(selectedCli.file, argsFactory(EFFECT_PROMPT + text));
    } catch (_) {
      throw translationFailedError();
    }

    return parseEffectInstruction(output);
  }

  return {
    getState: () => state(),
    rescan: () => state(),
    select: (id) => state(id),
    translateEffect
  };
}

module.exports = { CLI_DEFINITIONS, createLocalCliService };
