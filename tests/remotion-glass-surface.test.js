const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const React = require('react');
let GlassSurface;
function render(geometry, frameStyle = {}, children = null) {
  const filename = path.join(__dirname, '../app/remotion/glass-surface.jsx');
  assert.ok(fs.existsSync(filename), 'shared GlassSurface is implemented');
  if (!GlassSurface) {
    const { outputFiles } = require('esbuild').buildSync({ entryPoints: [filename],
      bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false });
    const compiled = new Module(filename, module);
    compiled.filename = filename; compiled.paths = module.paths;
    compiled._compile(outputFiles[0].text, filename);
    GlassSurface = compiled.exports.GlassSurface;
  }
  return require('react-dom/server').renderToStaticMarkup(
    React.createElement(GlassSurface, { geometry, frameStyle }, children));
}
const geometry = { x: 80, y: 100, width: 440, height: 440, cornerRadius: 28,
  color: '#F6AACB', fillOpacity: .22, backdropBlur: 18, borderWidth: 1,
  borderColor: '#FFE4EF', glowColor: '#F6AACB', glowOpacity: .45, glowBlur: 24 };
test('glass samples backdrop and clips only sharp content inside rounded bounds', () => {
  const html = render(geometry, {}, React.createElement('img', { src: '/photo.png', alt: 'material' }));
  assert.match(html, /backdrop-filter:blur\(18px\)/);
  assert.match(html, /background-color:rgba\(246, 170, 203, 0\.22\)/);
  assert.match(html, /left:80px;top:100px;width:440px;height:440px/);
  assert.match(html, /border-radius:28px/);
  assert.match(html, /box-shadow:[^;]+rgba\(246, 170, 203, 0\.45\)/);
  assert.match(html, /data-glass-content="true"[^>]*overflow:hidden/);
  assert.match(html, /<img[^>]+alt="material"/);
  assert.doesNotMatch(html, /(?:^|;)filter:blur/);
});
test('one surface applies whole-card fade and scale without an opacity ancestor', () => {
  const html = render(geometry, { opacity: .5, scale: .96, pivotX: 300, pivotY: 320 });
  assert.match(html, /opacity:0\.5/);
  assert.match(html, /transform:scale\(0\.96\)/);
  assert.match(html, /transform-origin:220px 220px/);
  assert.equal(render(geometry, { opacity: 0 }), '');
  assert.equal(render(geometry, { scale: 0 }), '');
});
