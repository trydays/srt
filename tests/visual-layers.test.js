const test = require('node:test');
const assert = require('node:assert/strict');
const layers = require('../src/visual-layers');

test('normalizes complete shape and text payloads', () => {
  assert.deepEqual(layers.normalizeParams('shape', { width: .4 }, true),
    { x: .1, y: .1, width: .4, height: .15, color: '#000000', cornerRadius: 0,
      borderWidth: 0, borderColor: '#FFFFFF', fillOpacity: 1, backdropBlur: 0,
      glowBlur: 0, glowColor: '#FFFFFF', glowOpacity: 0 });
  assert.deepEqual(layers.normalizeParams('text', { text: '重点\r\n第二行' }, true),
    { text: '重点\n第二行', x: .12, y: .12, fontSize: .05, color: '#FFFFFF',
      fontWeight: 400, letterSpacing: 0, shadowBlur: 0, shadowColor: '#000000', shadowOpacity: 0 });
});

test('rejects unsafe or malformed layer parameters', () => {
  const invalid = [
    ['text', {}], ['text', { text: '   ' }], ['text', { text: 1 }],
    ['text', { text: 'a'.repeat(201) }], ['text', { text: Array(9).fill('x').join('\n') }],
    ['text', { text: 'x\u0001' }], ['text', { text: 'x', color: 'red' }],
    ['text', { text: 'x', fontSize: .01 }], ['text', { text: 'x', nope: 1 }],
    ['shape', {}], ['shape', { x: .8, width: .3 }], ['shape', { width: '0.3' }],
    ['shape', { color: '#000' }], ['shape', { y: .9, height: .2 }],
    ['shape', { cornerRadius: -.01 }], ['shape', { cornerRadius: .51 }],
    ['shape', { borderWidth: -.01 }], ['shape', { borderWidth: .11 }],
    ['shape', { borderColor: '#FFF' }], ['shape', { fillOpacity: -.01 }],
    ['shape', { fillOpacity: 1.01 }], ['shape', { fillOpacity: NaN }],
    ['shape', { backdropBlur: -.01 }], ['shape', { backdropBlur: .081 }],
    ['shape', { glowBlur: .081 }], ['shape', { glowColor: 'white' }],
    ['shape', { glowOpacity: 1.01 }], ['text', { text: 'x', fontWeight: 500 }],
    ['text', { text: 'x', letterSpacing: .51 }], ['text', { text: 'x', shadowBlur: 1.01 }],
    ['text', { text: 'x', shadowColor: '#000' }], ['text', { text: 'x', shadowOpacity: -1 }]
  ];
  for (const [kind, params] of invalid) assert.throws(() => layers.normalizeParams(kind, params, true));
});

test('rejects an own constructor parameter outside the schema', () => {
  assert.throws(() => layers.normalizeParams('shape', { constructor: 1 }, true));
});

test('floors positive extents and text metrics to one pixel', () => {
  assert.deepEqual(layers.geometry('shape', { x: 0, y: 0, width: .01, height: .01 }, 48, 48),
    { x: 0, y: 0, width: 1, height: 1, color: '#000000', cornerRadius: 0,
      borderWidth: 0, borderColor: '#FFFFFF', fillOpacity: 1, backdropBlur: 0,
      glowBlur: 0, glowColor: '#FFFFFF', glowOpacity: 0 });
  assert.deepEqual(layers.geometry('text', { text: 'x', x: 0, y: 0, fontSize: .02 }, 48, 24), {
    x: 0, y: 0, fontSize: 1, lineHeight: 1,
    lines: [{ text: 'x', x: 0, baseline: 1 }], color: '#FFFFFF', fontWeight: 400,
    letterSpacing: 0, shadowBlur: 0, shadowColor: '#000000', shadowOpacity: 0
  });
  const calls = [];
  const ctx = { save() {}, restore() {}, fillRect: (...args) => calls.push(args) };
  layers.draw(ctx, 'shape', { x: 0, y: 0, width: .01, height: .01 }, 48, 48);
  assert.deepEqual(calls, [[0, 0, 1, 1]]);
});

test('shares rounded geometry and literal canvas drawing', () => {
  assert.deepEqual(layers.geometry('shape', { x: .1, y: .1, width: .3, height: .15, color: '#123456' }, 641, 359),
    { x: 64, y: 36, width: 192, height: 54, color: '#123456', cornerRadius: 0,
      borderWidth: 0, borderColor: '#FFFFFF', fillOpacity: 1, backdropBlur: 0,
      glowBlur: 0, glowColor: '#FFFFFF', glowOpacity: 0 });
  assert.deepEqual(layers.geometry('text', { text: '甲\n\n乙', x: .12, y: .12, fontSize: .08, color: '#FFFFFF' }, 640, 360), {
    x: 77, y: 43, fontSize: 29, lineHeight: 35,
    lines: [{ text: '甲', x: 77, baseline: 72 }, { text: '', x: 77, baseline: 107 }, { text: '乙', x: 77, baseline: 142 }], color: '#FFFFFF',
    fontWeight: 400, letterSpacing: 0, shadowBlur: 0, shadowColor: '#000000', shadowOpacity: 0
  });
  const calls = [];
  const ctx = { save:()=>calls.push('save'), restore:()=>calls.push('restore'), fillRect:(...a)=>calls.push(['rect',...a]), fillText:(...a)=>calls.push(['text',...a]) };
  layers.draw(ctx, 'text', { text: '甲\n乙' }, 640, 360);
  assert.equal(ctx.textBaseline, 'alphabetic'); assert.equal(ctx.textAlign, 'left');
  assert.equal(ctx.font, 'normal 18px Heiti SC'); assert.deepEqual(calls.filter(Array.isArray).map(x=>x[0]), ['text','text']);
});

test('converts formal glass and typography ratios against canvas and font size', () => {
  const shape = layers.geometry('shape', { width: .5, height: .25, backdropBlur: .04,
    glowBlur: .02, glowColor: '#268AFF', glowOpacity: .6 }, 640, 360);
  assert.equal(shape.backdropBlur, 14.4);
  assert.equal(shape.glowBlur, 7.2);
  assert.equal(shape.glowColor, '#268AFF');
  assert.equal(shape.glowOpacity, .6);
  const text = layers.geometry('text', { text: '标题', fontSize: .1, fontWeight: 700,
    letterSpacing: .25, shadowBlur: .5, shadowColor: '#102030', shadowOpacity: .4 }, 640, 360);
  assert.equal(text.fontWeight, 700);
  assert.equal(text.letterSpacing, 9);
  assert.equal(text.shadowBlur, 18);
  assert.equal(text.shadowColor, '#102030');
  assert.equal(text.shadowOpacity, .4);
});

test('converts shape card style ratios against the shorter rendered side', () => {
  const params = { x:.1, y:.1, width:.5, height:.25, color:'#101820',
    cornerRadius:.1, borderWidth:.02, borderColor:'#268AFF', fillOpacity:.75 };
  assert.deepEqual(layers.normalizeParams('shape', params, true), { ...params, backdropBlur: 0,
    glowBlur: 0, glowColor: '#FFFFFF', glowOpacity: 0 });
  const geometry = layers.geometry('shape', params, 640, 360);
  assert.equal(geometry.cornerRadius, 9);
  assert.equal(geometry.borderWidth, 1.8);
  assert.equal(geometry.borderColor, '#268AFF');
  assert.equal(geometry.fillOpacity, .75);
});

test('legacy canvas drawing rejects non-neutral shape styles instead of degrading them', () => {
  const context = { save() {}, restore() {}, fillRect() {} };
  assert.throws(() => layers.draw(context, 'shape', { width: .4, cornerRadius: .1 }, 640, 360),
    { code: 'VISUAL_LAYER_UNSUPPORTED_RENDERER' });
  assert.doesNotThrow(() => layers.draw(context, 'shape', { width: .4 }, 640, 360));
});
