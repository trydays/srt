(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTRenderRecipe = api;
})(typeof window === 'undefined' ? null : window, function() {
  var SUBTITLE_STYLE = Object.freeze({
    fontFamily: 'Heiti SC',
    fontSize: 16,
    referenceHeight: 450,
    bottomPercent: 7,
    maxWidthPercent: 84,
    textColor: '#FFFFFF',
    backgroundColor: '#000000',
    backgroundOpacity: 0.72
  });

  function codedError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function isPlainObject(value) {
    return value && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  }

  function hasOnlyKeys(value, keys) {
    var actual = Object.keys(value).sort();
    return actual.length === keys.length && actual.every(function(key, index) {
      return key === keys[index];
    });
  }

  function freezeRecipe(recipe) {
    recipe.steps.forEach(function(step) {
      step.params.segments.forEach(Object.freeze);
      Object.freeze(step.params.segments);
      Object.freeze(step.params);
      Object.freeze(step);
    });
    Object.freeze(recipe.steps);
    return Object.freeze(recipe);
  }

  function validateRenderRecipe(recipe) {
    if (!isPlainObject(recipe) || !hasOnlyKeys(recipe, ['steps', 'version'])
        || recipe.version !== 1 || !Array.isArray(recipe.steps) || recipe.steps.length !== 1) {
      throw codedError('EXPORT_INVALID_RECIPE');
    }

    var step = recipe.steps[0];
    if (!isPlainObject(step) || !hasOnlyKeys(step, ['capability', 'params'])) {
      throw codedError('EXPORT_INVALID_RECIPE');
    }
    if (step.capability !== 'subtitle.burn@1') {
      throw codedError('EXPORT_UNSUPPORTED_OPERATION');
    }
    if (!isPlainObject(step.params) || !hasOnlyKeys(step.params, ['segments'])
        || !Array.isArray(step.params.segments) || step.params.segments.length === 0) {
      throw codedError('EXPORT_INVALID_RECIPE');
    }

    var ids = new Set();
    var segments = step.params.segments.map(function(segment) {
      if (!isPlainObject(segment) || !hasOnlyKeys(segment, ['end', 'id', 'start', 'text'])
          || typeof segment.id !== 'string' || !segment.id
          || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)
          || segment.start < 0 || segment.end <= segment.start
          || typeof segment.text !== 'string' || !segment.text.trim()
          || ids.has(segment.id)) {
        throw codedError('EXPORT_INVALID_RECIPE');
      }
      ids.add(segment.id);
      return { id: segment.id, start: segment.start, end: segment.end, text: segment.text };
    });

    return freezeRecipe({
      version: 1,
      steps: [{ capability: 'subtitle.burn@1', params: { segments: segments } }]
    });
  }

  function buildSubtitleRecipe(segments) {
    return validateRenderRecipe({
      version: 1,
      steps: [{ capability: 'subtitle.burn@1', params: { segments: segments } }]
    });
  }

  return { buildSubtitleRecipe: buildSubtitleRecipe, validateRenderRecipe: validateRenderRecipe,
    SUBTITLE_STYLE: SUBTITLE_STYLE };
});
