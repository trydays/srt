(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTVisualMedia = api;
})(typeof window === 'undefined' ? null : window, function() {
  'use strict';
  function fail() { var error = new Error('VISUAL_MEDIA_INVALID'); error.code = error.message; throw error; }
  function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
  function finite(value, min, exclusive) {
    return typeof value === 'number' && Number.isFinite(value) && (exclusive ? value > min : value >= min);
  }
  function normalizeMediaParams(kind, params) {
    if ((kind !== 'image' && kind !== 'video') || !plain(params)) fail();
    var allowed = ['assetId', 'x', 'y', 'width', 'height', 'fit', 'cornerRadius'];
    if (kind === 'video') allowed.push('sourceStartSeconds');
    if (Object.keys(params).some(function(key) { return allowed.indexOf(key) < 0; })) fail();
    if (typeof params.assetId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(params.assetId)
        || !finite(params.x, 0) || !finite(params.y, 0)
        || !finite(params.width, 0, true) || params.width > 1
        || !finite(params.height, 0, true) || params.height > 1
        || params.x > 1 || params.y > 1) fail();
    var fit = params.fit === undefined ? (kind === 'image' ? 'contain' : 'cover') : params.fit;
    var cornerRadius = params.cornerRadius === undefined ? 0 : params.cornerRadius;
    if ((fit !== 'contain' && fit !== 'cover') || !finite(cornerRadius, 0) || cornerRadius > 0.5) fail();
    var result = { assetId: params.assetId, x: params.x, y: params.y,
      width: params.width, height: params.height, fit: fit, cornerRadius: cornerRadius };
    if (kind === 'video') {
      var sourceStartSeconds = params.sourceStartSeconds === undefined ? 0 : params.sourceStartSeconds;
      if (!finite(sourceStartSeconds, 0)) fail();
      result.sourceStartSeconds = sourceStartSeconds;
    }
    return result;
  }
  function geometry(kind, params, width, height) {
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) fail();
    var value = normalizeMediaParams(kind, params);
    var pixelWidth = Math.max(1, Math.round(value.width * width));
    var pixelHeight = Math.max(1, Math.round(value.height * height));
    return { x: Math.round(value.x * width), y: Math.round(value.y * height),
      width: pixelWidth, height: pixelHeight,
      cornerRadius: Math.round(value.cornerRadius * Math.min(pixelWidth, pixelHeight)), fit: value.fit };
  }
  function frameTiming(range, fps, sourceStartSeconds) {
    sourceStartSeconds = sourceStartSeconds === undefined ? 0 : sourceStartSeconds;
    if (!plain(range) || !finite(range.start, 0) || !finite(range.end, range.start, true)
        || !finite(fps, 0, true) || !finite(sourceStartSeconds, 0)) fail();
    var firstFrame = Math.ceil(range.start * fps);
    var endFrame = Math.ceil(range.end * fps);
    return { firstFrame: firstFrame, durationInFrames: endFrame - firstFrame,
      sourceStartFrame: Math.ceil(sourceStartSeconds * fps) };
  }
  return { normalizeMediaParams: normalizeMediaParams, geometry: geometry, frameTiming: frameTiming };
});
