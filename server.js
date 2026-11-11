// Servidor de chat anónimo. Sin dependencias: solo Node.js 16+.
// No guarda mensajes, no lee ni registra IPs, no usa cookies, no hace logs de peticiones.
// Todo (texto, imágenes, encuestas, votos, reacciones) solo se retransmite a los conectados: el servidor no lo almacena.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const GRACIA = 30 * 60 * 1000; // una sala vacía sigue existiendo 30 min (para que los amigos lleguen)
const rooms = new Map();       // codigo -> { conns:Set<res>, timer }  (solo en memoria)
const TYPES = { '.html':'text/html; charset=utf-8', '.json':'application/json', '.js':'text/javascript', '.svg':'image/svg+xml' };
const clean = c => String(c || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);

const MAX_IMG = 1200000;   // caracteres máx. de la imagen (base64) ≈ 900 KB
const MAX_BODY = 1500000;  // tamaño máx. de una petición /send
const IMG = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const ID = /^[a-f0-9]{1,16}$/, UID = /^[a-z0-9]{6,16}$/i;
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const newId = () => crypto.randomBytes(5).toString('hex');

function body(req, max) {
  return new Promise(ok => {
    let d = '';
    req.setEncoding('utf8');
    req.on('data', c => { d += c; if (d.length > max) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(d)); } catch { ok({}); } });
    req.on('close', () => ok({}));
  });
}

// Valida y limpia un evento. Devuelve null si no es válido.
function evento(b) {
  const k = b.k || 'm';
  if (k === 'm') {
    const t = str(b.t != null ? b.t : b.text, 500);
    const i = typeof b.i === 'string' && b.i.length <= MAX_IMG && IMG.test(b.i) ? b.i : '';
    if (!t && !i) return null;
    const ev = { k: 'm', id: newId(), t };
    if (i) ev.i = i;
    if (b.q && typeof b.q.id === 'string' && ID.test(b.q.id)) ev.q = { id: b.q.id, s: str(b.q.s, 80) };
    return ev;
  }
  if (k === 'p') {
    const q = str(b.q, 200);
    const o = Array.isArray(b.o) ? b.o.map(x => str(x, 100)).filter(Boolean).slice(0, 6) : [];
    if (!q || o.length < 2) return null;
    return { k: 'p', id: newId(), q, o };
  }
  if (k === 'v') {
    const n = Number.isInteger(b.n) ? b.n : -2;
    if (typeof b.id !== 'string' || !ID.test(b.id) || typeof b.u !== 'string' || !UID.test(b.u) || n < -1 || n > 5) return null;
    return { k: 'v', id: b.id, u: b.u, n };
  }
  if (k === 'r') {
    if (typeof b.id !== 'string' || !ID.test(b.id) || typeof b.u !== 'string' || !UID.test(b.u) || !EMOJIS.includes(b.e)) return null;
    return { k: 'r', id: b.id, u: b.u, e: b.e, on: !!b.on };
  }
  return null;
}

http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'POST' && req.url === '/join') {
    const b = await body(req, 4000), code = clean(b.room);
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
    const b = await body(req, MAX_BODY), room = rooms.get(clean(b.room));
    const ev = room && evento(b);
    if (ev) {
      const msg = `data: ${JSON.stringify(ev)}\n\n`; // solo el contenido, sin autor ni hora
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
