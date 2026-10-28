// Pure room logic, shared by the Cloudflare Worker and the local dev server.
// State: { players: [null | {ready, mode, ch}, null | {...}], n: matchCount }
// The server never looks at game state. It pairs two players, picks the seed, and forwards messages.
export const MODES = ["blocks", "chain", "panel", "bubble"];
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I, L, O, 0, 1
export const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
export const MAX_MSG = 2048;

export function newRoom() { return { players: [null, null], n: 0 }; }

export function genCode(rnd) {
  let c = "";
  for (let i = 0; i < 5; i++) c += CODE_ALPHABET[Math.floor(rnd() * CODE_ALPHABET.length)];
  return c;
}

export function roomMsg(st) {
  return JSON.stringify({ t: "room", players: st.players.map(p => p && { ready: p.ready, mode: p.mode, ch: p.ch }) });
}

// Seat a new connection. Returns {slot, out}; slot -1 means full.
export function join(st) {
  const slot = st.players.findIndex(p => p === null);
  if (slot < 0) return { slot: -1, out: [{ to: "self", raw: JSON.stringify({ t: "error", reason: "full" }) }] };
  st.players[slot] = { ready: false, mode: "blocks", ch: slot };
  return { slot, out: [
    { to: "self", raw: JSON.stringify({ t: "welcome", slot }) },
    { to: "all", raw: roomMsg(st) }] };
}

// A connection closed. Tell whoever remains.
export function leave(st, slot) {
  if (slot !== 0 && slot !== 1) return [];
  st.players[slot] = null;
  const o = 1 - slot, out = [];
  if (st.players[o]) { st.players[o].ready = false; out.push({ to: o, raw: JSON.stringify({ t: "left" }) }); out.push({ to: o, raw: roomMsg(st) }); }
  return out;
}

// Handle one message from `slot`. Returns {changed, out}. Relay messages never change state.
export function handle(st, slot, raw, rnd) {
  const res = { changed: false, out: [] };
  if (typeof raw !== "string" || raw.length > MAX_MSG || (slot !== 0 && slot !== 1)) return res;
  let m; try { m = JSON.parse(raw); } catch (e) { return res; }
  if (!m || typeof m.t !== "string") return res;
  const o = 1 - slot, me = st.players[slot];
  if (!me) return res;
  switch (m.t) {
    case "b": case "h": case "p": case "q":   // inputs, hashes, ping, pong: forward untouched
      if (st.players[o]) res.out.push({ to: o, raw });
      return res;
    case "pick": case "ready": {
      if (MODES.includes(m.mode)) me.mode = m.mode;
      if (m.ch === 0 || m.ch === 1) me.ch = m.ch;
      me.ready = m.t === "ready" && m.ready !== false;
      res.changed = true;
      if (st.players[0] && st.players[1] && st.players[0].ready && st.players[1].ready) {
        st.n++;
        const seed = Math.floor(rnd() * 0x7fffffff);
        res.out.push({ to: "all", raw: JSON.stringify({ t: "start", seed, n: st.n,
          modes: [st.players[0].mode, st.players[1].mode], chars: [st.players[0].ch, st.players[1].ch] }) });
        st.players[0].ready = false; st.players[1].ready = false;
      }
      res.out.push({ to: "all", raw: roomMsg(st) });
      return res;
    }
    default: return res;
  }
}
