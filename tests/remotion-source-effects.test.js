const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

const width = 160, height = 96, fps = 12;
const source = { id: 'source', type: 'source.video@1', range: { start: 0, end: 2 }, props: { assetId: 'video' } };
const effect = (type, props, start = .5, end = 1.5, id = type) => ({
  id, type: `video.${type}@1`, props, range: { start, end }
});
function loadComposition() {
  const filename = path.join(__dirname, '../app/remotion/SrtComposition.jsx');
  const built = require('esbuild').buildSync({ entryPoints: [filename], bundle: true,
    platform: 'node', format: 'cjs', packages: 'external', write: false });
  const compiled = new Module(filename, module);
  compiled.filename = filename; compiled.paths = module.paths;
  compiled._compile(built.outputFiles[0].text, filename);
  return compiled.exports.SrtComposition;
}
test('shared composition accepts ordered source effects and retains one media source below overlays', () => {
  const React = require('react');
  const graph = { nodes: [source, effect('transform', { scale: .5 }),
    effect('color', { brightness: .4 }), effect('noise', { amount: .5 }),
    effect('vignette', { strength: .6 }),
    { id: 'overlay', type: 'visual.shape@1', range: { start: 0, end: 2 },
      props: { x: .1, y: .1, width: .2, height: .2, color: '#00FF00' } }] };
  let html;
  assert.doesNotThrow(() => { html = require('react-dom/server').renderToStaticMarkup(
    React.createElement(require('@remotion/player').Player, {
      component: loadComposition(), inputProps: { graph, width, height,
        assets: { video: { src: 'http://127.0.0.1:4178/source.mp4' } } },
      durationInFrames: 24, compositionWidth: width, compositionHeight: height, fps,
      initialFrame: 12, noSuspense: true, numberOfSharedAudioTags: 0, acknowledgeRemotionLicense: true
    })); }, 'existing source effect graph must render through the shared composition');
  assert.equal((html.match(/<video /g) || []).length, 1);
  assert.equal((html.match(/<audio /g) || []).length, 0);
  assert.ok(html.indexOf('<canvas') >= 0);
  assert.ok(html.indexOf('<canvas') < html.indexOf('data-layer-id="overlay"'));
});

test('real Player and rendered media share ordered, clipped source pixels, seeking and isolated overlays', {
  skip: process.env.SRT_REAL_REMOTION_SOURCE !== '1', timeout: 240000
}, async t => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'srt-remotion-source-'));
  t.diagnostic(`Source evidence retained at ${directory}`);
  const ffmpeg = process.env.SRT_FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg';
  const chrome = process.env.SRT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const media = path.join(directory, 'source.mp4');
  const exec = require('node:child_process').execFileSync;
  exec(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i',
    `color=c=0x808080:s=${width}x${height}:r=${fps},drawbox=x=0:y=0:w=32:h=96:color=red:t=fill,drawbox=x=128:y=0:w=32:h=96:color=blue:t=fill,drawbox=x=64:y=0:w=32:h=16:color=white:t=fill:enable='gte(t,1)'`,
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000', '-t', '2',
    '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', '-c:a', 'aac', media]);
  const entry = `import React, {createRef} from 'react';
    import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {Player} from '@remotion/player';
    import {SrtComposition} from './app/remotion/SrtComposition';
    const root=createRoot(document.getElementById('preview')); const ref=createRef();
    window.setInput=(nodes)=>{window.nodes=nodes;flushSync(()=>root.render(<Player ref={ref}
      component={SrtComposition} inputProps={{graph:{nodes},width:160,height:96,assets:{video:{src:location.origin+'/source.mp4'}}}}
      durationInFrames={24} compositionWidth={160} compositionHeight={96} fps={12}
      style={{width:160,height:96}} noSuspense numberOfSharedAudioTags={0} acknowledgeRemotionLicense />));};
    window.seek=(f)=>ref.current.seekTo(f); window.getFrame=()=>ref.current.getCurrentFrame(); window.play=()=>ref.current.play();window.pause=()=>ref.current.pause();`;
  const built = require('esbuild').buildSync({ stdin: { contents: entry, loader: 'jsx', resolveDir: path.join(__dirname, '..') },
    bundle: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
  const server = require('node:http').createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.url === '/player.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(built.outputFiles[0].text); }
    else if (request.url === '/source.mp4') {
      const bytes = fs.readFileSync(media);
      response.setHeader('Content-Type', 'video/mp4'); response.setHeader('Accept-Ranges', 'bytes');
      const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
      if (range) {
        const start = Number(range[1]), end = range[2] ? Number(range[2]) : bytes.length - 1;
        response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
        response.end(bytes.subarray(start, end + 1));
      } else response.end(bytes);
    }
    else response.end('<body style="margin:0"><div id="preview" style="width:160px;height:96px"></div><script src="/player.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await require('@playwright/test').chromium.launch({ executablePath: chrome,
    headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const failures = []; page.on('pageerror', error => failures.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  const base = [source, effect('noise', { amount: 0 }, 0, 2)];
  async function pixels(nodes, frame) {
    await page.evaluate(({nodes, frame}) => { window.setInput(nodes); window.seek(frame); }, { nodes, frame });
    await page.waitForFunction(frame => {
      const canvas = document.querySelector('[data-source-effects]');
      return canvas?.dataset.drawnFrame === String(frame);
    }, frame).catch(async error => {
      t.diagnostic(JSON.stringify(await page.evaluate(() => ({
        frame: window.getFrame(), video: [...document.querySelectorAll('video')].map(v => ({time:v.currentTime, ready:v.readyState, seeking:v.seeking})),
        canvas: document.querySelector('canvas')?.outerHTML, errors: window.remotion_cancelled
      }))));
      throw error;
    });
    return page.evaluate(() => Array.from(document.querySelector('[data-source-effects]').getContext('2d').getImageData(0, 0, 160, 96).data));
  }
  const pixel = (data, x, y) => data.slice((y * width + x) * 4, (y * width + x) * 4 + 3);
  const near = (actual, expected, label, tolerance = 12) => actual.forEach((v, i) =>
    assert.ok(Math.abs(v - expected[i]) <= tolerance, `${label}: ${actual} vs ${expected}`));
  const plain = await pixels(base, 5);
  near(pixel(await pixels(base, 11), 80, 8), [128, 128, 128], 'source before temporal marker');
  near(pixel(await pixels(base, 12), 80, 8), [255, 255, 255], 'source temporal marker at exact frame');
  near(pixel(await pixels(base, 11), 80, 8), [128, 128, 128], 'backwards source seek removes future marker');
  const darkNodes = [source, effect('color', { brightness: -.7 })];
  near(pixel(await pixels(darkNodes, 5), 80, 48), pixel(plain, 80, 48), 'before boundary');
  assert.ok(pixel(await pixels(darkNodes, 6), 80, 48)[0] < 90, 'active at start');
  assert.ok(pixel(await pixels(darkNodes, 17), 80, 48)[0] < 90, 'active before end');
  near(pixel(await pixels(darkNodes, 18), 80, 48), pixel(plain, 80, 48), 'inactive at end');
  const rounded = await pixels([source, effect('transform', { scale: .53 }, 0, 2)], 7);
  near(pixel(rounded, 36, 48), [0, 0, 0], 'rounded transform left black margin', 0);
  near(pixel(rounded, 37, 48), pixel(plain, 5, 48), 'rounded transform first source column');
  near(pixel(rounded, 122, 48), [0, 0, 0], 'rounded transform right black margin', 0);
  const flipped = await pixels([source, effect('transform', { flipHorizontal: true, flipVertical: true }, 0, 2)], 12);
  near(pixel(flipped, 5, 48), pixel(plain, 154, 48), 'horizontal flip');
  near(pixel(flipped, 80, 87), [255, 255, 255], 'vertical flip temporal marker');
  const ordered = [source, effect('transform', { scale: 2 }), effect('color', { brightness: .4 }),
    effect('transform', { scale: .5 }, .5, 1.5, 'shrink')];
  const clipped = await pixels(ordered, 12);
  near(pixel(clipped, 5, 48), [0, 0, 0], 'final transform black margins');
  const clippedInterior = pixel(clipped, 42, 48);
  assert.ok(Math.max(...clippedInterior) - Math.min(...clippedInterior) <= 12, 'cropped red edge cannot reappear');
  const recolored = await pixels([...ordered, effect('color', { brightness: .4 }, .5, 1.5, 'recolor')], 12);
  assert.ok(pixel(recolored, 5, 48)[0] > 20, 'later color changes prior black margins');
  const grainNodes = [source, effect('noise', { amount: 1 }, 0, 2)];
  const grain = await pixels(grainNodes, 7);
  const stats = data => {
    const values = [];
    for (let y = 40; y < 60; y++) for (let x = 60; x < 100; x++) values.push(pixel(data, x, y)[0]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return { mean, sd: Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length) };
  };
  const grainStats = stats(grain);
  assert.ok(Math.abs(grainStats.mean - pixel(plain, 80, 48)[0]) <= 3, 'grain stays centered on source');
  assert.ok(grainStats.sd > 16 && grainStats.sd < 21, 'grain has the prescribed regional spread');
  assert.notDeepEqual(await pixels(grainNodes, 8), grain, 'noise advances with the composition frame');
  await pixels(grainNodes, 15);
  assert.deepEqual(await pixels(grainNodes, 7), grain, 'backwards noise redraw is deterministic');
  const revised = await pixels([source, effect('noise', { amount: .2 }, 0, 2)], 7);
  assert.notDeepEqual(revised, grain, 'paused graph revision redraws');
  await page.evaluate(() => window.play());
  await page.waitForFunction(() => Number(document.querySelector('[data-source-effects]').dataset.drawnFrame) >= 10);
  await page.evaluate(() => window.pause());
  await page.waitForFunction(() => document.querySelector('[data-source-effects]').dataset.drawnFrame === String(window.getFrame()));
  const playingState = await page.evaluate(() => ({ frame: window.getFrame(),
    drawn: Number(document.querySelector('[data-source-effects]').dataset.drawnFrame),
    mediaTime: document.querySelector('video').currentTime }));
  assert.ok(Math.abs(playingState.drawn - playingState.frame) <= 1, `normal playback follows the Player clock: ${JSON.stringify(playingState)}`);
  const vignette = await pixels([source, effect('vignette', { strength: 1 }, 0, 2)], 7);
  near(pixel(vignette, 0, 0), [0, 0, 0], 'vignette corner', 0);
  near(pixel(vignette, 80, 48), pixel(plain, 80, 48), 'vignette center', 1);
  const overlay = { id: 'overlay', type: 'visual.shape@1', range: { start: 0, end: 2 },
    props: { x: .05, y: .3, width: .2, height: .3, color: '#00FF00' } };
  const mixed = [...ordered, effect('noise', { amount: .4 }), effect('vignette', { strength: .6 }), overlay];
  const mixedPixels = await pixels(mixed, 12);
  await page.locator('#preview').screenshot({ path: path.join(directory, 'player-frame12.png') });
  assert.equal(await page.locator('video').count(), 1);
  assert.equal(await page.locator('audio').count(), 0);
  const screenshotPixels = exec(ffmpeg, ['-v', 'error', '-i', path.join(directory, 'player-frame12.png'), '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
  near(pixel(Array.from(screenshotPixels), 15, 40), [0, 255, 0], 'overlay is unaffected', 0);
  // The same component is bundled by the real Remotion renderer. No legacy source filter is involved.
  const serveUrl = await require('@remotion/bundler').bundle({ entryPoint: path.join(__dirname, '../app/remotion/entry.jsx'),
    outDir: path.join(directory, 'bundle') });
  const renderer = require('@remotion/renderer');
  const inputProps = { graph: { nodes: mixed }, width, height, fps, durationInFrames: 24,
    assets: { video: { src: origin + '/source.mp4' } } };
  const composition = { id: 'SrtProject', width, height, fps, durationInFrames: 24, props: inputProps, defaultProps: inputProps };
  const output = path.join(directory, 'mixed.mp4');
  const renderErrors = [];
  await renderer.renderMedia({ serveUrl, composition, inputProps, outputLocation: output,
    codec: 'h264', crf: 10, concurrency: 1, browserExecutable: chrome, chromiumOptions: { gl: 'swangle' },
    onBrowserLog: log => { if (['error', 'warn', 'warning'].includes(log.type)) renderErrors.push(log.text); } });
  assert.deepEqual(renderErrors, [], 'render must not decode revoked/stale frame images');
  const decoded = Array.from(exec(ffmpeg, ['-v', 'error', '-ss', '1', '-i', output,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']));
  for (const [x, y] of [[80, 48], [110, 60], [5, 5]]) near(pixel(decoded, x, y), pixel(mixedPixels, x, y), `MP4 source ${x},${y}`);
  near(pixel(decoded, 15, 40), [0, 255, 0], 'MP4 overlay remains unaffected');
  const framePixels = frame => Array.from(exec(ffmpeg, ['-v', 'error', '-i', output,
    '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']));
  for (const frame of [5, 18]) near(pixel(framePixels(frame), 5, 48), pixel(plain, 5, 48), `MP4 inactive boundary ${frame}`);
  for (const frame of [6, 17]) assert.ok(pixel(framePixels(frame), 5, 48)[0] < 20, `MP4 active boundary ${frame}`);
  const previewStats = stats(mixedPixels), renderStats = stats(decoded);
  assert.ok(Math.abs(previewStats.mean - renderStats.mean) <= 3, 'MP4 grain regional mean');
  assert.ok(Math.abs(previewStats.sd - renderStats.sd) <= 3, 'MP4 grain regional spread');
  const probe = JSON.parse(exec(process.env.SRT_FFPROBE_PATH || '/opt/homebrew/bin/ffprobe', [
    '-v', 'error', '-show_streams', '-of', 'json', output], { encoding: 'utf8' }));
  assert.equal(probe.streams.filter(stream => stream.codec_type === 'audio').length, 1, 'one exported audio source');
  t.diagnostic(JSON.stringify({ grainStats, previewStats, renderStats }));
  assert.deepEqual(failures, []);
  const invalidInput = { ...inputProps, graph: { nodes: [source, effect('noise', { amount: 2 }, 0, 2)] } };
  await assert.rejects(renderer.renderStill({ serveUrl, composition: { ...composition, props: invalidInput },
    inputProps: invalidInput, frame: 7, output: path.join(directory, 'must-not-render.png'),
    browserExecutable: chrome, chromiumOptions: { gl: 'swangle' }, logLevel: 'error' }), /RECIPE_INVALID_PARAM/,
  'source drawing errors fail the real render instead of exporting stale pixels');
});
