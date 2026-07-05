/**
 * effects.js — 效果关键词匹配测试
 *
 * 运行: node --test tests\effects.test.js
 * 测试内容: translateEffect() 对 24 个效果的关键词匹配
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// 模拟浏览器环境（effects.js 依赖 localStorage + STORAGE_KEYS）
global.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] || null; },
  setItem(k, v) { this._data[k] = v; },
  removeItem(k) { delete this._data[k]; }
};
global.STORAGE_KEYS = { VIDEO: 'srt:video' };

// 加载 effects.js
const effectsPath = path.join(__dirname, '..', 'app', 'effects.js');
eval(fs.readFileSync(effectsPath, 'utf-8'));

test('EFFECT_MAP 包含 24 个效果', () => {
  assert.strictEqual(EFFECT_MAP.length, 24, 'EFFECT_MAP 应有 24 个效果');
});

test('translateEffect 匹配反相关键词', () => {
  const tests = ['反相', '负片', 'invert', '反转颜色'];
  for (const kw of tests) {
    const r = translateEffect(kw);
    assert.ok(r.matched, '关键词 "' + kw + '" 应匹配');
    assert.ok(r.cmd.includes('negate'), '反相命令应包含 negate 滤镜');
  }
});

test('translateEffect 匹配色调关键词', () => {
  const tests = ['色调', '色相', 'hue', '色相偏移'];
  for (const kw of tests) {
    const r = translateEffect(kw);
    assert.ok(r.matched, '关键词 "' + kw + '" 应匹配');
    assert.ok(r.cmd.includes('hue=h='), '关键词 "' + kw + '" 的命令应包含 hue 滤镜, 实际: ' + r.cmd.substring(0,60));
  }
});

test('translateEffect 匹配像素化关键词', () => {
  const tests = ['像素化', '马赛克', 'pixelate', 'mosaic', '像素风'];
  for (const kw of tests) {
    const r = translateEffect(kw);
    assert.ok(r.matched, '关键词 "' + kw + '" 应匹配');
    assert.ok(r.cmd.includes('scale=iw/20'), '像素化命令应包含缩小步骤');
    assert.ok(r.cmd.includes('flags=neighbor'), '像素化命令应使用 neighbor 缩放');
  }
});

test('现有效果回归 — 淡入/黑白/加速/暗角/复古 仍可匹配', () => {
  assert.ok(translateEffect('淡入').matched, '淡入效果应匹配');
  assert.ok(translateEffect('黑白').matched, '黑白效果应匹配');
  assert.ok(translateEffect('加速').matched, '加速效果应匹配');
  assert.ok(translateEffect('暗角').matched, '暗角效果应匹配');
  assert.ok(translateEffect('复古').matched, '复古效果应匹配');
});
