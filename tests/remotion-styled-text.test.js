const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

function loadComponent(name) {
  const filename = path.join(__dirname, '../app/remotion/', name);
  assert.ok(fs.existsSync(filename), `shared React ${name} is implemented`);
  const result = require('esbuild').buildSync({ entryPoints: [filename], bundle: true,
    platform: 'node', format: 'cjs', packages: 'external', write: false });
  const compiled = new Module(filename, module); compiled.filename = filename;
  compiled.paths = module.paths;
  compiled._compile(result.outputFiles[0].text, filename);
  return compiled.exports;
}

function markup(geometry, frameStyle) {
  const { StyledText } = loadComponent('styled-text.jsx');
  const React = require('react');
  return require('react-dom/server').renderToStaticMarkup(
    React.createElement('svg', null, React.createElement(StyledText, { geometry, frameStyle }))
  );
}

test('renders literal lines with supplied geometry and text styling', () => {
  const html = markup({
    lines: [
      { text: '  <b>& title', x: 24, baseline: 52 },
      { text: 'second  line', x: 28, baseline: 84 }
    ],
    fontSize: 30,
    color: '#123456',
    fontWeight: 700,
    letterSpacing: 1.5,
    shadowBlur: 6,
    shadowColor: '#101010',
    shadowOpacity: 0.4
  });
  assert.equal((html.match(/<text /g) || []).length, 2);
  assert.ok(html.includes('  &lt;b&gt;&amp; title'));
  assert.ok(html.includes('second  line'));
  assert.match(html, /<text x="24" y="52"/);
  assert.match(html, /font-family:Heiti SC/);
  assert.match(html, /font-size:30px/);
  assert.match(html, /font-weight:700/);
  assert.match(html, /letter-spacing:1.5px/);
  assert.match(html, /drop-shadow\(0 0 6px rgba\(16, 16, 16, 0.4\)\)/);
});

test('uses neutral defaults and applies opacity with pivoted scale', () => {
  const geometry = { lines: [{ text: 'plain', x: 10, baseline: 20 }], fontSize: 18, color: '#000000' };
  const neutral = markup(geometry);
  assert.match(neutral, /<g opacity="1" transform="translate\(0 0\) scale\(1\) translate\(0 0\)"/);
  assert.match(neutral, /font-weight:400/);
  assert.match(neutral, /letter-spacing:0/);
  assert.doesNotMatch(neutral, /drop-shadow/);

  const animated = markup(geometry, { opacity: 0.25, scale: 1.2, pivotX: 160, pivotY: 90 });
  assert.match(animated, /<g opacity="0.25" transform="translate\(160 90\) scale\(1.2\) translate\(-160 -90\)"/);
});
