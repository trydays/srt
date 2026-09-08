const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const capabilities = require('../src/edit-capabilities');

// Only browser surfaces are doubled: the controller, registry, geometry and
// color matrices are the actual product modules. Real pixels live in E2E.
function harness(options = {}) {
  const created = [], pending = new Map(); let next = 0;
  function element(tag) {
    const handlers = {};
    const el = { tag, style: {}, hidden: true, children: [], width: 0, height: 0,
      setAttribute(k, v) { this[k] = v; }, appendChild(child) { this.children.push(child); },
      replaceChildren() { this.children = []; },
      addEventListener(k, fn) { (handlers[k] ||= []).push(fn); },
      removeEventListener(k, fn) { handlers[k] = (handlers[k] || []).filter(f => f !== fn); },
      emit(k) { (handlers[k] || []).forEach(fn => fn()); }
    };
    if (tag === 'canvas') {
      const calls = [];
      const ctx = { calls, save() {}, restore() {}, clearRect() {}, fillRect() {},
        translate(...args) { calls.push(['translate', ...args]); }, scale(...args) { calls.push(['scale', ...args]); },
        drawImage(...args) { calls.push(['draw', ...args]); } };
      el.getContext = () => ctx; created.push(el);
    }
    return el;
  }
  const video = Object.assign(element('video'), { videoWidth: 96, videoHeight: 64,
    readyState: 2, currentTime: 0, paused: true, ended: false,
    requestVideoFrameCallback(fn) { pending.set(++next, fn); return next; },
    cancelVideoFrameCallback(id) { pending.delete(id); }
  });
  if (options.animationFrames) {
    delete video.requestVideoFrameCallback; delete video.cancelVideoFrameCallback;
  }
  const canvas = element('canvas'), filter = element('filter');
  filter.parentNode = element('defs');
  const document = { getElementById: id => ({ previewVideo: video, previewSourceCanvas: canvas,
    previewColorFilter: filter }[id]), createElement: element, createElementNS: (_ns, tag) => element(tag) };
  let snapshot = { document: { revision: 1, timeline: { canvas: { width: 96, height: 64 } } },
    graph: { nodes: [{ type: 'source.video@1' }, { type: 'video.transform@1',
      range: { start: 1, end: 3 }, props: { flipHorizontal: true, scale: 1.25 } }] } };
  const window = Object.assign(element('window'), { document, projectEditingState: 'ready',
    projectEditing: { load: () => snapshot }, projectEditingReady: Promise.resolve(),
    editCapabilityRegistry: capabilities.createCapabilityRegistry(),
    SRTVideoTransform: require('../src/video-transform'), SRTColorAdjustment: require('../src/color-adjustment'),
    requestAnimationFrame(fn) { pending.set(++next, fn); return next; }, cancelAnimationFrame(id) { pending.delete(id); }
  });
  const context = vm.createContext({ window, document, getActiveProjectId: () => 'project' });
  for (const file of ['editor-color-preview.js', 'editor-source-preview.js']) {
    const filename = path.join(__dirname, '../app', file);
    if (fs.existsSync(filename)) vm.runInContext(fs.readFileSync(filename, 'utf8'), context);
  }
  return { window, video, canvas, created, pending, setSnapshot(value) { snapshot = value; }, snapshot,
    frame(time) { const [id, fn] = pending.entries().next().value; pending.delete(id); fn(0, { mediaTime: time }); } };
}

test('transform preview uses decoded frame mediaTime and exactly one cancellable loop', () => {
  const h = harness();
  assert.ok(h.window.sourcePreviewController, 'the source compositor must be installed');
  h.video.paused = false; h.video.emit('play'); h.video.emit('play');
  assert.equal(h.pending.size, 1);
  h.frame(1);
  assert.equal(h.canvas.hidden, false);
  assert.ok(h.created.some(c => c.getContext().calls.some(call => call[0] === 'scale' && call[1] === -1)));
  assert.equal(h.pending.size, 1);
  h.video.paused = true; h.video.emit('pause');
  assert.equal(h.pending.size, 0);
  h.video.paused = false; h.video.emit('play');
  h.window.emit('pagehide'); assert.equal(h.pending.size, 0);
  h.video.emit('timeupdate'); assert.equal(h.pending.size, 0);
});

test('undo and source loading clear stale frames; seeks reuse only two intrinsic buffers', () => {
  const h = harness();
  assert.ok(h.window.sourcePreviewController, 'the source compositor must be installed');
  h.video.currentTime = 2; h.window.colorPreviewController.render();
  assert.equal(h.canvas.hidden, false);
  for (let i = 0; i < 10; i++) h.video.emit('seeked');
  assert.equal(h.created.length, 3, 'one display canvas plus two reusable buffers');
  assert.ok(h.created.every(c => c.width === 96 && c.height === 64));
  h.video.emit('loadstart'); assert.equal(h.canvas.hidden, true);
  h.video.readyState = 0; h.video.emit('timeupdate'); assert.equal(h.canvas.hidden, true);
  h.video.readyState = 2; h.video.videoWidth = 64; h.video.videoHeight = 96; h.video.emit('loadeddata');
  assert.equal(h.canvas.hidden, false); assert.equal(h.canvas.width, 64); assert.equal(h.canvas.height, 96);
  h.setSnapshot({ ...h.snapshot, graph: { nodes: [{ type: 'source.video@1' }] } });
  h.window.emit('project-edit-state-changed'); assert.equal(h.canvas.hidden, true);
  assert.equal(h.video.style.filter, '');
});

test('animation-frame fallback stops after the last transform is undone, restoring pure-color SVG preview', () => {
  const h = harness({ animationFrames: true });
  const color = { id: 'color', type: 'video.color@1', range: { start: 1, end: 3 }, props: { brightness: 0.2 } };
  h.snapshot.graph.nodes.push(color);
  h.video.currentTime = 2; h.video.paused = false; h.video.emit('play');
  assert.equal(h.pending.size, 1); assert.equal(h.video.style.filter, '');
  h.frame(2); assert.equal(h.pending.size, 1);
  h.setSnapshot({ ...h.snapshot, graph: { nodes: [{ type: 'source.video@1' }, color] } });
  h.window.emit('project-edit-state-changed');
  assert.equal(h.pending.size, 0); assert.equal(h.canvas.hidden, true);
  assert.equal(h.video.style.filter, 'url(#previewColorFilter)');
});
