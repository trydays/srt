(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTColorAdjustment = api;
})(typeof window === 'undefined' ? null : window, function() {
  'use strict';

  var PARAMETER_SCHEMA = Object.freeze({
    temperature: Object.freeze({
      type: 'number', minimum: -1, maximum: 1, default: 0,
      description: '负值偏冷，正值偏暖，0 不改变'
    }),
    brightness: Object.freeze({
      type: 'number', minimum: -1, maximum: 1, default: 0,
      description: '负值变暗，正值变亮，0 不改变'
    }),
    saturation: Object.freeze({
      type: 'number', minimum: 0, maximum: 2, default: 1,
      description: '0 为黑白，1 不改变，大于 1 增强饱和度'
    }),
    contrast: Object.freeze({
      type: 'number', minimum: 0, maximum: 2, default: 1,
      description: '1 不改变，小于 1 降低对比度，大于 1 增强对比度'
    })
  });

  function codedError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function isPlainObject(value) {
    if (!value || Array.isArray(value) || typeof value !== 'object') return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function normalizeParams(params, requireChange) {
    if (!isPlainObject(params)) throw codedError('RECIPE_INVALID_PARAM');
    var names = Object.keys(params);
    if (requireChange && names.length === 0) throw codedError('RECIPE_INVALID_PARAM');
    if (names.some(function(name) {
      var schema = PARAMETER_SCHEMA[name];
      var value = params[name];
      return !schema || typeof value !== 'number' || !Number.isFinite(value)
        || value < schema.minimum || value > schema.maximum;
    })) {
      throw codedError('RECIPE_INVALID_PARAM');
    }
    var normalized = {};
    Object.keys(PARAMETER_SCHEMA).forEach(function(name) {
      normalized[name] = Object.prototype.hasOwnProperty.call(params, name)
        ? params[name] : PARAMETER_SCHEMA[name].default;
    });
    return normalized;
  }

  function normalizeRange(range, duration) {
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
      throw codedError('RECIPE_INVALID_RANGE');
    }
    if (range === undefined) return { start: 0, end: duration };
    if (!isPlainObject(range) || Object.keys(range).length !== 2
        || !Object.prototype.hasOwnProperty.call(range, 'start')
        || !Object.prototype.hasOwnProperty.call(range, 'end')
        || typeof range.start !== 'number' || !Number.isFinite(range.start)
        || typeof range.end !== 'number' || !Number.isFinite(range.end)
        || range.start < 0 || range.end <= range.start || range.end > duration) {
      throw codedError('RECIPE_INVALID_RANGE');
    }
    return { start: range.start, end: range.end };
  }

  function isActive(range, time) {
    return Boolean(range) && typeof time === 'number' && Number.isFinite(time)
      && time >= range.start && time < range.end;
  }

  function buildPreviewMatrices(params) {
    var value = normalizeParams(params, false);
    var temperature = [1 + 0.2 * value.temperature, 0, 0, 0, 0,
      0, 1, 0, 0, 0, 0, 0, 1 - 0.2 * value.temperature, 0, 0, 0, 0, 0, 1, 0];
    // The fixed FFmpeg eq pipeline adjusts limited-range BT.601 Y separately
    // from U/V: Y = 16 + 219*luma, contrast pivots around code value 128,
    // brightness adds 255*(0.25*b), and saturation scales chroma about neutral.
    // Combining the RGB<->YUV matrices avoids extra browser rounding/clipping:
    // RGB' = saturation*RGB + (contrast-saturation)*luma + offset.
    // Browser preview remains an 8-bit approximation of the encoded export.
    var luma = [0.299, 0.587, 0.114];
    var difference = value.contrast - value.saturation;
    var offset = (1 - value.contrast) * 112 / 219 + 0.25 * value.brightness * 255 / 219;
    var tone = [];
    for (var row = 0; row < 3; row++) {
      for (var column = 0; column < 3; column++) {
        tone.push(difference * luma[column] + (row === column ? value.saturation : 0));
      }
      tone.push(0, offset);
    }
    tone.push(0, 0, 0, 1, 0);
    return Object.freeze({ temperature: Object.freeze(temperature), tone: Object.freeze(tone) });
  }

  return {
    PARAMETER_SCHEMA: PARAMETER_SCHEMA,
    normalizeParams: normalizeParams,
    normalizeRange: normalizeRange,
    isActive: isActive,
    buildPreviewMatrices: buildPreviewMatrices
  };
});
