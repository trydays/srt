(function(root, factory) {
  var node = typeof module === 'object' && module.exports;
  var api = factory(node ? require('./keyframes') : root.SRTKeyframes,
    node ? require('./visual-layers') : root.SRTVisualLayers);
  if (node) module.exports = api;
  if (root) root.SRTVisualGroup = api;
})(typeof window === 'undefined' ? null : window, function(keyframes, visualLayers) {
  'use strict';

  function childParamsSchema(properties, required) {
    return {
      type: 'object',
      additionalProperties: false,
      required: required,
      properties: properties
    };
  }

  function layerSchema(kind, properties, required) {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'params'],
      properties: {
        kind: { type: 'string', enum: [kind] },
        params: childParamsSchema(properties, required)
      }
    };
  }

  var PARAMETERS = {
    type: 'object',
    additionalProperties: false,
    required: ['layers'],
    properties: {
      layers: {
        type: 'array',
        minItems: 1,
        maxItems: 16,
        items: {
          oneOf: [
            layerSchema('shape', visualLayers.SHAPE_PARAMETERS, []),
            layerSchema('text', visualLayers.TEXT_PARAMETERS, ['text'])
          ]
        }
      },
      pivotX: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
      pivotY: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
      opacity: keyframes.valueSchema(0, 1, 1),
      scale: keyframes.valueSchema(0, 2, 1)
    }
  };

  function fail() {
    var error = new Error('VISUAL_GROUP_INVALID');
    error.code = 'VISUAL_GROUP_INVALID';
    throw error;
  }

  function plain(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype;
  }

  function dataOnly(value, seen) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (!Array.isArray(value) && !plain(value)) return false;
    if (Object.getOwnPropertySymbols(value).length) return false;
    seen = seen || [];
    if (seen.indexOf(value) !== -1) return false;
    seen.push(value);
    var names = Object.getOwnPropertyNames(value);
    if (Array.isArray(value)) {
      var keys = Object.keys(value);
      if (keys.length !== value.length || keys.some(function(key, index) {
        return key !== String(index);
      })) {
        seen.pop();
        return false;
      }
      names = keys;
    }
    var valid = names.every(function(name) {
      var descriptor = Object.getOwnPropertyDescriptor(value, name);
      return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
        && descriptor.enumerable && dataOnly(descriptor.value, seen);
    });
    seen.pop();
    return valid;
  }

  function exactKeys(value, allowed) {
    var names = Object.keys(value);
    return names.every(function(name) { return allowed.indexOf(name) !== -1; });
  }

  function bounded(value, minimum, maximum) {
    return typeof value === 'number' && Number.isFinite(value)
      && value >= minimum && value <= maximum;
  }

  function normalizeParams(params, duration) {
    if (!dataOnly(params) || !plain(params)
        || !exactKeys(params, ['layers', 'pivotX', 'pivotY', 'opacity', 'scale'])
        || !Object.prototype.hasOwnProperty.call(params, 'layers')
        || !Array.isArray(params.layers) || params.layers.length < 1 || params.layers.length > 16) fail();
    if (duration !== undefined && duration !== null
        && (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0)) fail();
    var layers = params.layers.map(function(layer) {
      if (!plain(layer) || Object.keys(layer).length !== 2 || !exactKeys(layer, ['kind', 'params'])
          || (layer.kind !== 'shape' && layer.kind !== 'text') || !plain(layer.params)) fail();
      try {
        return { kind: layer.kind, params: visualLayers.normalizeParams(layer.kind, layer.params, true) };
      } catch (_) {
        fail();
      }
    });
    var pivotX = params.pivotX === undefined ? 0.5 : params.pivotX;
    var pivotY = params.pivotY === undefined ? 0.5 : params.pivotY;
    if (!bounded(pivotX, 0, 1) || !bounded(pivotY, 0, 1)) fail();
    try {
      return {
        layers: layers,
        pivotX: pivotX,
        pivotY: pivotY,
        opacity: keyframes.normalize(params.opacity === undefined ? 1 : params.opacity,
          0, 1, duration),
        scale: keyframes.normalize(params.scale === undefined ? 1 : params.scale,
          0, 2, duration)
      };
    } catch (_) {
      fail();
    }
  }

  function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function validRange(range) {
    return plain(range) && Object.keys(range).length === 2 && exactKeys(range, ['start', 'end'])
      && typeof range.start === 'number' && Number.isFinite(range.start) && range.start >= 0
      && typeof range.end === 'number' && Number.isFinite(range.end) && range.end > range.start;
  }

  function sample(params, range, mediaTime, width, height) {
    if (!validRange(range) || typeof mediaTime !== 'number' || !Number.isFinite(mediaTime)
        || !positiveInteger(width) || !positiveInteger(height)) fail();
    var canonical = normalizeParams(params, range.end - range.start);
    if (mediaTime < range.start || mediaTime >= range.end) return null;
    var elapsed = mediaTime - range.start;
    var opacity, scale;
    try {
      opacity = keyframes.valueAt(canonical.opacity, elapsed, 0, 1);
      scale = keyframes.valueAt(canonical.scale, elapsed, 0, 2);
    } catch (_) {
      fail();
    }
    var scaledWidth = Math.max(1, Math.floor(width * scale + 0.5));
    var scaledHeight = Math.max(1, Math.floor(height * scale + 0.5));
    return {
      opacity: opacity,
      scale: scale,
      x: Math.floor(canonical.pivotX * (width - scaledWidth) + 0.5),
      y: Math.floor(canonical.pivotY * (height - scaledHeight) + 0.5),
      width: scaledWidth,
      height: scaledHeight
    };
  }

  function draw(context, surface, params, frame, width, height) {
    if (!context || typeof context.save !== 'function' || typeof context.restore !== 'function'
        || typeof context.drawImage !== 'function' || !surface
        || typeof surface.getContext !== 'function' || !positiveInteger(width)
        || !positiveInteger(height) || !plain(frame)
        || !bounded(frame.opacity, 0, 1) || !bounded(frame.scale, 0, 2)
        || !Number.isSafeInteger(frame.x) || !Number.isSafeInteger(frame.y)
        || !positiveInteger(frame.width) || !positiveInteger(frame.height)) fail();
    var canonical = normalizeParams(params, null);
    if (frame.opacity === 0 || frame.scale === 0) return frame;
    if (surface.width !== width) surface.width = width;
    if (surface.height !== height) surface.height = height;
    var scratch = surface.getContext('2d');
    if (!scratch || typeof scratch.clearRect !== 'function') fail();
    scratch.clearRect(0, 0, width, height);
    canonical.layers.forEach(function(layer) {
      visualLayers.draw(scratch, layer.kind, layer.params, width, height);
    });
    context.save();
    context.globalAlpha = frame.opacity;
    context.drawImage(surface, frame.x, frame.y, frame.width, frame.height);
    context.restore();
    return frame;
  }

  return {
    PARAMETERS: PARAMETERS,
    normalizeParams: normalizeParams,
    sample: sample,
    draw: draw
  };
});
