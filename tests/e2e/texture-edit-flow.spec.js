const { test, expect } = require('./electron.fixture');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

function noiseReference(rgba, width, height, time, amount) {
  const bucket = Math.floor((Math.floor(time * 1000000 + .5) * 12 + 6) / 1000000) % 65521;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let z = ((x + 1) * 1973 + (y + 1) * 9277 + (bucket + 1) * 26699 + 911) % 65521;
    z = (31 * z * z + 17) % 65521; z = (31 * z * z + 17) % 65521;
    const delta = amount * 32 * ((z % 256 - 127.5) / 127.5), offset = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) rgba[offset + c] = Math.min(255, Math.max(0, Math.floor(rgba[offset + c] + delta + .5)));
  }
}

function vignetteReference(rgba, width, height, strength) {
  const cx = (width - 1) / 2, cy = (height - 1) / 2;
  const denominator = Math.max(1, ((width - 1) ** 2 + (height - 1) ** 2) / 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const q = ((x - cx) ** 2 + (y - cy) ** 2) / denominator, offset = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) rgba[offset + c] = Math.min(255, Math.max(0,
      Math.floor(rgba[offset + c] * (1 - strength * q) + .5)));
  }
}

async function openPlayableEditor(window, testInfo) {
  const ffmpeg = process.env.SRT_FFMPEG_PATH;
  expect(ffmpeg).toBeTruthy();
  const source = testInfo.outputPath('texture-source.mp4');
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i',
    'color=c=0x6080A0:s=96x64:r=24,drawbox=x=8:y=8:w=20:h=18:color=0xD04020:t=fill',
    '-t', '4', '-c:v', 'libx264', '-crf', '8', '-pix_fmt', 'yuv420p', source]);
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  await window.getByTestId('video-input').setInputFiles(source);
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  await window.waitForFunction(() => window.projectEditingState === 'ready'
    && document.getElementById('previewVideo').readyState >= 2);
}

async function submit(window, text, state = 'success') {
  await window.locator('.input-editor').fill(text); await window.locator('#generateBtn').click();
  const card = window.getByTestId('request-status-card').last();
  await expect(card.getByTestId('instruction-status')).toHaveAttribute('data-state', state);
  return card;
}

async function seekAndPixels(window, time) {
  return window.evaluate(time => new Promise(resolve => {
    const video = document.getElementById('previewVideo');
    const done = () => requestAnimationFrame(() => requestAnimationFrame(() => {
      const canvas = document.getElementById('previewSourceCanvas'), ctx = canvas.getContext('2d');
      resolve(Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data));
    }));
    video.addEventListener('seeked', done, { once: true }); video.currentTime = time;
  }), time);
}

test.describe('grain and vignette desktop editing', () => {
  test.skip(!process.env.SRT_REAL_EXPORT, 'requires the real playable media fixture');
  test.use({ localCliMode: 'two', localCliEffectResult: 'texture-transactions-success' });

  test('actual decoded frames change by grain bucket, reverse deterministically, and range vignette', async ({ window }, testInfo) => {
    await openPlayableEditor(window, testInfo); await submit(window, '调亮并添加颗粒和暗角');
    const early = await seekAndPixels(window, .5);
    const late = await seekAndPixels(window, 1.25);
    const changed = await seekAndPixels(window, 1.5);
    const reverse = await seekAndPixels(window, 1.25);
    expect(reverse).toEqual(late);
    expect(changed).not.toEqual(late);
    const corner = p => p.slice(0, 3).reduce((a, b) => a + b, 0);
    expect(corner(late)).toBeLessThan(corner(early));
    await window.evaluate(() => document.getElementById('previewVideo').play());
    await expect.poll(() => window.evaluate(() => document.getElementById('previewVideo').currentTime)).toBeGreaterThan(1.25);
    await window.evaluate(() => document.getElementById('previewVideo').pause());
    await expect(window.locator('#previewSourceCanvas')).toBeVisible();
  });

  test('ordered compositor produces independent landscape and portrait pixels', async ({ window }, testInfo) => {
    await openPlayableEditor(window, testInfo);
    const evidence = await window.evaluate(() => {
      const results = [];
      for (const [width, height] of [[6, 4], [4, 6]]) {
        const source = document.createElement('canvas'); source.width = width; source.height = height;
        const sctx = source.getContext('2d'); sctx.fillStyle = 'rgb(80,120,160)'; sctx.fillRect(0, 0, width, height);
        const output = document.createElement('canvas');
        const compositor = SRTSourcePreview.createCompositor(output,
          document.getElementById('previewColorFilter').parentNode);
        const graph = { nodes: [
          { id: 'n', type: 'video.noise@1', range: { start: 0, end: 2 }, props: { amount: .5 } },
          { id: 't', type: 'video.transform@1', range: { start: 0, end: 2 }, props: { flipHorizontal: true, flipVertical: false, scale: 1 } },
          { id: 'v', type: 'video.vignette@1', range: { start: 0, end: 2 }, props: { strength: .5 } }
        ] };
        compositor.render(source, graph, 1.25, width, height);
        results.push({ width, height, pixels: Array.from(output.getContext('2d').getImageData(0, 0, width, height).data) });
      }
      const orderSource = document.createElement('canvas'); orderSource.width = 6; orderSource.height = 4;
      orderSource.getContext('2d').fillRect(0, 0, 6, 4);
      const renderOrder = nodes => {
        const output = document.createElement('canvas');
        SRTSourcePreview.createCompositor(output, document.getElementById('previewColorFilter').parentNode)
          .render(orderSource, { nodes }, 1.25, 6, 4);
        return Array.from(output.getContext('2d').getImageData(0, 0, 6, 4).data);
      };
      const color = { id: 'c', type: 'video.color@1', range: { start: 0, end: 2 },
        props: { temperature: 0, brightness: .1, saturation: 1, contrast: 1 } };
      const noise = { id: 'o', type: 'video.noise@1', range: { start: 0, end: 2 }, props: { amount: 1 } };
      return { results, noiseThenColor: renderOrder([noise, color]), colorThenNoise: renderOrder([color, noise]) };
    });
    for (const item of evidence.results) {
      const expected = new Uint8ClampedArray(item.width * item.height * 4);
      for (let i = 0; i < expected.length; i += 4) expected.set([80, 120, 160, 255], i);
      noiseReference(expected, item.width, item.height, 1.25, .5);
      const flipped = new Uint8ClampedArray(expected.length);
      for (let y = 0; y < item.height; y++) for (let x = 0; x < item.width; x++) {
        flipped.set(expected.slice((y * item.width + x) * 4, (y * item.width + x + 1) * 4),
          (y * item.width + item.width - 1 - x) * 4);
      }
      vignetteReference(flipped, item.width, item.height, .5);
      expect(item.pixels).toEqual(Array.from(flipped));
    }
    expect(evidence.noiseThenColor).not.toEqual(evidence.colorThenNoise);
  });

  test('one compact transaction persists, supplies typed context, adds overlay, and undo is atomic', async ({ window, readScenarioState }, testInfo) => {
    await openPlayableEditor(window, testInfo);
    const before = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    await submit(window, '调亮并添加颗粒和暗角');
    const saved = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    expect(saved.document.edits.map(e => e.type)).toEqual(['video.color.adjustment@1',
      'video.noise.adjustment@1', 'video.vignette.adjustment@1']);
    expect(new Set(saved.document.edits.map(e => e.transactionId)).size).toBe(1);
    expect(saved.graph.documentRevision).toBe(saved.document.revision);
    await window.reload(); await window.waitForFunction(() => window.projectEditingState === 'ready');
    expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()))).toEqual(saved);
    await submit(window, '新增文字');
    const layered = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    expect(layered.document.edits.slice(0, 3)).toEqual(saved.document.edits);
    expect(layered.graph.nodes.at(-1).type).toBe('visual.text@1');
    await submit(window, '下一步', 'clarifying');
    const context = (await readScenarioState()).translationCalls.at(-1).context;
    expect(context.operations.slice(0, 3).map(o => o.params)).toEqual([
      { temperature: 0, brightness: .1, saturation: 1, contrast: 1 }, { amount: .6 }, { strength: .8 }]);
    await window.getByTestId('request-status-summary').nth(1).click();
    await window.getByRole('button', { name: '撤销本次编辑', exact: true }).click();
    expect((await window.evaluate(() => projectEditing.load(getActiveProjectId()))).document.edits).toHaveLength(3);
    const raw = await window.evaluate(() => localStorage.getItem('srt_project_edit_state'));
    await submit(window, '错误第二步', 'failed');
    expect(await window.evaluate(() => localStorage.getItem('srt_project_edit_state'))).toBe(raw);
    expect((await window.evaluate(() => projectEditing.load(getActiveProjectId()))).document.edits)
      .toEqual(saved.document.edits);
    expect(before.document.edits).toHaveLength(0);
  });

  test('undoing the initial texture request removes the source canvas and survives reload', async ({ window }, testInfo) => {
    await openPlayableEditor(window, testInfo); await submit(window, '调亮并添加颗粒和暗角');
    await window.getByTestId('request-status-summary').first().click();
    await window.getByRole('button', { name: '撤销本次编辑', exact: true }).click();
    expect((await window.evaluate(() => projectEditing.load(getActiveProjectId()))).document.edits).toHaveLength(0);
    await expect(window.locator('#previewSourceCanvas')).toBeHidden();
    await window.reload(); await window.waitForFunction(() => window.projectEditingState === 'ready');
    expect((await window.evaluate(() => projectEditing.load(getActiveProjectId()))).document.edits).toHaveLength(0);
  });

  test('a saved subtitle draft remains editable after texture edits', async ({ window }, testInfo) => {
    await openPlayableEditor(window, testInfo); await submit(window, '仅字幕');
    const field = window.getByTestId('subtitle-document-segment').first();
    await field.fill('纹理前保存的草稿'); await window.getByTestId('subtitle-document-save').click();
    await submit(window, '调亮并添加颗粒和暗角');
    await window.getByTestId('subtitle-document-toggle').click();
    await expect(field).toHaveText('纹理前保存的草稿');
    await field.fill('纹理后继续修改'); await window.getByTestId('subtitle-document-apply').click();
    await expect(window.getByTestId('subtitle-block').first()).toHaveText('纹理后继续修改');
  });
});
