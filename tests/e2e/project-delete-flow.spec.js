const {test, expect} = require('./electron.fixture');
test.use({localCliMode:'two'});
test('home delete supports cancellation and survives reload without touching other projects', async ({window}) => {
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  await expect(window.getByTestId('home-page')).toBeVisible();
  await window.evaluate(() => {
    localStorage.setItem('srt_projects', JSON.stringify([{id:'delete-a',name:'测试删除',path:'剪辑.html'}, {id:'keep-b',name:'保留项目',path:'剪辑.html'}]));
    localStorage.setItem('srt_project_edit_state', JSON.stringify({'delete-a':{},'keep-b':{keep:true}}));
  });
  await window.reload();
  window.once('dialog', dialog => dialog.dismiss());
  await window.getByTestId('delete-project').first().click();
  await expect(window.locator('.pcard')).toHaveCount(2);
  window.once('dialog', dialog => dialog.accept());
  await window.getByTestId('delete-project').first().click();
  await expect(window.locator('.pcard')).toHaveCount(1);
  await window.reload();
  await expect(window.locator('.pcard')).toContainText('保留项目');
  expect(await window.evaluate(() => JSON.parse(localStorage.getItem('srt_project_edit_state')))).toEqual({'keep-b':{keep:true}});
});
