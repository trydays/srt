const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const {
  createCapabilityRegistry,
  createColorRegistration,
  createSubtitleRegistration,
  createShapeRegistration,
  createTextRegistration,
  createGroupRegistration,
  createNoiseRegistration,
  createVignetteRegistration,
  matchesParameterSchema,
  validateSubtitlePayload
} = require('../src/edit-capabilities');

test('texture registrations expose complete opt-in source-effect adapters', async () => {
  for (const [registration, expected] of [
    [createNoiseRegistration(), { id: 'video.noise@1', editType: 'video.noise.adjustment@1', nodeType: 'video.noise@1', label: '画面颗粒', key: 'amount' }],
    [createVignetteRegistration(), { id: 'video.vignette@1', editType: 'video.vignette.adjustment@1', nodeType: 'video.vignette@1', label: '画面暗角', key: 'strength' }]
  ]) {
    assert.equal(registration.definition.id, expected.id);
    assert.deepEqual(registration.definition.params.required, [expected.key]);
    assert.equal(registration.editType, expected.editType);
    assert.equal(registration.nodeType, expected.nodeType);
    assert.equal(registration.graphStage, 'sourceEffect');
    const step = { range: { start: 1, end: 2 }, params: { [expected.key]: 0.5 } };
    const edit = registration.toEdit(await registration.prepare(), step);
    edit.id = 'texture'; edit.transactionId = 'tx';
    const node = registration.toGraph(edit, { videoHead: 'source' });
    assert.deepEqual(registration.preview({ nodes: [node] }, 1.5), [{ [expected.key]: 0.5 }]);
    assert.deepEqual(registration.preview({ nodes: [node] }, 2), []);
    assert.equal(registration.toTimeline(edit).lane, 'video-effect');
    assert.equal(registration.toTimeline(edit).label, expected.label);
    assert.equal(registration.toExport(node).capability, expected.id);
  }
});

test('texture capabilities are enabled in the default registry and incomplete custom definitions are hidden', () => {
  assert.equal(createCapabilityRegistry().get('video.noise@1').nodeType, 'video.noise@1');
  assert.equal(createCapabilityRegistry().get('video.vignette@1').nodeType, 'video.vignette@1');
  for (const factory of [createNoiseRegistration, createVignetteRegistration]) {
    const complete = factory();
    for (const adapter of ['prepare', 'toEdit', 'toGraph', 'toTimeline']) {
      const broken = { ...complete }; delete broken[adapter];
      assert.deepEqual(createCapabilityRegistry([broken]).promptDefinitions(), []);
    }
  }
});
const { PARAMETER_SCHEMA } = require('../src/color-adjustment');
const { SUBTITLE_STYLE } = require('../src/render-recipe');

const mediaFacts = { duration: 8 };

test('exposes only registrations with every core adapter and routing metadata', function() {
  const complete = createSubtitleRegistration();
  const adapters = ['prepare', 'toEdit', 'toGraph', 'toTimeline'];

  assert.deepEqual(createCapabilityRegistry().promptDefinitions().map(function(item) {
    return item.id;
  }), ['subtitle.generate@1', 'video.color.adjust@1', 'video.transform@1', 'video.noise@1',
    'video.vignette@1', 'visual.shape@1', 'visual.text@1', 'visual.group@1']);
  assert.equal(createCapabilityRegistry().promptDefinitions()[0].description,
    '为整段视频生成可编辑字幕；重新生成时替换现有字幕轨');
  assert.equal(createCapabilityRegistry().get('subtitle.generate@1').definition.range.allowed, false);
  assert.equal(createCapabilityRegistry().get('subtitle.generate@1').graphStage, 'overlay');

  const color = createColorRegistration();
  assert.equal(color.editMode, 'append');
  assert.equal(color.editType, 'video.color.adjustment@1');
  assert.equal(color.nodeType, 'video.color@1');
  assert.equal(color.graphStage, 'sourceEffect');
  assert.deepEqual(color.definition.params.properties, PARAMETER_SCHEMA);

  adapters.forEach(function(adapter) {
    const incomplete = Object.assign({}, complete);
    delete incomplete[adapter];
    assert.deepEqual(createCapabilityRegistry([incomplete]).promptDefinitions(), []);
  });

  const invalidSchema = Object.assign({}, complete, {
    definition: Object.assign({}, complete.definition, {
      params: { type: 'object', additionalProperties: true, properties: {} }
    })
  });
  assert.deepEqual(createCapabilityRegistry([invalidSchema]).promptDefinitions(), []);

  ['editMode', 'editType', 'nodeType', 'graphStage'].forEach(function(field) {
    const unroutable = Object.assign({}, complete);
    delete unroutable[field];
    assert.deepEqual(createCapabilityRegistry([unroutable]).promptDefinitions(), []);
  });
});

test('normalizes and lowers independent visual layer capabilities', () => {
  const registry = createCapabilityRegistry();
  const normalized = registry.normalizeRecipe({ kind: 'instruction', steps: [
    { capability: 'visual.shape@1', range: { start: 1, end: 3 }, params: { width: .4 } },
    { capability: 'visual.text@1', range: { start: 1, end: 3 }, params: { text: '重点' } }
  ] }, { duration: 4 });
  assert.deepEqual(normalized.steps.map(s => s.params), [
    { x:.1,y:.1,width:.4,height:.15,color:'#000000',cornerRadius:0,borderWidth:0,borderColor:'#FFFFFF',fillOpacity:1,
      backdropBlur:0,glowBlur:0,glowColor:'#FFFFFF',glowOpacity:0 },
    { text:'重点',x:.12,y:.12,fontSize:.05,color:'#FFFFFF',fontWeight:400,letterSpacing:0,
      shadowBlur:0,shadowColor:'#000000',shadowOpacity:0 }
  ]);
  for (const registration of [createShapeRegistration(), createTextRegistration()]) {
    assert.equal(registration.editMode, 'append'); assert.equal(registration.graphStage, 'visualOverlay');
    assert.equal(registration.toTimeline({id:'e',transactionId:'t',range:{start:1,end:3},payload:normalized.steps.shift().params}).lane, 'visual');
  }
});

test('enables executable groups in the default catalog and hides incomplete custom registrations', () => {
  const defaults = createCapabilityRegistry();
  assert.equal(defaults.get('visual.group@1').nodeType, 'visual.group@1');
  assert.equal(defaults.promptDefinitions().some(item => item.id === 'visual.group@1'), true);
  const complete = createGroupRegistration();
  assert.deepEqual(createCapabilityRegistry([complete]).promptDefinitions().map(item => item.id),
    ['visual.group@1']);
  for (const adapter of ['prepare', 'toEdit', 'toGraph', 'toTimeline']) {
    const incomplete = { ...complete };
    delete incomplete[adapter];
    assert.deepEqual(createCapabilityRegistry([incomplete]).promptDefinitions(), []);
  }
});

test('a supported core-only adapter applies without legacy preview or export methods', async () => {
  const registration = createColorRegistration();
  delete registration.preview;
  delete registration.toExport;
  const registry = createCapabilityRegistry([registration]);
  assert.deepEqual(registry.promptDefinitions().map(item => item.id), ['video.color.adjust@1']);
  const values = new Map();
  const { createProjectEditing } = require('../src/project-editing');
  const editing = createProjectEditing({ capabilityRegistry: registry,
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } });
  editing.initializeProject({ projectId: 'core-only', mediaFacts: {
    duration: 4, canvas: { width: 320, height: 240 }, source: { id: 'main-video', assetId: 'video' }
  } });
  const result = await editing.applyRecipe({ projectId: 'core-only', expectedRevision: 0, requestId: 'request',
    recipe: { kind: 'instruction', steps: [{ capability: 'video.color.adjust@1', params: { brightness: .3 } }] } });
  assert.equal(result.graph.nodes[1].type, 'video.color@1');
  assert.equal(result.graph.nodes[1].props.brightness, .3);
  assert.equal(editing.timelineItems('core-only')[0].lane, 'video-effect');
});

test('renderer-unsupported registrations stay readable but are neither advertised nor executed', async () => {
  const registration = createColorRegistration();
  registration.nodeType = 'video.unsupported-test@1';
  const toGraph = registration.toGraph;
  registration.toGraph = (...args) => ({ ...toGraph(...args), type: registration.nodeType });
  const registry = createCapabilityRegistry([registration]);
  assert.equal(registry.get(registration.definition.id), registration);
  assert.equal(registry.forNodeType(registration.nodeType), registration);
  assert.deepEqual(registry.promptDefinitions(), []);
  const { createProjectEditing } = require('../src/project-editing');
  const values = new Map();
  const editing = createProjectEditing({ capabilityRegistry: registry,
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } });
  editing.initializeProject({ projectId: 'unsupported', mediaFacts: {
    duration: 4, canvas: { width: 320, height: 240 }, source: { id: 'main-video', assetId: 'video' }
  } });
  const before = editing.load('unsupported');
  let prepared = false;
  registration.prepare = async () => { prepared = true; return {}; };
  await assert.rejects(editing.applyRecipe({ projectId: 'unsupported', expectedRevision: 0, requestId: 'rejected',
    recipe: { kind: 'instruction', steps: [{ capability: registration.definition.id, params: { brightness: .3 } }] }
  }), { code: 'RECIPE_UNSUPPORTED_CAPABILITY' });
  assert.equal(prepared, false);
  assert.deepEqual(editing.load('unsupported'), before);
  // Renderer availability does not restrict validation of an already stored edit.
  const map = JSON.parse(values.get('srt_project_edit_state'));
  map.unsupported.document.edits.push({ id: 'old', transactionId: 'old-request', type: registration.editType,
    target: { kind: 'source', id: 'main-video' }, range: { start: 0, end: 4 },
    payload: { temperature: 0, brightness: .3, contrast: 1, saturation: 1 }, order: 0, enabled: true });
  values.set('srt_project_edit_state', JSON.stringify(map));
  assert.equal(editing.load('unsupported').graph.nodes[1].type, registration.nodeType);
});

test('matches prior scalar schemas plus only the declared nested schema forms', () => {
  assert.equal(matchesParameterSchema({ type: 'number', minimum: 0, maximum: 1 }, .5), true);
  assert.equal(matchesParameterSchema({ type: 'number', minimum: 0, maximum: 1 }, Infinity), false);
  assert.equal(matchesParameterSchema({ type: 'string', minLength: 1, pattern: '^x+$' }, 'xx'), true);
  assert.equal(matchesParameterSchema({ type: 'string', enum: ['shape'] }, 'text'), false);
  assert.equal(matchesParameterSchema({ type: 'boolean' }, false), true);

  const schema = createGroupRegistration().definition.params;
  const value = { layers: [{ kind: 'text', params: { text: '标题' } }],
    opacity: { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1, easing: 'ease-out' }] } };
  assert.equal(matchesParameterSchema(schema, value), true);
  assert.equal(matchesParameterSchema(schema, { ...value, constructor: 'no' }), false);
  assert.equal(matchesParameterSchema(schema, { layers: Array.from({ length: 17 },
    () => ({ kind: 'shape', params: { width: .2 } })) }), false);

  let getterCalls = 0;
  const executable = {};
  Object.defineProperty(executable, 'layers', { enumerable: true, get() {
    getterCalls += 1; return [];
  } });
  assert.equal(matchesParameterSchema(schema, executable), false);
  assert.equal(getterCalls, 0);
});

test('normalizes group duration after range and lowers all canonical adapters', async () => {
  const registration = createGroupRegistration();
  const registry = createCapabilityRegistry([registration]);
  const rawParams = {
    layers: [
      { kind: 'shape', params: { width: .4 } },
      { kind: 'text', params: { text: '重点' } }
    ],
    opacity: { keyframes: [{ time: 0, value: 0 },
      { time: 1, value: 1, easing: 'ease-out' }] }
  };
  const normalized = registry.normalizeRecipe({ kind: 'instruction', steps: [{
    capability: 'visual.group@1', range: { start: 2, end: 4 }, params: rawParams
  }] }, { duration: 8 }).steps[0];
  assert.deepEqual(normalized.range, { start: 2, end: 4 });
  assert.deepEqual(normalized.params, {
    layers: [
      { kind: 'shape', params: { x:.1,y:.1,width:.4,height:.15,color:'#000000',cornerRadius:0,borderWidth:0,borderColor:'#FFFFFF',fillOpacity:1,
        backdropBlur:0,glowBlur:0,glowColor:'#FFFFFF',glowOpacity:0 } },
      { kind: 'text', params: { text:'重点',x:.12,y:.12,fontSize:.05,color:'#FFFFFF',fontWeight:400,letterSpacing:0,
        shadowBlur:0,shadowColor:'#000000',shadowOpacity:0 } }
    ],
    pivotX: .5, pivotY: .5,
    opacity: { keyframes: [
      { time: 0, value: 0, easing: 'linear' },
      { time: 1, value: 1, easing: 'ease-out' }
    ] },
    scale: 1
  });
  assert.deepEqual(await registration.prepare(), {});
  const edit = registration.toEdit({}, normalized, { duration: 8 });
  assert.deepEqual(edit, { type: 'visual.group.layer@1', range: normalized.range,
    payload: normalized.params });
  const persisted = { id: 'group-edit', transactionId: 'request', ...edit };
  const node = registration.toGraph(persisted, { videoHead: 'node-video', duration: 8 });
  assert.deepEqual(node, { id: 'node-group-edit', type: 'visual.group@1',
    range: normalized.range, inputs: [{ port: 'base', nodeId: 'node-video' }],
    props: normalized.params });
  assert.deepEqual(registration.toTimeline(persisted), {
    editId: 'group-edit', transactionId: 'request', lane: 'visual', range: normalized.range,
    label: '动画图层', summary: '2 个元素', elementCount: 2, animated: true
  });
  assert.deepEqual(registration.preview({ nodes: [node] }, 2.5), [{
    ...normalized.params, opacity: .875, scale: 1
  }]);
  assert.deepEqual(registration.preview({ nodes: [node] }, 4), []);
  assert.deepEqual(registration.toExport(node), {
    capability: 'visual.group@1', range: normalized.range, params: normalized.params
  });
});

test('group preparation validates project media references before creating an edit', async () => {
  const registration = createGroupRegistration();
  const step = { range: { start: 1, end: 2 }, params: { layers: [
    { kind: 'image', params: { assetId: 'asset-a', x: 0, y: 0, width: 1, height: 1 } }
  ] } };
  let received;
  assert.deepEqual(await registration.prepare(step, { validateProjectAssets: async request => {
    received = request; return { ok: true, assetIds: ['asset-a'] };
  } }), {});
  assert.deepEqual(received, { layers: step.params.layers, range: step.range });
  await assert.rejects(registration.prepare(step, { validateProjectAssets: async () =>
    ({ ok: false, errorCode: 'PROJECT_ASSET_UNKNOWN' }) }), { code: 'PROJECT_ASSET_UNKNOWN' });
});

test('rejects animation beyond explicit and default whole-video group ranges', () => {
  const registry = createCapabilityRegistry([createGroupRegistration()]);
  function recipe(range, time) {
    const step = { capability: 'visual.group@1', params: {
      layers: [{ kind: 'shape', params: { width: .2 } }],
      opacity: { keyframes: [{ time: 0, value: 0 }, { time, value: 1 }] }
    } };
    if (range) step.range = range;
    return { kind: 'instruction', steps: [step] };
  }
  assert.throws(() => registry.normalizeRecipe(recipe({ start: 2, end: 3 }, 1.01),
    { duration: 8 }), { code: 'VISUAL_GROUP_INVALID' });
  assert.throws(() => registry.normalizeRecipe(recipe(null, 8.01),
    { duration: 8 }), { code: 'VISUAL_GROUP_INVALID' });
});

test('rejects unsupported registration routing metadata from the prompt catalog', function() {
  const complete = createColorRegistration();
  ['merge', 'replace'].forEach(function(editMode) {
    assert.deepEqual(createCapabilityRegistry([
      Object.assign({}, complete, { editMode: editMode })
    ]).promptDefinitions(), []);
  });
  ['preSource', 'effect', 'overlayEffect'].forEach(function(graphStage) {
    assert.deepEqual(createCapabilityRegistry([
      Object.assign({}, complete, { graphStage: graphStage })
    ]).promptDefinitions(), []);
  });
});

test('normalizes the one whole-video subtitle instruction into a new safe recipe', function() {
  const registry = createCapabilityRegistry();
  const recipe = {
    kind: 'instruction',
    steps: [{ capability: 'subtitle.generate@1', params: {} }]
  };
  const normalized = registry.normalizeRecipe(recipe, mediaFacts);

  assert.deepEqual(normalized, {
    kind: 'instruction',
    steps: [{
      capability: 'subtitle.generate@1',
      target: { kind: 'source', id: 'main-video' },
      range: { start: 0, end: 8 },
      params: {}
    }]
  });
  assert.notEqual(normalized, recipe);
  assert.notEqual(normalized.steps[0], recipe.steps[0]);
});

test('validates an original recipe without requiring media facts', function() {
  const registry = createCapabilityRegistry();
  const recipe = {
    kind: 'instruction',
    steps: [{ capability: 'subtitle.generate@1', params: {} }]
  };
  const validated = registry.validateRecipe(recipe);
  assert.deepEqual(validated, recipe);
  assert.notEqual(validated, recipe);
  assert.notEqual(validated.steps[0].params, recipe.steps[0].params);
});

test('validates and normalizes multiple data-only steps with per-step ranges', function() {
  const registry = createCapabilityRegistry();
  const recipe = {
    kind: 'instruction',
    steps: [
      {
        capability: 'video.color.adjust@1',
        range: { start: 1, end: 3.5 },
        params: { temperature: -0.8 }
      },
      {
        capability: 'video.color.adjust@1',
        params: { brightness: 0.25, saturation: 1.2 }
      }
    ]
  };

  assert.deepEqual(registry.validateRecipe(recipe), recipe);
  assert.deepEqual(registry.normalizeRecipe(recipe, mediaFacts), {
    kind: 'instruction',
    steps: [
      {
        capability: 'video.color.adjust@1',
        target: { kind: 'source', id: 'main-video' },
        range: { start: 1, end: 3.5 },
        params: { temperature: -0.8 }
      },
      {
        capability: 'video.color.adjust@1',
        target: { kind: 'source', id: 'main-video' },
        range: { start: 0, end: 8 },
        params: { brightness: 0.25, saturation: 1.2 }
      }
    ]
  });
});

test('rejects ranges, unknown parameters, executable fields and non-data values', function() {
  const registry = createCapabilityRegistry();
  let kindGetterCalls = 0;
  let stepsGetterCalls = 0;
  const executableRecipe = {};
  Object.defineProperties(executableRecipe, {
    kind: {
      enumerable: true,
      get: function() { kindGetterCalls += 1; return 'instruction'; }
    },
    steps: {
      enumerable: true,
      get: function() { stepsGetterCalls += 1; return []; }
    }
  });
  assert.throws(function() {
    registry.validateRecipe(executableRecipe);
  }, { code: 'RECIPE_INVALID' });
  assert.equal(kindGetterCalls, 0);
  assert.equal(stepsGetterCalls, 0);

  assert.throws(function() {
    registry.normalizeRecipe({
      kind: 'instruction',
      steps: [{ capability: 'subtitle.generate@1', params: { start: 2, end: 5 } }]
    }, mediaFacts);
  }, { code: 'RECIPE_INVALID_PARAM' });

  [
    { command: 'ffmpeg' },
    { path: '/tmp/video.mp4' },
    { run: function() {} }
  ].forEach(function(extra) {
    assert.throws(function() {
      registry.normalizeRecipe({
        kind: 'instruction',
        steps: [Object.assign({ capability: 'subtitle.generate@1', params: {} }, extra)]
      }, mediaFacts);
    }, { code: 'RECIPE_INVALID' });
  });

  assert.throws(function() {
    registry.validateRecipe({
      kind: 'instruction',
      steps: [{ capability: 'subtitle.generate@1', range: { start: 0, end: 2 }, params: {} }]
    });
  }, { code: 'RECIPE_INVALID_RANGE' });

  assert.throws(function() {
    registry.validateRecipe({
      kind: 'instruction',
      steps: [{ capability: 'video.color.adjust@1', target: {
        kind: 'source', id: 'main-video'
      }, params: { brightness: 0.2 } }]
    });
  }, { code: 'RECIPE_INVALID' });

  assert.throws(function() {
    registry.validateRecipe({
      kind: 'instruction',
      steps: [{ capability: 'video.color.adjust@1', params: { brightness: function() {} } }]
    });
  }, { code: 'RECIPE_INVALID' });

  let getterCalls = 0;
  const executableParams = {};
  Object.defineProperty(executableParams, 'brightness', {
    enumerable: true,
    get: function() { getterCalls += 1; return 0.2; }
  });
  assert.throws(function() {
    registry.validateRecipe({
      kind: 'instruction',
      steps: [{ capability: 'video.color.adjust@1', params: executableParams }]
    });
  }, { code: 'RECIPE_INVALID' });
  assert.equal(getterCalls, 0);

  assert.throws(function() {
    registry.normalizeRecipe({
      kind: 'instruction',
      steps: [{ capability: 'video.color.adjust@1', range: { start: 7, end: 9 },
        params: { brightness: 0.2 } }]
    }, mediaFacts);
  }, { code: 'RECIPE_INVALID_RANGE' });
});

test('lowers color edits into graph, timeline, preview and declarative export adapters', async function() {
  const registration = createColorRegistration();
  assert.deepEqual(await registration.prepare(), {});
  const edit = registration.toEdit({}, {
    range: { start: 1, end: 4 },
    params: { temperature: -0.8, brightness: 0.25 }
  });
  assert.deepEqual(edit, {
    type: 'video.color.adjustment@1',
    range: { start: 1, end: 4 },
    payload: { temperature: -0.8, brightness: 0.25, saturation: 1, contrast: 1 }
  });

  const persisted = Object.assign({ id: 'edit-color', transactionId: 'transaction-1' }, edit);
  const node = registration.toGraph(persisted, { videoHead: 'node-video' });
  assert.deepEqual(node, {
    id: 'node-edit-color',
    type: 'video.color@1',
    range: { start: 1, end: 4 },
    inputs: [{ port: 'base', nodeId: 'node-video' }],
    props: edit.payload
  });
  assert.deepEqual(registration.toTimeline(persisted), {
    editId: 'edit-color', transactionId: 'transaction-1', lane: 'video-effect',
    range: { start: 1, end: 4 }, label: '画面调色',
    summary: '色温 -0.8，亮度 +0.25，饱和度 1，对比度 1'
  });

  const graph = { nodes: [node, Object.assign({}, node, {
    id: 'node-later', range: { start: 4, end: 6 }, props: { contrast: 1.5 }
  })] };
  assert.deepEqual(registration.preview(graph, 2), [edit.payload]);
  assert.deepEqual(registration.preview(graph, 4), [{
    temperature: 0, brightness: 0, saturation: 1, contrast: 1.5
  }]);
  assert.deepEqual(registration.toExport(node), {
    capability: 'video.color.adjust@1', range: { start: 1, end: 4 }, params: edit.payload
  });
  assert.equal(createCapabilityRegistry().forEditType('video.color.adjustment@1').definition.id,
    'video.color.adjust@1');
  assert.equal(createCapabilityRegistry().forNodeType('video.color@1').definition.id,
    'video.color.adjust@1');
});

test('prepares real IPC output and lowers it through edit, graph and timeline adapters', async function() {
  const registration = createSubtitleRegistration();
  let request;
  const prepared = await registration.prepare({ range: { start: 0, end: 8 } }, {
    videoPath: '/videos/source.mp4',
    generateSubtitles: async function(value) {
      request = value;
      return { ok: true, segments: [{ start: 0.2, end: 1.4, text: ' 大家好 ' }] };
    }
  });
  assert.deepEqual(request, { videoPath: '/videos/source.mp4' });

  let nextId = 0;
  const edit = registration.toEdit(prepared, { range: { start: 0, end: 8 } }, {
    duration: 8,
    idFactory: function(prefix) { nextId += 1; return prefix + '-' + nextId; }
  });
  assert.deepEqual(edit, {
    type: 'subtitle.track@1',
    range: { start: 0, end: 8 },
    payload: {
      segments: [{ id: 'subtitle-segment-1', start: 0.2, end: 1.4, text: '大家好' }],
      style: SUBTITLE_STYLE
    }
  });

  const persisted = Object.assign({ id: 'edit-1', transactionId: 'transaction-1' }, edit);
  const node = registration.toGraph(persisted, { videoHead: 'node-video' });
  assert.deepEqual(node, {
    id: 'node-edit-1',
    type: 'visual.subtitle@1',
    range: { start: 0, end: 8 },
    inputs: [{ port: 'base', nodeId: 'node-video' }],
    props: edit.payload
  });
  assert.deepEqual(registration.toTimeline(persisted), {
    editId: 'edit-1', transactionId: 'transaction-1', lane: 'subtitle',
    range: { start: 0, end: 8 }, label: '字幕', summary: '1 段'
  });
});

test('maps subtitle failures and validates payload timing with one millisecond tolerance', async function() {
  const registration = createSubtitleRegistration();
  await assert.rejects(registration.prepare({}, {
    videoPath: '/videos/source.mp4',
    generateSubtitles: async function() {
      return { ok: false, errorCode: 'SUBTITLE_NO_SPEECH' };
    }
  }), { code: 'SUBTITLE_NO_SPEECH' });

  assert.deepEqual(validateSubtitlePayload({
    segments: [{ id: 's1', start: 0, end: 8.001, text: '字幕' }],
    style: SUBTITLE_STYLE
  }, 8).segments[0], { id: 's1', start: 0, end: 8, text: '字幕' });
  assert.throws(function() {
    validateSubtitlePayload({
      segments: [{ id: 's1', start: 0, end: 8.0011, text: '字幕' }],
      style: SUBTITLE_STYLE
    }, 8);
  }, { code: 'SUBTITLE_INVALID_OUTPUT' });
});

test('rejects an unavailable video path before calling subtitle IPC', async function() {
  const registration = createSubtitleRegistration();
  let calls = 0;
  await assert.rejects(registration.prepare({}, {
    videoPath: '   ',
    generateSubtitles: async function() { calls += 1; return { ok: true, segments: [] }; }
  }), { code: 'VIDEO_PATH_UNAVAILABLE' });
  assert.equal(calls, 0);
});

test('previews from graph nodes and emits the existing declarative burn step', function() {
  const registration = createSubtitleRegistration();
  const node = {
    id: 'node-edit-1', type: 'visual.subtitle@1', range: { start: 0, end: 8 },
    inputs: [{ port: 'base', nodeId: 'node-video' }],
    props: {
      segments: [{ id: 's1', start: 1, end: 2, text: '大家好' }],
      style: SUBTITLE_STYLE
    }
  };
  const graph = { nodes: [{ id: 'node-video', type: 'source.video@1' }, node] };

  assert.deepEqual(registration.preview(graph, 1.5), { text: '大家好', visible: true });
  assert.deepEqual(registration.preview(graph, 2), { text: '', visible: false });
  assert.deepEqual(registration.toExport(node), {
    capability: 'subtitle.burn@1', params: { segments: node.props.segments }
  });
  assert.equal(createCapabilityRegistry().forEditType('subtitle.track@1').definition.id,
    'subtitle.generate@1');
  assert.equal(createCapabilityRegistry().forNodeType('visual.subtitle@1').definition.id,
    'subtitle.generate@1');
});

test('loads the same registry in a browser without Node dependencies', function() {
  const colorSource = fs.readFileSync(path.join(__dirname, '../src/color-adjustment.js'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '../src/edit-capabilities.js'), 'utf8');
  const context = { window: { SRTRenderRecipe: { SUBTITLE_STYLE } } };
  vm.runInNewContext(colorSource, context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/video-transform.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/video-texture.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/visual-layers.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/keyframes.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/visual-group.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/remotion-support.js'), 'utf8'), context);
  vm.runInNewContext(source, context);
  assert.equal(context.window.SRTEditCapabilities.createCapabilityRegistry()
    .get('subtitle.generate@1').definition.id, 'subtitle.generate@1');
  assert.equal(context.window.SRTEditCapabilities.createCapabilityRegistry()
    .get('video.color.adjust@1').definition.id, 'video.color.adjust@1');
  assert.equal(context.window.SRTEditCapabilities.createCapabilityRegistry()
    .get('visual.group@1').definition.id, 'visual.group@1');
  assert.equal(context.window.SRTEditCapabilities.createCapabilityRegistry().promptDefinitions().length, 8);
  const html = fs.readFileSync(path.join(__dirname, '../app/剪辑.html'), 'utf8');
  const scripts = ['../src/video-texture.js', '../src/visual-layers.js', '../src/keyframes.js',
    '../src/visual-group.js', '../src/remotion-support.js', '../src/edit-capabilities.js'];
  scripts.forEach((script, index) => {
    assert.ok(html.includes('src="' + script + '"'), script + ' loads in the editor');
    if (index) assert.ok(html.indexOf(scripts[index - 1]) < html.indexOf(script));
  });
});
