var http = require('http');
var fs = require('fs');
var path = require('path');
var { exec } = require('child_process');
var PORT = 3456;
var ROOT = __dirname;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

/* 读取 POST body 为 JSON */
function readBody(req, cb) {
  var chunks = [];
  req.on('data', function(c) { chunks.push(c); });
  req.on('end', function() {
    try { cb(null, JSON.parse(Buffer.concat(chunks).toString())); }
    catch(e) { console.error('[readBody] JSON 解析失败:', e.message); cb(e); }
  });
}

/* 执行命令，返回 {ok, stdout, stderr, exitCode} */
function runCmd(cmd, timeout, cb) {
  timeout = timeout || 15000;
  exec(cmd, { timeout: timeout, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, function(err, stdout, stderr) {
    if (err) {
      cb({ ok: false, stdout: (stdout || '').trim(), stderr: (stderr || '').trim(), exitCode: err.code || 1, killed: err.killed });
    } else {
      cb({ ok: true, stdout: (stdout || '').trim(), stderr: (stderr || '').trim(), exitCode: 0 });
    }
  });
}

/* 安装命令映射 */
var INSTALL = {
  ffmpeg:  'winget install "FFmpeg" --accept-package-agreements --silent',
  python:  'winget install Python.Python.3.11 --accept-package-agreements --silent',
  node:    'winget install OpenJS.NodeJS.LTS --accept-package-agreements --silent',
  whisper: 'pip install faster-whisper soundfile numpy --quiet'
};

http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  /* ── POST /api/exec ── 运行一个命令 */
  if (req.method === 'POST' && req.url === '/api/exec') {
    readBody(req, function(err, body) {
      if (err) { res.writeHead(400); res.end(JSON.stringify({ok:false,error:'请求体 JSON 无效'})); return; }
      var cmd = body.cmd;
      if (!cmd) { res.writeHead(400); res.end(JSON.stringify({ok:false,error:'缺少 cmd 参数'})); return; }
      console.log('[exec] ' + cmd);
      runCmd(cmd, body.timeout || 15000, function(result) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      });
    });
    return;
  }

  /* ── POST /api/install ── 安装工具 */
  if (req.method === 'POST' && req.url === '/api/install') {
    readBody(req, function(err, body) {
      if (err) { res.writeHead(400); res.end(JSON.stringify({ok:false,error:'请求体 JSON 无效'})); return; }
      var tool = body.tool;
      var cmd = INSTALL[tool];
      if (!cmd) { res.writeHead(400); res.end(JSON.stringify({ok:false,error:'未知工具: ' + tool})); return; }
      console.log('[install] ' + cmd);
      /* 安装命令超时 5 分钟 */
      runCmd(cmd, 300000, function(result) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      });
    });
    return;
  }

  /* ── 静态文件 ── */
  var reqPath = req.url.split('?')[0];
  var filePath = path.resolve(ROOT, '.' + (reqPath.startsWith('/') ? reqPath : '/' + reqPath));
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    console.error('[static] 路径穿越尝试: ' + req.url);
    res.writeHead(403); res.end('Forbidden'); return;
  }
  if (filePath === ROOT + path.sep || req.url === '/') {
    filePath = path.join(ROOT, '主页.html');
  }
  fs.readFile(filePath, function(err, data) {
    if (err) {
      console.error('[static] 文件读取失败:', filePath, err.message);
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    var ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, function() {
  console.log('三天remotion 本地服务器已启动: http://localhost:' + PORT);
  console.log('  POST /api/exec     — 执行命令  {cmd, timeout?}');
  console.log('  POST /api/install  — 安装工具  {tool: ffmpeg|python|node|whisper}');
  console.log('按 Ctrl+C 停止');
});
