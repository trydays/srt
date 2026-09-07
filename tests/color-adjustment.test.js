const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const {
  PARAMETER_SCHEMA,
  normalizeParams,
  normalizeRange,
  isActive,
  buildPreviewMatrices
} = require('../src/color-adjustment');

test('normalizes explicit color parameters with neutral defaults', function() {
  assert.deepEqual(normalizeParams({ temperature: -0.8, brightness: 0.25 }, true), {
    temperature: -0.8,
    brightness: 0.25,
    saturation: 1,
    contrast: 1
  });
  assert.deepEqual(normalizeParams({}, false), {
    temperature: 0,
    brightness: 0,
    saturation: 1,
    contrast: 1
  });
});

test('rejects absent, unknown, non-finite and out-of-range color parameters', function() {
  assert.throws(function() { normalizeParams({ brightness: 1.01 }, true); }, {
    code: 'RECIPE_INVALID_PARAM'
  });
  assert.throws(function() { normalizeParams({}, true); }, { code: 'RECIPE_INVALID_PARAM' });
  assert.throws(function() { normalizeParams({ warmth: 0.2 }, true); }, {
    code: 'RECIPE_INVALID_PARAM'
  });
  assert.throws(function() { normalizeParams({ contrast: Infinity }, true); }, {
    code: 'RECIPE_INVALID_PARAM'
  });
});

test('normalizes whole-target and explicit half-open ranges', function() {
  assert.deepEqual(normalizeRange(undefined, 12), { start: 0, end: 12 });
  assert.deepEqual(normalizeRange({ start: 5, end: 10 }, 12), { start: 5, end: 10 });
  assert.throws(function() { normalizeRange({ start: 5, end: 5 }, 12); }, {
    code: 'RECIPE_INVALID_RANGE'
  });
  assert.throws(function() { normalizeRange({ start: 5, end: 13 }, 12); }, {
    code: 'RECIPE_INVALID_RANGE'
  });
});

test('uses half-open range activity semantics', function() {
  assert.equal(isActive({ start: 5, end: 10 }, 5), true);
  assert.equal(isActive({ start: 5, end: 10 }, 9.999), true);
  assert.equal(isActive({ start: 5, end: 10 }, 10), false);
  assert.equal(isActive({ start: 5, end: 10 }, 4.999), false);
});

test('exposes the immutable four-parameter schema in a browser', function() {
  assert.deepEqual(Object.keys(PARAMETER_SCHEMA), [
    'temperature', 'brightness', 'saturation', 'contrast'
  ]);
  assert.equal(Object.isFrozen(PARAMETER_SCHEMA), true);
  assert.equal(Object.isFrozen(PARAMETER_SCHEMA.temperature), true);

  const source = fs.readFileSync(path.join(__dirname, '../src/color-adjustment.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  assert.equal(context.window.SRTColorAdjustment.PARAMETER_SCHEMA.brightness.maximum, 1);
});

test('preview matrices preserve identity and separate luma contrast from chroma saturation', function() {
  const identity = [1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0];
  const neutral = buildPreviewMatrices({});
  assert.deepEqual(neutral.temperature, identity);
  assert.deepEqual(neutral.tone, identity);
  assert.ok(Object.isFrozen(neutral) && Object.isFrozen(neutral.tone) && Object.isFrozen(neutral.temperature));
  const { tone } = buildPreviewMatrices({ contrast: 0, saturation: 1 });
  function channel(row, rgb) { return tone[row*5] * rgb[0] + tone[row*5+1] * rgb[1] + tone[row*5+2] * rgb[2] + tone[row*5+4]; }
  // Before output gamut clipping, contrast may change luma but not R-G chroma.
  assert.ok(Math.abs(channel(0, [0.6,0.2,0.1]) - channel(1, [0.6,0.2,0.1]) - 0.4) < 1e-10);
  assert.throws(() => buildPreviewMatrices({ contrast: 3 }), { code: 'RECIPE_INVALID_PARAM' });
});
