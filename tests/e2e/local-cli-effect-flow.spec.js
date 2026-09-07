const { test, expect } = require('./electron.fixture');
const fs = require('node:fs');

async function setUsableMetadata(window) {
  await expect.poll(() => window.locator('#previewVideo').getAttribute('src')).toBeTruthy();
  await window.evaluate(async () => {
    const video = document.getElementById('previewVideo');
    Object.defineProperties(video, {
      duration: { configurable: true, value: 4 },
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 360 }
    });
    video.dispatchEvent(new Event('loadedmetadata'));
    await window.projectEditingReady;
  });
}

async function openEditorWithCodex(window, testInfo) {
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  const videoPath = testInfo.outputPath('local-cli-effect.mp4');
  await fs.promises.writeFile(videoPath, Buffer.from('local CLI effect test video'));
  await window.getByTestId('video-input').setInputFiles(videoPath);
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  await setUsableMetadata(window);
}

test.describe('local CLI effect instructions', () => {
  test.use({ localCliMode: 'two' });

  test('explains unavailable fade without changing the project', async ({ window }, testInfo) => {
    await openEditorWithCodex(window, testInfo);
    await window.locator('.input-editor').fill('给片头添加一个淡入效果');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('request-user-message')).toHaveCount(1);
    await expect(window.getByTestId('request-status-card')).toHaveCount(1);
    await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'clarifying');
    await expect(window.getByTestId('timeline-status')).toHaveAttribute('data-state', 'waiting');
    await expect(window.locator('#tlTrack .tl-marker')).toHaveCount(0);
    await expect(window.getByTestId('effect-status')).toHaveCount(0);
    expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()).document.revision)).toBe(0);
  });

  test('rebuilds the timeline after reload and sends committed revision and subtitles in the next context', async ({ window, readScenarioState }, testInfo) => {
    await openEditorWithCodex(window, testInfo);
    await window.locator('.input-editor').fill('生成字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
    const saved = await window.evaluate(() => ({ document: projectEditing.load(getActiveProjectId()).document, history: getProjectConversation(getActiveProjectId()) }));
    expect(saved.history[0].transactionId).toBe(saved.document.edits[0].transactionId);
    await window.reload();
    await expect(window.locator('#tlTrack .tl-marker')).toHaveCount(1);
    await setUsableMetadata(window);
    await window.evaluate(() => { previewVideo.currentTime = 2; });
    await window.locator('.input-editor').fill('再生成字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('subtitle-status').last()).toHaveAttribute('data-state', 'success');
    const state = await readScenarioState();
    expect(state.translationCalls.at(-1).context.revision).toBe(1);
    expect(state.translationCalls.at(-1).context.subtitleTotal).toBe(saved.document.edits[0].payload.segments.length);
    expect(state.translationCalls.at(-1).context.edits[0].id).toBe(saved.document.edits[0].id);
    expect(state.translationCalls.at(-1).context.playheadSeconds).toBe(2);
    await expect(window.locator('#tlTrack .tl-marker')).toHaveCount(1);
  });

  test('preserves successful committed edits when conversation history cannot be saved', async ({ window }, testInfo) => {
    await openEditorWithCodex(window, testInfo);
    await window.evaluate(() => { window.saveProjectConversation = function() { throw new DOMException('Storage full', 'QuotaExceededError'); }; });
    await window.locator('.input-editor').fill('生成字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
    await expect(window.getByText('编辑结果已保留，但对话历史暂时未保存。')).toBeVisible();
    expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()).document.revision)).toBe(1);
    await expect(window.locator('#tlTrack .tl-marker')).toHaveCount(1);
    await window.reload();
    await expect(window.getByTestId('request-user-message')).toHaveCount(0);
    await expect(window.getByTestId('request-status-summary')).toContainText('已恢复的编辑记录');
    await window.getByTestId('request-status-summary').click();
    await expect(window.getByTestId('subtitle-undo')).toBeVisible();
    await window.getByTestId('subtitle-undo').click();
    await expect(window.locator('#tlTrack .tl-marker')).toHaveCount(0);
    expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()).document.edits.length)).toBe(0);
  });

  test('waits for a reloaded video source before translating and generating', async ({ window, readScenarioState }, testInfo) => {
    await openEditorWithCodex(window, testInfo);
    await window.evaluate(() => {
      const path = currentProjectVideoPath;
      currentProjectVideoPath = null;
      window.projectVideoLoading = true;
      window.currentProjectVideoReady = new Promise(resolve => {
        window.__resolveVideo = () => { currentProjectVideoPath = path; window.projectVideoLoading = false; resolve(path); };
      });
    });
    await window.locator('.input-editor').fill('生成字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('request-status-card')).toContainText('正在读取视频信息');
    expect((await readScenarioState()).translationCalls || []).toHaveLength(0);
    await window.evaluate(() => window.__resolveVideo());
    await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
  });

  test.describe('invalid local CLI output', () => {
    test.use({ localCliEffectResult: 'invalid' });

    test('shows failed and not run in the same card without a marker', async ({ window }, testInfo) => {
      await openEditorWithCodex(window, testInfo);
      await window.locator('.input-editor').fill('添加淡入');
      await window.locator('#generateBtn').click();
      await expect(window.getByTestId('request-status-card')).toHaveCount(1);
      await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'failed');
      await expect(window.getByTestId('timeline-status')).toHaveAttribute('data-state', 'not_run');
      await expect(window.getByTestId('timeline-effect-fade-in')).toHaveCount(0);
    });
  });

  test.describe('multi-turn clarify', () => {
    test.use({ localCliEffectResult: 'clarify-once' });

    test('asks a follow-up then converges after the reply', async ({ window }, testInfo) => {
      await openEditorWithCodex(window, testInfo);
      await window.locator('.input-editor').fill('做个效果');
      await window.locator('#generateBtn').click();
      await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'clarifying');
      await expect(window.getByTestId('request-clarify')).toContainText('字幕');
      await window.locator('.input-editor').fill('要字幕');
      await window.locator('#generateBtn').click();
      await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'success');
      await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
      await expect(window.locator('#tlTrack .tl-marker')).toHaveCount(1);
      await expect(window.getByTestId('request-clarify')).toHaveCount(0);
      await expect(window.getByTestId('request-user-message')).toHaveCount(2);
    });
  });

  test.describe('multi-step ranged instruction', () => {
    test.use({ localCliEffectResult: 'multi-step' });

    test('rejects unsupported multi-step instructions before any mutation', async ({ window }, testInfo) => {
      await openEditorWithCodex(window, testInfo);
      await window.locator('.input-editor').fill('从 12 到 18 秒加字幕，片尾淡出');
      await window.locator('#generateBtn').click();
      await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'failed');
      await expect(window.getByTestId('timeline-status')).toHaveAttribute('data-state', 'not_run');
      await expect(window.locator('#tlTrack .tl-marker')).toHaveCount(0);
      expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()).document.revision)).toBe(0);
    });
  });
});
