(function(root, factory) {
  var api = factory(function() {
    return typeof module === 'object' && module.exports
      ? require('./color-adjustment') : root.SRTColorAdjustment;
  }, function() {
    return typeof module === 'object' && module.exports
      ? require('./video-transform') : root.SRTVideoTransform;
  }, function() {
    return typeof module === 'object' && module.exports
      ? require('./visual-layers') : root.SRTVisualLayers;
  }, function() {
    return typeof module === 'object' && module.exports
      ? require('./visual-group') : root.SRTVisualGroup;
  }, function() {
    return typeof module === 'object' && module.exports
      ? require('./video-texture') : root.SRTVideoTexture;
  });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTRenderRecipe = api;
})(typeof window === 'undefined' ? null : window, function(getColorAdjustment, getVideoTransform, getVisualLayers, getVisualGroup, getVideoTexture) {
  var SUBTITLE_STYLE = Object.freeze({
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

  function freezeData(value) {
    if (!value || typeof value !== 'object') return value;
    Object.keys(value).forEach(function(key) {
      freezeData(value[key]);
    });
    return Object.freeze(value);
  }

  function validateSubtitleStep(step) {
    if (!hasOnlyKeys(step, ['capability', 'params'])) {
      throw codedError('EXPORT_INVALID_RECIPE');
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

    return { capability: 'subtitle.burn@1', params: { segments: segments } };
  }

  function validateSourceEffectStep(step) {
    var transform = step.capability === 'video.transform@1';
    var textureKind = step.capability === 'video.noise@1' ? 'noise'
      : step.capability === 'video.vignette@1' ? 'vignette' : null;
    if (!hasOnlyKeys(step, ['capability', 'params', 'range'])
        || !isPlainObject(step.range) || !hasOnlyKeys(step.range, ['end', 'start'])
        || !Number.isFinite(step.range.start) || !Number.isFinite(step.range.end)
        || step.range.start < 0 || step.range.end <= step.range.start
        || !isPlainObject(step.params)
        || !hasOnlyKeys(step.params, transform ? ['flipHorizontal', 'flipVertical', 'scale']
          : textureKind ? [textureKind === 'noise' ? 'amount' : 'strength']
            : ['brightness', 'contrast', 'saturation', 'temperature'])) {
      throw codedError('EXPORT_INVALID_RECIPE');
    }
    var params;
    try {
      params = textureKind ? getVideoTexture().normalizeParams(textureKind, step.params)
        : (transform ? getVideoTransform() : getColorAdjustment()).normalizeParams(step.params, false);
    } catch (_) {
      throw codedError('EXPORT_INVALID_RECIPE');
    }
    return {
      capability: step.capability,
      range: { start: step.range.start, end: step.range.end },
      params: params
    };
  }

  function validateLayerStep(step) {
    if (!hasOnlyKeys(step,['capability','params','range']) || !isPlainObject(step.range)
        || !hasOnlyKeys(step.range,['end','start']) || !Number.isFinite(step.range.start)
        || !Number.isFinite(step.range.end) || step.range.start<0 || step.range.end<=step.range.start
        || !isPlainObject(step.params)) throw codedError('EXPORT_INVALID_RECIPE');
    var kind=step.capability==='visual.shape@1'?'shape':'text', params;
    try { params=getVisualLayers().normalizeParams(kind,step.params,false); }
    catch(_){ throw codedError('EXPORT_INVALID_RECIPE'); }
    if (!hasOnlyKeys(step.params,Object.keys(kind==='shape'?getVisualLayers().SHAPE_PARAMETERS:getVisualLayers().TEXT_PARAMETERS).sort()))
      throw codedError('EXPORT_INVALID_RECIPE');
    return {capability:step.capability,range:{start:step.range.start,end:step.range.end},params:params};
  }

  function sameData(left, right) {
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left) && Array.isArray(right) && left.length === right.length
        && left.every(function(value, index) { return sameData(value, right[index]); });
    }
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    var leftKeys = Object.keys(left).sort(), rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every(function(key, index) {
      return key === rightKeys[index] && sameData(left[key], right[key]);
    });
  }

  function validateGroupStep(step) {
    if (!hasOnlyKeys(step, ['capability', 'params', 'range']) || !isPlainObject(step.range)
        || !hasOnlyKeys(step.range, ['end', 'start']) || !Number.isFinite(step.range.start)
        || !Number.isFinite(step.range.end) || step.range.start < 0
        || step.range.end <= step.range.start || !isPlainObject(step.params)) {
      throw codedError('EXPORT_INVALID_RECIPE');
    }
    var params;
    try {
      params = getVisualGroup().normalizeParams(step.params, step.range.end - step.range.start);
    } catch (_) {
      throw codedError('EXPORT_INVALID_RECIPE');
    }
    if (!sameData(step.params, params)) throw codedError('EXPORT_INVALID_RECIPE');
    return {
      capability: 'visual.group@1',
      range: { start: step.range.start, end: step.range.end },
      params: params
    };
  }

  function validateRenderRecipe(recipe) {
    if (!isPlainObject(recipe) || !hasOnlyKeys(recipe, ['steps', 'version'])
        || recipe.version !== 1 || !Array.isArray(recipe.steps) || recipe.steps.length === 0) {
      throw codedError('EXPORT_INVALID_RECIPE');
    }
    var stage = -1;
    var steps = Array.from(recipe.steps, function(step) {
      if (!isPlainObject(step) || typeof step.capability !== 'string') {
        throw codedError('EXPORT_INVALID_RECIPE');
      }
      if (step.capability !== 'video.color.adjust@1' && step.capability !== 'video.transform@1'
          && step.capability !== 'video.noise@1' && step.capability !== 'video.vignette@1'
          && step.capability !== 'visual.shape@1' && step.capability !== 'visual.text@1'
          && step.capability !== 'visual.group@1' && step.capability !== 'subtitle.burn@1') {
        throw codedError('EXPORT_UNSUPPORTED_OPERATION');
      }
      var current = step.capability === 'subtitle.burn@1' ? 2
        : step.capability.indexOf('visual.') === 0 ? 1 : 0;
      if (current < stage || (current===2 && stage===2)) throw codedError('EXPORT_INVALID_RECIPE');
      stage=current;
      if(current===0) return validateSourceEffectStep(step);
      if(current===1) return step.capability === 'visual.group@1'
        ? validateGroupStep(step) : validateLayerStep(step);
      return validateSubtitleStep(step);
    });
    return freezeData({ version: 1, steps: steps });
  }

  function buildSubtitleRecipe(segments) {
    return validateRenderRecipe({
      version: 1,
      steps: [{ capability: 'subtitle.burn@1', params: { segments: segments } }]
    });
  }

  function buildRenderRecipe(graph, registry) {
    if (!isPlainObject(graph) || !Array.isArray(graph.nodes)
        || !registry || typeof registry.forNodeType !== 'function') {
      throw codedError('EXPORT_INVALID_RECIPE');
    }
    var steps = [];
    graph.nodes.forEach(function(node) {
      if (!isPlainObject(node) || typeof node.type !== 'string') {
        throw codedError('EXPORT_INVALID_RECIPE');
      }
      if (node.type === 'source.video@1') return;
      var registration = registry.forNodeType(node.type);
      if (!registration || typeof registration.toExport !== 'function') {
        throw codedError('EXPORT_UNSUPPORTED_OPERATION');
      }
      steps.push(registration.toExport(node));
    });
    return validateRenderRecipe({ version: 1, steps: steps });
  }

  return { buildSubtitleRecipe: buildSubtitleRecipe, buildRenderRecipe: buildRenderRecipe,
    validateRenderRecipe: validateRenderRecipe, SUBTITLE_STYLE: SUBTITLE_STYLE };
});
