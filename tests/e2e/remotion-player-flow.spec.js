const { test, expect } = require('./electron.fixture');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const ffmpeg = process.env.SRT_FFMPEG_PATH || '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
const frameExpectations = [
  { time: 0.5, rgb: [22, 102, 204] },
  { time: 1, rgb: [22, 102, 204] },
  { time: 1.5, rgb: [113, 77, 119] },
  { time: 3.458333, rgb: [204, 51, 34] },
  { time: 3.5, rgb: [22, 102, 204] }
];

async function makeVideo(file, width, height, tone) {
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=0x1666CC:s=${width}x${height}:r=24:d=4`,
    '-f', 'lavfi', '-i', `sine=frequency=${tone}:sample_rate=48000:duration=4`,
    '-shortest', '-c:v', 'libx264', '-crf', '9', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', file
  ]);
}

async function openEditor(window, source) {
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  await expect(window.getByTestId('home-page')).toBeVisible();
  await window.getByTestId('video-input').setInputFiles(source);
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  await window.waitForFunction(() => window.projectEditingState === 'ready'
    && window.currentProjectVideoPath && window.editorPlayback);
  await expect(window.locator('#previewArea')).toHaveAttribute('data-render-engine', 'remotion');
  await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
}

async function submitGroup(window) {
  await window.locator('.input-editor').fill('添加组合动画');
  await window.locator('#generateBtn').click();
  const card = window.getByTestId('request-status-card').last();
  await expect(card.getByTestId('timeline-status')).toHaveAttribute('data-state', 'success');
  await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
  return card;
}

async function seek(window, seconds) {
  await window.evaluate((value) => window.editorPlayback.seekSeconds(value), seconds);
  await expect.poll(() => window.evaluate(() => window.editorPlayback.getState().currentTime))
    .toBeCloseTo(seconds, 1);
  await expect.poll(() => window.locator('#remotionPreview video').evaluate((video) => {
    const playerTime = window.editorPlayback.getState().currentTime;
    if (video.seeking || video.readyState < 2) return 9999;
    return Math.abs(video.currentTime - playerTime);
  }), { message: 'Remotion scene video did not settle on the playback-controller frame' })
    .toBeLessThanOrEqual(1 / 24);
  await window.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function remotionScreenshot(window, path) {
  return window.locator('#remotionPreview').screenshot(path ? { path } : undefined);
}

async function remotionCanvasRgb(window, xRatio = 0.6, yRatio = 0.6) {
  return window.evaluate(async ({ xRatio, yRatio }) => {
    const previewVideo = document.querySelector('#previewVideo');
    const sceneVideo = document.querySelector('#remotionPreview video');
    if (!previewVideo?.currentSrc || !sceneVideo) throw new Error('Player source video is unavailable');

    const waitFor = (target, eventName, ready, label) => new Promise((resolve, reject) => {
      if (ready()) { resolve(); return; }
      const finish = (callback, value) => {
        clearTimeout(timer);
        target.removeEventListener(eventName, onEvent);
        target.removeEventListener('error', onError);
        callback(value);
      };
      const onEvent = () => finish(resolve);
      const onError = () => finish(reject, target.error || new Error(`${label} failed`));
      const timer = setTimeout(() => finish(reject, new Error(`${label} timed out`)), 5000);
      target.addEventListener(eventName, onEvent, { once: true });
      target.addEventListener('error', onError, { once: true });
    });

    const source = document.createElement('video');
    source.muted = true;
    source.preload = 'auto';
    try {
      // Register before assigning the already-proven local file URL so a cached
      // metadata event cannot race the listener.
      const metadataReady = waitFor(
        source, 'loadedmetadata', () => source.readyState >= 1,
        'Player source metadata'
      );
      source.src = previewVideo.currentSrc;
      source.load();
      await metadataReady;

      const seekReady = waitFor(
        source, 'seeked',
        () => source.readyState >= 2 && Math.abs(source.currentTime - sceneVideo.currentTime) <= 1 / 48,
        'Player source seek'
      );
      source.currentTime = sceneVideo.currentTime;
      await seekReady;
      await document.fonts.ready;

      const canvas = document.createElement('canvas');
      canvas.width = source.videoWidth;
      canvas.height = source.videoHeight;
      const context = canvas.getContext('2d');
      context.drawImage(source, 0, 0, canvas.width, canvas.height);

      // Rasterize the actual mounted Remotion SVG layers in DOM order. This uses
      // the production geometry, fills and opacity without calling its sampler.
      for (const mountedSvg of document.querySelectorAll('#remotionPreview svg[data-group-id]')) {
        const svg = mountedSvg.cloneNode(true);
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
          type: 'image/svg+xml;charset=utf-8'
        });
        const url = URL.createObjectURL(blob);
        const image = new Image();
        try {
          const imageReady = waitFor(image, 'load', () => image.complete && image.naturalWidth > 0,
            'Remotion SVG rasterization');
          image.src = url;
          await imageReady;
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
        } finally {
          URL.revokeObjectURL(url);
        }
      }

      return Array.from(context.getImageData(
        Math.floor(canvas.width * xRatio), Math.floor(canvas.height * yRatio), 1, 1
      ).data.slice(0, 3));
    } finally {
      source.pause();
      source.removeAttribute('src');
      source.load();
      source.remove();
    }
  }, { xRatio, yRatio });
}

test.describe('Remotion desktop player (fixed local recipe, not real AI)', () => {
  test.use({
    localCliMode: 'two',
    localCliEffectResult: 'group-transactions-success',
    remotionRendering: true
  });
  test.setTimeout(120000);

  test('plays one audible source clock and seeks the same card frame deterministically', async ({ window }, testInfo) => {
    const source = testInfo.outputPath('remotion-player-landscape.mp4');
    await makeVideo(source, 640, 360, 440);
    await openEditor(window, source);
    await submitGroup(window);

    const oldVideo = window.locator('#previewVideo');
    const oldOverlay = window.locator('#previewLayerCanvas');
    const sceneVideos = window.locator('#remotionPreview video');
    await expect(oldVideo).toBeHidden();
    await expect(oldOverlay).toBeHidden();
    await expect(sceneVideos).toHaveCount(1);
    expect(await oldVideo.evaluate((video) => video.paused)).toBe(true);
    expect(await oldVideo.evaluate((video) => Object.prototype.hasOwnProperty.call(video, 'currentTime')))
      .toBe(false);

    const initial = await window.evaluate(() => window.editorPlayback.getState());
    expect(initial.duration).toBeCloseTo(4, 2);
    expect(initial.paused).toBe(true);
    await window.evaluate(() => {
      window.editorPlayback.setVolume(0.35);
      window.editorPlayback.setMuted(false);
      window.editorPlayback.setPlaybackRate(1.25);
    });
    await window.locator('#tlPlayBtn').click();
    await expect.poll(() => window.evaluate(() => window.editorPlayback.getState().currentTime), {
      timeout: 5000
    }).toBeGreaterThan(initial.currentTime + 0.15);
    await expect.poll(() => sceneVideos.evaluateAll((videos) => videos.filter((video) => !video.paused).length))
      .toBe(1);
    expect(await oldVideo.evaluate((video) => video.paused)).toBe(true);

    await window.locator('#tlPlayBtn').click();
    const pausedAt = (await window.evaluate(() => window.editorPlayback.getState())).currentTime;
    await window.waitForTimeout(120);
    const stillAt = (await window.evaluate(() => window.editorPlayback.getState())).currentTime;
    expect(Math.abs(stillAt - pausedAt)).toBeLessThanOrEqual(1 / 24);

    const fivePointDiagnostics = [];
    for (const expectation of frameExpectations) {
      await seek(window, expectation.time);
      const key = String(expectation.time).replace('.', '-');
      const screenshotPath = testInfo.outputPath(`remotion-player-five-point-${key}.png`);
      await remotionScreenshot(window, screenshotPath);
      const browserRgb = await remotionCanvasRgb(window);
      const diagnostic = {
        time: expectation.time,
        expectedRgb: expectation.rgb,
        browserVideoAndMountedSvgCanvasRgb: browserRgb,
        maximumBrowserChannelError: Math.max(...browserRgb.map((value, index) =>
          Math.abs(value - expectation.rgb[index])))
      };
      fivePointDiagnostics.push(diagnostic);
      await Promise.all([
        testInfo.attach(`remotion-player-five-point-${key}`, {
          path: screenshotPath,
          contentType: 'image/png'
        }),
        testInfo.attach(`remotion-player-five-point-${key}-rgb`, {
          body: Buffer.from(JSON.stringify(diagnostic, null, 2)),
          contentType: 'application/json'
        })
      ]);
    }
    const rgbFailures = fivePointDiagnostics.filter((diagnostic) =>
      diagnostic.maximumBrowserChannelError > 12);
    expect(rgbFailures, `five-point Player RGB mismatches: ${JSON.stringify(fivePointDiagnostics)}`)
      .toEqual([]);

    await seek(window, 2.5);
    const firstCardPath = testInfo.outputPath('remotion-player-card-frame-first.png');
    const cardFrame = await remotionScreenshot(window, firstCardPath);
    await seek(window, 0.5);
    const sourceOnlyPath = testInfo.outputPath('remotion-player-source-only-frame.png');
    const sourceOnlyFrame = await remotionScreenshot(window, sourceOnlyPath);
    expect(cardFrame.equals(sourceOnlyFrame)).toBe(false);
    await seek(window, 2.5);
    const secondCardPath = testInfo.outputPath('remotion-player-card-frame-second.png');
    const repeatedCardFrame = await remotionScreenshot(window, secondCardPath);
    await Promise.all([
      testInfo.attach('remotion-player-card-frame-first', { path: firstCardPath, contentType: 'image/png' }),
      testInfo.attach('remotion-player-source-only-frame', { path: sourceOnlyPath, contentType: 'image/png' }),
      testInfo.attach('remotion-player-card-frame-second', { path: secondCardPath, contentType: 'image/png' })
    ]);
    expect(repeatedCardFrame.equals(cardFrame)).toBe(true);

    const evidence = await window.locator('#previewArea').screenshot({
      path: testInfo.outputPath('remotion-player-chinese-card.png')
    });
    await testInfo.attach('remotion-player-chinese-card', {
      body: evidence,
      contentType: 'image/png'
    });
  });

  test('reloads an old-shaped portrait document and keeps source-only playback after undo', async ({ window }, testInfo) => {
    const source = testInfo.outputPath('remotion-player-portrait.mp4');
    await makeVideo(source, 360, 640, 550);
    await openEditor(window, source);
    const card = await submitGroup(window);
    await seek(window, 2.5);
    const withCard = await remotionScreenshot(window);
    const beforeReload = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    const persistedBytes = await window.evaluate(() => localStorage.getItem(STORAGE_KEYS.PROJECT_EDIT_STATE));

    expect(Object.keys(beforeReload.document).sort()).toEqual([
      'edits', 'projectId', 'revision', 'schemaVersion', 'sources', 'timeline'
    ]);
    expect(Object.keys(beforeReload.document.timeline).sort()).toEqual(['canvas', 'duration']);
    expect(beforeReload.document.timeline.canvas).toEqual({ width: 360, height: 640 });
    expect(beforeReload.document.timeline).not.toHaveProperty('fps');

    await window.reload();
    await window.waitForFunction(() => window.projectEditingState === 'ready'
      && window.currentProjectVideoPath && window.editorPlayback);
    await expect(window.locator('#previewArea')).toHaveAttribute('data-render-engine', 'remotion');
    await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
    expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()))).toEqual(beforeReload);
    expect(await window.evaluate(() => localStorage.getItem(STORAGE_KEYS.PROJECT_EDIT_STATE))).toBe(persistedBytes);

    const restoredCard = window.getByTestId('request-status-card').last();
    await restoredCard.getByTestId('request-status-summary').click();
    await restoredCard.getByRole('button', { name: '撤销本次编辑', exact: true }).click();
    const undone = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    expect(undone.document.edits).toHaveLength(0);
    expect(undone.document.revision).toBe(beforeReload.document.revision + 1);
    expect(undone.graph.nodes.map((node) => node.type)).toEqual(['source.video@1']);
    await expect(window.locator('#previewArea')).toHaveAttribute('data-render-engine', 'remotion');
    await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
    await seek(window, 2.5);
    expect((await remotionScreenshot(window)).equals(withCard)).toBe(false);

    await window.reload();
    await window.waitForFunction(() => window.projectEditingState === 'ready'
      && window.currentProjectVideoPath && window.editorPlayback);
    await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
    expect((await window.evaluate(() => projectEditing.load(getActiveProjectId()))).document)
      .toEqual(undone.document);
    expect((await window.evaluate(() => window.editorPlayback.getState())).duration).toBeCloseTo(4, 2);
    expect(await window.locator('#previewVideo').evaluate((video) => video.paused)).toBe(true);
  });
});
