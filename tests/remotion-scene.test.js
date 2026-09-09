const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const group = require('../src/visual-group');
let layers;
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
function scene() {
  if (!layers) layers = loadComponent('layers.jsx');
  return layers;
}
function node(extra = {}) {
  return { id: 'node-group', type: 'visual.group@1', range: { start: 1, end: 3 },
    props: group.normalizeParams({ layers: [
      { kind: 'shape', params: { x: .2, y: .25, width: .4, height: .4, color: '#E04020' } },
      { kind: 'text', params: { text: '动画标题\n第二行', x: .23, y: .28, fontSize: .08, color: '#FFFFFF' } }
    ], opacity: { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1, easing: 'back-out' },
      { time: 1.5, value: 1 }, { time: 2, value: 0 }] },
    scale: { keyframes: [{ time: 0, value: .5 }, { time: 1, value: 1, easing: 'back-out' }] }, ...extra }, 2) };
}
function markup(value, frame) {
  const { GroupLayer } = scene();
  return require('react-dom/server').renderToStaticMarkup(require('react').createElement(GroupLayer,
    { node: value, frame, fps: 20, width: 320, height: 240 }));
}
function standaloneMarkup(value, frame) {
  const { StandaloneLayer } = scene();
  return require('react-dom/server').renderToStaticMarkup(require('react').createElement(StandaloneLayer,
    { node: value, frame, fps: 20, width: 320, height: 240 }));
}
function subtitleMarkup(value, frame) {
  const { SubtitleLayer } = scene();
  return require('react-dom/server').renderToStaticMarkup(require('react').createElement(SubtitleLayer,
    { node: value, frame, fps: 20, width: 800, height: 450 }));
}
test('shared group layer enforces half-open visibility and zero contribution', () => {
  for (const frame of [19, 20, 60]) assert.equal(markup(node(), frame), '');
  assert.equal(markup(node({ opacity: 1, scale: 0 }), 30), '');
});
test('real SVG markup preserves geometry, integer pivot, target easing and holding', () => {
  const value = node();
  for (const frame of [25, 30, 40, 55]) {
    const sampled = group.sample(value.props, value.range, frame / 20, 320, 240);
    const html = markup(value, frame);
    assert.ok(html.includes(`x="${sampled.x}" y="${sampled.y}" width="${sampled.width}" height="${sampled.height}"`));
    assert.ok(html.includes(`opacity="${sampled.opacity}"`));
    assert.match(html, /<rect x="64" y="60" width="128" height="96" rx="0" ry="0" fill="#E04020" fill-opacity="1"/);
    assert.match(html, /<text x="74" y="86"/);
    assert.match(html, /<text x="74" y="109"/);
  }
});
test('overlapping children composite with one group opacity and source-frame clipping', () => {
  const value = node({ opacity: .5, scale: 1, layers: [
    { kind: 'shape', params: { x: .55, y: .7, width: .2, height: .15, color: '#20D060' } },
    { kind: 'shape', params: { x: .65, y: .7, width: .2, height: .15, color: '#20D060' } }
  ] });
  const html = markup(value, 40);
  assert.equal((html.match(/opacity="0.5"/g) || []).length, 1);
  assert.equal((html.match(/<rect /g) || []).length, 2);
  assert.match(html, /viewBox="0 0 320 240"/);
  assert.match(html, /overflow="hidden"/);
  assert.match(html, /preserveAspectRatio="none"/);
});
test('text remains literal with whitespace, newlines, baseline and original font', () => {
  const value = node({ opacity: 1, layers: [{ kind: 'text',
    params: { text: '  <script>&${x}\n second  line' } }] });
  const html = markup(value, 40);
  assert.match(html, /xml:space="preserve"/);
  assert.match(html, /white-space:pre/);
  assert.match(html, /font-family:Heiti SC/);
  assert.ok(html.includes('  &lt;script&gt;&amp;${x}'));
  assert.ok(html.includes(' second  line'));
  assert.equal((html.match(/<text /g) || []).length, 2);
});
test('standalone shape and literal multiline text use intrinsic geometry and half-open ranges', () => {
  const shape = { id: 'shape', type: 'visual.shape@1', range: { start: 1, end: 2 },
    props: { x: .2, y: .25, width: .4, height: .4, color: '#E04020' } };
  assert.equal(standaloneMarkup(shape, 19), '');
  assert.match(standaloneMarkup(shape, 20), /data-layer-id="shape"[^]*<rect x="64" y="60" width="128" height="96"/);
  assert.equal(standaloneMarkup(shape, 40), '');
  const text = { id: 'text', type: 'visual.text@1', range: { start: 0, end: 2 },
    props: { text: '  <b>& title\nsecond  line', x: .1, y: .1, fontSize: .1, color: '#ABCDEF' } };
  const html = standaloneMarkup(text, 0);
  assert.match(html, /data-layer-id="text"/);
  assert.ok(html.includes('  &lt;b&gt;&amp; title'));
  assert.ok(html.includes('second  line'));
  assert.equal((html.match(/<text /g) || []).length, 2);
});
test('shared shape rendering keeps rounded fill and border inside its original bounds', () => {
  const styled = { x: .1, y: .1, width: .5, height: .25, color: '#101820',
    cornerRadius: .1, borderWidth: .02, borderColor: '#268AFF', fillOpacity: .75 };
  const shape = { id: 'styled-shape', type: 'visual.shape@1', range: { start: 0, end: 2 }, props: styled };
  const standalone = standaloneMarkup(shape, 0);
  assert.match(standalone, /<rect x="32" y="24" width="160" height="60" rx="6" ry="6" fill="#101820" fill-opacity="0\.75"/);
  assert.match(standalone, /<rect x="32\.6" y="24\.6" width="158\.8" height="58\.8" rx="5\.4" ry="5\.4" fill="none" stroke="#268AFF" stroke-width="1\.2"/);

  const grouped = markup(node({ opacity: 1, scale: 1, layers: [
    { kind: 'shape', params: styled }, { kind: 'text', params: { text: 'opaque text' } }
  ] }), 40);
  assert.match(grouped, /fill-opacity="0\.75"/);
  assert.match(grouped, /stroke="#268AFF"/);
  assert.doesNotMatch(grouped, /<text[^>]*(?:opacity|fill-opacity)=/);
});
test('subtitle uses half-open segment times, gaps, overlap order and literal newlines', () => {
  const value = { id: 'subtitles', type: 'visual.subtitle@1', range: { start: .5, end: 3 }, props: {
    segments: [
      { id: 'a', start: 1, end: 2, text: 'first <b>&\nline' },
      { id: 'b', start: 1.5, end: 2.5, text: 'second' }
    ], style: { fontFamily: 'Heiti SC', fontSize: 16, referenceWidth: 800, referenceHeight: 450,
      bottomPercent: 7, maxWidthPercent: 84, textColor: '#FFFFFF', backgroundColor: '#000000', backgroundOpacity: .72 }
  } };
  assert.equal(subtitleMarkup(value, 10), '');
  assert.equal(subtitleMarkup(value, 19), '');
  let html = subtitleMarkup(value, 20);
  assert.ok(html.includes('first &lt;b&gt;&amp;\nline'));
  assert.equal(html.includes('second'), false);
  html = subtitleMarkup(value, 30);
  assert.ok(html.indexOf('first &lt;b&gt;&amp;\nline') < html.indexOf('second'));
  assert.match(html, /white-space:pre-wrap/);
  assert.match(html, /bottom:7%/);
  assert.match(html, /max-width:84%/);
  assert.match(html, /font-family:Heiti SC/);
  assert.match(html, /font-size:16px/);
  assert.match(html, /color:#FFFFFF/);
  assert.match(html, /background-color:rgba\(0,0,0,0\.72\)/);
  html = subtitleMarkup(value, 40);
  assert.equal(html.includes('first'), false);
  assert.ok(html.includes('second'));
  assert.equal(subtitleMarkup(value, 50), '');
});
test('composition preserves graph z-order with standalone layers and subtitle topmost', () => {
  const { SrtComposition } = loadComponent('SrtComposition.jsx');
  const React = require('react');
  const { Player } = require('@remotion/player');
  const style = { fontFamily: 'Heiti SC', fontSize: 16, referenceWidth: 800, referenceHeight: 450,
    bottomPercent: 7, maxWidthPercent: 84, textColor: '#FFFFFF', backgroundColor: '#000000', backgroundOpacity: .72 };
  const nodes = [
    { id: 'video', type: 'source.video@1', range: { start: 0, end: 4 }, props: { assetId: 'video' } },
    { id: 'shape', type: 'visual.shape@1', range: { start: 0, end: 4 }, props: { x: .1, y: .1, width: .2, height: .2, color: '#112233' } },
    { id: 'text', type: 'visual.text@1', range: { start: 0, end: 4 }, props: { text: 'title', x: .1, y: .1, fontSize: .1, color: '#FFFFFF' } },
    { id: 'subtitle', type: 'visual.subtitle@1', range: { start: 0, end: 4 }, props: { segments: [{ id: 's', start: 0, end: 4, text: 'caption' }], style } }
  ];
  const html = require('react-dom/server').renderToStaticMarkup(React.createElement(Player, {
    component: SrtComposition, inputProps: { graph: { nodes }, width: 320, height: 240,
      assets: { video: { src: 'http://127.0.0.1:4178/source' } } }, durationInFrames: 80,
    compositionWidth: 320, compositionHeight: 240, fps: 20, initialFrame: 0, noSuspense: true,
    numberOfSharedAudioTags: 0, acknowledgeRemotionLicense: true
  }));
  assert.ok(html.indexOf('data-layer-id="shape"') < html.indexOf('data-layer-id="text"'));
  assert.ok(html.indexOf('data-layer-id="text"') < html.indexOf('data-subtitle-id="subtitle"'));
});
test('shared composition renders original media once with groups in graph order', () => {
  const { SrtComposition } = loadComponent('SrtComposition.jsx');
  const React = require('react');
  const { Player } = require('@remotion/player');
  const first = node({ opacity: .5, scale: 1 });
  const second = { ...node({ opacity: .7, scale: 1 }), id: 'second-group' };
  const input = { width: 320, height: 240, fps: 20, durationInFrames: 80,
    assets: { video: { src: 'http://127.0.0.1:4178/session/video.mp4' } },
    graph: { nodes: [{ id: 'video', type: 'source.video@1', props: { assetId: 'video' } }, first, second] } };
  const html = require('react-dom/server').renderToStaticMarkup(React.createElement(Player, {
    component: SrtComposition, inputProps: input, durationInFrames: 80,
    compositionWidth: 320, compositionHeight: 240, fps: 20, initialFrame: 40, noSuspense: true,
    numberOfSharedAudioTags: 0, acknowledgeRemotionLicense: true
  }));
  assert.equal((html.match(/<video /g) || []).length, 1);
  assert.equal((html.match(/<audio /g) || []).length, 0);
  assert.ok(html.includes('http://127.0.0.1:4178/session/video.mp4'));
  assert.ok(html.indexOf('data-group-id="node-group"') < html.indexOf('data-group-id="second-group"'));
});
test('real browser Player driver owns frame events, controls, updates and cleanup', {
  skip: process.env.SRT_REAL_REMOTION_PLAYER !== '1'
}, async t => {
  const filename = path.join(__dirname, '../app/remotion/player.jsx');
  assert.ok(fs.existsSync(filename), 'browser Player adapter is implemented');
  const fsp = require('node:fs/promises');
  const temporary = await fsp.mkdtemp(path.join(require('node:os').tmpdir(), 'srt-remotion-player-'));
  t.after(() => fsp.rm(temporary, { recursive: true, force: true }));
  const media = path.join(temporary, 'source.mp4');
  require('node:child_process').execFileSync(process.env.SRT_FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x102030:s=320x240:r=20',
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000', '-t', '4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', media
  ]);
  const built = require('esbuild').buildSync({ entryPoints: [filename], bundle: true,
    platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
  const server = require('node:http').createServer((request, response) => {
    if (request.url === '/player.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(built.outputFiles[0].text); }
    else if (request.url === '/source.mp4') { response.setHeader('Content-Type', 'video/mp4'); response.end(fs.readFileSync(media)); }
    else { response.setHeader('Content-Type', 'text/html'); response.end('<div id="preview" style="width:640px;height:480px"></div><script src="/player.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await require('@playwright/test').chromium.launch({
    executablePath: process.env.SRT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, args: ['--autoplay-policy=no-user-gesture-required']
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const failures = []; page.on('pageerror', error => failures.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    window.states = []; window.errors = [];
    const graph = { schemaVersion: 1, projectId: 'driver', documentRevision: 0, duration: 4,
      nodes: [{ id: 'source', type: 'source.video@1', range: { start: 0, end: 4 }, inputs: [], props: { assetId: 'video' } }],
      outputs: { video: { nodeId: 'source', port: 'video' }, audio: { nodeId: 'source', port: 'audio' } } };
    window.input = { graph, width: 320, height: 240, fps: 20, durationInFrames: 80,
      assets: { video: { src: location.origin + '/source.mp4' } } };
    window.driver = await window.SRTRemotionPlayer.mount(document.querySelector('#preview'), input, {
      onState: state => states.push(state), onError: error => errors.push(error.message)
    });
    window.subscriptionStates = [];
    window.unsubscribe = driver.subscribe(state => subscriptionStates.push(state));
  });
  assert.deepEqual(await page.evaluate(() => driver.getState()), { currentTime: 0, duration: 4, paused: true });
  assert.equal(await page.locator('video').count(), 1);
  await page.evaluate(() => driver.seekSeconds(1.25));
  await page.waitForFunction(() => driver.getState().currentTime === 1.25);
  await page.evaluate(() => { driver.setVolume(.4); driver.setMuted(true); driver.setPlaybackRate(1.5); });
  await page.waitForFunction(() => document.querySelector('video').muted && Math.abs(document.querySelector('video').volume - .4) < .001);
  await page.evaluate(() => driver.play());
  await page.waitForFunction(() => !driver.getState().paused && driver.getState().currentTime > 1.4);
  await page.evaluate(() => driver.pause());
  await page.waitForFunction(() => driver.getState().paused);
  const paused = await page.evaluate(() => driver.getState().currentTime);
  await page.evaluate(() => driver.updateInput(structuredClone(input)));
  assert.equal(await page.evaluate(() => driver.getState().currentTime), paused);
  await page.evaluate(() => driver.seekSeconds(100));
  await page.waitForFunction(() => driver.getState().currentTime === 3.95);
  assert.ok(await page.evaluate(() => states.length > 3 && subscriptionStates.length > 3));
  assert.deepEqual(await page.evaluate(() => errors), []);
  await page.evaluate(() => { unsubscribe(); driver.destroy(); });
  assert.equal(await page.locator('#preview > *').count(), 0);
  assert.deepEqual(failures, []);
});
