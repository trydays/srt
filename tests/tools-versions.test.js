/**
 * tools-versions.json 解析测试
 *
 * 运行: node --test tests\tools-versions.test.js
 *
 * 测试:
 *   1. 文件存在且可解析
 *   2. 顶层字段完整 (version, bundled)
 *   3. 每个捆绑工具有必要的字段 (version, exe, size)
 *   4. 版本号格式正确
 *   5. exe 文件名一致（不包含路径分隔符）
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const versionsFile = path.join(__dirname, '..', 'resources', 'tools', 'tools-versions.json');

// 模块作用域加载一次，所有 test case 共享
const bundledVersions = JSON.parse(fs.readFileSync(versionsFile, 'utf-8'));

// ── 1: 文件存在且可解析 ─────────────────────────────────────────────────
test('tools-versions.json 文件存在且为合法 JSON', () => {
  assert.ok(fs.existsSync(versionsFile), 'tools-versions.json 文件应存在');
  assert.ok(bundledVersions, '应成功解析为对象');
});

// ── 2: 顶层字段完整 ─────────────────────────────────────────────────────
test('tools-versions.json 顶层包含 version 和 bundled', () => {
  assert.strictEqual(typeof bundledVersions.version, 'number', 'version 应为数字');
  assert.strictEqual(typeof bundledVersions.bundled, 'object', 'bundled 应为对象');
  assert.ok(Object.keys(bundledVersions.bundled).length > 0, 'bundled 不应为空');
});

// ── 3: 每个工具的必要字段 ───────────────────────────────────────────────
test('每个捆绑工具有 version / exe / size 字段', () => {
  var names = Object.keys(bundledVersions.bundled);
  for (var i = 0; i < names.length; i++) {
    var t = bundledVersions.bundled[names[i]];
    assert.ok(typeof t.version === 'string', names[i] + '.version 应为字符串');
    assert.ok(typeof t.exe === 'string', names[i] + '.exe 应为字符串');
    assert.ok(typeof t.size === 'number', names[i] + '.size 应为数字');
    assert.ok(t.exe.length > 0, names[i] + '.exe 不应为空');
  }
});

// ── 4: exe 文件名不包含路径分隔符 ─────────────────────────────────────
test('exe 字段仅包含文件名，不含路径分隔符', () => {
  var names = Object.keys(bundledVersions.bundled);
  for (var i = 0; i < names.length; i++) {
    var exe = bundledVersions.bundled[names[i]].exe;
    assert.strictEqual(exe.indexOf('/'), -1, names[i] + '.exe 不应含 /');
    assert.strictEqual(exe.indexOf('\\'), -1, names[i] + '.exe 不应含 \\');
  }
});

// ── 5: 版本号非空字符串 ─────────────────────────────────────────────────
test('每个工具的版本号为非空字符串', () => {
  var names = Object.keys(bundledVersions.bundled);
  for (var i = 0; i < names.length; i++) {
    var ver = bundledVersions.bundled[names[i]].version;
    assert.ok(ver.trim().length > 0, names[i] + '.version 不应为空');
  }
});
