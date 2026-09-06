const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MODEL_FILES = ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt'];

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function defaultRun(program, args, options) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(program, args, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

function parseSegments(stdout) {
  let value;
  try { value = JSON.parse(String(stdout).trim()); }
  catch (_) { throw codedError('SUBTITLE_INVALID_OUTPUT'); }
  if (!Array.isArray(value)) throw codedError('SUBTITLE_INVALID_OUTPUT');
  if (value.length === 0) throw codedError('SUBTITLE_NO_SPEECH');
  const segments = value.map((segment) => {
    if (!segment || Array.isArray(segment) || Object.getPrototypeOf(segment) !== Object.prototype
        || Object.keys(segment).sort().join(',') !== 'end,start,text'
        || !Number.isFinite(segment.start) || segment.start < 0
        || !Number.isFinite(segment.end) || segment.end <= segment.start
        || typeof segment.text !== 'string' || !segment.text.trim()) {
      throw codedError('SUBTITLE_INVALID_OUTPUT');
    }
    return { start: segment.start, end: segment.end, text: segment.text.trim() };
  });
  return segments;
}

function createSubtitleService({
  platform = process.platform,
  userDataDir,
  transcriberPath,
  fsApi = fs.promises,
  run = defaultRun
}) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const managedPython = platform === 'win32'
    ? pathApi.join(userDataDir, 'python', 'Scripts', 'python.exe')
    : pathApi.join(userDataDir, 'python', 'bin', 'python');
  const modelDir = pathApi.join(userDataDir, 'models', 'faster-whisper-small');

  async function requireFile(file, errorCode) {
    try {
      const stat = await fsApi.stat(file);
      if (!stat.isFile() || stat.size <= 0) throw new Error('not a usable file');
    } catch (_) {
      throw codedError(errorCode);
    }
  }

  async function generate({ videoPath } = {}) {
    if (typeof videoPath !== 'string' || !pathApi.isAbsolute(videoPath)) {
      throw codedError('VIDEO_PATH_UNAVAILABLE');
    }
    await requireFile(videoPath, 'VIDEO_PATH_UNAVAILABLE');
    await requireFile(managedPython, 'SUBTITLE_RUNTIME_NOT_READY');
    await requireFile(transcriberPath, 'SUBTITLE_RUNTIME_NOT_READY');
    for (const fileName of MODEL_FILES) {
      await requireFile(pathApi.join(modelDir, fileName), 'SUBTITLE_RUNTIME_NOT_READY');
    }
    try {
      await run(managedPython, ['-c', 'import faster_whisper'], {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        shell: false
      });
    } catch (_) {
      throw codedError('SUBTITLE_RUNTIME_NOT_READY');
    }
    let result;
    try {
      result = await run(managedPython, [
        transcriberPath, '--model-dir', modelDir, '--video', videoPath
      ], {
        timeout: 300000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        shell: false
      });
    } catch (_) {
      throw codedError('SUBTITLE_TRANSCRIPTION_FAILED');
    }
    return { segments: parseSegments(result.stdout) };
  }

  return { generate };
}

module.exports = { createSubtitleService, parseSegments };
