const test = require('node:test');
const assert = require('node:assert/strict');
const media = require('../src/visual-media');

test('normalizes image and video params with neutral defaults', () => {
  assert.deepEqual(media.normalizeMediaParams('image', { assetId: 'asset-a', x: .1, y: .2, width: .3, height: .4 }),
    { assetId: 'asset-a', x: .1, y: .2, width: .3, height: .4, fit: 'contain', cornerRadius: 0 });
  assert.deepEqual(media.normalizeMediaParams('video', { assetId: 'asset-b', x: 0, y: 0, width: 1, height: 1 }),
    { assetId: 'asset-b', x: 0, y: 0, width: 1, height: 1, fit: 'cover', cornerRadius: 0, sourceStartSeconds: 0 });
});

test('rejects unknown keys, unsafe ids and invalid normalized geometry', () => {
  for (const value of [
    ['audio', { assetId: 'a', x: 0, y: 0, width: 1, height: 1 }],
    ['image', { assetId: '../a', x: 0, y: 0, width: 1, height: 1 }],
    ['image', { assetId: 'a', x: 0, y: 0, width: 0, height: 1 }],
    ['video', { assetId: 'a', x: 0, y: 0, width: 1, height: 1, loop: true }]
  ]) assert.throws(() => media.normalizeMediaParams(value[0], value[1]), { code: 'VISUAL_MEDIA_INVALID' });
});

test('maps normalized geometry to integer canvas pixels', () => {
  assert.deepEqual(media.geometry('image', { assetId: 'a', x: .1, y: .2, width: .5, height: .25, cornerRadius: .1 }, 640, 360),
    { x: 64, y: 72, width: 320, height: 90, cornerRadius: 9, fit: 'contain' });
});

test('quantizes visible frames and media source start consistently', () => {
  assert.deepEqual(media.frameTiming({ start: .01, end: 1.01 }, 24, .125),
    { firstFrame: 1, durationInFrames: 24, sourceStartFrame: 3 });
  assert.deepEqual(media.frameTiming({ start: .01, end: 1.01 }, 30, .125),
    { firstFrame: 1, durationInFrames: 30, sourceStartFrame: 4 });
});
