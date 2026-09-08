const test = require('node:test');
const assert = require('node:assert/strict');
const layers = require('../src/visual-layers');

function loadPreview(registrations) {
  const modulePath = require.resolve('../app/editor-layer-preview');
  delete require.cache[modulePath];
  global.window = {
    SRTVisualLayers: layers,
    editCapabilityRegistry: { forNodeType(type) { return registrations[type]; } }
  };
  require(modulePath);
  return global.window.SRTLayerPreview;
}

test.afterEach(() => { delete global.window; });

test('drawGraph clears and draws active visual nodes in graph order', () => {
  const calls = [];
  const context = {
    clearRect: (...args) => calls.push(['clear', ...args]), save() {}, restore() {},
    fillRect: (...args) => calls.push(['rect', ...args]), fillText: (...args) => calls.push(['text', ...args])
  };
  const canvas = { width: 0, height: 0, hidden: true, getContext: () => context };
  const preview = loadPreview({
    'visual.shape@1': { preview: (_graph, time) => time >= 1 && time < 3 ? [{ x: .1, y: .1, width: .4, height: .25, color: '#112233' }] : [] },
    'visual.text@1': { preview: (_graph, time) => time >= 1 && time < 3 ? [{ text: '<b>literal</b>', x: .12, y: .12, fontSize: .08, color: '#FFFFFF' }] : [] }
  });
  const graph = { nodes: [{ type: 'visual.shape@1' }, { type: 'video.color@1' }, { type: 'visual.text@1' }] };

  assert.equal(preview.drawGraph(canvas, graph, 1, 100, 80), 2);
  assert.deepEqual(calls.filter(call => call[0] !== 'clear').map(call => call[0]), ['rect', 'text']);
  assert.deepEqual(calls[0], ['clear', 0, 0, 100, 80]);
  assert.equal(canvas.hidden, false);
  assert.equal(context.font, 'normal 6px Heiti SC');

  calls.length = 0;
  assert.equal(preview.drawGraph(canvas, graph, 3, 100, 80), 0);
  assert.deepEqual(calls, [['clear', 0, 0, 100, 80]]);
  assert.equal(canvas.hidden, true);
});

test('drawGraph updates intrinsic portrait dimensions and clips through the canvas', () => {
  const calls = [];
  const context = { clearRect() {}, save() {}, restore() {}, fillRect: (...args) => calls.push(args) };
  const canvas = { width: 16, height: 9, hidden: true, getContext: () => context };
  const preview = loadPreview({
    'visual.shape@1': { preview: () => [{ x: .75, y: .8, width: .25, height: .2, color: '#123456' }] }
  });
  preview.drawGraph(canvas, { nodes: [{ type: 'visual.shape@1' }] }, 2, 64, 96);
  assert.equal(canvas.width, 64); assert.equal(canvas.height, 96);
  assert.deepEqual(calls, [[48, 77, 16, 19]]);
});
