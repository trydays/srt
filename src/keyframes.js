(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTKeyframes = api;
})(typeof window === 'undefined' ? null : window, function() {
  'use strict';

  var EASING_NAMES = ['linear', 'ease-out', 'back-out'];
  var EASINGS = {
    linear: {
      value: function(p) { return p; },
      expression: function(p) { return p; }
    },
    'ease-out': {
      value: function(p) { return 1 - Math.pow(1 - p, 3); },
      expression: function(p) { return '(1-pow((1-' + p + '),3))'; }
    },
    'back-out': {
      value: function(p) {
        return 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);
      },
      expression: function(p) {
        return '(1+2.70158*pow((' + p + '-1),3)+1.70158*pow((' + p + '-1),2))';
      }
    }
  };

  function fail() {
    var error = new Error('KEYFRAMES_INVALID');
    error.code = 'KEYFRAMES_INVALID';
    throw error;
  }

  function plain(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype;
  }

  function onlyKeys(value, allowed) {
    return Object.keys(value).every(function(key) { return allowed.indexOf(key) !== -1; });
  }

  function validDomain(minimum, maximum) {
    return typeof minimum === 'number' && Number.isFinite(minimum)
      && typeof maximum === 'number' && Number.isFinite(maximum) && maximum >= minimum;
  }

  function validNumber(value, minimum, maximum) {
    return typeof value === 'number' && Number.isFinite(value)
      && value >= minimum && value <= maximum;
  }

  function valueSchema(minimum, maximum, defaultValue) {
    if (!validDomain(minimum, maximum) || !validNumber(defaultValue, minimum, maximum)) fail();
    return {
      oneOf: [
        { type: 'number', minimum: minimum, maximum: maximum },
        {
          type: 'object',
          additionalProperties: false,
          required: ['keyframes'],
          properties: {
            keyframes: {
              type: 'array',
              minItems: 2,
              maxItems: 16,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['time', 'value'],
                properties: {
                  time: { type: 'number', minimum: 0 },
                  value: { type: 'number', minimum: minimum, maximum: maximum },
                  easing: { type: 'string', enum: EASING_NAMES.slice() }
                }
              }
            }
          }
        }
      ],
      default: defaultValue
    };
  }

  function normalize(value, minimum, maximum, duration) {
    if (!validDomain(minimum, maximum)) fail();
    var durationKnown = duration !== undefined && duration !== null;
    if (durationKnown && (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0)) fail();
    if (typeof value === 'number') {
      if (!validNumber(value, minimum, maximum)) fail();
      return value;
    }
    if (!plain(value) || Object.keys(value).length !== 1 || !onlyKeys(value, ['keyframes'])
        || !Array.isArray(value.keyframes) || value.keyframes.length < 2
        || value.keyframes.length > 16) fail();
    for (var frameIndex = 0; frameIndex < value.keyframes.length; frameIndex++) {
      if (!Object.prototype.hasOwnProperty.call(value.keyframes, frameIndex)) fail();
    }
    var previous = -Infinity;
    var frames = value.keyframes.map(function(frame, index) {
      if (!plain(frame) || !onlyKeys(frame, ['time', 'value', 'easing'])
          || !Object.prototype.hasOwnProperty.call(frame, 'time')
          || !Object.prototype.hasOwnProperty.call(frame, 'value')
          || Object.keys(frame).length < 2 || Object.keys(frame).length > 3
          || typeof frame.time !== 'number' || !Number.isFinite(frame.time) || frame.time < 0
          || frame.time <= previous || (index === 0 && frame.time !== 0)
          || !validNumber(frame.value, minimum, maximum)
          || (frame.easing !== undefined && EASING_NAMES.indexOf(frame.easing) === -1)) fail();
      previous = frame.time;
      return { time: frame.time, value: frame.value, easing: frame.easing || 'linear' };
    });
    if (durationKnown && frames[frames.length - 1].time > duration) fail();
    return { keyframes: frames };
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function valueAt(value, elapsed, minimum, maximum) {
    if (!validDomain(minimum, maximum) || typeof elapsed !== 'number' || !Number.isFinite(elapsed)) fail();
    if (typeof value === 'number') return clamp(value, minimum, maximum);
    var frames = value && value.keyframes;
    if (!Array.isArray(frames) || frames.length < 2) fail();
    if (elapsed <= frames[0].time) return clamp(frames[0].value, minimum, maximum);
    for (var index = 1; index < frames.length; index++) {
      var destination = frames[index];
      if (elapsed <= destination.time) {
        var source = frames[index - 1];
        var p = clamp((elapsed - source.time) / (destination.time - source.time), 0, 1);
        var easing = EASINGS[destination.easing];
        if (!easing) fail();
        return clamp(source.value + (destination.value - source.value) * easing.value(p), minimum, maximum);
      }
    }
    return clamp(frames[frames.length - 1].value, minimum, maximum);
  }

  function number(value) {
    return Object.is(value, -0) ? '0' : String(value);
  }

  function expression(value, elapsedExpression, minimum, maximum) {
    if (!validDomain(minimum, maximum) || typeof elapsedExpression !== 'string'
        || !elapsedExpression.trim()) fail();
    if (typeof value === 'number') return number(clamp(value, minimum, maximum));
    var frames = value && value.keyframes;
    if (!Array.isArray(frames) || frames.length < 2) fail();
    var tail = number(frames[frames.length - 1].value);
    for (var index = frames.length - 1; index > 0; index--) {
      var source = frames[index - 1], destination = frames[index];
      var p = 'min(1,max(0,((' + elapsedExpression + ')-' + number(source.time)
        + ')/' + number(destination.time - source.time) + '))';
      var easing = EASINGS[destination.easing];
      if (!easing) fail();
      var segment = '(' + number(source.value) + '+(' + number(destination.value - source.value)
        + ')*' + easing.expression(p) + ')';
      tail = 'if(lt(' + elapsedExpression + ',' + number(destination.time) + '),'
        + segment + ',' + tail + ')';
    }
    return 'min(' + number(maximum) + ',max(' + number(minimum) + ',' + tail + '))';
  }

  return {
    valueSchema: valueSchema,
    normalize: normalize,
    valueAt: valueAt,
    expression: expression
  };
});
