const { test, expect } = require('./electron.fixture');
const { execFileSync } = require('node:child_process');

// Deterministic CLI responses exercise the application contract, not a real AI.
async function openEditor(window, testInfo, portrait = false) {
  const source = testInfo.outputPath('group-source.mp4');
  execFileSync(process.env.SRT_FFMPEG_PATH || '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    `color=c=black:s=${portrait ? '64x96' : '96x64'}:r=20:d=4`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source
  ]);
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  await window.getByTestId('video-input').setInputFiles(source);
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  await window.waitForFunction(() => window.projectEditingState === 'ready'
    && document.getElementById('previewVideo').readyState >= 2);
}
async function submit(window, text, state = 'success') {
  await window.locator('.input-editor').fill(text);
  await window.locator('#generateBtn').click();
  const card = window.getByTestId('request-status-card').last();
  await expect(card.getByTestId('instruction-status')).toHaveAttribute('data-state', state);
  if (state === 'success') await expect(card.locator('[data-testid="timeline-status"], [data-testid="subtitle-status"]')).toHaveAttribute('data-state', 'success');
  return card;
}
async function seek(window, time) {
  await window.evaluate(time => new Promise(resolve => {
    const video = document.getElementById('previewVideo');
    video.pause();
    video.addEventListener('seeked', resolve, { once: true });
    video.currentTime = time;
  }), time);
}
async function pixels(window) {
  return window.evaluate(() => {
    const canvas = document.getElementById('previewLayerCanvas');
    const ctx = canvas.getContext('2d'), data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const pixel = (x, y) => Array.from(ctx.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data);
    let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1, greenCount = 0, greenMaxX = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (data[i + 3] > 0 && data[i] > data[i + 1] * 2) {
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      if (data[i + 3] > 0 && data[i + 1] > data[i] * 2) { greenCount++; greenMaxX = Math.max(greenMaxX, x); }
    }
    return { hidden: canvas.hidden, width: canvas.width, height: canvas.height,
      red: pixel(.3, .6), overlap: pixel(.5, .6), corner: pixel(.98, .98),
      bounds: [minX, minY, maxX, maxY], greenCount, greenMaxX, image: canvas.toDataURL(),
      time: document.getElementById('previewVideo').currentTime };
  });
}

test.describe('flat group animations in desktop playback', () => {
  test.use({ localCliMode: 'two', localCliEffectResult: 'group-transactions-success' });

  test('natural playback, pause, reverse seeks and ended use deterministic alpha and bounds', async ({ window }, testInfo) => {
    await openEditor(window, testInfo);
    await submit(window, '添加组合动画');
    await expect(window.locator('.tl-marker[data-lane="visual"]')).toHaveText('动画图层 · 3 个元素');
    await seek(window, .9); expect((await pixels(window)).hidden).toBe(true);
    await seek(window, 1); expect((await pixels(window)).red[3]).toBe(0);
    await seek(window, 1.5);
    const middle = await pixels(window);
    expect(middle.red[3]).toBeCloseTo(128, -1);
    expect(middle.bounds[0]).toBeLessThan(19); // back-out exceeds final scale before settling
    expect(middle.bounds[2]).toBeGreaterThan(66);
    await seek(window, 2.5); const held = await pixels(window);
    expect(held.red).toEqual([204, 51, 34, 255]);
    expect(held.bounds).toEqual([19, 13, 66, 44]);
    await seek(window, 1.5); expect((await pixels(window)).image).toBe(middle.image);
    await seek(window, 3.5); expect((await pixels(window)).hidden).toBe(true);
    await seek(window, .85);
    await window.evaluate(() => new Promise(async resolve => {
      const video = document.getElementById('previewVideo');
      const onTime = () => { if (video.currentTime >= 1.45) {
        video.removeEventListener('timeupdate', onTime); video.pause(); resolve();
      } };
      video.addEventListener('timeupdate', onTime); await video.play();
    }));
    const paused = await pixels(window);
    expect(paused.red[3]).toBeGreaterThan(100); expect(paused.red[3]).toBeLessThan(240);
    expect(Math.abs(paused.red[3] - Math.round((paused.time - 1) * 255))).toBeLessThanOrEqual(1);
    await window.waitForTimeout(100); expect((await pixels(window)).image).toBe(paused.image);
    await seek(window, 1.5);
    const screenshot = await window.locator('#previewArea').screenshot({ path: testInfo.outputPath('group-animation-midpoint.png') });
    await testInfo.attach('group-animation-midpoint', { body: screenshot, contentType: 'image/png' });
    await seek(window, 3.7);
    await window.evaluate(() => new Promise(async resolve => {
      const video = document.getElementById('previewVideo');
      video.addEventListener('ended', resolve, { once: true }); await video.play();
    }));
    expect((await pixels(window)).hidden).toBe(true);
  });

  test('two ordered groups stay one request through reload, nested context, additive request and undo', async ({ window, readScenarioState }, testInfo) => {
    await openEditor(window, testInfo);
    const first = await submit(window, '添加两个组合');
    await expect(first.getByTestId('request-status-summary')).toContainText('动画图层 · 5 个元素');
    await expect(window.locator('.tl-marker[data-lane="visual"]')).toHaveCount(1);
    const initial = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    expect(initial.document.edits).toHaveLength(2);
    expect(new Set(initial.document.edits.map(edit => edit.transactionId)).size).toBe(1);
    await seek(window, 2.5); expect((await pixels(window)).overlap).toEqual([34, 68, 204, 255]);
    const beforeReload = await pixels(window);
    await window.reload();
    await window.waitForFunction(() => window.projectEditingState === 'ready' && document.getElementById('previewVideo').readyState >= 2);
    await seek(window, 2.5); expect((await pixels(window)).image).toBe(beforeReload.image);
    await submit(window, '下一步', 'clarifying');
    const context = (await readScenarioState()).translationCalls.at(-1).context;
    expect(context.operations.map(op => op.params)).toEqual(initial.document.edits.map(edit => edit.payload));
    expect(context.operations[0].params.scale.keyframes[1].easing).toBe('back-out');
    await submit(window, '修改已有组合', 'clarifying');
    expect((await window.evaluate(() => projectEditing.load(getActiveProjectId()))).document).toEqual(initial.document);
    const restored = window.getByTestId('request-status-card').first();
    await restored.getByTestId('request-status-summary').click();
    await restored.getByRole('button', { name: '撤销本次编辑', exact: true }).click();
    expect((await window.evaluate(() => projectEditing.load(getActiveProjectId()))).document.edits).toHaveLength(0);
    await expect(window.locator('#previewLayerCanvas')).toBeHidden();
    // Existing undo is deliberately one transaction deep. Verify each request
    // while it is current, without extending the product's undo protocol.
    await submit(window, '添加两个组合');
    const recreated = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    expect(recreated.document.edits.map(edit => edit.payload)).toEqual(initial.document.edits.map(edit => edit.payload));
    const added = await submit(window, '新增一个组合');
    await expect(window.locator('.tl-marker[data-lane="visual"]')).toHaveCount(2);
    const next = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    expect(next.document.edits).toHaveLength(3);
    expect(next.document.edits.slice(0, 2)).toEqual(recreated.document.edits);
    await added.getByTestId('request-status-summary').click();
    await added.getByRole('button', { name: '撤销本次编辑', exact: true }).click();
    expect((await window.evaluate(() => projectEditing.load(getActiveProjectId()))).document.edits).toEqual(recreated.document.edits);
  });

  test('portrait clipping, subtitles above groups and invalid second group atomicity', async ({ window }, testInfo) => {
    await openEditor(window, testInfo, true);
    await submit(window, '仅字幕');
    const before = await window.evaluate(() => localStorage.getItem('srt_project_edit_state'));
    await window.locator('.input-editor').fill('错误第二步'); await window.locator('#generateBtn').click();
    await expect(window.getByTestId('request-status-card').last().getByTestId('timeline-status')).toHaveAttribute('data-state', 'failed');
    expect(await window.evaluate(() => localStorage.getItem('srt_project_edit_state'))).toBe(before);
    await submit(window, '添加组合动画');
    await seek(window, 2.5);
    const portrait = await pixels(window);
    expect([portrait.width, portrait.height]).toEqual([64, 96]);
    expect(portrait.bounds).toEqual([13, 19, 44, 66]);
    expect(portrait.greenCount).toBeGreaterThan(0);
    expect(portrait.greenMaxX).toBe(63); // long text is clipped at the intrinsic video edge
    const evidence = await window.evaluate(() => {
      const canvas = document.getElementById('previewLayerCanvas'), subtitle = document.getElementById('previewSubtitle');
      subtitle.style.top = '50%'; subtitle.style.bottom = 'auto';
      const snapshot = projectEditing.load(getActiveProjectId());
      return { types: snapshot.graph.nodes.map(n => n.type), subtitle: subtitle.textContent,
        z: [getComputedStyle(canvas).zIndex, getComputedStyle(subtitle).zIndex],
        overflow: getComputedStyle(document.getElementById('previewArea')).overflow };
    });
    expect(evidence.types.indexOf('visual.group@1')).toBeLessThan(evidence.types.indexOf('visual.subtitle@1'));
    expect(evidence.subtitle).toBe('欢迎测试自动字幕');
    expect(Number(evidence.z[0])).toBeLessThan(Number(evidence.z[1])); expect(evidence.overflow).toBe('hidden');
    const visible = await window.locator('#previewArea').screenshot({ path: testInfo.outputPath('group-portrait-subtitle.png') });
    await window.locator('#previewSubtitle').evaluate(el => { el.hidden = true; });
    const hidden = await window.locator('#previewArea').screenshot(); expect(visible.equals(hidden)).toBe(false);
    await testInfo.attach('group-portrait-subtitle', { body: visible, contentType: 'image/png' });
  });
});
