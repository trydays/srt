const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const layers = require('../src/visual-layers');
const capabilities = require('../src/edit-capabilities');

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

function controllerHarness({ animationFrames = false } = {}) {
  const pending = new Map(); let next = 0;
  const handlers = {};
  const context = { clearRect() {}, save() {}, restore() {}, fillRect() {}, fillText() {} };
  const canvas = { width: 0, height: 0, hidden: true, getContext: () => context };
  const video = {
    videoWidth: 96, videoHeight: 64, readyState: 2, currentTime: 0,
    paused: true, ended: false, seeking: false,
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    emit(type) { (handlers[type] || []).forEach(fn => fn()); },
    requestVideoFrameCallback(fn) { pending.set(++next, fn); return next; },
    cancelVideoFrameCallback(id) { pending.delete(id); }
  };
  if (animationFrames) {
    delete video.requestVideoFrameCallback;
    delete video.cancelVideoFrameCallback;
  }
  const windowHandlers = {};
  const graph = { nodes: [{ type: 'source.video@1' }, {
    type: 'visual.shape@1', range: { start: 1, end: 3 },
    props: { x: .1, y: .1, width: .4, height: .25, color: '#112233' }
  }] };
  let snapshot = { document: { timeline: { canvas: { width: 96, height: 64 } } }, graph };
  const document = { getElementById: id => ({ previewVideo: video, previewLayerCanvas: canvas }[id]) };
  const window = {
    document, SRTVisualLayers: layers, editCapabilityRegistry: capabilities.createCapabilityRegistry(),
    projectEditingState: 'ready', projectVideoLoading: false,
    projectEditing: { load: () => snapshot }, projectEditingReady: new Promise(() => {}),
    addEventListener(type, fn) { (windowHandlers[type] ||= []).push(fn); },
    emit(type) { (windowHandlers[type] || []).forEach(fn => fn()); },
    requestAnimationFrame(fn) { pending.set(++next, fn); return next; },
    cancelAnimationFrame(id) { pending.delete(id); }
  };
  const sandbox = vm.createContext({ window, document, getActiveProjectId: () => 'project' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/editor-layer-preview.js'), 'utf8'), sandbox);
  return {
    window, video, canvas, pending,
    setSnapshot(value) { snapshot = value; },
    frame(time) {
      const entry = pending.entries().next().value;
      assert.ok(entry, 'expected one scheduled frame');
      pending.delete(entry[0]);
      if (animationFrames) entry[1](); else entry[1](0, { mediaTime: time });
    }
  };
}

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

test('decoded playback ignores timeupdate timestamps between decoded frames', () => {
  const h = controllerHarness();
  h.video.paused = false;
  h.video.emit('play');
  assert.equal(h.pending.size, 1);
  h.frame(.99);
  assert.equal(h.canvas.hidden, true);
  assert.equal(h.pending.size, 1);

  h.video.currentTime = 1.01;
  h.window.layerPreviewController.render();
  assert.equal(h.canvas.hidden, true, 'public refresh must retain the last decoded timestamp during playback');
  h.video.emit('timeupdate');
  assert.equal(h.canvas.hidden, true, 'only the next decoded mediaTime may reveal the layer');
  assert.equal(h.pending.size, 1, 'timeupdate must not create a second decoded callback');
  h.frame(1.01);
  assert.equal(h.canvas.hidden, false);
});

test('seeking suppresses redraw and scheduling until seeked in decoded and fallback modes', () => {
  for (const animationFrames of [false, true]) {
    const h = controllerHarness({ animationFrames });
    h.video.paused = false;
    h.video.emit('play');
    assert.equal(h.pending.size, 1);
    h.video.seeking = true;
    h.video.emit('seeking');
    assert.equal(h.canvas.hidden, true);
    assert.equal(h.pending.size, 0);

    h.video.currentTime = 2;
    h.video.emit('timeupdate');
    assert.equal(h.canvas.hidden, true);
    assert.equal(h.pending.size, 0, 'seeking timeupdate must not restart either scheduler');

    h.video.seeking = false;
    h.video.emit('seeked');
    assert.equal(h.pending.size, 1);
    if (animationFrames) {
      assert.equal(h.canvas.hidden, false);
    } else {
      assert.equal(h.canvas.hidden, true, 'decoded playback waits for the post-seek frame');
      h.frame(2);
      assert.equal(h.canvas.hidden, false);
      assert.equal(h.pending.size, 1);
    }
    h.video.emit('loadstart');
    assert.equal(h.pending.size, 0);
    h.setSnapshot({ ...h.window.projectEditing.load(), graph: { nodes: [{ type: 'source.video@1' }] } });
    h.window.emit('project-edit-state-changed');
    assert.equal(h.canvas.hidden, true);
  }
});
