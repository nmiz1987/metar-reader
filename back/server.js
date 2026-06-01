const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 3000;
const FRONT_DIR = path.join(__dirname, '../front');

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'text/javascript',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Proxy endpoint: /metar?ids=KLAX
  if (url.pathname === '/metar') {
    const ids = String(url.searchParams.get('ids') ?? '');
    if (!ids) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing ?ids= parameter');
    }

    const upstream = `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(ids)}`;

    https
      .get(upstream, { headers: { 'User-Agent': 'metar-reader/1.0' } }, (apiRes) => {
        res.writeHead(apiRes.statusCode ?? 200, {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        apiRes.pipe(res);
      })
      .on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`Upstream error: ${err.message}`);
      });

  // Serve static files from front/
  } else {
    const relativePath = url.pathname === '/' ? 'html/index.html' : url.pathname.slice(1);
    const filePath = path.join(FRONT_DIR, relativePath);

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      const ct = MIME[path.extname(filePath)] ?? 'text/plain';
      res.writeHead(200, { 'Content-Type': ct });
      res.end(data);
    });
  }
});

server.listen(PORT, () => {
  console.log(`METAR Reader running at http://localhost:${PORT}`);
});
