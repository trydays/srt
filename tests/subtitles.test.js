const test = require('node:test');
const assert = require('node:assert/strict');
const { createSubtitleService } = require('../src/subtitles');

test('analysis mode preserves subtitles and returns finer timing', async () => {
  const segments = [{ start: 0, end: 8, text: '第一点。第二点。' }];
  const timingSegments = [{ start: 0.3, end: 2, text: '第一点。' }, { start: 4, end: 7, text: '第二点。' }];
  const fixture = createFixture({ stdout: JSON.stringify({ segments, timingSegments }) });
  assert.deepEqual(await fixture.service.generate({ videoPath: '/videos/talk.mp4', includeTiming: true }),
    { segments, timingSegments });
  assert.ok(fixture.calls[1].args.includes('--include-timing'));
});

function createFixture({
  stdout = '[]',
  runtimeError = null,
  runError = null,
  missing = []
} = {}) {
  const calls = [];
  return {
    calls,
    service: createSubtitleService({
      platform: 'darwin',
      userDataDir: '/user-data',
      transcriberPath: '/app/resources/tools/transcribe-subtitles.py',
      fsApi: {
        async stat(file) {
          if (missing.some((suffix) => file.endsWith(suffix))) {
            throw Object.assign(new Error('missing'), { code: 'ENOENT' });
          }
          return { isFile: () => true, size: 1 };
        }
      },
      run: async (program, args, options) => {
        calls.push({ program, args, options });
        if (args[0] === '-c') {
          if (runtimeError) throw runtimeError;
          return { stdout: '', stderr: '' };
        }
        if (runError) throw runError;
        return { stdout, stderr: '' };
      }
    })
  };
}

test('runs only the managed Python, fixed script, model directory and selected video', async () => {
  const fixture = createFixture({
    stdout: '[{"start":0.4,"end":1.2,"text":"第一句"},{"start":2,"end":3,"text":" 第二句 "}]'
  });
  const result = await fixture.service.generate({ videoPath: '/videos/talk.mp4' });
  assert.deepEqual(result.segments, [
    { start: 0.4, end: 1.2, text: '第一句' },
    { start: 2, end: 3, text: '第二句' }
  ]);
  assert.deepEqual(fixture.calls, [
    {
      program: '/user-data/python/bin/python',
      args: ['-c', 'import faster_whisper'],
      options: { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true, shell: false }
    },
    {
      program: '/user-data/python/bin/python',
      args: [
        '/app/resources/tools/transcribe-subtitles.py',
        '--model-dir', '/user-data/models/faster-whisper-small',
        '--video', '/videos/talk.mp4'
      ],
      options: { timeout: 300000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: false }
    }
  ]);
});

for (const stdout of [
  'not-json',
  '{}',
  '[{"start":0,"end":0,"text":"x"}]',
  '[{"start":0,"end":1,"text":"   "}]',
  '[{"start":0,"end":1,"text":"x","extra":true}]'
]) {
  test(`rejects the entire invalid result: ${stdout}`, async () => {
    const { service } = createFixture({ stdout });
    await assert.rejects(
      () => service.generate({ videoPath: '/videos/talk.mp4' }),
      { code: 'SUBTITLE_INVALID_OUTPUT' }
    );
  });
}

test('classifies empty speech without returning an empty track', async () => {
  const { service } = createFixture({ stdout: '[]' });
  await assert.rejects(
    () => service.generate({ videoPath: '/videos/talk.mp4' }),
    { code: 'SUBTITLE_NO_SPEECH' }
  );
});

test('rejects a missing video before starting Python', async () => {
  const fixture = createFixture({ missing: ['talk.mp4'] });
  await assert.rejects(
    () => fixture.service.generate({ videoPath: '/videos/talk.mp4' }),
    { code: 'VIDEO_PATH_UNAVAILABLE' }
  );
  assert.equal(fixture.calls.length, 0);
});

test('rejects a missing managed runtime or model before transcription', async () => {
  const fixture = createFixture({ missing: ['model.bin'] });
  await assert.rejects(
    () => fixture.service.generate({ videoPath: '/videos/talk.mp4' }),
    { code: 'SUBTITLE_RUNTIME_NOT_READY' }
  );
  assert.equal(fixture.calls.length, 0);
});

test('classifies a broken faster-whisper import as an unready runtime', async () => {
  const fixture = createFixture({ runtimeError: new Error('cannot import faster_whisper') });
  await assert.rejects(
    () => fixture.service.generate({ videoPath: '/videos/talk.mp4' }),
    { code: 'SUBTITLE_RUNTIME_NOT_READY' }
  );
  assert.deepEqual(fixture.calls, [{
    program: '/user-data/python/bin/python',
    args: ['-c', 'import faster_whisper'],
    options: { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true, shell: false }
  }]);
});

test('classifies a child process failure without exposing command execution', async () => {
  const { service } = createFixture({ runError: new Error('python failed') });
  await assert.rejects(
    () => service.generate({ videoPath: '/videos/talk.mp4' }),
    { code: 'SUBTITLE_TRANSCRIPTION_FAILED' }
  );
});
