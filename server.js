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

function createStaticServer({ root = path.join(__dirname, 'app') } = {}) {
  const staticRoot = path.resolve(root);

  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch (_) {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }

    const requestPath = pathname === '/' ? '/主页.html' : pathname;
    const filePath = path.resolve(staticRoot, '.' + (requestPath.startsWith('/') ? requestPath : '/' + requestPath));
    if (filePath !== staticRoot && !filePath.startsWith(staticRoot + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const contentType = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
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
