const fs = require('fs');
const http = require('http');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};
const ERROR_CONTENT_TYPE = 'text/plain; charset=utf-8';

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative)
  );
}

function sendError(req, res, statusCode, message) {
  res.writeHead(statusCode, { 'Content-Type': ERROR_CONTENT_TYPE });
  res.end(req.method === 'HEAD' ? undefined : message);
}

function createStaticServer({ root = path.join(__dirname, 'app') } = {}) {
  const staticRoot = fs.realpathSync(path.resolve(root));

  return http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendError(req, res, 404, 'Not Found');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch (_) {
      sendError(req, res, 400, 'Bad Request');
      return;
    }
    if (pathname.includes('\0')) {
      sendError(req, res, 400, 'Bad Request');
      return;
    }

    let filePath;
    try {
      const requestPath = pathname === '/' ? '/主页.html' : pathname;
      filePath = path.resolve(staticRoot, '.' + (requestPath.startsWith('/') ? requestPath : '/' + requestPath));
    } catch (_) {
      sendError(req, res, 400, 'Bad Request');
      return;
    }
    if (!isWithinRoot(staticRoot, filePath)) {
      sendError(req, res, 403, 'Forbidden');
      return;
    }

    try {
      const canonicalFile = await fs.promises.realpath(filePath);
      if (!isWithinRoot(staticRoot, canonicalFile)) {
        sendError(req, res, 403, 'Forbidden');
        return;
      }
      const data = await fs.promises.readFile(canonicalFile);
      const contentType = MIME[path.extname(canonicalFile).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (_) {
      if (!res.headersSent) sendError(req, res, 404, 'Not Found');
      else res.destroy();
    }
  });
}

function startStaticServer({ port = 3456 } = {}) {
  const server = createStaticServer();
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { createStaticServer, startStaticServer };

if (require.main === module) {
  const server = startStaticServer();
  server.on('listening', () => {
    console.log('三天remotion 本地服务器已启动，仅监听当前电脑。');
  });
}
