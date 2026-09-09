const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRenderGraphCompiler } = require('../src/render-graph');
const { normalizeParams } = require('../src/visual-group');
const { SUBTITLE_STYLE } = require('../src/render-recipe');

function fixture() {
  const document = {
    schemaVersion: 1, projectId: 'remotion-project', revision: 3,
    timeline: { duration: 4.01, canvas: { width: 320, height: 240 } },
    sources: [{ id: 'main-video', assetId: 'video', kind: 'video', range: { start: 0, end: 4.01 } }],
    edits: [{ id: 'group', transactionId: 'transaction', type: 'visual.group.layer@1',
      target: { kind: 'source', id: 'main-video' }, range: { start: 1, end: 3 }, order: 0, enabled: true,
      payload: normalizeParams({ layers: [
        { kind: 'shape', params: { x: .2, y: .25, width: .4, height: .4, color: '#E04020' } },
        { kind: 'text', params: { text: '动画标题\n第二行', x: .23, y: .28, fontSize: .08, color: '#FFFFFF' } }
      ], opacity: { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1, easing: 'back-out' }] },
      scale: { keyframes: [{ time: 0, value: .5 }, { time: 1, value: 1, easing: 'back-out' }] } }, 2) }]
  };
  return { document, graph: createRenderGraphCompiler().compile(document) };
}
const options = () => ({ fps: 20, assets: { video: { src: 'http://127.0.0.1:4178/session-token/video' } } });
const api = () => require('../src/remotion-input');

test('render input API exists', () => {
  assert.ok(fs.existsSync(require('node:path').join(__dirname, '../src/remotion-input.js')));
});
test('creates detached complete input without writing frame rate into v1', () => {
  const snapshot = fixture(), before = structuredClone(snapshot), settings = options();
  const input = api().createRenderInput(snapshot, settings);
  assert.deepEqual(input, { graph: snapshot.graph, width: 320, height: 240, fps: 20,
    durationInFrames: 81, assets: settings.assets });
  input.graph.nodes[1].props.layers[0].params.color = '#000000';
  input.assets.video.src = 'changed';
  assert.deepEqual(snapshot, before);
  assert.equal(settings.assets.video.src, options().assets.video.src);
  assert.equal(Object.hasOwn(snapshot.document.timeline, 'fps'), false);
});
test('rejects stale metadata and every graph mismatch including valid modified props', () => {
  for (const mutate of [s => s.graph.projectId = 'other', s => s.graph.documentRevision++,
    s => s.graph.duration = 5, s => s.graph.nodes[1].props.layers[0].params.color = '#000000',
    s => s.graph.outputs.video.nodeId = s.graph.nodes[0].id,
    s => s.projectId = 'other', s => s.revision = 2, s => s.duration = 9]) {
    const snapshot = fixture(); mutate(snapshot);
    assert.throws(() => api().createRenderInput(snapshot, options()));
  }
});
test('allows reordered object keys while requiring the complete matching graph', () => {
  const snapshot = fixture();
  snapshot.graph = Object.fromEntries(Object.entries(snapshot.graph).reverse());
  assert.equal(api().createRenderInput(snapshot, options()).durationInFrames, 81);
});
test('validates fps, integer canvas dimensions and safe frame count', () => {
  for (const fps of [0, -1, NaN, Infinity, '20', Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => api().createRenderInput(fixture(), { ...options(), fps }));
  }
  const snapshot = fixture(); snapshot.document.timeline.canvas.width = 320.5;
  assert.throws(() => api().createRenderInput(snapshot, options()));
});
test('requires source assets served by a trusted loopback HTTP session', () => {
  for (const src of ['https://example.com/v.mp4', 'file:///tmp/v.mp4', 'http://localhost:4178/a',
    'http://127.0.0.1.evil:4178/a', 'http://user:secret@127.0.0.1:4178/a', 'data:video/mp4;base64,a']) {
    assert.throws(() => api().createRenderInput(fixture(), { fps: 20, assets: { video: { src } } }));
  }
  assert.throws(() => api().createRenderInput(fixture(), { fps: 20, assets: {} }));
});
test('source only is supported; unknown node types fail selection and rendering', () => {
  const snapshot = fixture(); snapshot.document.edits = [];
  snapshot.graph = createRenderGraphCompiler().compile(snapshot.document);
  assert.equal(api().supportsGraph(snapshot.graph), true);
  assert.equal(api().supportsGraph(null), false);
  snapshot.document.edits = [{ ...fixture().document.edits[0], type: 'video.color.adjustment@1',
    payload: { temperature: .2, brightness: 0, saturation: 1, contrast: 1 } }];
  snapshot.graph = createRenderGraphCompiler().compile(snapshot.document);
  snapshot.graph.nodes[1].type = 'video.unsupported-test@1';
  assert.equal(api().supportsGraph(snapshot.graph), false);
  assert.throws(() => api().createRenderInput(snapshot, options()));
});
function visualFixture() {
  const snapshot = fixture(), base = snapshot.document.edits[0];
  snapshot.document.edits.push(
    { ...base, id: 'shape', type: 'visual.shape.layer@1', order: 1,
      payload: { x: .1, y: .1, width: .3, height: .15, color: '#000000' } },
    { ...base, id: 'text', type: 'visual.text.layer@1', order: 2,
      payload: { text: '独立文字\n第二行', x: .1, y: .1, fontSize: .05, color: '#FFFFFF' } },
    { ...base, id: 'subtitle', type: 'subtitle.track@1', order: 3,
      range: { start: 0, end: snapshot.document.timeline.duration },
      payload: { segments: [{ id: 'segment', start: 1, end: 2, text: '已应用字幕' }], style: { ...SUBTITLE_STYLE } } }
  );
  snapshot.graph = createRenderGraphCompiler().compile(snapshot.document);
  return snapshot;
}
test('admits standalone text, shape and applied subtitles with groups without changing the snapshot', () => {
  const snapshot = visualFixture(), before = structuredClone(snapshot);
  assert.equal(api().supportsGraph(snapshot.graph), true);
  const input = api().createRenderInput(snapshot, options());
  assert.deepEqual(input.graph.nodes.map(node => node.type), [
    'source.video@1', 'visual.group@1', 'visual.shape@1', 'visual.text@1', 'visual.subtitle@1'
  ]);
  assert.deepEqual(snapshot, before);
  input.graph.nodes.at(-1).props.segments[0].text = 'changed';
  assert.equal(snapshot.document.edits.at(-1).payload.segments[0].text, '已应用字幕');
});
test('all four enabled source effects join existing visuals in the same render input', () => {
  const snapshot = visualFixture();
  for (const [index, type, payload] of [
    [0, 'video.color.adjustment@1', { temperature: .2, brightness: 0, saturation: 1, contrast: 1 }],
    [1, 'video.transform.operation@1', { flipHorizontal: true, flipVertical: false, scale: .8 }],
    [2, 'video.noise.adjustment@1', { amount: .5 }],
    [3, 'video.vignette.adjustment@1', { strength: .4 }]
  ]) snapshot.document.edits.push({ ...snapshot.document.edits[0], id: 'effect-' + index, type, payload, order: index });
  snapshot.graph = createRenderGraphCompiler().compile(snapshot.document);
  assert.equal(api().supportsGraph(snapshot.graph), true);
  assert.deepEqual(api().createRenderInput(snapshot, options()).graph.nodes.map(node => node.type), [
    'source.video@1', 'video.color@1', 'video.transform@1', 'video.noise@1', 'video.vignette@1',
    'visual.group@1', 'visual.shape@1', 'visual.text@1', 'visual.subtitle@1'
  ]);
  snapshot.document.edits.at(-1).enabled = false;
  snapshot.graph = createRenderGraphCompiler().compile(snapshot.document);
  assert.equal(api().supportsGraph(snapshot.graph), true);
  assert.equal(api().createRenderInput(snapshot, options()).graph.nodes.some(node => node.type === 'video.vignette@1'), false);
});
test('R2 admission still rejects mismatched or malformed subtitle snapshots', () => {
  const snapshot = visualFixture();
  snapshot.graph.nodes.at(-1).props.segments[0].text = 'unapplied change';
  assert.throws(() => api().createRenderInput(snapshot, options()), { code: 'REMOTION_INPUT_INVALID' });
  const graph = visualFixture().graph;
  graph.nodes.at(-1).props.style.extra = true;
  assert.equal(api().supportsGraph(graph), false);
});
test('exposes the browser UMD input API', () => {
  const context = { window: { SRTRenderGraph: require('../src/render-graph'),
    SRTRemotionSupport: require('../src/remotion-support') }, URL };
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../src/remotion-input.js'), 'utf8'), context);
  assert.equal(typeof context.window.SRTRemotionInput.createRenderInput, 'function');
  assert.equal(typeof context.window.SRTRemotionInput.supportsGraph, 'function');
  assert.equal(context.window.SRTRemotionInput.supportsGraph(visualFixture().graph), true);
});
