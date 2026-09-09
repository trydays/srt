const fsPromises = require('node:fs/promises');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const MIME_BY_EXTENSION = Object.freeze({
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska'
});

function parseRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size <= 0) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start >= size || end < start) return false;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

async function createRenderAssetSession({ assetId, videoPath }) {
  if (typeof assetId !== 'string' || !assetId.trim()
      || typeof videoPath !== 'string' || !videoPath) {
    throw new TypeError('Invalid render asset');
  }

  const realPath = await fsPromises.realpath(videoPath);
  const file = await fsPromises.open(realPath, 'r');
  let fileClosed = false;
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new TypeError('Render asset must be a regular file');

    const route = `/${randomBytes(32).toString('hex')}`;
    const contentType = MIME_BY_EXTENSION[path.extname(realPath).toLowerCase()]
      || 'application/octet-stream';
    const streams = new Set();
    const sockets = new Set();
    let closing = false;

    const server = http.createServer((request, response) => {
      const requestPath = new URL(request.url, 'http://127.0.0.1').pathname;
      if (closing || requestPath !== route) {
        response.writeHead(404, { 'Content-Length': '0' });
        response.end();
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Length': '0' });
        response.end();
        return;
      }

      const range = parseRange(request.headers.range, stat.size);
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
      };
      if (range === false) {
        response.writeHead(416, {
          ...headers,
          'Content-Range': `bytes */${stat.size}`,
          'Content-Length': '0'
        });
        response.end();
        return;
      }

      const start = range ? range.start : 0;
      const end = range ? range.end : stat.size - 1;
      const length = stat.size === 0 ? 0 : end - start + 1;
      response.writeHead(range ? 206 : 200, {
        ...headers,
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
        'Content-Length': String(length)
      });
      if (request.method === 'HEAD' || stat.size === 0) {
        response.end();
        return;
      }

      // A response borrows the session's pinned descriptor. Destroying a
      // FileHandle ReadStream closes that handle even with autoClose:false;
      // a video remount/aborted Range must not close another reader's file.
      const stream = fs.createReadStream(null, {
        fd: file.fd,
        fs: { read: fs.read, close: (_fd, done) => done(null) },
        autoClose: false,
        start,
        end
      });
      streams.add(stream);
      const forget = () => streams.delete(stream);
      stream.once('close', forget);
      stream.once('error', (error) => {
        forget();
        if (!response.destroyed) response.destroy(error);
      });
      response.once('close', () => {
        if (!stream.destroyed) stream.destroy();
      });
      stream.pipe(response);
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(0, '127.0.0.1');
    });

    const address = server.address();
    const assets = { [assetId]: { src: `http://127.0.0.1:${address.port}${route}` } };
    let closePromise;
    function close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        const closed = new Promise((resolve) => server.close(resolve));
        const readersClosed = [...streams].map(stream => new Promise(resolve => {
          stream.once('close', resolve);
          stream.destroy();
        }));
        for (const socket of sockets) socket.destroy();
        await Promise.all([closed, ...readersClosed]);
        await file.close();
        fileClosed = true;
      })();
      return closePromise;
    }

    return { assets, close };
  } catch (error) {
    if (!fileClosed) await file.close().catch(() => {});
    throw error;
  }
}

module.exports = { createRenderAssetSession };
