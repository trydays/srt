const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.join(__dirname, '../src/timeline-layout.js');
const model = fs.existsSync(modulePath) ? require(modulePath) : {};
const item = (id, start, end, lane = 'visual') => ({ editId: id, lane, range: { start, end } });

test('ruler labels remain distinct at high zoom for short and minute-long media', () => {
  assert.equal(typeof model.formatTick, 'function');
  for (const duration of [4, 65]) {
    const step = duration / 120;
    const labels = Array.from({ length: 121 }, (_, i) => model.formatTick(step * i, step));
    assert.equal(new Set(labels).size, labels.length);
  }
  assert.equal(model.formatTick(60, .01), '01:00.00');
});

test('formatTick safely falls back for invalid spacing', () => {
  assert.equal(model.formatTick(1.234, 0), '1s');
  assert.equal(model.formatTick(1.234, -1), '1s');
  assert.equal(model.formatTick(1.234, NaN), '1s');
});

test('layout packs touching intervals, separates overlaps and lanes without mutating input', () => {
  assert.equal(typeof model.layout, 'function');
  const items = [item('c', 2, 4), item('b', 0, 3), item('a', 0, 2), item('fx', 0, 4, 'video-effect'), item('sub', 0, 4, 'subtitle')];
  const before = JSON.stringify(items);
  const rows = model.layout(items, 4);
  assert.deepEqual(rows.map(r => r.lane), ['source', 'subtitle', 'visual', 'visual', 'video-effect']);
  assert.deepEqual(rows[2].items.map(i => i.editId), ['a', 'c']);
  assert.deepEqual(rows[3].items.map(i => i.editId), ['b']);
  assert.deepEqual(model.layout([...items].reverse(), 4), rows);
  assert.equal(JSON.stringify(items), before);
});
test('empty media has no rows; valid media always includes one source and no empty lanes', () => {
  assert.equal(typeof model.layout, 'function');
  assert.deepEqual(model.layout([], 0), []);
  assert.deepEqual(model.layout([], NaN), []);
  assert.equal(model.layout([], 9).length, 1);
  assert.deepEqual(model.layout([], 9)[0].items[0].range, { start: 0, end: 9 });
});
test('zoom and scrolled coordinates preserve seconds and clamp ends', () => {
  assert.equal(typeof model.contentWidth, 'function');
  assert.equal(model.contentWidth(400, 8, 1), 400);
  assert.equal(model.contentWidth(400, 8, 4), 1600);
  assert.equal(model.timeAt(250, 100, 200, 800, 8), 3.5);
  assert.equal(model.timeAt(0, 100, 0, 800, 8), 0);
  assert.equal(model.timeAt(1000, 100, 200, 800, 8), 8);
  assert.equal(model.timeAt(0, 0, 0, 0, 0), 0);
});
test('zoom anchors visible playhead or viewport center and fit resets scroll', () => {
  assert.equal(typeof model.zoomScroll, 'function');
  assert.equal(model.zoomScroll(800, 1600, 200, 400, 3, 8), 500);
  assert.equal(model.zoomScroll(800, 1600, 200, 400, 0, 8), 600);
  assert.equal(model.zoomScroll(1600, 400, 600, 400, 3, 8), 0);
});
