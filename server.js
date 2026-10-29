// Servidor de chat anónimo. Sin dependencias: solo Node.js 16+.
// No guarda mensajes, no lee ni registra IPs, no usa cookies, no hace logs de peticiones.
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const GRACIA = 30 * 60 * 1000; // una sala vacía sigue existiendo 30 min (para que los amigos lleguen)
const rooms = new Map();       // codigo -> { conns:Set<res>, timer }  (solo en memoria)
const TYPES = { '.html':'text/html; charset=utf-8', '.json':'application/json', '.js':'text/javascript', '.svg':'image/svg+xml' };
const clean = c => String(c || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);

function body(req) {
  return new Promise(ok => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 4000) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(d)); } catch { ok({}); } });
  });
}

http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'POST' && req.url === '/join') {
    const b = await body(req), code = clean(b.room);
    if (code.length < 4) { res.writeHead(400).end(); return; }
    const existe = rooms.has(code);
    if (b.create && existe) { res.writeHead(409).end(); return; }   // código ya usado: no se puede "crear" encima
    if (!b.create && !existe) { res.writeHead(404).end(); return; } // sin sala creada no se entra
    if (!existe) rooms.set(code, { conns: new Set(), timer: null });
    const room = rooms.get(code);
    clearTimeout(room.timer);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': ok\n\n');
    room.conns.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      room.conns.delete(res);
      if (!room.conns.size) room.timer = setTimeout(() => {
        if (!room.conns.size && rooms.get(code) === room) rooms.delete(code);
      }, GRACIA);
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/send') {
    const b = await body(req), room = rooms.get(clean(b.room));
    const text = String(b.text || '').trim().slice(0, 500);
    if (room && text) {
      const msg = `data: ${JSON.stringify({ t: text })}\n\n`; // solo el texto, nada más
      for (const r of room.conns) r.write(msg);
    }
    res.writeHead(204).end(); return;
  }

  // Archivos estáticos
  let f = req.url.split('?')[0]; if (f === '/') f = '/index.html';
  const file = path.normalize(path.join(PUB, f));
  if (!file.startsWith(PUB)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
  });
}).listen(PORT, () => console.log('Chat anónimo en http://localhost:' + PORT));
