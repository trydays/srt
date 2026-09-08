const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const texture = require('../src/video-texture');

function expectedNoise(channel, x, y, time, amount) {
  const micros = Math.floor(time * 1000000 + 0.5);
  const bucket = Math.floor((micros * 12 + 6) / 1000000) % 65521;
  let z = ((x + 1) * 1973 + (y + 1) * 9277 + (bucket + 1) * 26699 + 911) % 65521;
  z = (31 * z * z + 17) % 65521;
  z = (31 * z * z + 17) % 65521;
  const delta = amount * 32 * ((z % 256 - 127.5) / 127.5);
  return Math.min(255, Math.max(0, Math.floor(channel + delta + 0.5)));
}

test('exports frozen browser-compatible parameter schemas', () => {
  assert.deepEqual(texture.NOISE_PARAMETERS.amount.type, 'number');
  assert.deepEqual(texture.VIGNETTE_PARAMETERS.strength.minimum, 0);
  assert.ok(Object.isFrozen(texture.NOISE_PARAMETERS));
  assert.ok(Object.isFrozen(texture.NOISE_PARAMETERS.amount));
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/video-texture'), 'utf8'), context);
  assert.equal(typeof context.window.SRTVideoTexture.applyFrame, 'function');
});

test('normalizes exactly one required finite bounded scalar', () => {
  assert.deepEqual(texture.normalizeParams('noise', { amount: 0 }), { amount: 0 });
  assert.deepEqual(texture.normalizeParams('vignette', { strength: 1 }), { strength: 1 });
  for (const params of [{}, { amount: 1, seed: 4 }, { amount: NaN }, { amount: Infinity }, { amount: -0.1 }, { amount: 1.1 }, null, []]) {
    assert.throws(() => texture.normalizeParams('noise', params), { code: 'RECIPE_INVALID_PARAM' });
  }
  assert.throws(() => texture.normalizeParams('unknown', { amount: 1 }), { code: 'RECIPE_INVALID_PARAM' });
  const sneaky = Object.create(null); sneaky.amount = 1; sneaky.constructor = 4;
  assert.throws(() => texture.normalizeParams('noise', sneaky), { code: 'RECIPE_INVALID_PARAM' });
});

test('grain uses canonical deterministic bucket, achromatic delta and clipping', () => {
  const source = new Uint8ClampedArray([0, 100, 250, 7, 100, 101, 102, 9]);
  const first = new Uint8ClampedArray(source);
  texture.applyFrame('noise', { amount: 1 }, first, 2, 1, 13 / 12);
  for (let x = 0; x < 2; x += 1) {
    for (let c = 0; c < 3; c += 1) assert.equal(first[x * 4 + c], expectedNoise(source[x * 4 + c], x, 0, 13 / 12, 1));
  }
  assert.deepEqual([first[3], first[7]], [7, 9]);
  const decoded = new Uint8ClampedArray(source);
  texture.applyFrame('noise', { amount: 1 }, decoded, 2, 1, 1.083333);
  assert.deepEqual(decoded, first);
  const intervening = new Uint8ClampedArray(source);
  texture.applyFrame('noise', { amount: 1 }, intervening, 2, 1, 1.5);
  assert.notDeepEqual(intervening, first);
  const repeated = new Uint8ClampedArray(source);
  texture.applyFrame('noise', { amount: 1 }, repeated, 2, 1, 13 / 12);
  assert.deepEqual(repeated, first);
});

test('vignette uses circular intrinsic geometry and safe 1x1 center', () => {
  const one = new Uint8ClampedArray([100, 100, 100, 255]);
  texture.applyFrame('vignette', { strength: 1 }, one, 1, 1, 2);
  assert.deepEqual([...one], [100, 100, 100, 255]);
  const square = new Uint8ClampedArray(3 * 3 * 4).fill(100);
  for (let i = 3; i < square.length; i += 4) square[i] = 201;
  texture.applyFrame('vignette', { strength: 1 }, square, 3, 3, 0);
  assert.deepEqual([square[0], square[4 * 4], square[8 * 4]], [0, 100, 0]);
  assert.equal(square[4], square[12]);
  assert.equal(square[3], 201);
});

test('zero effects are identity and frame/range inputs are strict', () => {
  for (const kind of ['noise', 'vignette']) {
    const key = kind === 'noise' ? 'amount' : 'strength';
    const data = new Uint8ClampedArray([1, 2, 3, 4]);
    assert.equal(texture.applyFrame(kind, { [key]: 0 }, data, 1, 1, 0), data);
    assert.deepEqual([...data], [1, 2, 3, 4]);
    assert.equal(texture.buildFilter(kind, { [key]: 0 }, { start: 0, end: 1 }), '');
  }
  for (const invoke of [
    () => texture.applyFrame('noise', { amount: 1 }, new Uint8Array(4), 1, 1, 0),
    () => texture.applyFrame('noise', { amount: 1 }, new Uint8ClampedArray(3), 1, 1, 0),
    () => texture.applyFrame('noise', { amount: 1 }, new Uint8ClampedArray(4), 0, 1, 0),
    () => texture.applyFrame('noise', { amount: 1 }, new Uint8ClampedArray(4), 1, 1, -1),
    () => texture.buildFilter('noise', { amount: 1 }, { start: 1, end: 1 }),
    () => texture.buildFilter('noise', { amount: 1 }, { start: 0, end: Infinity }),
    () => texture.buildFilter('noise', { amount: 1 }, { start: 0, end: 1, extra: 2 })
  ]) assert.throws(invoke);
});

test('builds fixed geq filters containing half-open time guards', () => {
  const noise = texture.buildFilter('noise', { amount: 0.5 }, { start: 1, end: 2 });
  const vignette = texture.buildFilter('vignette', { strength: 1 }, { start: 0, end: 3 });
  for (const value of [noise, vignette]) {
    assert.match(value, /^format=gbrp,geq=/);
    assert.match(value, /gte\(T,/);
    assert.match(value, /lt\(T,/);
    assert.doesNotMatch(value, /undefined|NaN|Infinity/);
  }
});
