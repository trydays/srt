const { test, expect } = require('./electron.fixture');
const fs = require('node:fs');

async function openEditor(window, testInfo) {
  const source = testInfo.outputPath('project-editing.mp4');
  await fs.promises.writeFile(source, 'metadata fixture');
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  await window.getByTestId('video-input').setInputFiles(source);
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  await expect.poll(() => window.locator('#previewVideo').getAttribute('src')).toBeTruthy();
}

async function metadata(window) {
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

test.describe('unified project editing', () => {
  test.use({ localCliMode: 'two' });

  test('waits for media facts and migrates legacy applied text and draft once', async ({ window }, testInfo) => {
    await openEditor(window, testInfo);
    await expect.poll(() => window.evaluate(() => localStorage.getItem('srt_project_edit_state'))).toBeNull();
    const legacy = await window.evaluate(() => {
      const old = { [getActiveProjectId()]: {
        segments: [{ id: 'legacy-1', start: 0.2, end: 1.4, text: '旧项目已应用字幕' }],
        draft: { 'legacy-1': '旧项目未应用草稿' },
        undo: { requestId: 'old-request', segments: [], draft: null }
      } };
      localStorage.setItem('srt_project_subtitles', JSON.stringify(old));
      return JSON.stringify(old);
    });
    await metadata(window);
    await expect(window.getByTestId('subtitle-block')).toHaveText('旧项目已应用字幕');
    await window.evaluate(() => window.subtitleController.openAfter(null));
    await expect(window.getByTestId('subtitle-document-segment')).toHaveText('旧项目未应用草稿');
    const saved = await window.evaluate(() => localStorage.getItem('srt_project_edit_state'));
    await window.reload();
    await metadata(window);
    expect(await window.evaluate(() => localStorage.getItem('srt_project_edit_state'))).toBe(saved);
    expect(await window.evaluate(() => localStorage.getItem('srt_project_subtitles'))).toBe(legacy);
    await expect(window.getByTestId('subtitle-block')).toHaveText('旧项目已应用字幕');
  });

  test('regeneration, whole-request undo and next AI context share the document revision', async ({
    window, readScenarioState
  }, testInfo) => {
    await openEditor(window, testInfo);
    await metadata(window);
    await window.locator('.input-editor').fill('给视频加字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('subtitle-status').last()).toHaveAttribute('data-state', 'success');
    await window.getByTestId('subtitle-document-segment').first().fill('需要保留的修改');
    await window.getByTestId('subtitle-document-apply').click();
    const before = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    expect(before.graph.documentRevision).toBe(before.document.revision);
    await window.locator('.input-editor').fill('重新生成字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('subtitle-status').last()).toHaveAttribute('data-state', 'success');
    const after = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    expect(after.document.edits).toHaveLength(1);
    expect(after.document.revision).toBe(before.document.revision + 1);
    const state = await readScenarioState();
    expect(state.translationCalls.at(-1).context.revision).toBe(before.document.revision);
    expect(state.translationCalls.at(-1).context.subtitles[0].text).toBe('需要保留的修改');
    await window.getByTestId('request-status-card').last().getByTestId('request-status-summary').click();
    await window.getByTestId('subtitle-undo').click();
    await expect(window.getByTestId('subtitle-block').first()).toHaveText('需要保留的修改');
    const undone = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    expect(undone.document.edits).toEqual(before.document.edits);
    expect(undone.graph.documentRevision).toBe(undone.document.revision);
  });

  test('a failed draft cleanup cannot resurrect stale text or block editing after reload', async ({ window }, testInfo) => {
    await openEditor(window, testInfo);
    await metadata(window);
    await window.locator('.input-editor').fill('给视频加字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('subtitle-status').last()).toHaveAttribute('data-state', 'success');
    await window.getByTestId('subtitle-document-segment').first().fill('已经应用的文字');
    await window.getByTestId('subtitle-document-save').click();
    await window.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'srt_project_subtitle_drafts') throw new Error('draft cleanup failure');
        return original.call(this, key, value);
      };
    });
    await window.getByTestId('subtitle-document-apply').click();
    await expect(window.getByTestId('subtitle-block').first()).toHaveText('已经应用的文字');
    await expect(window.getByTestId('subtitle-document-status')).toContainText('字幕已应用');
    await window.reload();
    await metadata(window);
    await window.getByTestId('subtitle-document-toggle').click();
    await expect(window.getByTestId('subtitle-document-status')).toContainText('所有修改已应用');
    await window.getByTestId('subtitle-document-segment').first().fill('刷新后仍能继续编辑');
    await window.getByTestId('subtitle-document-save').click();
    await window.getByTestId('subtitle-document-apply').click();
    await expect(window.getByTestId('subtitle-block').first()).toHaveText('刷新后仍能继续编辑');
  });
});
