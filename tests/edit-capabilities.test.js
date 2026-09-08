const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const {
  createCapabilityRegistry,
  createColorRegistration,
  createSubtitleRegistration,
  validateSubtitlePayload
} = require('../src/edit-capabilities');
const { PARAMETER_SCHEMA } = require('../src/color-adjustment');
const { SUBTITLE_STYLE } = require('../src/render-recipe');

const mediaFacts = { duration: 8 };

test('exposes only registrations with every executable adapter and routing metadata', function() {
  const complete = createSubtitleRegistration();
  const adapters = ['prepare', 'toEdit', 'toGraph', 'toTimeline', 'preview', 'toExport'];

  assert.deepEqual(createCapabilityRegistry().promptDefinitions().map(function(item) {
    return item.id;
  }), ['subtitle.generate@1', 'video.color.adjust@1', 'video.transform@1']);
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
  vm.runInNewContext(source, context);
  assert.equal(context.window.SRTEditCapabilities.createCapabilityRegistry()
    .get('subtitle.generate@1').definition.id, 'subtitle.generate@1');
  assert.equal(context.window.SRTEditCapabilities.createCapabilityRegistry()
    .get('video.color.adjust@1').definition.id, 'video.color.adjust@1');
});
