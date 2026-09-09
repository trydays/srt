const test = require('node:test');
const assert = require('node:assert/strict');
const group = require('../src/visual-group');

test('reference animation uses valid existing group parameters and fades at its range boundaries', async () => {
  const { groupAnimation, WIDTH, HEIGHT } = await import('../previews/reference-effects/scenes.mjs');
  const range = { start: .35, end: 7.7 };
  const props = groupAnimation(range.start, range.end, .2, .4);
  assert.equal(group.sample(props, range, .2, WIDTH, HEIGHT), null);
  assert.equal(group.sample(props, range, .35, WIDTH, HEIGHT).opacity, 0);
  assert.equal(group.sample(props, range, 2, WIDTH, HEIGHT).opacity, 1);
  assert.ok(group.sample(props, range, 7.6, WIDTH, HEIGHT).opacity < 1);
  assert.equal(group.sample(props, range, 7.7, WIDTH, HEIGHT), null);
});
