import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { bundle } from '@remotion/bundler';
import { openBrowser, selectComposition, renderMedia, renderStill } from '@remotion/renderer';
import { build } from 'esbuild';
import assetSessions from '../src/remotion-assets.js';
import { SCENES } from '../previews/reference-effects/scenes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const onlyScene = option('--scene', 'all');
if (onlyScene !== 'all' && !SCENES[onlyScene]) throw new Error('Use --scene glass, keypoints or all');
const reference = path.resolve(option('--reference', '/Users/mac/Downloads/37875025116-1-192.mp4'));
const ffmpeg = process.env.SRT_FFMPEG_PATH || '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
const requestedOut = option('--out');
if (requestedOut && onlyScene === 'all') throw new Error('--out requires one --scene');
const parent = requestedOut ? path.dirname(path.resolve(requestedOut)) : os.tmpdir();
await mkdir(parent, { recursive: true });
const output = await mkdtemp(path.join(parent, 'srt-r5-'));
const sessions = [];
let browser, server;
const inputs = {};
const previewFiles = {};
const log = message => console.log(`[R5] ${message}`);
try {
  log(`Outputs: ${output}`);
  for (const [name, start, duration] of [['glass', 2, 8], ['keypoints', 14, 14], ['inset', 60, 4]]) {
    const filename = path.join(output, `${name}-source.mp4`);
    await run(ffmpeg, ['-v', 'error', '-ss', String(start), '-i', reference, '-t', String(duration),
      '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19',
      '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', filename], { maxBuffer: 1024 * 1024 });
    const session = await assetSessions.createRenderAssetSession({ assetId: name, videoPath: filename });
    sessions.push(session); inputs[name] = session.assets[name].src;
  }
  const still = path.join(output, 'material.png');
  await run(ffmpeg, ['-v', 'error', '-ss', '60', '-i', reference, '-frames:v', '1', still]);
  const image = `data:image/png;base64,${(await readFile(still)).toString('base64')}`;
  const inputProps = Object.fromEntries(Object.keys(SCENES).map(scene => [scene,
    { scene, source: inputs[scene], insetSource: inputs.inset, image }]));
  const serveUrl = await bundle({ entryPoint: path.join(root, 'previews/reference-effects/entry.jsx'),
    outDir: path.join(output, 'bundle'), rootDir: root, publicDir: null, enableCaching: false,
    webpackOverride: config => ({ ...config, devtool: false }) });
  browser = await openBrowser('chrome');
  for (const [scene, settings] of Object.entries(SCENES)) {
    if (onlyScene !== 'all' && scene !== onlyScene) continue;
    const props = inputProps[scene];
    const composition = await selectComposition({ serveUrl, id: settings.id,
      inputProps: props, puppeteerInstance: browser });
    const video = path.join(output, requestedOut ? path.basename(requestedOut) : `${scene}-preview.mp4`);
    previewFiles[`/${scene}.mp4`] = video;
    let lastPercent = -1;
    await renderMedia({ serveUrl, composition, inputProps: props, outputLocation: video,
      codec: 'h264', crf: 18, pixelFormat: 'yuv420p', audioCodec: 'aac',
      puppeteerInstance: browser, concurrency: 2,
      onProgress: ({ progress }) => {
        const percent = Math.floor(progress * 10) * 10;
        if (percent !== lastPercent) { lastPercent = percent; log(`${scene}: ${percent}%`); }
      } });
    for (const frame of (scene === 'glass' ? [0, 15, 60, 150, 226, 239] : [0, 16, 90, 270, 414])) {
      await renderStill({ serveUrl, composition, inputProps: props,
        output: path.join(output, `${scene}-${frame}.png`), frame,
        puppeteerInstance: browser, imageFormat: 'png' });
    }
    if (scene === 'glass') {
      for (const canvasBackground of [false, true]) {
        for (const noBlur of [false, true]) {
          const probeProps = { ...props, diagnostic: true, canvasBackground, noBlur };
          for (const frame of [15, 60]) {
            await renderStill({ serveUrl, composition: { ...composition, props: probeProps },
              inputProps: probeProps, frame,
              output: path.join(output, `probe-${canvasBackground ? 'canvas' : 'video'}-${noBlur ? 'plain' : 'blur'}-${frame}.png`),
              puppeteerInstance: browser, imageFormat: 'png' });
          }
        }
      }
    }
    log(`Created ${video}`);
  }
  await browser.close({ silent: true }); browser = null;
  await build({ entryPoints: [path.join(root, 'previews/reference-effects/player.jsx')],
    outfile: path.join(output, 'preview.js'), bundle: true, platform: 'browser', format: 'iife',
    target: 'chrome130', define: { 'process.env.NODE_ENV': '"production"' } });
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SRT · 两种参考效果</title><style>
    *{box-sizing:border-box}body{margin:0;background:#111318;color:#e9ebf0;font-family:system-ui,sans-serif}main{max-width:1080px;margin:0 auto;padding:42px 24px}header{margin-bottom:24px}.eyebrow{font-size:11px;letter-spacing:3px;color:#eab3ca}h1{font-size:30px;margin:14px 0}p,.note{color:#a8aebb;font-size:14px;line-height:1.7}.note{padding:14px 18px;background:#1c1f27;border-radius:10px}section{margin-top:34px}.heading{display:flex;justify-content:space-between;align-items:center;gap:16px}h2{font-size:18px}a{color:#eeb5ce;font-size:13px}details{color:#abb2c1;font-size:13px}.checks{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0}label{display:flex;align-items:center;gap:5px}input{accent-color:#e5a2bf}
    </style><div id="root">正在加载预览…</div><script src="/preview.js"></script></html>`;
  await writeFile(path.join(output, 'index.html'), html);
  await writeFile(path.join(output, 'run.json'), JSON.stringify({ reference, output,
    prototype: true, sourceIntervals: { glass: [2, 10], keypoints: [14, 28], inset: [60, 64] },
    videos: previewFiles, startedWith: 'manual fixture, not AI-generated' }, null, 2));
  if (args.includes('--serve')) {
    const staticFiles = { '/': [path.join(output, 'index.html'), 'text/html; charset=utf-8'],
      '/preview.js': [path.join(output, 'preview.js'), 'application/javascript'],
      ...Object.fromEntries(Object.entries(previewFiles).map(([route, file]) => [route, [file, 'video/mp4']])) };
    server = http.createServer(async (request, response) => {
      const route = new URL(request.url, 'http://127.0.0.1').pathname;
      if (route === '/inputs.json') { response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(inputProps)); return; }
      const file = staticFiles[route];
      if (!file) { response.writeHead(404); response.end(); return; }
      response.setHeader('Content-Type', file[1]);
      const stream = createReadStream(file[0]);
      stream.on('error', () => { if (!response.headersSent) response.writeHead(500); response.end(); });
      stream.pipe(response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    log(`PREVIEW http://127.0.0.1:${server.address().port}/`);
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  }
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (browser) await browser.close({ silent: true });
  await Promise.all(sessions.map(session => session.close()));
}
