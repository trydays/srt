const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const {
  createCapabilityRegistry,
  createSubtitleRegistration,
  validateSubtitlePayload
} = require('../src/edit-capabilities');
const { SUBTITLE_STYLE } = require('../src/render-recipe');

const mediaFacts = { duration: 8 };

test('exposes only registrations with every executable adapter', function() {
  const complete = createSubtitleRegistration();
  const adapters = ['prepare', 'toEdit', 'toGraph', 'toTimeline', 'preview', 'toExport'];

  assert.deepEqual(createCapabilityRegistry().promptDefinitions().map(function(item) {
    return item.id;
  }), ['subtitle.generate@1']);
  assert.equal(createCapabilityRegistry().get('subtitle.generate@1').definition.range.allowed, false);

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

test('rejects ranges, unknown parameters, executable fields and non-data values', function() {
  const registry = createCapabilityRegistry();
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
});

test('loads the same registry in a browser without Node dependencies', function() {
  const source = fs.readFileSync(path.join(__dirname, '../src/edit-capabilities.js'), 'utf8');
  const context = { window: { SRTRenderRecipe: { SUBTITLE_STYLE } } };
  vm.runInNewContext(source, context);
  assert.equal(context.window.SRTEditCapabilities.createCapabilityRegistry()
    .get('subtitle.generate@1').definition.id, 'subtitle.generate@1');
});
