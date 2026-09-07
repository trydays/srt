const test = require('node:test');
const assert = require('node:assert/strict');
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
