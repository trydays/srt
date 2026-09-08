const test = require('node:test');
const assert = require('node:assert/strict');
const { createCapabilityRegistry } = require('../src/edit-capabilities');
const { buildPrompt } = require('../src/instruction-capabilities');
const { validateRenderRecipe } = require('../src/render-recipe');

const step = (params = { flipHorizontal: true }, range = { start: 1, end: 3 }) =>
  ({ capability: 'video.transform@1', params, range });

test('catalog discovers typed transforms and snapshots explicit neutral and active params', () => {
  const registry = createCapabilityRegistry();
  assert.ok(registry.get('video.transform@1'));
  const transform = require('../src/video-transform');
  const recipe = { kind: 'instruction', steps: [step({ flipHorizontal: true, scale: 1.25 })] };
  assert.deepEqual(registry.validateRecipe(recipe), recipe);
  const normalized = registry.normalizeRecipe(recipe, { duration: 4 });
  recipe.steps[0].params.flipHorizontal = false;
  assert.equal(normalized.steps[0].params.flipHorizontal, true);
  assert.deepEqual(transform.normalizeParams({ flipVertical: true }, true),
    { flipHorizontal: false, flipVertical: true, scale: 1 });
  for (const params of [{ flipHorizontal: false }, { scale: 0.25 }, { scale: 4 }]) {
    assert.deepEqual(registry.validateRecipe({ kind: 'instruction', steps: [step(params)] }).steps[0].params, params);
  }
  assert.deepEqual(registry.normalizeRecipe({ kind: 'instruction', steps: [
    { capability: 'video.transform@1', params: { scale: 1 } }
  ] }, { duration: 4 }).steps[0].range, { start: 0, end: 4 });
});

test('rejects invalid transform parameters and project ranges', () => {
  const registry = createCapabilityRegistry();
  assert.ok(registry.get('video.transform@1'));
  const { normalizeParams } = require('../src/video-transform');
  for (const params of [{}, { flipHorizontal: 1 }, { flipVertical: 'false' },
    { scale: '1' }, { scale: NaN }, { scale: Infinity }, { scale: 0.249 }, { scale: 4.01 },
    { position: 1 }, { constructor: 1 }, { toString: true }]) {
    assert.throws(() => registry.validateRecipe({ kind: 'instruction', steps: [step(params)] }));
    assert.throws(() => normalizeParams(params, true), { code: 'RECIPE_INVALID_PARAM' });
  }
  for (const range of [{ start: -1, end: 2 }, { start: 2, end: 2 }, { start: 3, end: 2 },
    { start: 0, end: Infinity }, { start: 0, end: 4.0001 }, { start: '0', end: 2 }]) {
    assert.throws(() => registry.normalizeRecipe({ kind: 'instruction', steps: [step(undefined, range)] }, { duration: 4 }));
  }
});

test('shared frozen geometry uses rounded intrinsic pixels and deterministic centering', () => {
  assert.ok(createCapabilityRegistry().get('video.transform@1'));
  const { geometry } = require('../src/video-transform');
  const params = { scale: 0.5, flipHorizontal: true };
  const g = geometry(params, 47, 31);
  assert.deepEqual(g, { scaledWidth: 24, scaledHeight: 16, padWidth: 47, padHeight: 31,
    padX: 11, padY: 7, cropX: 0, cropY: 0, offsetX: 11, offsetY: 7,
    params: { flipHorizontal: true, flipVertical: false, scale: 0.5 } });
  assert.ok(Object.isFrozen(g) && Object.isFrozen(g.params));
  params.scale = 4;
  assert.equal(g.params.scale, 0.5);
  const enlarged = geometry({ scale: 1.25 }, 47, 31);
  assert.deepEqual([enlarged.scaledWidth, enlarged.scaledHeight, enlarged.cropX, enlarged.cropY,
    enlarged.offsetX, enlarged.offsetY], [59, 39, 6, 4, -6, -4]);
  for (const dims of [[0, 2], [-1, 2], [1.5, 2], [Infinity, 2]]) assert.throws(() => geometry({}, ...dims));
});

test('transform adapters revalidate persisted payloads and retain graph order and half-open time', async () => {
  const registration = createCapabilityRegistry().get('video.transform@1');
  assert.ok(registration);
  assert.deepEqual([registration.editMode, registration.graphStage, registration.editType, registration.nodeType],
    ['append', 'sourceEffect', 'video.transform.operation@1', 'video.transform@1']);
  assert.deepEqual(await registration.prepare(), {});
  const edit = { ...registration.toEdit({}, step()), id: 'flip', transactionId: 'request' };
  const node = registration.toGraph(edit, { videoHead: 'previous' });
  assert.deepEqual(node.inputs, [{ port: 'base', nodeId: 'previous' }]);
  assert.deepEqual(node.props, { flipHorizontal: true, flipVertical: false, scale: 1 });
  assert.throws(() => registration.toGraph({ ...edit, payload: { flipHorizontal: 'true' } }, { videoHead: 'previous' }));
  const timeline = registration.toTimeline(edit);
  assert.equal(timeline.lane, 'video-effect');
  assert.equal(timeline.label, '画面变换');
  assert.match(timeline.summary, /水平|横向/);
  const graph = { nodes: [node, { ...node, props: { scale: 0.5 } }] };
  assert.deepEqual(registration.preview(graph, 1).map(p => p.scale), [1, 0.5]);
  assert.deepEqual(registration.preview(graph, 3), []);
  assert.deepEqual(registration.toExport(node), step(node.props));
});

test('prompt describes booleans and carries true and false without undeclared context fields', () => {
  const prompt = buildPrompt('翻转', [], { operations: [step({ flipHorizontal: true,
    flipVertical: false, scale: 1.25, path: '/secret/movie', html: '<script>' })] });
  assert.match(prompt, /flipHorizontal.*type: boolean.*default: false/);
  assert.doesNotMatch(prompt, /undefined/);
  const context = prompt.split('当前编辑上下文：')[1];
  assert.ok(context);
  assert.match(context, /"flipHorizontal":true,"flipVertical":false,"scale":1.25/);
  assert.doesNotMatch(context, /secret|script|html/);
});

test('strict export accepts interleaved source effects only before a final subtitle and freezes snapshots', () => {
  const normalized = { flipHorizontal: true, flipVertical: false, scale: 1 };
  const transform = step(normalized);
  const color = { capability: 'video.color.adjust@1', range: { start: 0, end: 4 },
    params: { temperature: 0, brightness: 0.2, saturation: 1, contrast: 1 } };
  const subtitle = { capability: 'subtitle.burn@1', params: { segments: [{ id: 's', start: 0, end: 4, text: 'hello' }] } };
  const recipe = { version: 1, steps: [transform, color, transform, subtitle] };
  const snapshot = validateRenderRecipe(recipe);
  assert.deepEqual(snapshot, recipe);
  assert.ok(Object.isFrozen(snapshot.steps[0].params));
  normalized.scale = 2;
  assert.equal(snapshot.steps[0].params.scale, 1);
  for (const invalid of [{ ...transform, filter: 'hflip' }, step({ scale: 1 }),
    step({ ...normalized, flipHorizontal: 1 }), step({ ...normalized, extra: true }),
    { ...transform, range: { start: 3, end: 1 } }]) {
    assert.throws(() => validateRenderRecipe({ version: 1, steps: [invalid] }), { code: 'EXPORT_INVALID_RECIPE' });
  }
  assert.throws(() => validateRenderRecipe({ version: 1, steps: [subtitle, transform] }), { code: 'EXPORT_INVALID_RECIPE' });
});
