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

// ── 工具函数 ──────────────────────────────────────────────

function log(msg) { console.log(`[srt] ${msg}`); }
function bail(msg) { console.error(`[srt] 错误: ${msg}`); process.exit(1); }

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'create-srt/1.0', 'Accept': 'application/vnd.github.v3+json' },
    };
    https.get(opts, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) return resolve(httpsGet(res.headers.location));
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        resolve(data);
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest, label, sizeMB) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    let redirects = 0;
    function get(uri) {
      if (++redirects > 5) return reject(new Error('Too many redirects'));
      const u2 = new URL(uri);
      https.get({
        hostname: u2.hostname,
        path: u2.pathname + u2.search,
        headers: { 'User-Agent': 'create-srt/1.0' },
      }, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) return get(res.headers.location);
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const file = fs.createWriteStream(dest);
        let dl = 0;
        res.on('data', (c) => { dl += c.length; });
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          log(`下载完成 (${(dl / 1048576).toFixed(0)}MB)`);
          resolve();
        });
        file.on('error', reject);
      }).on('error', reject);
    }
    get(url);
  });
}

// ── 主流程 ────────────────────────────────────────────────

async function main() {
  log('三天remotion 安装器');

  // 1. 平台检查
  if (os.platform() !== 'win32') {
    bail('目前仅支持 Windows。macOS/Linux 即将支持。');
  }

  // 2. 获取最新版本
  log('查询最新版本...');
  let release;
  try {
    release = JSON.parse(await httpsGet(`https://api.github.com/repos/${REPO}/releases/latest`));
  } catch (e) {
    bail(`无法访问 GitHub Release: ${e.message}`);
  }
  log(`最新版本: ${release.tag_name}`);

  // 3. 优先找 portable exe，其次 zip
  const exeAsset = release.assets.find((a) => a.name.includes('portable') && a.name.endsWith('.exe'));
  const zipAsset = release.assets.find((a) => a.name.endsWith('.zip'));
  const asset = exeAsset || zipAsset;
  if (!asset) bail('找不到安装包（portable exe 或 zip）');

  const sizeMB = (asset.size / 1048576).toFixed(0);
  log(`安装包: ${asset.name} (${sizeMB}MB)`);

  // 4. 如果是 portable exe → 直接下载运行
  if (asset === exeAsset) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srt-'));
    const exePath = path.join(tmpDir, asset.name);
    log('下载 portable exe（解压即用，无需安装）...');
    await downloadFile(asset.browser_download_url, exePath, asset.name, sizeMB);
    log('启动...');
    try { execSync(`"${exePath}"`, { stdio: 'inherit' }); } catch (_) {}
    try { fs.unlinkSync(exePath); fs.rmdirSync(tmpDir); } catch (_) {}
    bail(''); // suppress error output on exit
  }

  // 5. Zip → 下载 + 解压到 LocalAppData
  const installDir = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'srt');
  if (fs.existsSync(installDir)) {
    log(`已安装: ${installDir}`);
    log('如需重新安装，请先删除该目录。');
    // 尝试直接启动
    const existingExe = path.join(installDir, '三天remotion.exe');
    if (fs.existsSync(existingExe)) {
      log('启动已有安装...');
      try { execSync(`"${existingExe}"`, { stdio: 'inherit' }); } catch (_) {}
      process.exit(0);
    }
  }

  fs.mkdirSync(installDir, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srt-'));
  const zipPath = path.join(tmpDir, asset.name);

  log(`下载中...`);
  await downloadFile(asset.browser_download_url, zipPath, asset.name, sizeMB);

  // 解压 (用 PowerShell)
  log('解压中...');
  try {
    execSync(
      `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${installDir}' -Force"`,
      { stdio: 'pipe' }
    );
  } catch (e) {
    bail(`解压失败: ${e.message}`);
  }

  // 清理临时的 zip
  try { fs.unlinkSync(zipPath); fs.rmdirSync(tmpDir); } catch (_) {}

  // 找主 exe
  const exeName = '三天remotion.exe';
  const mainExe = path.join(installDir, exeName);
  if (!fs.existsSync(mainExe)) bail(`解压成功但找不到 ${exeName}`);

  // 创建桌面快捷方式 (PowerShell)
  log('创建桌面快捷方式...');
  try {
    const desktop = path.join(os.homedir(), 'Desktop');
    const shortcutPs = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("${path.join(desktop, '三天remotion.lnk')}")
$Shortcut.TargetPath = "${mainExe}"
$Shortcut.WorkingDirectory = "${installDir}"
$Shortcut.Save()
`;
    execSync(`powershell -Command "${shortcutPs.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
  } catch (_) { /* shortcut is optional */ }

  log('安装完成！');
  log(`位置: ${installDir}`);
  log('桌面快捷方式已创建，双击启动。');

  // 启动
  try { execSync(`"${mainExe}"`, { stdio: 'inherit' }); } catch (_) {}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
