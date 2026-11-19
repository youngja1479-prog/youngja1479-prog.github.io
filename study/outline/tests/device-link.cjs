// 기기 연결 (device linking) against the REAL sync Worker code (Durable Object LinkRoom)
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
let counts = { get: 0, meta: 0, put: 0, conflict: 0 }; const sent = [];

function device(name, mf, ip = '198.51.100.7', clockSkew = 0) {
  const store = {};
  const ctx = {
    console, Math, JSON, Promise, Map, Set, Array, Object, Error, Uint8Array, TextEncoder, TextDecoder, Blob, Response,
    CompressionStream, DecompressionStream, btoa, atob, URL, String, Number, Boolean,
    crypto: require('node:crypto').webcrypto,
    Date: class extends Date { constructor(...x) { x.length ? super(...x) : super(Date.now() + clockSkew); } static now() { return Date.now() + clockSkew; } },
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 30)), location: { protocol: 'https:', hostname: 'youngja1479-prog.github.io', origin: 'https://youngja1479-prog.github.io', pathname: '/study/outline/' }, clearTimeout, setInterval: () => 0, clearInterval() {},
    navigator: { onLine: true }, document: { visibilityState: 'visible', baseURI: 'https://x/' },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    confirm: () => true, toasts: [], renders: 0,
    fetch: async (u, init = {}) => {
      const url = new URL(u);
      if (init.method === 'PUT') counts.put++; else if (url.search.includes('meta=1')) counts.meta++; else counts.get++;
      sent.push({ url: url.pathname, body: typeof init.body === 'string' ? init.body : '' });
      const r = await mf.dispatchFetch('http://sync' + url.pathname + url.search, { ...init, headers: { ...(init.headers || {}), Origin: 'https://youngja1479-prog.github.io', 'CF-Connecting-IP': ip } });
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
    const __idb = {}; let idbFail = false;
    async function idbSet(k, v) { if (idbFail && k === 'link-backups') return false; __idb[k] = v; return true; }
    async function idbGet(k) { return __idb[k] || null; }
    async function lsSaveData() {}
    function renderHome(){} function renderMokcha(){} function renderSebu(){} function renderTree(){} function goHome(){}
    function getSebu() { const n = DATA.notebooks.find(x => x.id === 'nb1'); const m = n && n.mokchas.find(x => x.id === 'm1'); return m && m.sebus.find(x => x.id === 's1'); }
    function initDrawPage() { renders++; }
    function openModal(){} function closeModal(){}
  ` + syncBlock + `
    globalThis.api = { get DATA() { return DATA; }, set DATA(d) { DATA = d; },
      connectWithPassword, linkOffer, linkClaim, linkBackups, restoreLinkBackup, setIdbFail(v) { idbFail = v; }, linkStatus, linkCancel, linkNormalize, linkUrl, linkFormat, get syncPassword() { return syncPassword; }, syncPushNow, syncPullAndMaybeApply, syncNowManual, decryptEnvelope, encryptData,
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
const M = process.env.PT_MODULES || '/workspace/test-tools/node_modules';
const VENDOR = path.join(__dirname, '../vendor/qr');
(async () => {
  const mfOpts = { modules: true, script: workerSrc, kvNamespaces: ['NOTES'], durableObjects: { LINK: 'LinkRoom' }, compatibilityDate: '2024-11-01' };
  const mf = new Miniflare(mfOpts);
  const mfShort = new Miniflare({ ...mfOpts, bindings: { LINK_TTL_MS: '1200' } });
  try {
    // 1) tablet already connected (test vault, test password) with notes
    const tablet = device('tablet', mf, '198.51.100.7');
    tablet.DATA = notebook(Date.now()); tablet.draw(40, 'T');
    assert.equal(await tablet.connectWithPassword(PW), true); await idle(tablet);
    // 2) code + QR payload
    sent.length = 0;
    const o = await tablet.linkOffer();
    assert.match(o.code, /^[2-9A-HJ-NP-Z]{10}$/); assert.match(o.slot, /^[0-9a-f]{64}$/);
    assert.ok(o.exp > Date.now() + 9 * 60e3 && o.exp <= Date.now() + 10 * 60e3 + 1000, 'expires in 10 min');
    const url = tablet.linkUrl(o.code);
    assert.equal(url, 'https://youngja1479-prog.github.io/study/outline/#link=' + o.code);
    assert.equal(tablet.linkNormalize(url), o.code); assert.equal(tablet.linkNormalize(tablet.linkFormat(o.code).toLowerCase()), o.code);
    assert.equal(tablet.linkNormalize(' ' + o.code.slice(0, 5) + ' ' + o.code.slice(5) + ' '), o.code);
    for (const bad of ['', 'ABC', o.code + 'X', 'O0I1ABCDEF', 'https://x/#nothing']) assert.equal(tablet.linkNormalize(bad), null, bad);
    // the server only ever sees the slot id and ciphertext — never the code or the password
    assert.ok(sent.length >= 1 && sent.every(r => !r.url.includes(o.code) && !r.body.includes(o.code) && !r.body.includes(PW) && !r.url.includes(PW)), 'no code/password on the wire');
    const offered = JSON.parse(sent.find(r => r.url === '/link/' + o.slot).body);
    assert.deepEqual(Object.keys(offered).sort(), ['ct', 'iv']);
    // real QR roundtrip: vendored qrcode.js draws the URL, jsQR (the iOS fallback) reads it back
    const qctx = {}; vm.createContext(qctx); vm.runInContext(fs.readFileSync(path.join(VENDOR, 'qrcode.js'), 'utf8') + '\nthis.qrcode = qrcode;', qctx);
    const qr = qctx.qrcode(0, 'M'); qr.addData(url); qr.make();
    const n = qr.getModuleCount(), sc = 6, q = 4, W = (n + 2 * q) * sc, px = new Uint8ClampedArray(W * W * 4).fill(255);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) for (let y = 0; y < sc; y++) for (let x = 0; x < sc; x++) { const i = (((r + q) * sc + y) * W + (c + q) * sc + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
    const jctx = { module: { exports: {} } }; jctx.exports = jctx.module.exports; vm.createContext(jctx);
    vm.runInContext(fs.readFileSync(path.join(VENDOR, 'jsQR.js'), 'utf8'), jctx);
    const dec = jctx.module.exports(px, W, W);
    assert.ok(dec, 'QR decodes'); assert.equal(dec.data, url); assert.equal(tablet.linkNormalize(dec.data), o.code);
    assert.equal(await tablet.linkStatus(o.slot), 'waiting');
    // 3) wrong code → clear message, nothing connected, real slot still waiting
    const phone = device('phone', mf, '198.51.100.8');
    let wrong = o.code.slice(0, 9) + (o.code[9] === 'Z' ? 'Y' : 'Z');
    let r = await phone.linkClaim(wrong);
    assert.equal(r.ok, false); assert.match(r.error, /맞지 않거나/); assert.equal(phone.syncPassword, null);
    r = await phone.linkClaim('ABC'); assert.equal(r.ok, false); assert.match(r.error, /10자리/);
    assert.equal(await tablet.linkStatus(o.slot), 'waiting');
    // 4) new (empty) phone links with the typed code → same vault, notes arrive, no password typed
    r = await phone.linkClaim(tablet.linkFormat(o.code).toLowerCase());
    assert.equal(r.ok, true, r.error); await idle(phone);
    assert.equal(phone.syncPassword, PW, 'phone got the vault secret');
    assert.equal(phone.ctx.localStorage.getItem('gkc-sync-pw'), PW);
    assert.deepEqual([...phone.ids()].sort(), [...tablet.ids()].sort(), 'phone has all tablet notes');
    assert.equal(await tablet.linkStatus(o.slot), 'used', 'tablet sees it was used');
    // 5) reused code → refused
    const third = device('third', mf, '198.51.100.9');
    r = await third.linkClaim(o.code); assert.equal(r.ok, false); assert.match(r.error, /이미 사용한/); assert.equal(third.syncPassword, null);
    // 6) two-device sync after linking (both directions)
    phone.draw(5, 'P'); await phone.syncPushNow(); await idle(phone);
    await tablet.syncPullAndMaybeApply({}); await idle(tablet);
    assert.deepEqual([...tablet.ids()].sort(), [...phone.ids()].sort(), 'tablet got phone ink');
    tablet.draw(3, 'T2'); await tablet.syncPushNow(); await idle(tablet);
    await phone.syncPullAndMaybeApply({}); await idle(phone);
    assert.deepEqual([...phone.ids()].sort(), [...tablet.ids()].sort(), 'phone got tablet ink');
    assert.equal(phone.ids().size, 48);
    // 7) cancelled code (window closed) cannot be used
    const o2 = await tablet.linkOffer(); await tablet.linkCancel(o2.slot);
    r = await third.linkClaim(o2.code); assert.equal(r.ok, false); assert.match(r.error, /맞지 않거나/);
    // 8) old password path still works (and a wrong password is still refused)
    const pwDev = device('pw-device', mf, '198.51.100.10');
    assert.equal(await pwDev.connectWithPassword(PW), true); await idle(pwDev);
    assert.deepEqual([...pwDev.ids()].sort(), [...tablet.ids()].sort());
    const badDev = device('bad-pw', mf, '198.51.100.11'); badDev.DATA = notebook(Date.now()); badDev.draw(1, 'B');
    assert.equal(await badDev.connectWithPassword(PW + 'x'), true, 'other password = other (new) vault, as before');
    assert.notEqual(badDev.syncPassword, PW);
    // 9) rate limit: repeated wrong codes from one IP get blocked
    const guesser = device('guesser', mf, '203.0.113.50');
    let last;
    for (let i = 0; i < 13; i++) last = await guesser.linkClaim(tablet.linkFormat(Array.from({ length: 10 }, (_, j) => '23456789AB'[(i + j) % 10]).join('')));
    assert.match(last.error, /너무 많이 시도/, last.error);
    const o3 = await tablet.linkOffer();
    r = await guesser.linkClaim(o3.code); assert.equal(r.ok, false, 'blocked IP cannot claim even the right code');
    assert.equal(await tablet.linkStatus(o3.slot), 'waiting');
    r = await third.linkClaim(o3.code); assert.equal(r.ok, true, 'other device still can'); await idle(third);
    // offer flood limit
    const flooder = device('flooder', mf, '203.0.113.60'); flooder.DATA = notebook(Date.now());
    assert.equal(await flooder.connectWithPassword(PW + '-flood'), true);
    let err = null; for (let i = 0; i < 21 && !err; i++) { try { await flooder.linkOffer(); } catch (e) { err = e; } }
    assert.ok(err && /너무 많이/.test(err.message), 'offer rate limit');
    // 10) expired code (short TTL Worker instance)
    const tShort = device('tablet-short', mfShort, '198.51.100.20'); tShort.DATA = notebook(Date.now()); tShort.draw(2, 'S');
    assert.equal(await tShort.connectWithPassword(PW + '-short'), true); await idle(tShort);
    const o4 = await tShort.linkOffer();
    await new Promise(res => setTimeout(res, 1500));
    const late = device('late', mfShort, '198.51.100.21');
    r = await late.linkClaim(o4.code); assert.equal(r.ok, false); assert.match(r.error, /시간이 지났/); assert.equal(late.syncPassword, null);
    assert.equal(await tShort.linkStatus(o4.slot), 'gone');
    // 12) 기준 기기: the new device already has its own notes → it is asked, every choice backs up first
    const nbOf = (id, n, tag) => ({ id, title: id, mokchas: [{ id: id + '-m', title: 'm', sebus: [{ id: id + '-s', title: 's', pageHeight: 1200,
      pages: [{ strokes: Array.from({ length: n }, (_, i) => ({ id: tag + i, tool: 'pen', color: '#111', width: 1.5, points: [{ x: i, y: i }, { x: i + 5, y: i + 5 }] })), texts: [] }] }] }] });
    const nbIds = d => d.DATA.notebooks.map(n => n.id).sort().join(',');
    const pullAll = async (...ds) => { for (const d of ds) { await d.syncPullAndMaybeApply({}); await idle(d); } };
    const cloudIds = async () => { await pullAll(tablet); return nbIds(tablet); };
    const before = await cloudIds();                       // 'nb1'
    let asked = null;
    // 12a) merge (keep both): nothing deleted anywhere
    const dm = device('dev-merge', mf, '198.51.100.40'); dm.DATA = { version: 1, updatedAt: Date.now() - 1000, notebooks: [nbOf('mine-m', 3, 'mm')] };
    let oc = await tablet.linkOffer();
    r = await dm.linkClaim(oc.code, async (info) => { asked = info; return 'merge'; });
    assert.equal(r.ok, true, r.error); assert.equal(r.choice, 'merge'); await idle(dm);
    assert.equal(JSON.stringify(asked.local), JSON.stringify({ nb: 1, mk: 1, sb: 1, ink: 3 })); assert.equal(asked.remote.nb, 1);
    assert.equal(nbIds(dm), [before, 'mine-m'].sort().join(','));
    assert.equal(await cloudIds(), nbIds(dm), 'cloud has both');
    let bks = await dm.linkBackups(); assert.equal(bks.length, 1); assert.equal(bks[0].kind, 'local'); assert.equal(bks[0].data.notebooks[0].id, 'mine-m');
    // 12b) cancel → nothing changed, not connected, no backup
    const dc = device('dev-cancel', mf, '198.51.100.41'); dc.DATA = { version: 1, updatedAt: 5, notebooks: [nbOf('keep-c', 2, 'kc')] };
    const dcBefore = JSON.stringify(dc.DATA);
    oc = await tablet.linkOffer();
    r = await dc.linkClaim(oc.code, async () => null);
    assert.equal(r.ok, false); assert.equal(r.cancelled, true); assert.equal(JSON.stringify(dc.DATA), dcBefore); assert.equal(dc.syncPassword, null);
    assert.equal((await dc.linkBackups()).length, 0);
    // 12c) backup cannot be saved → nothing changed
    const df = device('dev-fail', mf, '198.51.100.42'); df.DATA = { version: 1, updatedAt: 5, notebooks: [nbOf('keep-f', 2, 'kf')] }; df.setIdbFail(true);
    const dfBefore = JSON.stringify(df.DATA);
    oc = await tablet.linkOffer();
    r = await df.linkClaim(oc.code, async () => 'remote');
    assert.equal(r.ok, false); assert.match(r.error, /백업을 저장하지 못했어요/); assert.equal(JSON.stringify(df.DATA), dfBefore); assert.equal(df.syncPassword, null);
    // 12d) "연결된 기기 노트로 맞추기": confirm declined first → asked again; then local notes replaced, backed up, cloud untouched
    const dr = device('dev-remote', mf, '198.51.100.43'); dr.DATA = { version: 1, updatedAt: Date.now() + 99999, notebooks: [nbOf('mine-r', 4, 'mr')] };
    const cloudBefore = await cloudIds();
    let asks = 0, confirms = []; dr.ctx.confirm = (m) => { confirms.push(m); return confirms.length > 1; };
    oc = await tablet.linkOffer();
    r = await dr.linkClaim(oc.code, async () => { asks++; return 'remote'; });
    assert.equal(r.ok, true, r.error); assert.equal(asks, 2, 'declined confirm → choose again'); await idle(dr);
    assert.match(confirms[0], /이 기기의 노트\(노트 1개 · 목차 1개 · 세부 1개\)가 연결된 기기의 노트/); assert.match(confirms[0], /자동 백업/);
    assert.equal(nbIds(dr), cloudBefore, 'device now has the cloud notes');
    await pullAll(dr); assert.equal(await cloudIds(), cloudBefore, 'cloud unchanged (even though this device was "newer")');
    bks = await dr.linkBackups(); assert.equal(bks[0].data.notebooks[0].id, 'mine-r'); assert.equal(bks[0].counts.ink, 4);
    // ... and 되살리기 brings the old notes back (new ids), deleting nothing
    const rr = await dr.restoreLinkBackup(bks[0].id); assert.equal(rr.ok, true); assert.equal(rr.added, 1);
    await new Promise(res => setTimeout(res, 100)); await dr.syncPushNow(); await idle(dr);
    assert.equal(dr.DATA.notebooks.length, cloudBefore.split(',').length + 1);
    const restored = dr.DATA.notebooks.find(n => n.title === 'mine-r'); assert.ok(restored && restored.id !== 'mine-r', 'restored with a fresh id');
    assert.equal(restored.mokchas[0].sebus[0].pages[0].strokes.length, 4);
    await pullAll(tablet); assert.ok(tablet.DATA.notebooks.some(n => n.title === 'mine-r'), 'restored notes sync to the other device');
    assert.equal((await dr.linkBackups())[0].label, '되살리기 전 이 기기 노트', 'restore itself is backed up first');
    // 12e) "이 기기 노트로 맞추기": every device ends with this device's notes; the cloud copy is backed up here
    const dl = device('dev-local', mf, '198.51.100.44');
    // this device: a copy of the shared notebook with 2 strokes removed + its own notebook
    await pullAll(tablet);
    const shared = JSON.parse(JSON.stringify(tablet.DATA.notebooks.find(n => n.id === 'nb1')));
    const sp = shared.mokchas[0].sebus[0].pages[0], gone = sp.strokes.slice(0, 2).map(x => x.id); sp.strokes = sp.strokes.slice(2);
    dl.DATA = { version: 1, updatedAt: 10, notebooks: [shared, nbOf('mine-l', 2, 'ml')] };
    const cloudFull = JSON.parse(JSON.stringify(tablet.DATA));
    confirms = []; dl.ctx.confirm = (m) => { confirms.push(m); return true; };
    oc = await tablet.linkOffer();
    r = await dl.linkClaim(oc.code, async () => 'local');
    assert.equal(r.ok, true, r.error); await idle(dl);
    assert.match(confirms[0], /이 기기에 없는 노트는 다른 기기에서도 지워져요/);
    bks = await dl.linkBackups();
    assert.equal(bks.map(b => b.kind).sort().join(), 'local,remote');
    assert.equal(JSON.stringify(bks.find(b => b.kind === 'remote').data.notebooks.map(n => n.id).sort()), JSON.stringify(cloudFull.notebooks.map(n => n.id).sort()), 'cloud copy backed up');
    await pullAll(tablet, dr, phone);
    for (const d of [tablet, dr, phone]) {
      assert.equal(nbIds(d), 'mine-l,nb1', d.name + ' has exactly this device\'s notebooks');
      const ids = new Set(d.DATA.notebooks.find(n => n.id === 'nb1').mokchas[0].sebus[0].pages[0].strokes.map(x => x.id));
      assert.ok(gone.every(g => !ids.has(g)), d.name + ': strokes this device did not have are gone');
      assert.equal(ids.size, sp.strokes.length);
    }
    // restore the cloud backup on this device → everything comes back to everyone (fresh ids)
    const rb = await dl.restoreLinkBackup(bks.find(b => b.kind === 'remote').id); assert.equal(rb.ok, true); assert.ok(rb.added >= 3, 'added ' + rb.added);
    await new Promise(res => setTimeout(res, 100)); await dl.syncPushNow(); await idle(dl); await pullAll(tablet);
    const tAll = tablet.DATA.notebooks.flatMap(n => n.mokchas.flatMap(m => m.sebus.flatMap(x => x.pages[0].strokes))).length;
    const cAll = cloudFull.notebooks.flatMap(n => n.mokchas.flatMap(m => m.sebus.flatMap(x => x.pages[0].strokes))).length;
    assert.ok(tAll >= cAll, `all strokes back (${tAll} ≥ ${cAll})`);
    assert.ok(tablet.DATA.notebooks.some(n => n.title === 'mine-r') && tablet.DATA.notebooks.some(n => n.title === 'mine-m'));
    // 12f) empty new device: no question, as before
    const de = device('dev-empty', mf, '198.51.100.45'); let qn = 0;
    oc = await tablet.linkOffer();
    r = await de.linkClaim(oc.code, async () => { qn++; return 'merge'; }); assert.equal(r.ok, true); assert.equal(qn, 0); assert.equal(r.choice, 'auto');
    // 11) the vault itself was never touched by linking: same KV keys/revisions as plain sync
    const kv = await mf.getKVNamespace('NOTES');
    const keys = (await kv.list()).keys.map(k => k.name);
    assert.ok(keys.every(k => /^[0-9a-f]{64}$/.test(k)), 'linking stores nothing in the notes KV');
    console.log('PASS: 기기 연결 — code+QR (real QR roundtrip, jsQR), server sees only slot+ciphertext, wrong/short code refused, link → same vault without password, reuse refused, cancel, expiry, claim+offer rate limits, two-device sync after linking, password path unchanged; 기준 기기 choice (merge / 연결된 기기 / 이 기기) with confirm + automatic backup, cancel and backup failure change nothing, 되살리기 restores without deleting');
  } finally { await mf.dispose(); await mfShort.dispose(); }
})().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
