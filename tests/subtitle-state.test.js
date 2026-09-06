const test = require('node:test');
const assert = require('node:assert/strict');
const { STORAGE_KEY, createSubtitleStore } = require('../app/subtitle-state');

function memoryStorage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

function fixture() {
  let id = 0;
  return createSubtitleStore(memoryStorage(), () => `segment-${++id}`);
}

test('keeps subtitles isolated by project', () => {
  const store = fixture();
  store.replace('project-a', 'request-a', [{ start: 0, end: 1, text: 'A' }]);
  assert.equal(store.get('project-a').segments[0].text, 'A');
  store.saveDraft('project-a', { 'segment-1': 'A draft' });
  assert.equal(store.get('project-a').draft['segment-1'], 'A draft');
  assert.deepEqual(store.get('project-b').segments, []);
  assert.equal(store.get('project-b').draft, null);
});

test('saves a complete draft without changing applied subtitles', () => {
  const store = fixture();
  const state = store.replace('project-a', 'request-a', [
    { start: 0, end: 1, text: 'A' },
    { start: 1, end: 2, text: 'B' }
  ]);

  const saved = store.saveDraft('project-a', {
    [state.segments[0].id]: 'A draft',
    [state.segments[1].id]: 'B draft'
  });

  assert.deepEqual(saved.segments, state.segments);
  assert.deepEqual(saved.draft, {
    [state.segments[0].id]: 'A draft',
    [state.segments[1].id]: 'B draft'
  });
  assert.deepEqual(store.get('project-a').segments, state.segments);

  const unchanged = store.saveDraft('project-a', {
    [state.segments[0].id]: ' A ',
    [state.segments[1].id]: ' B '
  });
  assert.equal(unchanged.draft, null);
  assert.equal(store.get('project-a').draft, null);
});

test('applies all draft texts and clears the draft', () => {
  const store = fixture();
  const state = store.replace('project-a', 'request-a', [
    { start: 0, end: 1, text: 'A' },
    { start: 1, end: 2, text: 'B' }
  ]);
  const applied = store.applyTexts('project-a', {
    [state.segments[0].id]: 'A applied',
    [state.segments[1].id]: 'B applied'
  });

  assert.deepEqual(applied.segments.map((segment) => segment.text), ['A applied', 'B applied']);
  assert.equal(applied.draft, null);
});

test('rejects invalid draft text without partial writes', () => {
  const store = fixture();
  const state = store.replace('project-a', 'request-a', [
    { start: 0, end: 1, text: 'A' },
    { start: 1, end: 2, text: 'B' }
  ]);
  store.saveDraft('project-a', {
    [state.segments[0].id]: 'A draft',
    [state.segments[1].id]: 'B draft'
  });
  const before = store.get('project-a');
  assert.throws(() => store.saveDraft('project-a', {
    [state.segments[0].id]: 'A draft',
    [state.segments[1].id]: '   '
  }), { code: 'SUBTITLE_TEXT_REQUIRED' });
  assert.deepEqual(store.get('project-a'), before);
});

test('rejects missing or unknown draft ids without partial writes', () => {
  const store = fixture();
  const state = store.replace('project-a', 'request-a', [
    { start: 0, end: 1, text: 'A' },
    { start: 1, end: 2, text: 'B' }
  ]);
  store.saveDraft('project-a', {
    [state.segments[0].id]: 'A draft',
    [state.segments[1].id]: 'B draft'
  });
  const before = store.get('project-a');
  assert.throws(() => store.applyTexts('project-a', {
    [state.segments[0].id]: 'A applied',
    unknown: 'B applied'
  }), { code: 'SUBTITLE_DOCUMENT_STALE' });
  assert.deepEqual(store.get('project-a'), before);
});

test('normalizes legacy states without draft fields', () => {
  const storage = memoryStorage({
    [STORAGE_KEY]: JSON.stringify({
      'project-a': {
        segments: [{ id: 'segment-1', start: 0, end: 1, text: 'A' }],
        undo: { requestId: 'request-a', segments: [] }
      }
    })
  });
  const store = createSubtitleStore(storage, () => 'unused');

  assert.deepEqual(store.get('project-a'), {
    segments: [{ id: 'segment-1', start: 0, end: 1, text: 'A' }],
    draft: null,
    undo: { requestId: 'request-a', segments: [], draft: null }
  });
  assert.equal(store.undo('project-a', 'request-a').draft, null);
});

test('first generation can be undone exactly once to an empty track', () => {
  const store = fixture();
  store.replace('project-a', 'request-a', [{ start: 0, end: 1, text: '初版' }]);
  assert.equal(store.canUndo('project-a', 'request-a'), true);
  assert.deepEqual(store.undo('project-a', 'request-a').segments, []);
  assert.equal(store.canUndo('project-a', 'request-a'), false);
  assert.throws(() => store.undo('project-a', 'request-a'), { code: 'SUBTITLE_UNDO_UNAVAILABLE' });
});

test('regeneration snapshots user-edited current subtitles', () => {
  const store = fixture();
  const first = store.replace('project-a', 'request-a', [{ start: 0, end: 1, text: '初版' }]);
  store.saveDraft('project-a', { [first.segments[0].id]: '草稿版' });
  store.updateText('project-a', first.segments[0].id, '人工修改版');
  store.replace('project-a', 'request-b', [{ start: 0, end: 1, text: '重生成版' }]);
  const restored = store.undo('project-a', 'request-b');
  assert.equal(restored.segments[0].text, '人工修改版');
  assert.equal(restored.draft, null);
});

test('regeneration undo restores both subtitles and prior draft', () => {
  const store = fixture();
  const first = store.replace('project-a', 'request-a', [{ start: 0, end: 1, text: '初版' }]);
  store.saveDraft('project-a', { [first.segments[0].id]: '草稿版' });
  store.replace('project-a', 'request-b', [{ start: 0, end: 1, text: '重生成版' }]);
  const restored = store.undo('project-a', 'request-b');

  assert.equal(restored.segments[0].text, '初版');
  assert.deepEqual(restored.draft, { [first.segments[0].id]: '草稿版' });
  assert.throws(() => store.undo('project-a', 'request-b'), { code: 'SUBTITLE_UNDO_UNAVAILABLE' });
});

test('rejects an empty edited subtitle without changing storage', () => {
  const store = fixture();
  const state = store.replace('project-a', 'request-a', [{ start: 0, end: 1, text: '保留' }]);
  assert.throws(
    () => store.updateText('project-a', state.segments[0].id, '   '),
    { code: 'SUBTITLE_TEXT_REQUIRED' }
  );
  assert.equal(store.get('project-a').segments[0].text, '保留');
});
