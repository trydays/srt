#!/usr/bin/env node
// ============================================================
//  npx srt — 下载并安装 三天remotion
// ============================================================

const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = 'trydays/srt';
const INSTALLER_NAME = '三天remotion Setup';

// ── 工具函数 ──────────────────────────────────────────────

function log(msg) { console.log(`[srt] ${msg}`); }
function bail(msg) { console.error(`[srt] 错误: ${msg}`); process.exit(1); }

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'srt-cli/1.0', 'Accept': 'application/vnd.github.v3+json' },
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
    release = JSON.parse(
      await httpsGet(`https://api.github.com/repos/${REPO}/releases/latest`)
    );
  } catch (e) {
    bail(`无法访问 GitHub Release: ${e.message}`);
  }
  log(`最新版本: ${release.tag_name}`);

  // 3. 找到安装包
  const asset = release.assets.find((a) => a.name.startsWith(INSTALLER_NAME) && a.name.endsWith('.exe'));
  if (!asset) bail(`找不到安装包: ${INSTALLER_NAME}*.exe`);

  const sizeMB = (asset.size / 1048576).toFixed(0);
  log(`安装包: ${asset.name} (${sizeMB}MB)`);

  // 4. 提示用户
  console.log('');
  log('即将下载安装包。安装过程会显示 Windows 安装向导。');
  log(`如果浏览器弹出 SmartScreen 警告，点击"更多信息" →"仍要运行"。\n`);

  // 5. 下载到临时目录（用重定向 URL 以支持大文件）
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srt-'));
  const exePath = path.join(tmpDir, asset.name);
  log(`下载中... (保存到 ${tmpDir})`);

  // 从 GitHub 下载（跟随重定向）
  const dlUrl = asset.browser_download_url;

  await new Promise((resolve, reject) => {
    const u = new URL(dlUrl);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'srt-cli/1.0', 'Accept': 'application/octet-stream' },
    };
    https.get(opts, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // 跟随重定向（GitHub Release 下载链接会重定向到 S3）
        const u2 = new URL(res.headers.location);
        opts.hostname = u2.hostname;
        opts.path = u2.pathname + u2.search;
        https.get(opts, (res2) => {
          const file = fs.createWriteStream(exePath);
          let downloaded = 0;
          res2.on('data', (chunk) => {
            downloaded += chunk.length;
            if (downloaded % (10 * 1048576) === 0) {
              log(`  已下载 ${(downloaded / 1048576).toFixed(0)}MB / ${sizeMB}MB`);
            }
          });
          res2.pipe(file);
          file.on('finish', () => { file.close(); log('下载完成。'); resolve(); });
          file.on('error', reject);
        }).on('error', reject);
      } else {
        const file = fs.createWriteStream(exePath);
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      }
    }).on('error', reject);
  });

  // 6. 运行安装包
  log('启动安装程序...');
  try {
    execSync(`"${exePath}"`, { stdio: 'inherit' });
  } catch (e) {
    // NSIS 安装器退出码可能是 0（成功）或用户取消，忽略非零退出码
    if (e.status !== 0) {
      log(`安装程序已退出 (code ${e.status})`);
    }
  }

  // 7. 清理
  try { fs.unlinkSync(exePath); fs.rmdirSync(tmpDir); } catch (_) {}
  log('完成！在开始菜单或桌面找到"三天remotion"启动。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
