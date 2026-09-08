const test = require('node:test');
const assert = require('node:assert/strict');

const group = require('../src/visual-group');

function params(extra = {}) {
  return {
    layers: [
      { kind: 'shape', params: { x: .1, y: .1, width: .3, height: .2, color: '#112233' } },
      { kind: 'text', params: { text: '标题', x: .2, y: .3, fontSize: .1, color: '#FFFFFF' } }
    ],
    ...extra
  };
}

test('canonicalizes one flat ordered group with shared defaults and animations', () => {
  const input = params({ opacity: { keyframes: [
    { time: 0, value: 0 }, { time: 1, value: 1, easing: 'ease-out' }
  ] } });
  const canonical = group.normalizeParams(input, 2);
  assert.deepEqual(canonical, {
    layers: input.layers,
    pivotX: .5,
    pivotY: .5,
    opacity: { keyframes: [
      { time: 0, value: 0, easing: 'linear' },
      { time: 1, value: 1, easing: 'ease-out' }
    ] },
    scale: 1
  });
  assert.notEqual(canonical.layers, input.layers);
  assert.notEqual(canonical.layers[0].params, input.layers[0].params);
});

test('rejects oversized, nested, malformed or executable flat groups', () => {
  const invalid = [
    {},
    { layers: [] },
    { layers: Array.from({ length: 17 }, () => params().layers[0]) },
    { layers: [{ kind: 'group', params: {} }] },
    { layers: [{ kind: 'shape', params: { color: 'red' } }] },
    { layers: [{ kind: 'text', params: { text: 'x\u0000y' } }] },
    { layers: [{ kind: 'text', params: { text: '   ' } }] },
    { layers: [{ kind: 'text', params: { text: 'x' }, range: { start: 0, end: 1 } }] },
    { layers: [{ kind: 'shape', params: {}, animation: {} }] },
    params({ constructor: 'not allowed' }),
    params({ pivotX: .5, path: '/tmp/x' }),
    params({ opacity: '1' }),
    params({ scale: 2.01 }),
    params({ opacity: { keyframes: [{ time: 0, value: 0 }, { time: 3, value: 1 }] } })
  ];
  for (const value of invalid) {
    assert.throws(() => group.normalizeParams(value, 2), { code: 'VISUAL_GROUP_INVALID' });
  }
});

test('samples half-open ranges using group-relative time and integer pivot geometry', () => {
  const canonical = group.normalizeParams(params({ pivotX: .25, pivotY: .75,
    opacity: { keyframes: [{ time: 0, value: 0 }, { time: 2, value: 1 }] },
    scale: .5 }), 3);
  assert.equal(group.sample(canonical, { start: 1, end: 4 }, .999, 100, 80), null);
  assert.equal(group.sample(canonical, { start: 1, end: 4 }, 4, 100, 80), null);
  assert.deepEqual(group.sample(canonical, { start: 1, end: 4 }, 2, 100, 80), {
    opacity: .5, scale: .5, x: 13, y: 30, width: 50, height: 40
  });
  const zero = group.normalizeParams(params({ opacity: 0, scale: 0 }), 3);
  assert.deepEqual(group.sample(zero, { start: 1, end: 4 }, 1, 100, 80), {
    opacity: 0, scale: 0, x: 50, y: 40, width: 1, height: 1
  });
});

test('draws children on scratch then applies group opacity once on destination', () => {
  const events = [];
  const scratch = {
    save() { events.push(['scratch-save']); },
    restore() { events.push(['scratch-restore']); },
    clearRect(...args) { events.push(['scratch-clear', ...args]); },
    fillRect(...args) { events.push(['scratch-fillRect', ...args]); },
    fillText(...args) { events.push(['scratch-fillText', ...args]); }
  };
  const surface = { width: 100, height: 80, getContext(kind) {
    assert.equal(kind, '2d'); return scratch;
  } };
  const destination = {
    save() { events.push(['destination-save']); },
    restore() { events.push(['destination-restore']); },
    drawImage(...args) { events.push(['destination-drawImage', ...args]); }
  };
  Object.defineProperty(destination, 'globalAlpha', {
    set(value) { events.push(['destination-alpha', value]); }
  });
  const canonical = group.normalizeParams(params(), 3);
  const frame = { opacity: .4, scale: .5, x: 13, y: 30, width: 50, height: 40 };
  group.draw(destination, surface, canonical, frame, 100, 80);
  assert.deepEqual(events.filter(event => event[0] === 'scratch-fillRect'),
    [['scratch-fillRect', 10, 8, 30, 16]]);
  assert.deepEqual(events.filter(event => event[0] === 'scratch-fillText'),
    [['scratch-fillText', '标题', 20, 32]]);
  assert.deepEqual(events.filter(event => event[0] === 'destination-alpha'),
    [['destination-alpha', .4]]);
  assert.deepEqual(events.filter(event => event[0] === 'destination-drawImage'),
    [['destination-drawImage', surface, 13, 30, 50, 40]]);
  assert.ok(events.findIndex(event => event[0] === 'scratch-fillText') <
    events.findIndex(event => event[0] === 'destination-drawImage'));
});

test('opacity zero or scale zero contributes no destination pixels', () => {
  let draws = 0;
  const destination = { save() {}, restore() {}, drawImage() { draws += 1; } };
  const scratch = { save() {}, restore() {}, clearRect() {}, fillRect() {}, fillText() {} };
  const surface = { width: 10, height: 10, getContext() { return scratch; } };
  const canonical = group.normalizeParams(params(), 1);
  group.draw(destination, surface, canonical,
    { opacity: 0, scale: 1, x: 0, y: 0, width: 10, height: 10 }, 10, 10);
  group.draw(destination, surface, canonical,
    { opacity: 1, scale: 0, x: 5, y: 5, width: 1, height: 1 }, 10, 10);
  assert.equal(draws, 0);
});
