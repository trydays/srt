const { test, expect } = require('./electron.fixture');
const fs = require('node:fs');

test.use({ localCliMode: 'two' });

async function metadata(window) {
  await window.evaluate(async () => {
    const video = document.getElementById('previewVideo');
    Object.defineProperties(video, {
      duration: { configurable: true, value: 40 },
      videoWidth: { configurable: true, value: 640 }, videoHeight: { configurable: true, value: 360 }
    });
    video.dispatchEvent(new Event('loadedmetadata'));
    await window.projectEditingReady;
  });
}

test('packs effects into bounded lanes and zooms, scrolls, seeks without changing project', async ({ window }, testInfo) => {
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  const source = testInfo.outputPath('timeline.mp4');
  await fs.promises.writeFile(source, 'metadata fixture, not real media');
  await window.getByTestId('video-input').setInputFiles(source);
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  await expect.poll(() => window.locator('#previewVideo').getAttribute('src')).toBeTruthy();
  await metadata(window);
  await expect(window.locator('#tlZoomIn')).toBeVisible({ timeout: 4000 });
  await expect(window.locator('.tl-source')).toHaveCount(1);
  const before = await window.evaluate(async () => {
    const steps = Array.from({ length: 10 }, (_, i) => ({ capability: 'visual.group@1',
      range: { start: 2, end: 10 }, params: { layers: [
        { kind: 'shape', params: { x: .1, y: .1, width: .4, height: .25, color: '#000000' } },
        { kind: 'text', params: { text: '要点 ' + (i + 1) } }
      ], opacity: 1, scale: 1 } }));
    steps.push({ capability: 'visual.text@1', range: { start: 10, end: 15 }, params: { text: '后续要点' } });
    steps.push({ capability: 'video.color.adjust@1', range: { start: 0, end: 40 }, params: { brightness: .1 } });
    const projectId = getActiveProjectId();
    await projectEditing.applyRecipe({ projectId, expectedRevision: 0, requestId: 'timeline-fixture', recipe: { kind: 'instruction', steps } });
    renderMarkers();
    return localStorage.getItem('srt_project_edit_state');
  });
  await expect(window.locator('.tl-marker')).toHaveCount(12);
  await expect(window.locator('.tl-row[data-lane="visual"]')).toHaveCount(10);
  await expect(window.locator('.tl-row[data-lane="visual"]').first().locator('.tl-marker')).toHaveCount(2);
  const viewport = window.locator('#tlViewport');
  expect((await viewport.boundingBox()).height).toBeLessThanOrEqual(242);
  await window.locator('#tlZoomIn').click();
  await window.locator('#tlZoomIn').click();
  expect(await viewport.evaluate(el => el.scrollWidth > el.clientWidth * 2)).toBe(true);
  await viewport.evaluate(el => { el.scrollLeft = 200; el.scrollTop = 90; });
  const box = await viewport.boundingBox();
  const expected = await window.evaluate(() => {
    const el = document.getElementById('tlViewport');
    return (el.scrollLeft + 100) / Number(document.getElementById('tlTrack').dataset.timeWidth) * 40;
  });
  await window.mouse.click(box.x + 1 + 104 + 100, box.y + 45);
  expect(await window.evaluate(() => editorPlayback.getState().currentTime)).toBeCloseTo(expected, 1);
  expect(await window.locator('#tlPlayhead').evaluate(el => parseFloat(el.style.left))).toBeCloseTo(404, 0);
  await window.locator('#tlFit').click();
  expect(await viewport.evaluate(el => el.scrollLeft)).toBe(0);
  expect(await viewport.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await viewport.evaluate(el => { el.scrollTop = 0; });
  await window.screenshot({ path: testInfo.outputPath('multitrack.png'), fullPage: true });
  await window.setViewportSize({ width: 850, height: 700 });
  await expect.poll(() => viewport.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect(await window.evaluate(() => localStorage.getItem('srt_project_edit_state'))).toBe(before);
  await window.reload();
  await metadata(window);
  await expect(window.locator('.tl-marker')).toHaveCount(12);
  expect(await window.evaluate(() => localStorage.getItem('srt_project_edit_state'))).toBe(before);
  // Presentation-only boundary: very short touching clips keep their true widths.
  await window.evaluate(() => timelineView.render([
    { editId: 'short-a', lane: 'visual', label: '短片段', range: { start: 0, end: .001 } },
    { editId: 'short-b', lane: 'visual', label: '短片段', range: { start: .001, end: .002 } }
  ], 40));
  const tiny = await window.locator('.tl-marker').evaluateAll(elements => elements.map(el => {
    const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width };
  }));
  expect(tiny[0].width).toBeLessThan(2);
  expect(tiny[0].right).toBeLessThanOrEqual(tiny[1].left + .02);
});
