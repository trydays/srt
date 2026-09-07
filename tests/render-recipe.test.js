const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSubtitleRecipe,
  validateRenderRecipe,
  SUBTITLE_STYLE
} = require('../src/render-recipe');

test('builds an independent applied-subtitle snapshot', () => {
  const applied = [{ id: 's1', start: 0.2, end: 1.4, text: '大家好' }];
  const recipe = buildSubtitleRecipe(applied);
  applied[0].text = '后来的草稿';
  assert.equal(recipe.steps[0].params.segments[0].text, '大家好');
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
