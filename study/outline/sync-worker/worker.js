// gkc-notes-sync Worker (KV binding NOTES). Values are client-side encrypted envelopes.
// v2 (2026-11-11): streamed GET/PUT (no 20 MB string copies → no exceededResources),
// 25 MB KV limit, per-write revision in KV metadata, cheap ?meta=1 polling, and
// optional compare-and-swap (X-Base-Rev) so a device that merged an older copy
// cannot overwrite another device's newer upload. Old clients keep working.
const ORIGINS = ["https://youngja1479-prog.github.io"];
const MAX = 25 * 1024 * 1024 - 4096;
function cors(req) {
  const o = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
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
