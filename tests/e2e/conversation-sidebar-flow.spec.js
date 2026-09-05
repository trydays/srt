const { test, expect } = require('./electron.fixture');

async function openHome(window) {
  await window.getByTestId('continue').click();
  await expect(window.getByTestId('home-page')).toBeVisible();
  await expect(window.locator('#splash')).toHaveClass(/is-done/);
}

async function uploadAndOpenEditor(window, name = 'sidebar-test.mp4') {
  await expect(window.locator('#splash')).toHaveClass(/is-done/);
  await window.getByTestId('video-input').setInputFiles({
    name,
    mimeType: 'video/mp4',
    buffer: Buffer.from('sidebar test video')
  });
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
}

test('docks conversation left and keeps one component drag path', async ({ window }) => {
  await openHome(window);
  await uploadAndOpenEditor(window);

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
  await expect(window.locator('#tlTrack .tl-marker')).toHaveCount(1);

  await window.getByTestId('sidebar-tab-conversation').click();
  await expect(window.getByTestId('conversation-panel')).toBeVisible();
  await expect(window.locator('#tlTrack .tl-marker')).toHaveCount(1);
});
