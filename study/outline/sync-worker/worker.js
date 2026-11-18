// gkc-notes-sync Worker (KV binding NOTES). Values are client-side encrypted envelopes.
// v2 (2026-11-11): streamed GET/PUT (no 20 MB string copies → no exceededResources),
// 25 MB KV limit, per-write revision in KV metadata, cheap ?meta=1 polling, and
// optional compare-and-swap (X-Base-Rev) so a device that merged an older copy
// cannot overwrite another device's newer upload. Old clients keep working.
// v3 (2026-11-18): device linking (/link/<slot>) in a Durable Object (LINK, class LinkRoom).
// A connected device stores an AES-GCM ciphertext of the sync secret under a slot id; both
// the slot id and the key are PBKDF2 outputs of a short code the user shows on screen, so
// this Worker never sees the code, the key or the secret. Slots live 10 minutes, are
// handed out once, and creating/claiming is rate-limited per IP. /v1 is unchanged.
const ORIGINS = ["https://youngja1479-prog.github.io"];
const MAX = 25 * 1024 * 1024 - 4096;
function cors(req) {
  const o = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Methods": "GET,PUT,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Base-Rev,X-Updated-At",
    "Access-Control-Expose-Headers": "X-Rev,X-Updated-At",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
async function currentMeta(env, k) {
  const r = await env.NOTES.getWithMetadata(k, { type: "stream" });
  if (r.value) { try { await r.value.cancel(); } catch (_) {} }
  if (!r.value) return { rev: "empty", at: 0, exists: false };
  const md = r.metadata || {};
  return { rev: md.rev || "legacy", at: md.at || 0, size: md.size || 0, exists: true };
}
export default {
  async fetch(req, env) {
    const h = cors(req);
    try {
      if (req.method === "OPTIONS") return new Response(null, { headers: h });
      const url = new URL(req.url);
      const lm = url.pathname.match(/^\/link\/([a-f0-9]{64})(\/claim|\/status)?$/);
      if (lm) {
        if (!env.LINK) return new Response("linking not available", { status: 501, headers: h });
        const ip = req.headers.get("CF-Connecting-IP") || "local";
        const stub = env.LINK.get(env.LINK.idFromName("global"));
        const body = (req.method === "POST" && !lm[2]) ? await req.text() : null;
        if (body && body.length > LINK_MAX) return new Response("too big", { status: 413, headers: h });
        const r = await stub.fetch("https://link/" + lm[1] + (lm[2] || ""), { method: req.method, headers: { "X-IP": ip }, body });
        return new Response(r.body, { status: r.status, headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store" } });
      }
      const m = url.pathname.match(/^\/v1\/([a-f0-9]{64})$/);
      if (!m) return new Response("ok", { headers: h });
      const k = m[1];
      if (req.method === "GET") {
        if (url.searchParams.get("meta") === "1") {
          const md = await currentMeta(env, k);
          return new Response(JSON.stringify(md), { headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store" } });
        }
        const r = await env.NOTES.getWithMetadata(k, { type: "stream" });
        const md = r.metadata || {};
        const hh = { ...h, "Content-Type": "application/json", "Cache-Control": "no-store",
          "X-Rev": r.value ? (md.rev || "legacy") : "empty", "X-Updated-At": String(md.at || 0) };
        return new Response(r.value || "null", { headers: hh });
      }
      if (req.method === "PUT") {
        const len = Number(req.headers.get("Content-Length") || "0");
        if (len > MAX) return new Response("too big", { status: 413, headers: h });
        const base = req.headers.get("X-Base-Rev");
        if (base) {
          const cur = await currentMeta(env, k);
          if (cur.rev !== base) {
            return new Response(JSON.stringify({ conflict: true, rev: cur.rev, at: cur.at }), { status: 409, headers: { ...h, "Content-Type": "application/json", "X-Rev": cur.rev } });
          }
        }
        const body = await req.arrayBuffer();
        if (body.byteLength > MAX) return new Response("too big", { status: 413, headers: h });
        if (body.byteLength < 2) return new Response("empty", { status: 400, headers: h });
        const rev = Date.now().toString(36) + "-" + crypto.randomUUID().slice(0, 8);
        const at = Number(req.headers.get("X-Updated-At") || "0") || Date.now();
        await env.NOTES.put(k, body, { metadata: { rev, at, size: body.byteLength } });
        return new Response("saved", { headers: { ...h, "X-Rev": rev } });
      }
      return new Response("no", { status: 405, headers: h });
    } catch (e) {
      // Always answer with CORS headers so the page can show the real reason.
      return new Response("server error: " + (e && e.message || e), { status: 500, headers: h });
    }
  }
};

// ---------- device linking ----------
const LINK_MAX = 4096;            // ciphertext of a small JSON
const LINK_TTL = 10 * 60 * 1000;  // a code works for 10 minutes
const RL = { create: [20, 60 * 60 * 1000], claim: [12, 10 * 60 * 1000] }; // per IP: [max, window]
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
export class LinkRoom {
  constructor(state, env) { this.state = state; this.storage = state.storage; this.ttl = Number(env && env.LINK_TTL_MS) || LINK_TTL; }
  async limited(kind, ip, count) {
    const [max, win] = RL[kind], key = "rl:" + kind + ":" + ip, now = Date.now();
    let r = await this.storage.get(key);
    if (!r || r.reset < now) r = { n: 0, reset: now + win };
    if (r.n >= max) return Math.ceil((r.reset - now) / 1000);
    if (count) { r.n++; await this.storage.put(key, r); await this.wake(r.reset); }
    return 0;
  }
  async wake(at) {
    const cur = await this.storage.getAlarm();
    if (!cur || cur > at) await this.storage.setAlarm(at);
  }
  async fetch(req) {
    const url = new URL(req.url), [, slot, part] = url.pathname.split("/"), sub = part ? "/" + part : "";
    const ip = req.headers.get("X-IP") || "local", key = "s:" + slot, now = Date.now();
    let s = await this.storage.get(key);
    if (s && s.exp < now) { await this.storage.delete(key); s = null; }
    if (req.method === "POST" && !sub) {            // connected device: offer the encrypted secret
      const wait = await this.limited("create", ip, true);
      if (wait) return J({ error: "rate", retryAfter: wait }, 429);
      let b; try { b = JSON.parse(await req.text()); } catch (_) { return J({ error: "bad" }, 400); }
      if (!b || typeof b.iv !== "string" || typeof b.ct !== "string" || b.iv.length > 64 || b.ct.length > LINK_MAX) return J({ error: "bad" }, 400);
      if (s) return J({ error: "exists" }, 409);
      const exp = now + this.ttl;
      await this.storage.put(key, { iv: b.iv, ct: b.ct, exp, used: false });
      await this.wake(exp);
      return J({ ok: true, exp });
    }
    if (req.method === "POST" && sub === "/claim") { // new device: take it, once
      const wait = await this.limited("claim", ip, false);
      if (wait) return J({ error: "rate", retryAfter: wait }, 429);
      if (!s) { await this.limited("claim", ip, true); return J({ error: "notfound" }, 404); }
      if (s.used) { await this.limited("claim", ip, true); return J({ error: "used" }, 410); }
      await this.storage.put(key, { exp: s.exp, used: true, usedAt: now }); // ciphertext is gone after this
      return J({ iv: s.iv, ct: s.ct });
    }
    if (req.method === "GET" && sub === "/status") {
      return J({ state: !s ? "gone" : (s.used ? "used" : "waiting"), exp: s ? s.exp : 0 });
    }
    if (req.method === "DELETE" && !sub) {           // the showing device cancels / closes
      if (s) await this.storage.delete(key);
      return J({ ok: true });
    }
    return J({ error: "no" }, 405);
  }
  async alarm() {
    const now = Date.now(); let next = 0;
    const all = await this.storage.list();
    for (const [k, v] of all) {
      const t = k.startsWith("s:") ? v.exp : (k.startsWith("rl:") ? v.reset : 0);
      if (!t) continue;
      if (t <= now) await this.storage.delete(k); else if (!next || t < next) next = t;
    }
    if (next) await this.storage.setAlarm(next);
  }
}
