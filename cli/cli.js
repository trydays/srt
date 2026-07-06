#!/usr/bin/env node
// ============================================================
//  npx create-srt — 下载并安装 三天remotion
// ============================================================

const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = 'trydays/srt';

function log(msg) { console.log(`[srt] ${msg}`); }
function bail(msg) { console.error(`[srt] 错误: ${msg}`); process.exit(1); }

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'create-srt/1.0', 'Accept': 'application/vnd.github.v3+json' },
    }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) return resolve(httpsGet(res.headers.location));
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(data);
      });
    }).on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    let redirects = 0;
    function get(uri) {
      if (++redirects > 5) return reject(new Error('Too many redirects'));
      const u = new URL(uri);
      https.get({
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'create-srt/1.0' },
      }, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) return get(res.headers.location);
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const f = fs.createWriteStream(dest);
        let dl = 0, t = Date.now();
        res.on('data', (c) => { dl += c.length; if (Date.now() - t > 2000) { t = Date.now(); log(`  ${(dl/1048576).toFixed(0)}MB...`); } });
        res.pipe(f);
        f.on('finish', () => { f.close(); log(`  下载完成 (${(dl/1048576).toFixed(0)}MB)`); resolve(); });
        f.on('error', reject);
      }).on('error', reject);
    }
    get(url);
  });
}

async function main() {
  log('三天remotion 安装器');

  if (os.platform() !== 'win32') bail('目前仅支持 Windows。');

  log('查询最新版本...');
  let release;
  try {
    release = JSON.parse(await httpsGet(`https://api.github.com/repos/${REPO}/releases/latest`));
  } catch (e) { bail(`无法访问 GitHub Release: ${e.message}`); }
  log(`最新版本: ${release.tag_name}`);

  const zip = release.assets.find((a) => a.name.endsWith('.zip'));
  if (!zip) bail('找不到 zip 安装包');

  const sizeMB = (zip.size / 1048576).toFixed(0);
  log(`安装包: ${zip.name} (${sizeMB}MB)`);

  // 安装目录
  const installDir = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'srt');
  const exePath = path.join(installDir, '三天remotion.exe');

  if (fs.existsSync(exePath)) {
    log(`已安装: ${installDir}`);
    log('启动...');
    try { execSync(`"${exePath}"`, { stdio: 'inherit' }); } catch (_) {}
    process.exit(0);
  }

  // 下载
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srt-'));
  const zipPath = path.join(tmp, zip.name);
  log('下载中...');
  await download(zip.browser_download_url, zipPath);

  // 解压
  log('解压中...');
  fs.mkdirSync(installDir, { recursive: true });
  execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${installDir}' -Force"`, { stdio: 'pipe' });

  try { fs.unlinkSync(zipPath); fs.rmdirSync(tmp); } catch (_) {}

  if (!fs.existsSync(exePath)) bail(`解压成功但找不到 三天remotion.exe`);

  // 快捷方式
  log('创建桌面快捷方式...');
  try {
    const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut("${path.join(os.homedir(), 'Desktop', '三天remotion.lnk')}");$s.TargetPath="${exePath}";$s.WorkingDirectory="${installDir}";$s.Save()`;
    execSync(`powershell -Command "${ps}"`, { stdio: 'pipe' });
  } catch (_) {}

  log(`安装完成: ${installDir}`);
  log('启动...');
  try { execSync(`"${exePath}"`, { stdio: 'inherit' }); } catch (_) {}
}

main().catch((e) => { console.error(e); process.exit(1); });
