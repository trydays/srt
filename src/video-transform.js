(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTVideoTransform = api;
})(typeof window === 'undefined' ? null : window, function() {
  'use strict';

  var PARAMETER_SCHEMA = Object.freeze({
    flipHorizontal: Object.freeze({ type: 'boolean', default: false, description: 'true 水平翻转，false 不翻转' }),
    flipVertical: Object.freeze({ type: 'boolean', default: false, description: 'true 垂直翻转，false 不翻转' }),
    scale: Object.freeze({ type: 'number', minimum: 0.25, maximum: 4, default: 1,
      description: '先翻转再居中缩放；1 不缩放，放大裁去边缘，缩小补黑边，画布尺寸不变' })
  });

  function invalid(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function normalizeParams(params, requireExplicit) {
    if (!params || typeof params !== 'object' || Array.isArray(params)
        || (Object.getPrototypeOf(params) !== Object.prototype && Object.getPrototypeOf(params) !== null)
        || Object.getOwnPropertySymbols(params).length) throw invalid('RECIPE_INVALID_PARAM');
    var names = Object.getOwnPropertyNames(params);
    if (requireExplicit && names.length === 0) throw invalid('RECIPE_INVALID_PARAM');
    names.forEach(function(name) {
      var descriptor = Object.getOwnPropertyDescriptor(params, name);
      if (!Object.prototype.hasOwnProperty.call(PARAMETER_SCHEMA, name)
          || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw invalid('RECIPE_INVALID_PARAM');
      }
      var schema = PARAMETER_SCHEMA[name], value = descriptor.value;
      if (typeof value !== schema.type || (schema.type === 'number'
          && (!Number.isFinite(value) || value < schema.minimum || value > schema.maximum))) {
        throw invalid('RECIPE_INVALID_PARAM');
      }
    });
    var normalized = {};
    Object.keys(PARAMETER_SCHEMA).forEach(function(name) {
      normalized[name] = Object.prototype.hasOwnProperty.call(params, name)
        ? params[name] : PARAMETER_SCHEMA[name].default;
    });
    return normalized;
  }

  function geometry(params, width, height) {
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
      throw invalid('TRANSFORM_INVALID_GEOMETRY');
    }
    var normalized = normalizeParams(params, false);
    var scaledWidth = Math.max(1, Math.round(width * normalized.scale));
    var scaledHeight = Math.max(1, Math.round(height * normalized.scale));
    var padWidth = Math.max(width, scaledWidth), padHeight = Math.max(height, scaledHeight);
    var padX = Math.floor((padWidth - scaledWidth) / 2), padY = Math.floor((padHeight - scaledHeight) / 2);
    var cropX = Math.floor((padWidth - width) / 2), cropY = Math.floor((padHeight - height) / 2);
    return Object.freeze({ scaledWidth: scaledWidth, scaledHeight: scaledHeight,
      padWidth: padWidth, padHeight: padHeight, padX: padX, padY: padY,
      cropX: cropX, cropY: cropY, offsetX: padX - cropX, offsetY: padY - cropY,
      params: Object.freeze(normalized) });
  }

  return { PARAMETER_SCHEMA: PARAMETER_SCHEMA, normalizeParams: normalizeParams, geometry: geometry };
});
