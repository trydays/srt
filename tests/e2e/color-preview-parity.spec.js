const { test, expect } = require('./electron.fixture');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createVideoExportService } = require('../../src/video-export');
const run = promisify(execFile);

async function openEditor(window, testInfo) {
  const source = testInfo.outputPath('preview-metadata.mp4');
  await fs.writeFile(source, 'metadata fixture');
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  await window.getByTestId('video-input').setInputFiles(source);
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  await window.evaluate(async () => {
    const video = document.getElementById('previewVideo');
    Object.defineProperties(video, {
      duration: { configurable: true, value: 4 },
      videoWidth: { configurable: true, value: 96 },
      videoHeight: { configurable: true, value: 64 },
      currentTime: { configurable: true, value: 2 }
    });
    video.dispatchEvent(new Event('loadedmetadata'));
    await window.projectEditingReady;
  });
}

async function apply(window, params) {
  await window.evaluate(async params => {
    const projectId = getActiveProjectId();
    const current = projectEditing.load(projectId);
    await projectEditing.applyRecipe({ projectId, expectedRevision: current.document.revision,
      requestId: 'pixel-' + current.document.revision,
      recipe: { kind: 'instruction', steps: [{ capability: 'video.color.adjust@1',
        range: { start: 1, end: 3 }, params }] } });
    colorPreviewController.render();
  }, params);
}

async function undo(window) {
  await window.evaluate(() => {
    const projectId = getActiveProjectId(), current = projectEditing.load(projectId);
    projectEditing.undo({ projectId, expectedRevision: current.document.revision,
      transactionId: current.document.edits.at(-1).transactionId });
    colorPreviewController.render();
  });
}

// Rasterize the exact live product SVG filter in Chromium. Reading attributes or
// evaluating the matrix in JS would not catch rendering/color-space mistakes.
async function pixels(window, imageData, filtered = true) {
  return window.evaluate(async ({ imageData, filtered }) => {
    const filter = document.getElementById('previewColorFilter').outerHTML;
    const content = imageData
      ? `<image width="96" height="64" href="${imageData}"/>`
      : '<rect width="32" height="64" fill="rgb(254,0,0)"/>'
        + '<rect x="32" width="32" height="64" fill="rgb(32,112,208)"/>'
        + '<rect x="64" width="32" height="64" fill="rgb(60,180,80)"/>';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><defs>${filter}</defs>`
      + `<g${filtered ? ' filter="url(#previewColorFilter)"' : ''}>${content}</g></svg>`;
    const image = new Image();
    image.src = 'data:image/svg+xml;base64,' + btoa(svg);
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    return [16, 48, 80].map(x => Array.from(ctx.getImageData(x, 32, 1, 1).data).slice(0, 3));
  }, { imageData, filtered });
}

test.describe('actual color preview pixels', () => {
  test.use({ localCliMode: 'two' });

  test('zero and intermediate contrast preserve independent chroma, and neutral settings preserve pixels', async ({ window }, testInfo) => {
    await openEditor(window, testInfo);
    const original = await pixels(window, null, false);
    await apply(window, { contrast: 0, saturation: 1 });
    const rendered = await pixels(window);
    expect(rendered[0][0] - rendered[0][1]).toBeGreaterThan(180);
    expect(rendered[0][1]).toBeGreaterThan(40);
    expect(rendered[1][2] - rendered[1][0]).toBeGreaterThan(150);
    await undo(window);
    await apply(window, { contrast: 0.6, saturation: 0.7, brightness: 0.15 });
    const intermediate = await pixels(window);
    // Blue and green patches remain in gamut. Their channel differences must
    // scale only with saturation (0.7), never saturation*contrast (0.42).
    for (const p of [1, 2]) {
      expect(Math.abs((intermediate[p][2] - intermediate[p][0])
        - 0.7 * (original[p][2] - original[p][0]))).toBeLessThanOrEqual(2);
    }
    await undo(window);
    await apply(window, { contrast: 1, saturation: 1 });
    const neutral = await pixels(window);
    neutral.forEach((pixel, i) => pixel.forEach((value, c) => expect(Math.abs(value - original[i][c])).toBeLessThanOrEqual(1)));
  });

  test('real product export and browser preview agree on colored patches', async ({ window }, testInfo) => {
    test.skip(process.env.SRT_REAL_EXPORT !== '1', 'requires the existing opt-in FFmpeg environment');
    test.setTimeout(120000);
    const ffmpegPath = process.env.SRT_FFMPEG_PATH, ffprobePath = process.env.SRT_FFPROBE_PATH;
    expect(ffmpegPath).toBeTruthy(); expect(ffprobePath).toBeTruthy();
    await openEditor(window, testInfo);
    const source = testInfo.outputPath('parity-source.mp4');
    await run(ffmpegPath, ['-v', 'error', '-n', '-f', 'lavfi', '-i',
      'color=c=red:s=96x64:r=10,drawbox=x=32:y=0:w=32:h=64:color=0x2070D0:t=fill,drawbox=x=64:y=0:w=32:h=64:color=0x3CB450:t=fill',
      '-t', '4', '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', source]);
    async function png(file) {
      const { stdout } = await run(ffmpegPath, ['-v', 'error', '-ss', '2', '-i', file,
        '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], { encoding: 'buffer' });
      return 'data:image/png;base64,' + stdout.toString('base64');
    }
    const original = await png(source);
    const service = createVideoExportService({ getExportTools: async () => ({ ffmpegPath, ffprobePath }) });
    const cases = [{ temperature: 0, brightness: 0, saturation: 1, contrast: 0 },
      { temperature: 0, brightness: 0.15, saturation: 0.7, contrast: 0.6 },
      { temperature: 0, brightness: -1, saturation: 1, contrast: 2 },
      { temperature: 0, brightness: 0, saturation: 2, contrast: 0 }];
    const evidence = [];
    for (const [i, params] of cases.entries()) {
      await apply(window, params);
      const preview = await pixels(window, original);
      const outputPath = testInfo.outputPath(`parity-${i}.mp4`);
      const result = await service.start({ jobId: `parity-${i}`, videoPath: source, outputPath,
        recipe: { version: 1, steps: [{ capability: 'video.color.adjust@1',
          range: { start: 1, end: 3 }, params }] } });
      expect(result.status).toBe('completed');
      const exported = await pixels(window, await png(outputPath), false);
      // Seven 8-bit levels allow YUV420 conversion/LUT rounding and lossy H.264;
      // the old RGB contrast differs by 50–125 levels on these patches.
      preview.forEach((pixel, p) => pixel.forEach((value, c) =>
        expect(Math.abs(value - exported[p][c]), JSON.stringify({ params, preview, exported })).toBeLessThanOrEqual(7)));
      evidence.push({ params, preview, exported, maxChannelError: Math.max(...preview.flatMap((pixel, p) => pixel.map((v, c) => Math.abs(v - exported[p][c])))) });
      await undo(window);
    }
    console.log('COLOR_PREVIEW_PARITY=' + JSON.stringify(evidence));
  });
});
