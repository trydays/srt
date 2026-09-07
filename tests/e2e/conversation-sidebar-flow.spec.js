const { test, expect } = require('./electron.fixture');
const fs = require('node:fs');

async function openHome(window) {
  await window.getByTestId('continue').click();
  await expect(window.getByTestId('home-page')).toBeVisible();
  await expect(window.locator('#splash')).toHaveClass(/is-done/);
}

async function uploadAndOpenEditor(window, testInfo, name = 'sidebar-test.mp4') {
  await expect(window.locator('#splash')).toHaveClass(/is-done/);
  const source = testInfo.outputPath(name);
  await fs.promises.writeFile(source, 'sidebar test video');
  await window.getByTestId('video-input').setInputFiles(source);
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  await expect.poll(() => window.locator('#previewVideo').getAttribute('src')).toBeTruthy();
  await window.evaluate(() => {
    const video = document.getElementById('previewVideo');
    Object.defineProperties(video, {
      duration: { configurable: true, value: 4 }, videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 360 }
    });
    video.dispatchEvent(new Event('loadedmetadata'));
    return window.projectEditingReady;
  });
}

test('docks conversation left and keeps one component drag path', async ({ window }, testInfo) => {
  await openHome(window);
  await uploadAndOpenEditor(window, testInfo);

  const sidebar = window.getByTestId('editor-sidebar');
  const workspace = window.getByTestId('editor-page');
  await expect(window.locator('#splitRoot')).toHaveAttribute('data-sidebar-side', 'left');
  await expect(window.getByTestId('conversation-panel')).toBeVisible();
  await expect(window.getByTestId('components-panel')).toBeHidden();

  const sidebarBox = await sidebar.boundingBox();
  const workspaceBox = await workspace.boundingBox();
  expect(sidebarBox.x + sidebarBox.width).toBeLessThanOrEqual(workspaceBox.x);

  await window.getByTestId('sidebar-tab-components').click();
  await window.locator('#compSearch').fill('缩放入场');
  const card = window.locator('.comp-card[data-name="缩放入场"]');
  await expect(card).toHaveCount(1);
  await card.dragTo(window.locator('#tlTrack'));
  await expect(window.locator('#tlTrack .tl-marker')).toHaveCount(0);

  await window.getByTestId('sidebar-tab-conversation').click();
  await expect(window.getByTestId('conversation-panel')).toBeVisible();
  await expect(window.locator('#tlTrack .tl-marker')).toHaveCount(0);
  await expect(window.getByTestId('conversation-panel')).toContainText('尚未接通');
  expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()).document.revision)).toBe(0);
});

test('home owns side preference and editor docks right without overlap', async ({ window }, testInfo) => {
  await openHome(window);
  await expect(window.getByTestId('local-avatar')).toBeVisible();
  await window.getByTestId('local-avatar').click();
  const popover = window.getByTestId('preferences-popover');
  await expect(popover.getByTestId('sidebar-side-left')).toHaveAttribute('aria-pressed', 'true');
  await expect(popover).not.toContainText('侧栏宽度');
  await expect(popover).not.toContainText('登录');
  await expect(popover).not.toContainText('云同步');

  await popover.getByTestId('sidebar-side-right').click();
  await uploadAndOpenEditor(window, testInfo, 'right-sidebar.mp4');
  await expect(window.locator('#splitRoot')).toHaveAttribute('data-sidebar-side', 'right');
  await expect(window.getByTestId('local-avatar')).toHaveCount(0);

  const sidebarBox = await window.getByTestId('editor-sidebar').boundingBox();
  const workspaceBox = await window.getByTestId('editor-page').boundingBox();
  expect(workspaceBox.x + workspaceBox.width).toBeLessThanOrEqual(sidebarBox.x);

  await window.reload();
  await expect(window.locator('#splitRoot')).toHaveAttribute('data-sidebar-side', 'right');
});

test.describe('project-scoped final conversation history', () => {
  test.use({ localCliMode: 'two' });
  test('separates completed history across two projects and reload', async ({ window }, testInfo) => {
    await window.getByTestId('local-cli-codex').click();
    await openHome(window);
    await uploadAndOpenEditor(window, testInfo, 'project-a.mp4');
    await window.locator('.input-editor').fill('项目 A 生成字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
    const projectAId = await window.evaluate(() => getActiveProjectId());

    await window.locator('.wtab.is-pinned .wtab__main').click();
    await uploadAndOpenEditor(window, testInfo, 'project-b.mp4');
    const projectBId = await window.evaluate(() => getActiveProjectId());
    expect(projectBId).not.toBe(projectAId);
    await expect(window.getByTestId('request-status-card')).toHaveCount(0);

    await window.locator('[data-project-id="' + projectAId + '"] .wtab__main').click();
    await expect(window.getByTestId('request-user-message')).toHaveText('项目 A 生成字幕');
    await window.reload();
    await expect(window.getByTestId('request-status-card')).toHaveCount(1);
  });
});
