// Cloudflare Worker + Durable Object relay. One Room object per lobby code.
// Uses the WebSocket Hibernation API so idle lobbies cost no duration.
import { newRoom, genCode, join, leave, handle, CODE_RE } from "./room_core.mjs";

const ROOM_TTL_MS = 60 * 60 * 1000;      // unused rooms are deleted after an hour
const EMPTY_TTL_MS = 10 * 60 * 1000;     // emptied rooms are deleted after ten minutes

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.st = null;
    ctx.blockConcurrencyWhile(async () => { this.st = (await ctx.storage.get("st")) || null; });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  sockets(slot) { return this.ctx.getWebSockets().filter(w => { const a = w.deserializeAttachment(); return a && a.slot === slot; }); }
  deliver(out, selfWs) {
    for (const o of out) {
      const targets = o.to === "self" ? [selfWs] : o.to === "all" ? this.ctx.getWebSockets() : this.sockets(o.to);
      for (const w of targets) { try { w.send(o.raw); } catch (e) { /* peer already gone */ } }
    }
  }
  save() { return this.ctx.storage.put("st", this.st); }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/init") {
      if (this.st) return new Response("taken", { status: 409 });
      this.st = newRoom(); await this.save();
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return new Response("ok");
    }
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const fail = reason => { server.send(JSON.stringify({ t: "error", reason })); server.close(1008, reason); };
    if (!this.st) fail("no-room");
    else {
      const j = join(this.st);
      if (j.slot < 0) this.deliver(j.out, server), server.close(1008, "full");
      else { server.serializeAttachment({ slot: j.slot }); await this.save(); this.deliver(j.out, server); }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, msg) {
    const a = ws.deserializeAttachment(); if (!a || !this.st) return;
    const r = handle(this.st, a.slot, typeof msg === "string" ? msg : "", Math.random);
    if (r.changed) await this.save();
    this.deliver(r.out, ws);
  }

  async gone(ws, code) {
    try { ws.close(code && code !== 1005 && code !== 1006 ? code : 1000, "bye"); } catch (e) { /* already closed */ }
    const a = ws.deserializeAttachment(); if (!a || !this.st) return;
    this.deliver(leave(this.st, a.slot), ws);
    await this.save();
    if (!this.st.players[0] && !this.st.players[1]) await this.ctx.storage.setAlarm(Date.now() + EMPTY_TTL_MS);
  }
  webSocketClose(ws, code) { return this.gone(ws, code); }
  webSocketError(ws) { return this.gone(ws, 1011); }

  async alarm() {
    if (this.ctx.getWebSockets().length > 0) { await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS); return; }
    await this.ctx.storage.deleteAll(); this.st = null;
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = { "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "content-type" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (url.pathname === "/create" && req.method === "POST") {
      for (let i = 0; i < 8; i++) {
        const code = genCode(Math.random);
        const r = await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch("https://room/init");
        if (r.status === 200) return new Response(JSON.stringify({ code }), { headers: { ...cors, "content-type": "application/json" } });
      }
      return new Response("busy", { status: 503, headers: cors });
    }
    const m = url.pathname.match(/^\/ws\/([A-Za-z0-9]{5})$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!CODE_RE.test(code)) return new Response("bad code", { status: 400, headers: cors });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }
    if (url.pathname === "/") return new Response("versus relay ok", { headers: cors });
    return new Response("not found", { status: 404, headers: cors });
  },
};
