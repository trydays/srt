const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPrompt, parseInstruction } = require('./instruction-capabilities');
const { translateCodex } = require('./codex-translation');

const CLI_DEFINITIONS = [
  { id: 'codex', label: 'Codex CLI', command: 'codex' },
  { id: 'claude', label: 'Claude Code', command: 'claude' },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini' }
];

const TRANSLATION_TIMEOUT_MS = 60000;

const EFFECT_ARGS = {
  codex: (prompt) => ['exec', '--json', prompt],
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
    if (args[0] === 'exec' && args[1] === '--json') {
      return translateCodex(execFile, file, args, TRANSLATION_TIMEOUT_MS);
    }
    return new Promise((resolve, reject) => {
      const child = execFile(file, args, { timeout: TRANSLATION_TIMEOUT_MS, maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
      if (child && child.stdin && typeof child.stdin.end === 'function') child.stdin.end();
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

function translationFailedError() {
  const error = new Error('Local CLI translation failed');
  error.code = 'LOCAL_CLI_TRANSLATION_FAILED';
  return error;
}

function instructionTranslationError(cause) {
  const code = cause && (cause.killed || cause.code === 'ETIMEDOUT')
    ? 'LOCAL_CLI_TRANSLATION_TIMEOUT' : 'LOCAL_CLI_TRANSLATION_FAILED';
  const error = new Error(code);
  error.code = code;
  return error;
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

  async function translateInstruction(text, history, context, skill) {
    const available = await scan();
    const selectedCliId = await readSelection();
    if (!selectedCliId) throw notSelectedError();
    const selectedCli = available.find((item) => item.id === selectedCliId);
    if (!selectedCli) throw unavailableError();
    const argsFactory = EFFECT_ARGS[selectedCliId];
    if (typeof argsFactory !== 'function') throw translationFailedError();
    const prompt = buildPrompt(text, history, context, skill);
    let output;
    try {
      output = await translateEffectOutput(selectedCli.file, argsFactory(prompt));
    } catch (error) {
      throw instructionTranslationError(error);
    }
    return parseInstruction(output);
  }

  return {
    getState: () => state(),
    rescan: () => state(),
    select: (id) => state(id),
    translateInstruction
  };
}

module.exports = { CLI_DEFINITIONS, createLocalCliService };
