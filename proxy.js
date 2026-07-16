#!/usr/bin/env node
// aionui-rtl-proxy — reverse-proxies AionUi and injects RTL CSS+JS into HTML.
// Pure Node stdlib (no npm). Transparent WebSocket upgrade passthrough.
//
// Source untouched: this lives at ~/.local/share/aionui-rtl-patch/.
// AionUi is bound to 127.0.0.1:25807; this proxy listens on [::]:25808.
//
// 2026-06-16 upload-hang fix (v3 — root cause: backend requires Expect:100-continue
// for large bodies). Diagnosis: a large upload (>~3MB) sent to the AionUi backend
// WITHOUT the HTTP/1.1 100-continue handshake makes the backend hang and never
// respond (verified: direct curl to :25807 at 10MB is 10/10 WITH Expect, 4/10
// WITHOUT). Browsers/XHR (and the old proxy) send large bodies without Expect, so
// uploads "spin forever". Fix: BUFFER the client request body in full, then forward
// it to the backend performing the 100-continue handshake ourselves for large
// bodies (flush headers, wait for the backend's "100 Continue", then send the body;
// fallback timer covers endpoints that don't 100). Small bodies skip the handshake.
// Responses still stream untouched (downloads verified byte-identical). Dedicated
// upstream socket per request. WebSocket upgrades pass through raw, unchanged.

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

// Bodies larger than this are forwarded using the backend's required
// 100-continue handshake. The AionUi backend intermittently fails to respond
// to bodies sent WITHOUT the handshake (verified: rapid 50KB direct-to-backend
// is 12/12 with Expect, ~5/12 without), so the threshold is set low enough that
// every real file upload uses it. Tiny chatty JSON API calls (< 8KB) stay direct
// to avoid a needless round-trip; they work fine at real (human-spaced) rates.
const HANDSHAKE_THRESHOLD = 8 * 1024; // 8 KB
const CONTINUE_FALLBACK_MS = 1000;      // send body anyway if no "100 Continue" arrives

const INJECTED =
  '<link rel="stylesheet" href="' + ASSET_PREFIX + 'rtl.css?v=9">' +
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
  '<script src="' + ASSET_PREFIX + 'rtl.js?v=9" defer></script>';

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

// Only genuine HTML *documents* get buffered + RTL-injected. An attachment
// (Content-Disposition: attachment) or any non-text/html body streams through.
function isHtmlDocument(upRes) {
  const ct = (upRes.headers['content-type'] || '').toLowerCase();
  const cd = (upRes.headers['content-disposition'] || '').toLowerCase();
  return ct.includes('text/html') && !cd.includes('attachment');
}

function relayResponse(res, upRes) {
  if (isHtmlDocument(upRes)) {
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
    upRes.on('error', () => { try { res.end(); } catch(e){} });
  } else {
    res.writeHead(upRes.statusCode, upRes.headers);
    upRes.pipe(res);
    upRes.on('error', () => { try { res.destroy(); } catch(e){} });
  }
}

function proxyHttp(req, res) {
  const headers = Object.assign({}, req.headers);
  delete headers['accept-encoding']; // need plain HTML to inject reliably
  delete headers['expect'];          // we manage the upstream handshake ourselves

  // `bodyBuf` is a Buffer for body-bearing requests, or null to stream a bodyless req (GET/HEAD).
  const forward = (bodyBuf) => {
    const outHeaders = Object.assign({}, headers);
    let responded = false;
    if (bodyBuf !== null) {
      delete outHeaders['transfer-encoding'];
      outHeaders['content-length'] = String(bodyBuf.length);
    }
    const useHandshake = bodyBuf !== null && bodyBuf.length > HANDSHAKE_THRESHOLD;
    if (useHandshake) outHeaders['expect'] = '100-continue';

    const upstream = http.request({
      host: UPSTREAM_HOST, port: UPSTREAM_PORT,
      method: req.method, path: req.url, headers: outHeaders,
      agent: false                   // dedicated socket per request — no pooled reuse
    }, upRes => { responded = true; relayResponse(res, upRes); });

    upstream.on('error', err => {
      // After a response, this can only be the abandoned request side failing.
      if (responded) return;
      if (!res.headersSent) {
        try { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('upstream error: ' + err.message); }
        catch (e) { try { res.destroy(); } catch(e2){} }
      } else { try { res.destroy(); } catch(e){} }
    });
    res.on('close', () => { if (!responded) { try { upstream.destroy(); } catch(e){} } });

    if (bodyBuf === null) {
      req.on('error', () => { try { upstream.destroy(); } catch(e){} });
      req.pipe(upstream);
      return;
    }
    if (useHandshake) {
      // Perform the 100-continue handshake with the backend: flush headers, wait
      // for "100 Continue", then send the body. The backend needs this for large
      // bodies or it hangs. Fallback sends the body anyway if no 100 arrives.
      let sent = false, fb = null;
      const send = () => { if (sent) return; sent = true; if (fb) clearTimeout(fb); try { upstream.end(bodyBuf); } catch(e){} };
      upstream.on('continue', send);
      fb = setTimeout(send, CONTINUE_FALLBACK_MS);
      try { upstream.flushHeaders(); } catch(e) { send(); }
    } else {
      upstream.end(bodyBuf);
    }
  };

  const hasBody = (!!req.headers['content-length'] && req.headers['content-length'] !== '0')
               || !!req.headers['transfer-encoding'];

  if (hasBody) {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => forward(Buffer.concat(chunks)));
    req.on('error', () => { /* client aborted before full body; nothing forwarded */ });
  } else {
    forward(null);
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith(ASSET_PREFIX)) return serveAsset(req, res);
  return proxyHttp(req, res);
});

// NOTE: no 'checkContinue' handler — Node auto-acks the client's 100-continue so
// the client streams its body to us, which we buffer. We then run our OWN
// 100-continue handshake with the backend (above). This decouples the two legs.

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
