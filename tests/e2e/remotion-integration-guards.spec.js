const { test, expect } = require('./electron.fixture');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const ffmpeg = process.env.SRT_FFMPEG_PATH || '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';

async function video(file, color) {
  await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=${color}:s=320x240:r=24:d=4`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
}
async function editor(window, source) {
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  await window.getByTestId('video-input').setInputFiles(source);
  await window.getByTestId('start-editing').click();
  await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
}

test.describe('Remotion integration preserves existing guardrails', () => {
  test.use({ localCliMode: 'two', remotionRendering: true });
  test('a graph rejected by the active renderer fails visibly instead of switching to legacy', async ({ window }, info) => {
    const source = info.outputPath('unsupported-source.mp4');
    await video(source, 'blue'); await editor(window, source);
    const result = await window.evaluate(async () => {
      const snapshot = projectEditing.load(getActiveProjectId());
      snapshot.document.revision++; snapshot.graph.documentRevision++;
      SRTRemotionInput.supportsGraph = () => false;
      let code = null;
      try { await remotionPreviewController.ensure(snapshot); } catch (error) { code = error.code; }
      return { code, engine: remotionPreviewController.getEngine() };
    });
    expect(result).toEqual({ code: 'REMOTION_GRAPH_UNSUPPORTED', engine: 'remotion' });
    await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'error');
    await expect(window.locator('#remotionPreviewMessage')).toBeVisible();
    await expect(window.locator('#previewVideo')).toBeHidden();
  });

  test('reupload stops the previous scene and releases its source session', async ({ window }, info) => {
    const first = info.outputPath('旧 视频.mp4'), second = info.outputPath('新 视频.mp4');
    await video(first, 'blue'); await video(second, 'red');
    await editor(window, first);
    const oldSource = await window.locator('#remotionPreview video').getAttribute('src');
    await window.locator('#tlPlayBtn').click();
    await window.locator('#reupload').setInputFiles(second);
    await expect(window.locator('#remotionPreview')).toBeHidden();
    await expect(window.locator('#remotionPreview video')).toHaveCount(0);
    await expect(window.locator('#previewVideo')).toBeVisible();
    expect(await window.evaluate(() => editorPlayback.getState().paused)).toBe(true);
    await expect.poll(() => window.evaluate(async url => {
      try { await fetch(url); return true; } catch (_) { return false; }
    }, oldSource)).toBe(false);
    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('video-export-status')).toHaveText('当前视频路径不可用');
  });

  test('rechecks pending subtitle edits after asynchronous preview preparation', async ({ window, readScenarioState }, info) => {
    const source = info.outputPath('guard-source.mp4');
    await video(source, 'blue'); await editor(window, source);
    await window.evaluate(() => {
      let dirty = false;
      window.subtitleController.hasPendingChanges = () => dirty;
      window.subtitleController.openAfter = () => {};
      const ensure = window.remotionPreviewController.ensure;
      window.remotionPreviewController.ensure = async snapshot => {
        const engine = await ensure(snapshot);
        dirty = true;
        return engine;
      };
    });
    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('video-export-status')).toHaveText('请先应用字幕修改');
    expect((await readScenarioState()).exportRequests || []).toHaveLength(0);
    await expect(window.getByTestId('video-export-button')).toBeEnabled();
  });

  test('a failed Player remains failed until a real remount, not a revision update', async ({ window }, info) => {
    const source = info.outputPath('failure-source.mp4');
    await video(source, 'blue'); await editor(window, source);
    const result = await window.evaluate(async () => {
      remotionPreviewController.resetToSource();
      const mount = SRTRemotionPlayer.mount;
      let fail;
      SRTRemotionPlayer.mount = (container, input, options) => {
        fail = options.onError;
        return mount(container, input, options);
      };
      const snapshot = projectEditing.load(getActiveProjectId());
      await remotionPreviewController.ensure(snapshot);
      fail(new Error('test decoder failure'));
      let rejected = false;
      try { await remotionPreviewController.ensure(snapshot); } catch (_) { rejected = true; }
      return { rejected, state: document.getElementById('remotionPreview').dataset.state,
        engine: remotionPreviewController.getEngine() };
    });
    expect(result).toEqual({ rejected: true, state: 'error', engine: 'remotion' });
  });

  test('source effects and undo stay on Remotion while preserving paused playback position', async ({ window }, info) => {
    const source = info.outputPath('compatibility-source.mp4');
    await video(source, 'blue'); await editor(window, source);
    await window.evaluate(async () => {
      editorPlayback.seekSeconds(1.5);
      const projectId = getActiveProjectId();
      await projectEditing.applyRecipe({ projectId, expectedRevision: 0, requestId: 'compat-color',
        recipe: { kind: 'instruction', steps: [{ capability: 'video.color.adjust@1', params: { brightness: .2 } }] } });
      window.dispatchEvent(new Event('project-edit-state-changed'));
    });
    await expect(window.locator('#previewArea')).toHaveAttribute('data-render-engine', 'remotion');
    await expect(window.locator('#remotionPreview canvas[data-source-effects]')).toHaveAttribute('data-drawn-frame', '36');
    await expect(window.locator('#previewVideo')).toBeHidden();
    expect(await window.evaluate(() => editorPlayback.getState().currentTime)).toBeCloseTo(1.5, 1);
    await window.evaluate(async () => {
      const projectId = getActiveProjectId();
      projectEditing.undo({ projectId, expectedRevision: 1, transactionId: 'compat-color' });
      window.dispatchEvent(new Event('project-edit-state-changed'));
    });
    await expect(window.locator('#previewArea')).toHaveAttribute('data-render-engine', 'remotion');
    await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
    expect(await window.locator('#previewVideo').evaluate(video => video.paused)).toBe(true);
  });

  test('subtitle selection and paused source-effect edits never duplicate the Remotion subtitle', async ({ window }, info) => {
    const source = info.outputPath('subtitle-engine-switch.mp4');
    await video(source, 'blue'); await editor(window, source);
    await window.locator('.input-editor').fill('给视频加字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('subtitle-block')).toHaveCount(2);
    await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
    await expect(window.locator('#previewArea')).toHaveAttribute('data-render-engine', 'remotion');
    await window.getByTestId('subtitle-block').first().click();
    await expect(window.locator('#remotionPreview')).toContainText('大家好');
    await expect(window.getByTestId('preview-subtitle')).toBeHidden();
    await window.evaluate(async () => {
      const projectId = getActiveProjectId();
      await projectEditing.applyRecipe({ projectId,
        expectedRevision: projectEditing.load(projectId).document.revision, requestId: 'subtitle-color-switch',
        recipe: { kind: 'instruction', steps: [{ capability: 'video.color.adjust@1', params: { brightness: .2 } }] } });
      window.dispatchEvent(new Event('project-edit-state-changed'));
    });
    await expect(window.locator('#previewArea')).toHaveAttribute('data-render-engine', 'remotion');
    // The fixed first segment starts at 0.2s, rounded to frame 5 at 24fps.
    await expect(window.locator('#remotionPreview canvas[data-source-effects]')).toHaveAttribute('data-drawn-frame', '5');
    await expect(window.getByTestId('preview-subtitle')).toBeHidden();
    await expect(window.locator('#remotionPreview')).toContainText('大家好');
    expect(await window.evaluate(() => editorPlayback.getState().paused)).toBe(true);
    await window.evaluate(() => {
      const projectId = getActiveProjectId();
      projectEditing.undo({ projectId, expectedRevision: projectEditing.load(projectId).document.revision,
        transactionId: 'subtitle-color-switch' });
      window.dispatchEvent(new Event('project-edit-state-changed'));
    });
    await expect(window.locator('#previewArea')).toHaveAttribute('data-render-engine', 'remotion');
    await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
    await expect(window.locator('#remotionPreview')).toContainText('大家好');
    await expect(window.getByTestId('preview-subtitle')).toBeHidden();
  });
});
