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

async function submit(window, text) {
  await window.locator('.input-editor').fill(text);
  await window.locator('#generateBtn').click();
  await expect(window.getByTestId('request-status-card').last()).toHaveClass(/is-collapsed/);
}

async function seek(window, seconds, event = 'timeupdate') {
  await window.evaluate(({ seconds, event }) => {
    const video = document.getElementById('previewVideo');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: seconds });
    video.dispatchEvent(new Event(event));
  }, { seconds, event });
}

test.describe('graph-derived color transactions', () => {
  test.use({ localCliMode: 'two', localCliEffectResult: 'color-transactions' });

  for (const hasDraft of [false, true]) {
    test(`keeps subtitles editable after a color-only transaction with saved draft=${hasDraft}`, async ({ window }, testInfo) => {
      await openEditor(window, testInfo);
      await metadata(window);
      await submit(window, '生成字幕');
      const field = window.getByTestId('subtitle-document-segment').first();
      await field.fill('调色前已应用的字幕');
      await window.getByTestId('subtitle-document-apply').click();
      if (hasDraft) {
        await field.fill('调色前保存的草稿');
        await window.getByTestId('subtitle-document-save').click();
      }
      const before = await window.evaluate(() => projectEditing.load(getActiveProjectId()).document);
      await submit(window, '仅调整颜色');
      const after = await window.evaluate(() => projectEditing.load(getActiveProjectId()).document);
      expect(after.revision).toBe(before.revision + 1);
      expect(after.edits.find(edit => edit.type === 'subtitle.track@1'))
        .toEqual(before.edits.find(edit => edit.type === 'subtitle.track@1'));
      if (hasDraft) {
        const draft = await window.evaluate(() => {
          const snapshot = projectEditing.load(getActiveProjectId());
          const edit = snapshot.document.edits.find(item => item.type === 'subtitle.track@1');
          return subtitleDraftStore.get(getActiveProjectId(), edit.id);
        });
        expect(draft.baseRevision).toBe(after.revision);
      }
      await window.getByTestId('subtitle-document-toggle').click();
      await expect(field).toHaveText(hasDraft ? '调色前保存的草稿' : '调色前已应用的字幕');
      await field.fill('调色后继续修改的字幕');
      await window.getByTestId('subtitle-document-save').click();
      await expect(window.getByTestId('subtitle-document-status')).toHaveText('草稿已保存 · 尚未应用');
      await window.getByTestId('subtitle-document-apply').click();
      await expect(window.getByTestId('subtitle-block').first()).toHaveText('调色后继续修改的字幕');
      await expect(window.getByTestId('subtitle-document-status')).toHaveText('所有修改已应用');
    });
  }

  test('restores the earlier mixed transaction card and subtitle editor after reload then undo', async ({ window }, testInfo) => {
    await openEditor(window, testInfo);
    await metadata(window);
    await submit(window, '第一次调色并生成字幕');
    await window.getByTestId('subtitle-document-segment').first().fill('事务 A 的字幕');
    await window.getByTestId('subtitle-document-apply').click();
    const original = await window.evaluate(() => projectEditing.load(getActiveProjectId()).document);
    await submit(window, '第二次调色并生成字幕');
    await window.reload();
    await metadata(window);
    const cardA = window.getByTestId('request-status-card').first();
    const cardB = window.getByTestId('request-status-card').last();
    await expect(cardA.getByTestId('subtitle-status')).toHaveCount(0);
    await cardB.getByTestId('request-status-summary').click();
    await cardB.getByRole('button', { name: '撤销本次编辑', exact: true }).click();
    expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()).document.edits)).toEqual(original.edits);
    await expect(cardA.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
    await expect(cardA.getByTestId('request-status-summary')).toContainText('字幕');
    await expect(window.getByTestId('subtitle-document-surface')).toBeVisible();
    await expect(window.getByTestId('subtitle-document-segment').first()).toHaveText('事务 A 的字幕');
    expect(await window.locator('[data-subtitle-document]').evaluate(el => el.previousElementSibling.dataset.requestId))
      .toBe(await cardA.getAttribute('data-request-id'));
  });

  test('projects ranged color into preview and timeline across reload, context and undo', async ({ window, readScenarioState }, testInfo) => {
    await openEditor(window, testInfo);
    await metadata(window);
    await submit(window, '把 1–3 秒调冷、提亮并提高对比度');
    const marker = window.locator('.tl-marker');
    await expect(marker).toHaveCount(1);
    const bounds = await marker.evaluate(element => ({ left: parseFloat(element.style.left),
      width: parseFloat(element.style.width), track: document.getElementById('tlTrack').getBoundingClientRect().width }));
    expect(bounds.left).toBeCloseTo(16 + (bounds.track - 32) / 4, 1);
    expect(bounds.width).toBeCloseTo((bounds.track - 32) / 2, 1);
    await seek(window, 0.5);
    await expect(window.locator('#previewVideo')).toHaveCSS('filter', 'none');
    await seek(window, 2, 'seeked');
    await expect(window.locator('#previewVideo')).toHaveCSS('filter', /previewColorFilter/);
    await expect(window.locator('[data-color-temperature]')).toHaveAttribute('values', '0.88 0 0 0 0 0 1 0 0 0 0 0 1.12 0 0 0 0 0 1 0');
    const tone = (await window.locator('[data-color-tone]').getAttribute('values')).split(' ').map(Number);
    expect(tone[0]).toBeCloseTo(1.3); // Y contrast is independent of U/V saturation.
    expect(tone[6]).toBeCloseTo(1);
    expect(tone[12]).toBeCloseTo(1);
    expect(tone[4]).toBeCloseTo(-0.3 * 128 / 255 + 0.05);
    await expect(window.locator('[data-color-encode]')).toHaveCount(1);
    await expect(window.locator('[data-color-decode]')).toHaveCount(1);
    await expect(window.locator('#previewSubtitle')).toHaveCSS('filter', 'none');
    await seek(window, 3);
    await expect(window.locator('#previewVideo')).toHaveCSS('filter', 'none');
    const saved = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    await window.reload();
    await metadata(window);
    await expect(marker).toHaveCount(1);
    await seek(window, 2);
    await expect(window.locator('#previewVideo')).toHaveCSS('filter', /previewColorFilter/);
    expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()))).toEqual(saved);
    await window.locator('.input-editor').fill('下一步');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('request-clarify')).toBeVisible();
    const context = (await readScenarioState()).translationCalls.at(-1).context;
    expect(context.revision).toBe(saved.document.revision);
    expect(context.operations).toEqual([{ capability: 'video.color.adjust@1', range: { start: 1, end: 3 },
      params: { temperature: -0.6, brightness: 0.2, saturation: 1, contrast: 1.3 } }]);
    await window.getByTestId('request-status-summary').first().click();
    await window.getByRole('button', { name: '撤销本次编辑', exact: true }).click();
    await expect(marker).toHaveCount(0);
    await expect(window.locator('#previewVideo')).toHaveCSS('filter', 'none');
    await expect(window.locator('[data-subtitle-document]')).toBeHidden();
  });

  test('presents color-first mixed steps as one transaction and restores it on reload and subtitle undo', async ({ window }, testInfo) => {
    await openEditor(window, testInfo);
    await metadata(window);
    await submit(window, '把 1–3 秒调冷并生成字幕');
    await expect(window.getByTestId('request-status-card')).toHaveCount(1);
    await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
    await expect(window.getByTestId('request-status-summary')).toContainText('画面调色');
    await expect(window.getByTestId('request-status-summary')).toContainText('字幕');
    await expect(window.locator('.tl-marker')).toHaveCount(2);
    const markerRows = await window.locator('.tl-marker').evaluateAll(elements => elements.map(el => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }));
    expect(markerRows[0].bottom).toBeLessThanOrEqual(markerRows[1].top);
    await expect(window.locator('.tl-marker[data-lane="subtitle"]')).toHaveJSProperty('offsetWidth',
      Math.round(await window.locator('#tlTrack').evaluate(el => el.getBoundingClientRect().width - 32)));
    await seek(window, 2);
    await expect(window.locator('#previewSubtitle')).toBeVisible();
    await expect(window.locator('#previewSubtitle')).toHaveCSS('filter', 'none');
    const baseline = await window.evaluate(() => projectEditing.load(getActiveProjectId()).document.edits);
    await window.reload();
    await metadata(window);
    await expect(window.getByTestId('request-status-card')).toHaveCount(1);
    await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
    await window.getByTestId('subtitle-document-toggle').click();
    await window.getByTestId('subtitle-document-segment').first().fill('恢复前字幕');
    await window.getByTestId('subtitle-document-save').click();
    await submit(window, '再次调色并生成字幕');
    await window.getByTestId('request-status-summary').last().click();
    await window.getByRole('button', { name: '撤销本次编辑', exact: true }).click();
    expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()).document.edits)).toEqual(baseline);
    await expect(window.getByTestId('subtitle-document-segment').first()).toHaveText('恢复前字幕');
    await expect(window.locator('.tl-marker')).toHaveCount(2);
  });

  test('undo removes both steps of one mixed transaction', async ({ window }, testInfo) => {
    await openEditor(window, testInfo);
    await metadata(window);
    await submit(window, '调色并生成字幕');
    await seek(window, 2);
    await window.getByTestId('request-status-summary').click();
    await expect(window.getByRole('button', { name: '撤销本次编辑', exact: true })).toHaveCount(1);
    await window.getByRole('button', { name: '撤销本次编辑', exact: true }).click();
    await expect(window.locator('.tl-marker')).toHaveCount(0);
    await expect(window.locator('#previewVideo')).toHaveCSS('filter', 'none');
    await expect(window.locator('[data-subtitle-document]')).toBeHidden();
    expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()).document.edits)).toEqual([]);
  });

  test('composes every active color operation in graph order', async ({ window }, testInfo) => {
    await openEditor(window, testInfo);
    await metadata(window);
    await submit(window, '叠加两次调色');
    await seek(window, 2.5);
    await expect(window.locator('[data-color-temperature]')).toHaveCount(2);
    const gains = await window.locator('[data-color-temperature]').evaluateAll(elements => elements.map(el => Number(el.getAttribute('values').split(' ')[0])));
    expect(gains).toEqual([0.88, 1.08]);
    const stages = await window.locator('#previewColorFilter > *').evaluateAll(elements =>
      elements.map(el => el.getAttributeNames().find(name => name.startsWith('data-color-'))));
    expect(stages).toEqual(['data-color-temperature', 'data-color-encode', 'data-color-tone', 'data-color-decode',
      'data-color-temperature', 'data-color-encode', 'data-color-tone', 'data-color-decode']);
    await seek(window, 3);
    await expect(window.locator('[data-color-temperature]')).toHaveCount(1);
    const tone = (await window.locator('[data-color-tone]').getAttribute('values')).split(' ').map(Number);
    expect(tone[6]).toBeCloseTo(0.7);
    expect(tone[12]).toBeCloseTo(0.7);
    await seek(window, 4);
    await expect(window.locator('#previewVideo')).toHaveCSS('filter', 'none');
  });
});
