const test = require('node:test');
const assert = require('node:assert/strict');
const { createSubtitleStore } = require('../app/subtitle-state');

function memoryStorage() {
  const values = new Map();
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
  assert.deepEqual(store.get('project-b').segments, []);
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
  store.updateText('project-a', first.segments[0].id, '人工修改版');
  store.replace('project-a', 'request-b', [{ start: 0, end: 1, text: '重生成版' }]);
  const restored = store.undo('project-a', 'request-b');
  assert.equal(restored.segments[0].text, '人工修改版');
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
