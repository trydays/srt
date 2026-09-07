const test = require('node:test');
const assert = require('node:assert/strict');
const { createSubtitleDraftStore } = require('../app/subtitle-draft-state');

function fixture() {
  const values = new Map();
  let writes = 0;
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { writes += 1; values.set(key, value); }
  };
  return { store: createSubtitleDraftStore(storage), values, writes: () => writes };
}
const segments = [{ id: 's1', start: 0, end: 1, text: '已应用字幕' }];

test('saved subtitle draft is isolated from applied text and other projects', () => {
  const f = fixture();
  const draft = f.store.save('p1', 'edit1', 2, { s1: ' 修改文字 ' }, segments);
  assert.deepEqual(draft, { baseRevision: 2, textById: { s1: '修改文字' } });
  assert.equal(segments[0].text, '已应用字幕');
  assert.equal(f.store.get('p2', 'edit1'), null);
  draft.textById.s1 = '不能修改已保存数据';
  assert.equal(f.store.get('p1', 'edit1').textById.s1, '修改文字');
});

test('draft validates all segment IDs and nonempty text before writing', () => {
  const f = fixture();
  for (const texts of [{}, { other: 'x' }, { s1: '' }, { s1: 'ok', extra: 'x' }]) {
    assert.throws(() => f.store.save('p1', 'edit1', 2, texts, segments));
  }
  assert.equal(f.writes(), 0);
});

test('legacy draft migration is idempotent, including cleared drafts', () => {
  const f = fixture();
  f.store.migrate('p1', 'edit1', 2, { s1: '旧草稿' }, segments);
  assert.equal(f.writes(), 1);
  f.store.migrate('p1', 'edit1', 2, { s1: '旧草稿' }, segments);
  assert.equal(f.writes(), 1);
  f.store.clear('p1', 'edit1');
  f.store.migrate('p1', 'edit1', 2, { s1: '旧草稿' }, segments);
  assert.equal(f.store.get('p1', 'edit1'), null);
});

test('saving unchanged applied text clears draft and preserves no applied state', () => {
  const f = fixture();
  f.store.save('p1', 'edit1', 2, { s1: 'draft' }, segments);
  assert.equal(f.store.save('p1', 'edit1', 2, { s1: '已应用字幕' }, segments), null);
  assert.deepEqual([...f.values.keys()], ['srt_project_subtitle_drafts']);
});

test('undo can rebase a saved draft only onto matching restored segment IDs', () => {
  const f = fixture();
  f.store.save('p1', 'edit1', 2, { s1: '之前保存的草稿' }, segments);
  assert.equal(f.store.get('p1', 'edit1').baseRevision, 2);
  assert.throws(() => f.store.rebase('p1', 'edit1', 5, [{ ...segments[0], id: 'new' }]),
    { code: 'SUBTITLE_DOCUMENT_STALE' });
  f.store.rebase('p1', 'edit1', 5, segments);
  assert.equal(f.store.get('p1', 'edit1').baseRevision, 5);
  assert.equal(f.store.get('p1', 'edit1').textById.s1, '之前保存的草稿');
});

test('failed persistence leaves the prior draft available', () => {
  let stored = null;
  const storage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
  const store = createSubtitleDraftStore(storage);
  store.save('p1', 'edit1', 2, { s1: '已保存草稿' }, segments);
  const before = stored;
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => store.save('p1', 'edit1', 2, { s1: '新草稿' }, segments));
  assert.equal(stored, before);
});
