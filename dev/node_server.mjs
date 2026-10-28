// Local relay with the same protocol as the Cloudflare Worker. No dependencies (tiny RFC 6455 server).
// Run:  node dev/node_server.mjs [port]      Used by the test suite with latency injection.
import http from "node:http";
import crypto from "node:crypto";
import { newRoom, genCode, join, leave, handle, CODE_RE } from "../src/room_core.mjs";

function frame(str) {
  const p = Buffer.from(str), n = p.length;
  const h = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : null;
  return Buffer.concat([h, p]);
}
function parser(onText, onClose) {
  let buf = Buffer.alloc(0);
  return chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 15; let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { onClose(); return; }
      const masked = (buf[1] & 128) !== 0, need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      const mask = masked ? buf.subarray(off, off + 4) : null; off += masked ? 4 : 0;
      const data = Buffer.from(buf.subarray(off, off + len));
      if (mask) for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(need);
      if (op === 1) onText(data.toString("utf8")); else if (op === 8) { onClose(); return; }
    }
  };
}

export function startServer({ port = 0, delay = 0, jitter = 0 } = {}) {
  const rooms = new Map(); // code -> {st, socks:[null,null]}
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "content-type" };
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    if (req.method === "POST" && req.url === "/create") {
      let code; do code = genCode(Math.random); while (rooms.has(code));
      rooms.set(code, { st: newRoom(), socks: [null, null] });
      res.writeHead(200, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ code }));
    }
    res.writeHead(200, cors); res.end("Puzzle Attack relay ok");
  });
  const send = (sock, raw) => {
    if (sock.destroyed) return;
    const d = delay + Math.random() * jitter;
    if (d <= 0) sock.write(frame(raw));
    else { // keep ordering like TCP: never let a later message overtake an earlier one
      sock._at = Math.max(sock._at || 0, Date.now() + d);
      setTimeout(() => { if (!sock.destroyed) sock.write(frame(raw)); }, sock._at - Date.now());
    }
  };
  server.on("upgrade", (req, sock) => {
    const m = req.url.match(/^\/ws\/([A-Za-z0-9]{5})$/);
    const key = req.headers["sec-websocket-key"];
    if (!m || !key) return sock.destroy();
    sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
      crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64") + "\r\n\r\n");
    sock.setNoDelay(true);
    const code = m[1].toUpperCase(), room = CODE_RE.test(code) && rooms.get(code);
    const deliver = (out) => { for (const o of out) {
      const t = o.to === "self" ? [sock] : o.to === "all" ? room.socks : [room.socks[o.to]];
      for (const s of t) if (s) send(s, o.raw); } };
    if (!room) { sock.write(frame(JSON.stringify({ t: "error", reason: "no-room" }))); return sock.end(); }
    const j = join(room.st);
    if (j.slot < 0) { deliver(j.out); return setTimeout(() => sock.end(), 50); }
    const slot = j.slot; room.socks[slot] = sock; deliver(j.out);
    let closed = false;
    const close = () => {
      if (closed) return; closed = true; room.socks[slot] = null; sock.destroy();
      deliver(leave(room.st, slot));
      if (!room.socks[0] && !room.socks[1]) rooms.delete(code);
    };
    sock.on("data", parser(txt => { if (txt === "ping") return send(sock, "pong"); const r = handle(room.st, slot, txt, Math.random); deliver(r.out); }, close));
    sock.on("close", close); sock.on("error", close);
  });
  return new Promise(resolve => server.listen(port, () => resolve({
    port: server.address().port, rooms,
    close: () => new Promise(r => { for (const room of rooms.values()) room.socks.forEach(s => s && s.destroy()); server.close(r); server.closeAllConnections && server.closeAllConnections(); }) })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startServer({ port: +process.argv[2] || 8787 });
  console.log("Puzzle Attack relay listening on http://localhost:" + s.port);
}
