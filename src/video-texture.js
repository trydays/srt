(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTVideoTexture = api;
})(typeof window === 'undefined' ? null : window, function() {
  'use strict';

  var NOISE_PARAMETERS = Object.freeze({
    amount: Object.freeze({ type: 'number', minimum: 0, maximum: 1,
      description: '画面颗粒强度，0 为关闭，1 为固定最大强度' })
  });
  var VIGNETTE_PARAMETERS = Object.freeze({
    strength: Object.freeze({ type: 'number', minimum: 0, maximum: 1,
      description: '画面暗角强度，0 为关闭，1 时四角为黑色' })
  });
  var HASH_LOOKUP = (function() {
    var table = new Uint8Array(65521);
    for (var z = 0; z < table.length; z += 1) {
      var value = (31 * z * z + 17) % 65521;
      value = (31 * value * value + 17) % 65521;
      table[z] = value % 256;
    }
    return table;
  })();

  function codedError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function isPlainObject(value) {
    return value !== null && !Array.isArray(value) && typeof value === 'object'
      && Object.getPrototypeOf(value) === Object.prototype;
  }

  function normalizeParams(kind, params) {
    var key = kind === 'noise' ? 'amount' : kind === 'vignette' ? 'strength' : null;
    if (!key || !isPlainObject(params) || Object.keys(params).length !== 1
        || !Object.prototype.hasOwnProperty.call(params, key)
        || typeof params[key] !== 'number' || !Number.isFinite(params[key])
        || params[key] < 0 || params[key] > 1) {
      throw codedError('RECIPE_INVALID_PARAM');
    }
    var result = {};
    result[key] = params[key];
    return result;
  }

  function validateFrame(rgba, width, height, mediaTime) {
    if (!(rgba instanceof Uint8ClampedArray) || !Number.isSafeInteger(width) || width <= 0
        || !Number.isSafeInteger(height) || height <= 0 || width * height * 4 !== rgba.length
        || typeof mediaTime !== 'number' || !Number.isFinite(mediaTime) || mediaTime < 0) {
      throw codedError('RECIPE_INVALID_PARAM');
    }
  }

  function applyFrame(kind, params, rgba, width, height, mediaTime) {
    var normalized = normalizeParams(kind, params);
    validateFrame(rgba, width, height, mediaTime);
    var amount = kind === 'noise' ? normalized.amount : normalized.strength;
    if (amount === 0) return rgba;
    if (kind === 'noise') {
      var micros = Math.floor(mediaTime * 1000000 + 0.5);
      var bucket = Math.floor((micros * 12 + 6) / 1000000) % 65521;
      for (var y = 0; y < height; y += 1) {
        for (var x = 0; x < width; x += 1) {
          var z = ((x + 1) * 1973 + (y + 1) * 9277 + (bucket + 1) * 26699 + 911) % 65521;
          var delta = amount * 32 * ((HASH_LOOKUP[z] - 127.5) / 127.5);
          var offset = (y * width + x) * 4;
          for (var channel = 0; channel < 3; channel += 1) {
            rgba[offset + channel] = Math.min(255, Math.max(0,
              Math.floor(rgba[offset + channel] + delta + 0.5)));
          }
        }
      }
      return rgba;
    }
    var centerX = (width - 1) / 2;
    var centerY = (height - 1) / 2;
    var denominator = Math.max(1,
      ((width - 1) * (width - 1) + (height - 1) * (height - 1)) / 4);
    for (var vy = 0; vy < height; vy += 1) {
      for (var vx = 0; vx < width; vx += 1) {
        var dx = vx - centerX;
        var dy = vy - centerY;
        var factor = 1 - amount * (dx * dx + dy * dy) / denominator;
        var voffset = (vy * width + vx) * 4;
        for (var vc = 0; vc < 3; vc += 1) {
          rgba[voffset + vc] = Math.min(255, Math.max(0,
            Math.floor(rgba[voffset + vc] * factor + 0.5)));
        }
      }
    }
    return rgba;
  }

  function validateRange(range) {
    if (!isPlainObject(range) || Object.keys(range).length !== 2
        || !Object.prototype.hasOwnProperty.call(range, 'start')
        || !Object.prototype.hasOwnProperty.call(range, 'end')
        || !Number.isFinite(range.start) || !Number.isFinite(range.end)
        || range.start < 0 || range.end <= range.start) {
      throw codedError('RECIPE_INVALID_PARAM');
    }
  }

  function guarded(changed, range) {
    return 'if(gte(T,' + range.start + ')*lt(T,' + range.end + '),' + changed + ',p(X,Y))';
  }

  function buildFilter(kind, params, range) {
    var normalized = normalizeParams(kind, params);
    validateRange(range);
    var amount = kind === 'noise' ? normalized.amount : normalized.strength;
    if (amount === 0) return '';
    var changed;
    if (kind === 'noise') {
      var bucket = 'mod(floor((floor(T*1000000+0.5)*12+6)/1000000),65521)';
      var z = 'mod((X+1)*1973+(Y+1)*9277+(' + bucket + '+1)*26699+911,65521)';
      z = 'mod(31*pow(' + z + ',2)+17,65521)';
      z = 'mod(31*pow(' + z + ',2)+17,65521)';
      var delta = amount + '*32*(mod(' + z + ',256)-127.5)/127.5';
      changed = 'clip(floor(p(X,Y)+' + delta + '+0.5),0,255)';
    } else {
      var q = '(pow(X-(W-1)/2,2)+pow(Y-(H-1)/2,2))/max(1,(pow(W-1,2)+pow(H-1,2))/4)';
      changed = 'clip(floor(p(X,Y)*(1-' + amount + '*(' + q + '))+0.5),0,255)';
    }
    var expression = guarded(changed, range);
    return "format=gbrp,geq=r='" + expression + "':g='" + expression + "':b='" + expression + "'";
  }

  return {
    NOISE_PARAMETERS: NOISE_PARAMETERS,
    VIGNETTE_PARAMETERS: VIGNETTE_PARAMETERS,
    normalizeParams: normalizeParams,
    applyFrame: applyFrame,
    buildFilter: buildFilter
  };
});
