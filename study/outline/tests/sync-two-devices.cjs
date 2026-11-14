// Two-device sync regression (tablet ↔ phone) against the REAL sync Worker code
// running locally in Miniflare (no network, no real vault). Each device is a separate
// VM context executing the page's production sync/merge/crypto code with its own
// DATA (= separate localStorage/IndexedDB). Run: node study/outline/tests/sync-two-devices.cjs
// Needs miniflare (npm i miniflare@3) — path via MINIFLARE_PATH or a local install.
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), assert = require('node:assert/strict');
let Miniflare;
try { ({ Miniflare } = require(process.env.MINIFLARE_PATH || 'miniflare')); }
catch (e) { console.log('SKIP: miniflare not installed'); process.exit(0); }
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const a = script.indexOf("const SYNC_PW_KEY"), b = script.indexOf("/* ========== State ========== */");
const syncBlock = script.slice(a, b);
const workerSrc = fs.readFileSync(path.join(__dirname, '../sync-worker/worker.js'), 'utf8');
const PW = 'throwaway-test-' + Math.random().toString(36).slice(2);
let counts = { get: 0, meta: 0, put: 0, conflict: 0 };

function device(name, mf, clockSkew = 0) {
  const store = {};
  const ctx = {
    console, Math, JSON, Promise, Map, Set, Array, Object, Error, Uint8Array, TextEncoder, TextDecoder, Blob, Response,
    CompressionStream, DecompressionStream, btoa, atob, URL, String, Number, Boolean,
    crypto: require('node:crypto').webcrypto,
    Date: class extends Date { constructor(...x) { x.length ? super(...x) : super(Date.now() + clockSkew); } static now() { return Date.now() + clockSkew; } },
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 30)), clearTimeout, setInterval: () => 0, clearInterval() {},
    navigator: { onLine: true }, document: { visibilityState: 'visible', baseURI: 'https://x/' },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    confirm: () => true, toasts: [], renders: 0,
    fetch: async (u, init = {}) => {
      const url = new URL(u);
      if (init.method === 'PUT') counts.put++; else if (url.search.includes('meta=1')) counts.meta++; else counts.get++;
      const r = await mf.dispatchFetch('http://sync' + url.pathname + url.search, { ...init, headers: { ...(init.headers || {}), Origin: 'https://youngja1479-prog.github.io' } });
      if (r.status === 409) counts.conflict++;
      const body = await r.text();
      return { ok: r.ok, status: r.status, headers: { get: h => r.headers.get(h) }, text: async () => body };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(`
    const SYNC_URL = 'https://gkc-notes-sync.example';
    const LS_KEY = 'gkc-study-notes-v1';
    const $ = () => null;
    function toast(m) { toasts.push(m); }
    function esc(s) { return String(s); }
    const defaultData = () => ({ version: 1, notebooks: [], updatedAt: 0 });
    var DATA = defaultData(); var saveTimer = null;
    const state = { view: 'draw', drawing: false, nbId: 'nb1', mokId: 'm1', sebuId: 's1' };
    async function idbSet() { return true; }
    async function lsSaveData() {}
    function renderHome(){} function renderMokcha(){} function renderSebu(){} function renderTree(){} function goHome(){}
    function getSebu() { const n = DATA.notebooks.find(x => x.id === 'nb1'); const m = n && n.mokchas.find(x => x.id === 'm1'); return m && m.sebus.find(x => x.id === 's1'); }
    function initDrawPage() { renders++; }
    function openModal(){} function closeModal(){}
  ` + syncBlock + `
    globalThis.api = { get DATA() { return DATA; }, set DATA(d) { DATA = d; },
      connectWithPassword, syncPushNow, syncPullAndMaybeApply, syncNowManual, decryptEnvelope, encryptData,
      st: () => ({ syncBusy, syncPendingPush, syncConflicts, syncLastError }) };
  `, ctx);
  const api = ctx.api;
  api.name = name;
  // what the page's draw code does on pen-up: push stroke with id, bump updatedAt
  api.draw = (n, tag) => {
    let s = api.getSebu();
    if (!s) throw new Error('no sebu');
    const p = s.pages[0];
    for (let i = 0; i < n; i++) {
      const pts = []; let x = Math.random() * 800, y = Math.random() * 4000;
      for (let j = 0; j < 40; j++) { x += Math.random() * 2; y += Math.random() * 2; pts.push({ x, y, p: 0.3 + Math.random() * 0.4 }); }
      p.strokes.push({ id: tag + '-' + i + '-' + Math.random().toString(36).slice(2, 7), tool: 'pen', color: '#1a1a1a', width: 1.5, points: pts, pr: 1 });
    }
    api.DATA.updatedAt = ctx.Date.now();
  };
  api.getSebu = () => vm.runInContext('getSebu()', ctx);
  api.ids = () => new Set((api.getSebu()?.pages[0].strokes || []).map(s => s.id));
  api.ctx = ctx;
  return api;
}
const notebook = (at) => ({ version: 1, updatedAt: at, notebooks: [{ id: 'nb1', title: '국어', mokchas: [{ id: 'm1', title: '목차1', sebus: [{ id: 's1', title: '세부1', pageHeight: 4000, pages: [{ strokes: [], texts: [] }] }] }] }] });
const until = async (fn, ms = 5000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 20)); } };
const idle = (d) => until(() => !d.st().syncBusy && !d.st().syncPendingPush);
const subset = (A, B) => [...A].every(x => B.has(x));

(async () => {
  const mf = new Miniflare({ modules: true, script: workerSrc, kvNamespaces: ['NOTES'], compatibilityDate: '2024-11-01' });
  try {
    const tablet = device('tablet', mf), phone = device('phone', mf);
    // 1) tablet (reference) has ink, connects first → uploads compressed v2
    tablet.DATA = notebook(Date.now()); tablet.draw(300, 'T');
    assert.equal(await tablet.connectWithPassword(PW), true); await idle(tablet);
    assert.equal(tablet.st().syncLastError, '');
    // 2) phone (empty) connects → receives every tablet stroke, points within 0.01 px
    assert.equal(await phone.connectWithPassword(PW), true);
    assert(subset(tablet.ids(), phone.ids()) && phone.ids().size === 300, 'phone got tablet ink');
    const ts = tablet.getSebu().pages[0].strokes[5], ps = phone.getSebu().pages[0].strokes.find(s => s.id === ts.id);
    ts.points.forEach((pt, i) => { assert(Math.abs(pt.x - ps.points[i].x) <= 0.005 && Math.abs(pt.y - ps.points[i].y) <= 0.005); });
    // 3) tablet writes more, pushes; phone's auto-poll picks it up
    tablet.draw(50, 'T2'); await tablet.syncPushNow(); await idle(tablet);
    await phone.syncPullAndMaybeApply({ quiet: true });
    assert(subset(tablet.ids(), phone.ids()), 'phone poll got new tablet ink');
    // 4) unchanged polls use the cheap meta check, not full downloads
    const g0 = counts.get; for (let i = 0; i < 5; i++) await phone.syncPullAndMaybeApply({ quiet: true });
    assert.equal(counts.get, g0, 'unchanged poll must not download the vault'); assert(counts.meta >= 5);
    // 5) simultaneous writing on both devices → CAS conflict → no lost ink, both converge
    tablet.draw(20, 'T3'); phone.draw(7, 'P1');
    await Promise.all([tablet.syncPushNow(), phone.syncPushNow()]);
    await Promise.all([idle(tablet), idle(phone)]);
    await tablet.syncPullAndMaybeApply({}); await phone.syncPullAndMaybeApply({});
    await Promise.all([idle(tablet), idle(phone)]);
    await tablet.syncPullAndMaybeApply({}); await phone.syncPullAndMaybeApply({});
    assert.deepEqual([...tablet.ids()].sort(), [...phone.ids()].sort(), 'both devices converge');
    assert.equal(tablet.ids().size, 300 + 50 + 20 + 7);
    // 6) a phone with an OLD copy (missing new tablet ink) and a clock 1h ahead pushes:
    //    the cloud and the tablet must keep all tablet ink
    const stale = device('stale-phone', mf, 3600e3);
    stale.DATA = JSON.parse(JSON.stringify(phone.DATA)); stale.ctx.localStorage.setItem('gkc-sync-pw', PW);
    tablet.draw(30, 'T4'); await tablet.syncPushNow(); await idle(tablet);
    const tabletIds = tablet.ids();
    stale.ctx.syncReady = vm.runInContext(`syncPassword='${PW}'; vaultIdFromPassword('${PW}').then(v => { syncVaultId = v; })`, stale.ctx); await stale.ctx.syncReady;
    stale.draw(3, 'S'); await stale.syncPushNow(); await idle(stale);
    await tablet.syncPullAndMaybeApply({});
    assert(subset(tabletIds, tablet.ids()), 'tablet keeps its ink'); assert(subset(stale.ids(), tablet.ids()));
    await phone.syncPullAndMaybeApply({}); assert(subset(tablet.ids(), phone.ids()));
    // 7) empty device never wipes the cloud
    const fresh = device('fresh', mf); fresh.ctx.localStorage.setItem('gkc-sync-pw', PW);
    assert.equal(await fresh.connectWithPassword(PW), true); await fresh.syncPushNow(); await idle(fresh);
    await phone.syncPullAndMaybeApply({}); assert(subset(tablet.ids(), phone.ids()));
    // 8) migration: a legacy ~19.8 MB v1 envelope (old 20 MB limit) is read, merged and
    //    re-uploaded far smaller as v2; old clients cannot decrypt v2 and so never overwrite it
    const big = device('big-tablet', mf); big.DATA = notebook(Date.now()); big.draw(5100, 'B');
    const kv = await mf.getKVNamespace('NOTES');
    const vid = await vm.runInContext(`vaultIdFromPassword('${PW}-big')`, big.ctx);
    const v1 = await vm.runInContext(`(async () => { const s = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)); const k = await deriveAesKey('${PW}-big', s); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(DATA))); return { v: 1, salt: bufToB64(s), iv: bufToB64(iv), ct: bufToB64(ct), updatedAt: DATA.updatedAt - 1 }; })()`, big.ctx);
    const v1Len = JSON.stringify(v1).length; await kv.put(vid, JSON.stringify(v1));
    big.draw(100, 'B2');
    assert.equal(await big.connectWithPassword(PW + '-big'), true); await idle(big);
    assert.equal(big.st().syncLastError, '');
    const after = JSON.parse(await kv.get(vid)); assert.equal(after.v, 2);
    const v2Len = JSON.stringify(after).length;
    const oldDecrypt = vm.runInContext(`(async (env, pw) => { const k = await deriveAesKey(pw, b64ToBuf(env.salt)); const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(env.iv) }, k, b64ToBuf(env.ct)); return JSON.parse(new TextDecoder().decode(plain)); })`, big.ctx);
    await assert.rejects(oldDecrypt(after, PW + '-big'));
    const bigPhone = device('big-phone', mf); assert.equal(await bigPhone.connectWithPassword(PW + '-big'), true);
    assert.equal(bigPhone.ids().size, 5200);
    // 9) PDF pages (images, incompressible JPEG data) + ink on top sync tablet → phone;
    //    the page's size estimate (sum of image data) is close to the real upload
    const pt = device('pdf-tablet', mf), pp = device('pdf-phone', mf);
    pt.DATA = notebook(Date.now()); pt.draw(50, 'PI');
    const rnd = n => require('node:crypto').randomBytes(n).toString('base64');
    const pdfPages = Array.from({ length: 30 }, (_, k) => ({ id: 'pdf' + k, x: 0, y: 1200 * (k + 1) + 34, w: 800, h: 1131, src: 'data:image/jpeg;base64,' + rnd(195000) }));
    pt.getSebu().pages[0].images = pdfPages; pt.getSebu().pageHeight = 1200 * 31;
    const added = pdfPages.reduce((a, o) => a + o.src.length, 0);
    assert.equal(await pt.connectWithPassword(PW + '-pdf'), true); await idle(pt);
    assert.equal(pt.st().syncLastError, '');
    const sent = vm.runInContext('syncLastBytes', pt.ctx);
    assert(sent > added * 0.95 && sent < added * 1.15, `estimate off: payload ${sent} vs images ${added}`);
    assert.equal(await pp.connectWithPassword(PW + '-pdf'), true);
    const got = pp.getSebu().pages[0].images || [];
    assert.equal(got.length, 30); got.forEach((o, k) => assert.equal(o.src, pdfPages[k].src));
    assert(subset(pt.ids(), pp.ids()) && pp.ids().size === 50, 'ink over PDF synced');
    assert.equal(pp.getSebu().pageHeight, 1200 * 31);
    console.log(`PASS: PDF 30 pages ${(added / 1e6).toFixed(1)} MB images → payload ${(sent / 1e6).toFixed(1)} MB, phone has all pages + ink`);
    console.log(`PASS: tablet→phone ink, poll pickup, meta-only unchanged polls, concurrent writes (409 conflicts: ${counts.conflict}) converge, stale+clock-skewed phone cannot drop tablet ink, empty device cannot wipe, legacy v1 ${(v1Len / 1e6).toFixed(1)} MB → v2 ${(v2Len / 1e6).toFixed(1)} MB, old client cannot read v2`);
  } finally { await mf.dispose(); }
})().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
