const test = require('node:test');
const assert = require('node:assert/strict');

const keyframes = require('../src/keyframes');

test('normalizes scalars and canonical keyframes without mutating caller data', () => {
  const input = { keyframes: [
    { time: 0, value: 0 },
    { time: 1, value: 1, easing: 'ease-out' }
  ] };
  const canonical = keyframes.normalize(input, 0, 1, 2);
  assert.deepEqual(canonical, { keyframes: [
    { time: 0, value: 0, easing: 'linear' },
    { time: 1, value: 1, easing: 'ease-out' }
  ] });
  assert.notEqual(canonical, input);
  assert.notEqual(canonical.keyframes, input.keyframes);
  assert.equal(keyframes.normalize(0.5, 0, 1, 2), 0.5);
  assert.equal(keyframes.valueAt(canonical, 0.5, 0, 1), 0.875);
});

test('rejects malformed times, values, easing, fields and frame counts', () => {
  const invalid = [
    { keyframes: [{ time: 0, value: 0 }, { time: 0, value: 1 }] },
    { keyframes: [{ time: 1, value: 0 }, { time: 2, value: 1 }] },
    { keyframes: [{ time: 0, value: 0 }, { time: -1, value: 1 }] },
    { keyframes: [{ time: 0, value: 0 }, { time: Infinity, value: 1 }] },
    { keyframes: [{ time: 0, value: 0 }, { time: 1, value: NaN }] },
    { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1, easing: 'custom' }] },
    { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1, command: 'run' }] },
    { keyframes: [{ time: 0, value: 0 }, { time: 1, value: '1' }] },
    { keyframes: [{ time: 0, value: 0 }] },
    { keyframes: Array.from({ length: 17 }, (_, time) => ({ time, value: 0 })) }
  ];
  for (const value of invalid) {
    assert.throws(() => keyframes.normalize(value, 0, 1, 20), { code: 'KEYFRAMES_INVALID' });
  }
  for (const value of [-0.01, 1.01, Infinity, NaN, '0.5', null]) {
    assert.throws(() => keyframes.normalize(value, 0, 1, 2), { code: 'KEYFRAMES_INVALID' });
  }
});

test('treats null and undefined duration as unknown but enforces known range duration', () => {
  const animation = { keyframes: [{ time: 0, value: 0 }, { time: 3, value: 1 }] };
  assert.deepEqual(keyframes.normalize(animation, 0, 1), keyframes.normalize(animation, 0, 1, null));
  assert.throws(() => keyframes.normalize(animation, 0, 1, 2), { code: 'KEYFRAMES_INVALID' });
  for (const duration of [0, -1, NaN, Infinity, '2']) {
    assert.throws(() => keyframes.normalize(animation, 0, 1, duration), { code: 'KEYFRAMES_INVALID' });
  }
});

test('evaluates every easing deterministically, holds the last value and clamps domains', () => {
  const easeOut = keyframes.normalize({ keyframes: [
    { time: 0, value: 0 }, { time: 1, value: 1, easing: 'ease-out' }
  ] }, 0, 1, 2);
  const backOut = keyframes.normalize({ keyframes: [
    { time: 0, value: 0 }, { time: 1, value: 1, easing: 'back-out' }
  ] }, 0, 1, 2);
  const linear = keyframes.normalize({ keyframes: [
    { time: 0, value: 0.2 }, { time: 1, value: 0.8, easing: 'linear' }
  ] }, 0, 1, 2);
  assert.equal(keyframes.valueAt(linear, 0.5, 0, 1), 0.5);
  assert.equal(keyframes.valueAt(easeOut, 0.5, 0, 1), 0.875);
  assert.ok(Math.abs(keyframes.valueAt(backOut, 0.5, 0, 1) - 1) < 1e-12);
  assert.equal(keyframes.valueAt(linear, 8, 0, 1), 0.8);
  assert.equal(keyframes.valueAt(linear, -5, 0, 1), 0.2);
  const reversed = [0.8, 0.2, 0.8].map(time => keyframes.valueAt(easeOut, time, 0, 1));
  assert.deepEqual(reversed, [0.992, 0.4879999999999999, 0.992]);
  assert.equal(keyframes.valueAt({ keyframes: [
    { time: 0, value: 1.8, easing: 'linear' },
    { time: 1, value: 2, easing: 'back-out' }
  ] }, 0.5, 0, 2), 2);
});

test('builds controlled FFmpeg expressions from the same easing definitions', () => {
  assert.equal(keyframes.expression(0.5, '(T-1)', 0, 1), '0.5');
  const animation = keyframes.normalize({ keyframes: [
    { time: 0, value: 0 },
    { time: 1, value: 1, easing: 'ease-out' },
    { time: 2, value: 0.5, easing: 'back-out' }
  ] }, 0, 1, 2);
  const expression = keyframes.expression(animation, '(T-1)', 0, 1);
  assert.match(expression, /^min\(1,max\(0,/);
  assert.match(expression, /if\(lt\(\(T-1\),1\),/);
  assert.match(expression, /pow\(/);
  assert.match(expression, /2\.70158/);
  assert.match(expression, /1\.70158/);
  assert.doesNotMatch(expression, /command|script|eval|Function/);
});

test('publishes a strict bounded schema for declared-value validation', () => {
  const schema = keyframes.valueSchema(0, 1, 1);
  assert.equal(schema.default, 1);
  assert.equal(schema.oneOf[0].type, 'number');
  assert.equal(schema.oneOf[1].properties.keyframes.minItems, 2);
  assert.equal(schema.oneOf[1].properties.keyframes.maxItems, 16);
  assert.deepEqual(schema.oneOf[1].properties.keyframes.items.properties.easing.enum,
    ['linear', 'ease-out', 'back-out']);
});
