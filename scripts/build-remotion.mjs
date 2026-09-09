import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { bundle } from '@remotion/bundler';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(projectRoot, 'app/remotion-built');
await mkdir(output, { recursive: true });
await build({
  entryPoints: [path.join(projectRoot, 'app/remotion/player.jsx')],
  outfile: path.join(output, 'player.js'), bundle: true, platform: 'browser',
  format: 'iife', target: 'chrome130', minify: true,
  define: { 'process.env.NODE_ENV': '"production"' }
});
await bundle({
  entryPoint: path.join(projectRoot, 'app/remotion/entry.jsx'),
  outDir: path.join(output, 'render'), rootDir: projectRoot,
  enableCaching: false, publicDir: null,
  webpackOverride: config => ({ ...config, devtool: false })
});
console.log('Built shared Remotion Player and renderer composition.');
