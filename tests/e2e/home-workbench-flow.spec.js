const { test, expect } = require('./electron.fixture');

async function expectHome(window) {
  await expect(window.getByTestId('home-page')).toBeVisible();
  await expect(window.locator('#splash')).toHaveClass(/is-done/);
}

async function returnHome(window) {
  await window.locator('.wtab.is-pinned .wtab__main').click();
  await expectHome(window);
}

test('工作台保留上传和最近项目闭环，两个入口都可进入组件库', async ({ window }) => {
  await window.getByTestId('continue').click();
  await expectHome(window);

  await expect(window.getByTestId('home-upload')).toBeVisible();
  await expect(window.getByTestId('recent-projects')).toBeVisible();
  await expect(window.getByTestId('template-workflows')).toBeVisible();
  await expect(window.getByTestId('component-preview')).toBeVisible();
  await expect(window.getByTestId('nav-workbench')).toHaveAttribute('aria-current', 'page');

  await window.getByTestId('nav-component-library').click();
  await expect(window.getByRole('heading', { name: '浏览全部组件' })).toBeVisible();
  await returnHome(window);

  await window.getByTestId('component-preview-library').click();
  await expect(window.getByRole('heading', { name: '浏览全部组件' })).toBeVisible();
  await returnHome(window);

  await window.getByTestId('video-input').setInputFiles({
    name: 'home-workbench.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('home workbench video')
  });
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  const projectId = await window.evaluate(() => getActiveProjectId());

  await returnHome(window);
  const recentProject = window.locator('[data-testid="recent-projects"] [data-project-id="' + projectId + '"]');
  await expect(recentProject).toContainText('home-workbench.mp4');
  await recentProject.click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  await expect.poll(() => window.evaluate(() => getActiveProjectId())).toBe(projectId);
});
