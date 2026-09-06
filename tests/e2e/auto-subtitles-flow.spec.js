const { test, expect } = require('./electron.fixture');
const fs = require('node:fs');

async function createVideoFixture(testInfo) {
  const file = testInfo.outputPath('subtitle-surface.mp4');
  await fs.promises.writeFile(file, Buffer.from('subtitle surface fixture'));
  return file;
}

async function openEditor(window, videoFixturePath) {
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  await window.getByTestId('video-input').setInputFiles(videoFixturePath);
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
}

async function seedExistingSubtitle(window) {
  await window.evaluate(() => {
    const store = window.SRTSubtitleState.createSubtitleStore(
      localStorage,
      () => 'seed-segment'
    );
    store.replace(getActiveProjectId(), 'seed-request', [
      { start: 0, end: 1, text: '原字幕不能丢失' }
    ]);
    window.subtitleController.render();
  });
}

test.describe('subtitle surface', () => {
  test.use({ localCliMode: 'two' });

  test('shows fixed segments in one track and the preview', async ({ window }, testInfo) => {
    const videoFixturePath = await createVideoFixture(testInfo);
    await openEditor(window, videoFixturePath);
    await window.evaluate(() => {
      let id = 0;
      const store = window.SRTSubtitleState.createSubtitleStore(
        localStorage,
        () => `fixture-segment-${++id}`
      );
      store.replace(getActiveProjectId(), 'fixture-request', [
        { start: 0.2, end: 1.4, text: '大家好' },
        { start: 1.6, end: 3.0, text: '欢迎测试自动字幕' }
      ]);
      window.subtitleController.render();
    });
    await expect(window.getByTestId('subtitle-block')).toHaveCount(2);
    await window.getByTestId('subtitle-block').first().click();
    await expect(window.getByTestId('preview-subtitle')).toHaveText('大家好');
  });
});

test.describe('auto subtitle conversation', () => {
  test.use({ localCliMode: 'two', subtitleResult: 'success' });

  test('generates, edits, persists and undoes the one subtitle track', async ({ window }, testInfo) => {
    const videoFixturePath = await createVideoFixture(testInfo);
    await openEditor(window, videoFixturePath);
    await expect(window.locator('#generateBtn')).toHaveText('发送');
    await window.locator('.input-editor').fill('给这个视频加上字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('request-user-message')).toHaveCount(1);
    await expect(window.getByTestId('request-status-card')).toHaveCount(1);
    await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'success');
    await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
    await expect(window.getByTestId('subtitle-block')).toHaveCount(2);
    await window.getByTestId('subtitle-undo').click();
    await expect(window.getByTestId('subtitle-block')).toHaveCount(0);
    await window.locator('.input-editor').fill('重新生成字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('subtitle-block')).toHaveCount(2);
    await expect(window.getByTestId('subtitle-undo')).toHaveCount(1);
    await window.getByTestId('subtitle-block').first().click();
    await expect(window.getByTestId('preview-subtitle')).toHaveText('大家好');
    await window.getByTestId('subtitle-text-input').fill('大家好，已经修改');
    await window.getByTestId('subtitle-text-save').click();
    await expect(window.getByTestId('preview-subtitle')).toHaveText('大家好，已经修改');
    await window.reload();
    await expect(window.getByTestId('subtitle-block').first()).toHaveText('大家好，已经修改');
    await window.locator('.input-editor').fill('再生成一次字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('request-status-card')).toHaveCount(3);
    const latestRequestCard = window.getByTestId('request-status-card').last();
    await expect(latestRequestCard.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
    await expect(window.getByTestId('subtitle-undo')).toHaveCount(1);
    await latestRequestCard.getByTestId('subtitle-undo').click();
    await expect(window.getByTestId('subtitle-block').first()).toHaveText('大家好，已经修改');
  });
});

test.describe('auto subtitles without speech', () => {
  test.use({ localCliMode: 'two', subtitleResult: 'no-speech' });

  test('shows a readable result and preserves the old track', async ({ window }, testInfo) => {
    const videoFixturePath = await createVideoFixture(testInfo);
    await openEditor(window, videoFixturePath);
    await seedExistingSubtitle(window);
    await window.locator('.input-editor').fill('给视频加字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'failed');
    await expect(window.getByText('未检测到可生成字幕的清晰人声')).toBeVisible();
    await expect(window.getByTestId('subtitle-block')).toHaveCount(1);
    await expect(window.getByTestId('subtitle-block')).toHaveText('原字幕不能丢失');
  });
});
