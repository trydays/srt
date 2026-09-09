const test = require('node:test');
const assert = require('node:assert/strict');
const { createCapabilityRegistry, createGroupRegistration, createNoiseRegistration,
  createVignetteRegistration, createTransformRegistration, createShapeRegistration,
  createSubtitleRegistration } = require('../src/edit-capabilities');

test('validates canonical texture steps and preserves source-effect order', () => {
  const recipe = validateRenderRecipe({ version: 1, steps: [
    { capability: 'video.noise@1', range: { start: 0, end: 2 }, params: { amount: 0.5 } },
    { capability: 'video.vignette@1', range: { start: 1, end: 3 }, params: { strength: 1 } }
  ] });
  assert.deepEqual(recipe.steps.map(step => step.capability), ['video.noise@1', 'video.vignette@1']);
  assert.ok(Object.isFrozen(recipe.steps[0].params));
  for (const step of [
    { capability: 'video.noise@1', range: { start: 0, end: 2 }, params: { amount: 1, seed: 2 } },
    { capability: 'video.vignette@1', range: { start: 0, end: 2 }, params: { strength: NaN } },
    { capability: 'video.noise@1', range: { start: 2, end: 2 }, params: { amount: 1 } }
  ]) assert.throws(() => validateRenderRecipe({ version: 1, steps: [step] }), { code: 'EXPORT_INVALID_RECIPE' });
});

test('builds texture render steps with explicit and enabled default registries', () => {
  const graph = { nodes: [
    { type: 'source.video@1' },
    { id: 'n', type: 'video.noise@1', range: { start: 0, end: 2 }, props: { amount: 0.4 } },
    { id: 'v', type: 'video.vignette@1', range: { start: 0, end: 2 }, props: { strength: 0.6 } }
  ] };
  const registry = createCapabilityRegistry([createNoiseRegistration(), createVignetteRegistration()]);
  assert.deepEqual(buildRenderRecipe(graph, registry).steps.map(step => step.capability),
    ['video.noise@1', 'video.vignette@1']);
  assert.deepEqual(buildRenderRecipe(graph, createCapabilityRegistry()).steps.map(step => step.capability),
    ['video.noise@1', 'video.vignette@1']);
});

test('render recipes retain texture-transform order before visuals and a single subtitle', () => {
  const registry = createCapabilityRegistry([createNoiseRegistration(), createVignetteRegistration(),
    createTransformRegistration(), createShapeRegistration(), createSubtitleRegistration()]);
  for (const sources of [
    [{ type: 'video.noise@1', props: { amount: .4 } },
      { type: 'video.transform@1', props: { flipHorizontal: true, flipVertical: false, scale: 1 } }],
    [{ type: 'video.transform@1', props: { flipHorizontal: false, flipVertical: true, scale: 1 } },
      { type: 'video.vignette@1', props: { strength: .7 } }]
  ]) {
    const nodes = [{ type: 'source.video@1' }, ...sources.map((node, index) => ({
      id: `source-${index}`, range: { start: 0, end: 4 }, ...node
    })), {
      id: 'shape', type: 'visual.shape@1', range: { start: 0, end: 4 },
      props: { x: .1, y: .1, width: .2, height: .2, color: '#000000' }
    }, {
      id: 'subtitle', type: 'visual.subtitle@1', props: {
        segments: [{ id: 's', start: 1, end: 2, text: 'top' }]
      }
    }];
    assert.deepEqual(buildRenderRecipe({ nodes }, registry).steps.map(step => step.capability), [
      ...sources.map(node => node.type), 'visual.shape@1', 'subtitle.burn@1'
    ]);
  }
});
const { normalizeParams: normalizeGroup } = require('../src/visual-group');
const {
  buildSubtitleRecipe,
  buildRenderRecipe,
  validateRenderRecipe,
  SUBTITLE_STYLE
} = require('../src/render-recipe');

function subtitleGraph() {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    documentRevision: 2,
    duration: 4,
    nodes: [{
      id: 'node-main-video', type: 'source.video@1', range: { start: 0, end: 4 },
      inputs: [], props: { assetId: 'asset-1' }
    }, {
      id: 'node-edit-1', type: 'visual.subtitle@1', range: { start: 0, end: 4 },
      inputs: [{ port: 'base', nodeId: 'node-main-video' }],
      props: {
        segments: [{ id: 's1', start: 0.2, end: 1.4, text: '大家好' }],
        style: SUBTITLE_STYLE
      }
    }],
    outputs: {
      video: { nodeId: 'node-edit-1', port: 'video' },
      audio: { nodeId: 'node-main-video', port: 'audio' }
    }
  };
}

test('builds an independent applied-subtitle snapshot', () => {
  const applied = [{ id: 's1', start: 0.2, end: 1.4, text: '大家好' }];
  const recipe = buildSubtitleRecipe(applied);
  applied[0].text = '后来的草稿';
  assert.equal(recipe.steps[0].params.segments[0].text, '大家好');
});

test('builds export steps from the graph registration adapter', () => {
  const graph = subtitleGraph();
  let exportedNode;
  const registry = {
    forNodeType(type) {
      assert.equal(type, 'visual.subtitle@1');
      return {
        toExport(node) {
          exportedNode = node;
          return {
            capability: 'subtitle.burn@1',
            params: { segments: node.props.segments }
          };
        }
      };
    }
  };
  const recipe = buildRenderRecipe(graph, registry);
  assert.equal(exportedNode, graph.nodes[1]);
  assert.deepEqual(recipe, {
    version: 1,
    steps: [{
      capability: 'subtitle.burn@1',
      params: { segments: [{ id: 's1', start: 0.2, end: 1.4, text: '大家好' }] }
    }]
  });
  graph.nodes[1].props.segments[0].text = '后改';
  assert.equal(recipe.steps[0].params.segments[0].text, '大家好');
});

test('rejects source-only and unknown graph nodes through the export boundary', () => {
  const graph = subtitleGraph();
  const registry = { forNodeType() { return null; } };
  assert.throws(() => buildRenderRecipe(graph, registry), {
    code: 'EXPORT_UNSUPPORTED_OPERATION'
  });

  graph.nodes.pop();
  graph.outputs.video.nodeId = 'node-main-video';
  assert.throws(() => buildRenderRecipe(graph, registry), {
    code: 'EXPORT_INVALID_RECIPE'
  });
});

test('exports the fixed subtitle style', () => {
  assert.deepEqual(SUBTITLE_STYLE, {
    fontFamily: 'Heiti SC',
    fontSize: 16,
    referenceWidth: 800,
    referenceHeight: 450,
    bottomPercent: 7,
    maxWidthPercent: 84,
    textColor: '#FFFFFF',
    backgroundColor: '#000000',
    backgroundOpacity: 0.72
  });
});

test('rejects empty and unknown recipes', () => {
  assert.throws(() => validateRenderRecipe({ version: 1, steps: [] }),
    { code: 'EXPORT_INVALID_RECIPE' });
  assert.throws(() => buildSubtitleRecipe([]), { code: 'EXPORT_INVALID_RECIPE' });
  assert.throws(() => validateRenderRecipe({
    version: 1,
    steps: [{
      capability: 'subtitle.burn@2',
      params: { segments: [{ id: 's1', start: 0, end: 1, text: '原文' }] }
    }]
  }), { code: 'EXPORT_UNSUPPORTED_OPERATION' });
});

test('rejects non-string capabilities as invalid recipes', () => {
  for (const capability of [null, 1]) {
    assert.throws(() => validateRenderRecipe({
      version: 1,
      steps: [{
        capability,
        params: { segments: [{ id: 's1', start: 0, end: 1, text: '原文' }] }
      }]
    }), { code: 'EXPORT_INVALID_RECIPE' });
  }
});

test('rejects invalid timing, blank text and executable fields', () => {
  assert.throws(() => buildSubtitleRecipe([
    { id: 's1', start: 1, end: 1, text: '原文' }
  ]), { code: 'EXPORT_INVALID_RECIPE' });
  assert.throws(() => buildSubtitleRecipe([
    { id: 's1', start: 0, end: 1, text: '   ' }
  ]), { code: 'EXPORT_INVALID_RECIPE' });
  for (const field of ['command', 'args', 'script']) {
    const step = {
      capability: 'subtitle.burn@1',
      params: { segments: [{ id: 's1', start: 0, end: 1, text: '原文' }] },
      [field]: 'not allowed'
    };
    assert.throws(() => validateRenderRecipe({ version: 1, steps: [step] }),
      { code: 'EXPORT_INVALID_RECIPE' });
  }
});

function colorStep() {
  return {
    capability: 'video.color.adjust@1', range: { start: 1, end: 3 },
    params: { temperature: -0.8, brightness: 0.25, saturation: 1, contrast: 1 }
  };
}

for (const withSubtitle of [false, true]) {
  test(`builds defensive frozen color graph snapshots with subtitle=${withSubtitle}`, () => {
    const graph = subtitleGraph();
    if (!withSubtitle) graph.nodes.pop();
    const first = colorStep();
    const second = colorStep();
    second.params.temperature = 0.5;
    const colors = [first, second].map((step, index) => ({
      id: `color-${index}`, type: 'video.color@1', range: step.range,
      inputs: [], props: step.params
    }));
    graph.nodes.splice(1, 0, ...colors);
    const recipe = buildRenderRecipe(graph, createCapabilityRegistry());
    assert.deepEqual(recipe.steps.slice(0, 2), [first, second]);
    assert.equal(recipe.steps.length, withSubtitle ? 3 : 2);
    if (withSubtitle) assert.equal(recipe.steps[2].capability, 'subtitle.burn@1');
    colors[0].range.start = 2;
    colors[0].props.temperature = 1;
    assert.equal(recipe.steps[0].range.start, 1);
    assert.equal(recipe.steps[0].params.temperature, -0.8);
    function assertFrozen(value) {
      if (!value || typeof value !== 'object') return;
      assert.ok(Object.isFrozen(value));
      Object.values(value).forEach(assertFrozen);
    }
    assertFrozen(recipe);
  });
}

test('rejects invalid color ranges, incomplete parameters and executable fields', () => {
  const invalid = [];
  for (const range of [null, { start: 1, end: 1 }, { start: -1, end: 3 },
    { start: 1, end: Infinity }, { start: NaN, end: 3 }, { start: '1', end: 3 },
    { start: 1, end: 3, filter: 'movie=evil' }]) {
    invalid.push({ ...colorStep(), range });
  }
  for (const [name, values] of Object.entries({
    temperature: [-1.01, 1.01, NaN, Infinity, '0'], brightness: [-1.01, 1.01],
    saturation: [-0.01, 2.01], contrast: [-0.01, 2.01]
  })) {
    for (const value of values) {
      const step = colorStep();
      step.params[name] = value;
      invalid.push(step);
    }
  }
  const missing = colorStep();
  delete missing.params.contrast;
  invalid.push(missing);
  for (const field of ['command', 'args', 'script', 'filter', 'path']) {
    invalid.push({ ...colorStep(), [field]: 'movie=evil' });
    const step = colorStep();
    step.params[field] = 'movie=evil';
    invalid.push(step);
  }
  for (const step of invalid) {
    assert.throws(() => validateRenderRecipe({ version: 1, steps: [step] }),
      { code: 'EXPORT_INVALID_RECIPE' });
  }
});

test('accepts color parameter boundaries and rejects unregistered color capabilities', () => {
  for (const params of [
    { temperature: -1, brightness: -1, saturation: 0, contrast: 0 },
    { temperature: 1, brightness: 1, saturation: 2, contrast: 2 }
  ]) {
    const step = { ...colorStep(), params };
    assert.deepEqual(validateRenderRecipe({ version: 1, steps: [step] }).steps[0], step);
  }
  assert.throws(() => validateRenderRecipe({
    version: 1, steps: [{ ...colorStep(), capability: 'video.color.adjust@2' }]
  }), { code: 'EXPORT_UNSUPPORTED_OPERATION' });
});

test('rejects duplicate subtitles and colors placed after subtitles', () => {
  const subtitle = buildSubtitleRecipe([{ id: 's1', start: 0, end: 1, text: '字幕' }]).steps[0];
  for (const steps of [[subtitle, subtitle], [subtitle, colorStep()]]) {
    assert.throws(() => validateRenderRecipe({ version: 1, steps }),
      { code: 'EXPORT_INVALID_RECIPE' });
  }
});

test('rejects sparse step arrays instead of producing an empty filter chain', () => {
  for (const steps of [Array(1), [colorStep(), ,]]) {
    assert.throws(() => validateRenderRecipe({ version: 1, steps }),
      { code: 'EXPORT_INVALID_RECIPE' });
  }
});

test('accepts exact frozen layers between source effects and subtitles', () => {
  const subtitle=buildSubtitleRecipe([{id:'s',start:0,end:1,text:'字幕'}]).steps[0];
  const shape={capability:'visual.shape@1',range:{start:1,end:3},params:{x:.1,y:.1,width:.4,height:.25,color:'#000000'}};
  const text={capability:'visual.text@1',range:{start:1,end:3},params:{text:'重点',x:.12,y:.12,fontSize:.08,color:'#FFFFFF'}};
  const recipe=validateRenderRecipe({version:1,steps:[colorStep(),shape,text,subtitle]});
  assert.deepEqual(recipe.steps,[colorStep(),shape,text,subtitle]); assert.ok(Object.isFrozen(recipe.steps[1].params));
  const neutralStyle = { ...shape, params: { ...shape.params, cornerRadius: 0,
    borderWidth: 0, borderColor: '#FFFFFF', fillOpacity: 1 } };
  assert.deepEqual(validateRenderRecipe({ version: 1, steps: [neutralStyle] }).steps[0], neutralStyle);
  const missingOriginal = { ...neutralStyle, params: { ...neutralStyle.params } };
  delete missingOriginal.params.color;
  assert.throws(() => validateRenderRecipe({ version: 1, steps: [missingOriginal] }),
    { code: 'EXPORT_INVALID_RECIPE' });
  assert.throws(()=>validateRenderRecipe({version:1,steps:[text,colorStep()]}),{code:'EXPORT_INVALID_RECIPE'});
  assert.throws(()=>validateRenderRecipe({version:1,steps:[subtitle,shape]}),{code:'EXPORT_INVALID_RECIPE'});
  assert.throws(()=>validateRenderRecipe({version:1,steps:[{...text,params:{...text.params,path:'/tmp/x'}}]}),{code:'EXPORT_INVALID_RECIPE'});
});

test('accepts a frozen group whose shape child predates neutral style fields', () => {
  const group = groupStep();
  for (const name of ['cornerRadius', 'borderWidth', 'borderColor', 'fillOpacity']) {
    delete group.params.layers[0].params[name];
  }
  const validated = validateRenderRecipe({ version: 1, steps: [group] });
  assert.deepEqual(validated.steps[0].params.layers[0].params, {
    ...group.params.layers[0].params, cornerRadius: 0, borderWidth: 0,
    borderColor: '#FFFFFF', fillOpacity: 1
  });
});

function groupStep() {
  return {
    capability: 'visual.group@1',
    range: { start: 1, end: 3 },
    params: normalizeGroup({
      layers: [
        { kind: 'shape', params: { width: .4 } },
        { kind: 'text', params: { text: '重点' } }
      ],
      opacity: { keyframes: [
        { time: 0, value: 0 },
        { time: 1, value: 1, easing: 'ease-out' }
      ] }
    }, 2)
  };
}

test('accepts only canonical complete group params and deeply freezes them', () => {
  const group = groupStep();
  const recipe = validateRenderRecipe({ version: 1, steps: [group] });
  assert.deepEqual(recipe.steps[0], group);
  function assertFrozen(value) {
    if (!value || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value));
    Object.values(value).forEach(assertFrozen);
  }
  assertFrozen(recipe);

  const missingDefault = structuredClone(group);
  delete missingDefault.params.pivotX;
  const missingChildDefault = structuredClone(group);
  delete missingChildDefault.params.layers[0].params.x;
  const missingEasing = structuredClone(group);
  delete missingEasing.params.opacity.keyframes[0].easing;
  const extra = structuredClone(group);
  extra.params.layers[1].constructor = 'no';
  for (const step of [missingDefault, missingChildDefault, missingEasing, extra]) {
    assert.throws(() => validateRenderRecipe({ version: 1, steps: [step] }),
      { code: 'EXPORT_INVALID_RECIPE' });
  }
});

test('builds a defensive group recipe through a custom graph registration', () => {
  const step = groupStep();
  const graph = {
    schemaVersion: 1, projectId: 'p', documentRevision: 1, duration: 4,
    nodes: [
      { id: 'node-main-video', type: 'source.video@1', range: { start: 0, end: 4 },
        inputs: [], props: { assetId: 'asset' } },
      { id: 'node-group', type: 'visual.group@1', range: step.range,
        inputs: [{ port: 'base', nodeId: 'node-main-video' }], props: step.params }
    ],
    outputs: { video: { nodeId: 'node-group', port: 'video' },
      audio: { nodeId: 'node-main-video', port: 'audio' } }
  };
  const recipe = buildRenderRecipe(graph,
    createCapabilityRegistry([createGroupRegistration()]));
  assert.deepEqual(recipe.steps, [step]);
  graph.nodes[1].props.layers[0].params.width = .8;
  assert.equal(recipe.steps[0].params.layers[0].params.width, .4);
});
