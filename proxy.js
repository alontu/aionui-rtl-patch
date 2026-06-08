#!/usr/bin/env node
// aionui-rtl-proxy — reverse-proxies AionUi and injects RTL CSS+JS into HTML.
// Pure Node stdlib (no npm). Transparent WebSocket upgrade passthrough.
//
// Source untouched: this lives at ~/.local/share/aionui-rtl-patch/.
// AionUi is bound to 127.0.0.1:25807; this proxy listens on [::]:25808.

const http = require('http');
const net  = require('net');
const fs   = require('fs');
const path = require('path');

const LISTEN_HOST   = process.env.RTL_LISTEN_HOST   || '::';
const LISTEN_PORT   = parseInt(process.env.RTL_LISTEN_PORT   || '25808', 10);
const UPSTREAM_HOST = process.env.RTL_UPSTREAM_HOST || '127.0.0.1';
const UPSTREAM_PORT = parseInt(process.env.RTL_UPSTREAM_PORT || '25807', 10);
const ASSET_DIR     = process.env.RTL_ASSET_DIR     || path.dirname(__filename);
const ASSET_PREFIX  = '/__aionui-rtl__/';

const INJECTED =
  '<link rel="stylesheet" href="' + ASSET_PREFIX + 'rtl.css?v=8">' +
  '<script>(function(){' +
  'if(location.search.indexOf("nortl=1")!==-1)return;' +
  'try{if(localStorage.getItem("aionui-rtl-disabled")==="1")return;}catch(e){}' +
  'if(Element.prototype.__aionuiPatched)return;' +
  'var q=window.__aionuiShadowQueue=window.__aionuiShadowQueue||[];' +
  'var orig=Element.prototype.attachShadow;' +
  'Element.prototype.attachShadow=function(init){' +
    'var sr=orig.apply(this,arguments);' +
    'if(sr&&(!init||init.mode!=="closed"))q.push(sr);' +
    'return sr;' +
  '};' +
  'Element.prototype.__aionuiPatched=true;' +
  '})();</script>' +
  '<script src="' + ASSET_PREFIX + 'rtl.js?v=8" defer></script>';

function serveAsset(req, res) {
  const name = req.url.slice(ASSET_PREFIX.length).split('?')[0];
  if (!/^[a-z0-9_.-]+$/i.test(name)) {
    res.writeHead(400); res.end('bad asset name'); return;
  }
  const file = path.join(ASSET_DIR, name);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ct = file.endsWith('.css') ? 'text/css'
             : file.endsWith('.js')  ? 'application/javascript'
             : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'public, max-age=300' });
    res.end(data);
  });
}

function proxyHttp(req, res) {
  const headers = Object.assign({}, req.headers);
  delete headers['accept-encoding']; // need plain HTML to inject reliably
  const upstream = http.request({
    host: UPSTREAM_HOST, port: UPSTREAM_PORT,
    method: req.method, path: req.url, headers
  }, upRes => {
    const ct = (upRes.headers['content-type'] || '').toLowerCase();
    if (ct.includes('text/html')) {
      const outHeaders = Object.assign({}, upRes.headers);
      delete outHeaders['content-length'];
      delete outHeaders['content-encoding'];
      delete outHeaders['transfer-encoding'];
      res.writeHead(upRes.statusCode, outHeaders);
      const chunks = [];
      upRes.on('data', c => chunks.push(c));
      upRes.on('end', () => {
        let body = Buffer.concat(chunks).toString('utf8');
        const lower = body.toLowerCase();
        const idx = lower.indexOf('</head>');
        if (idx !== -1) body = body.slice(0, idx) + INJECTED + body.slice(idx);
        res.end(body);
      });
      upRes.on('error', err => { try { res.end(); } catch(e){} });
    } else {
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
    }
  });
  upstream.on('error', err => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('upstream error: ' + err.message);
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith(ASSET_PREFIX)) return serveAsset(req, res);
  return proxyHttp(req, res);
});

// WebSocket / HTTP-upgrade transparent passthrough via raw TCP.
server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    const lines = [req.method + ' ' + req.url + ' HTTP/1.1'];
    for (const [k, v] of Object.entries(req.headers)) lines.push(k + ': ' + v);
    lines.push('', '');
    upstream.write(lines.join('\r\n'));
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error',  () => upstream.destroy());
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log('aionui-rtl-proxy listening on [' + LISTEN_HOST + ']:' + LISTEN_PORT +
              ' -> ' + UPSTREAM_HOST + ':' + UPSTREAM_PORT);
});
