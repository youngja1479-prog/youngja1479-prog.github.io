// Sync status flapping regression (2026-11-14): "동기화 중 / 오프라인 · 나중에 동기화" kept alternating.
// Production sync code in a VM against the REAL Worker in Miniflare, with injected network
// blips, slow/hung requests and errors. Synthetic data, throwaway password.
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), assert = require('node:assert/strict');
let Miniflare;
try { ({ Miniflare } = require(process.env.MINIFLARE_PATH || ['/workspace/test-tools/node_modules/miniflare', 'miniflare'].find(p => { try { require.resolve(p); return true; } catch (_) { return false; } }) || 'miniflare')); }
catch (e) { console.log('SKIP: miniflare not installed'); process.exit(0); }
const script = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const syncBlock = script.slice(script.indexOf('const SYNC_PW_KEY'), script.indexOf('/* ========== State ========== */'));
const workerSrc = fs.readFileSync(path.join(__dirname, '../sync-worker/worker.js'), 'utf8');
const PW = 'throwaway-flap-' + Math.random().toString(36).slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function device(mf) {
  const store = {}, statuses = [], delays = [];
  const net = { fail: 0, failWith: null, hang: 0, inFlight: 0, maxInFlight: 0, calls: 0, slowMs: 0 };
  const el = { set className(v) {}, set title(v) {}, set textContent(v) { if (statuses[statuses.length - 1] !== v) statuses.push(v); }, style: {} };
  const ctx = {
    console, Math, JSON, Promise, Map, Set, Array, Object, Error, TypeError, Uint8Array, TextEncoder, TextDecoder, Blob, Response,
    CompressionStream, DecompressionStream, btoa, atob, URL, String, Number, Boolean, AbortController,
    crypto: require('node:crypto').webcrypto, Date,
    setTimeout: (f, ms) => { if (ms >= 1000 && ms <= 61000 && ms !== 2000 && ms !== 20000) delays.push(ms); return setTimeout(f, Math.min(ms || 0, 25)); },
    clearTimeout, setInterval: () => 0, clearInterval() {},
    navigator: { onLine: true }, document: { visibilityState: 'visible' },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    confirm: () => true,
    fetch: async (u, init = {}) => {
      net.calls++; net.inFlight++; net.maxInFlight = Math.max(net.maxInFlight, net.inFlight);
      try {
        if (net.slowMs) await sleep(net.slowMs);
        if (net.hang > 0) {
          net.hang--;
          await new Promise((_, rej) => init.signal && init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
        }
        if (net.fail > 0) { net.fail--; throw new TypeError('Failed to fetch'); }
        if (net.failWith && (init.method === 'PUT')) return { ok: false, status: net.failWith, headers: { get: () => null }, text: async () => 'too big' };
        const url = new URL(u);
        const r = await mf.dispatchFetch('http://sync' + url.pathname + url.search, { method: init.method, body: init.body, headers: { ...(init.headers || {}), Origin: 'https://youngja1479-prog.github.io' } });
        const body = await r.text();
        return { ok: r.ok, status: r.status, headers: { get: h => r.headers.get(h) }, text: async () => body };
      } finally { net.inFlight--; }
    },
  };
  vm.createContext(ctx);
  ctx.el = el;
  vm.runInContext(`
    const SYNC_URL = 'https://gkc-notes-sync.example';
    const LS_KEY = 'gkc-study-notes-v1';
    const $ = (q) => q === '#sync-status' ? el : null;
    function toast() {} function esc(s) { return String(s); }
    const defaultData = () => ({ version: 1, notebooks: [], updatedAt: 0 });
    var DATA = defaultData(); var saveTimer = null;
    const state = { view: 'draw', drawing: false };
    async function idbSet() { return true; } async function lsSaveData() {}
    function renderHome(){} function renderMokcha(){} function renderSebu(){} function renderTree(){} function goHome(){}
    function getSebu() { const n = DATA.notebooks[0]; return n && n.mokchas[0].sebus[0]; }
    function initDrawPage() {} function openModal(){} function closeModal(){}
  ` + syncBlock + `
    globalThis.api = { get DATA() { return DATA; }, set DATA(d) { DATA = d; }, connectWithPassword, syncPushNow, syncPullAndMaybeApply,
      syncNowManual, scheduleSyncPush, updateSyncStatusUI, decryptEnvelope,
      st: () => ({ syncBusy, syncPendingPush, syncLastError, syncRetryCount, timer: !!syncPushTimer }) };
  `, ctx);
  const api = ctx.api;
  Object.assign(api, { ctx, net, statuses, delays });
  api.write = (tag) => { const p = api.DATA.notebooks[0].mokchas[0].sebus[0].pages[0]; p.strokes.push({ id: tag, tool: 'pen', color: '#111', width: 1.5, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }); api.DATA.updatedAt = Date.now(); api.scheduleSyncPush(); };
  return api;
}
const nb = () => ({ version: 1, updatedAt: Date.now(), notebooks: [{ id: 'nb1', title: 'T', mokchas: [{ id: 'm1', title: 'M', sebus: [{ id: 's1', title: 'S', pages: [{ strokes: [], texts: [] }] }] }] }] });
const until = async (fn, ms = 8000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout waiting'); await sleep(10); } };
const OFF = /오프라인/;

(async () => {
  const mf = new Miniflare({ modules: true, script: workerSrc, kvNamespaces: ['NOTES'], compatibilityDate: '2024-11-01' });
  try {
    const d = device(mf); d.DATA = nb();
    assert.equal(await d.connectWithPassword(PW), true);
    await until(() => !d.st().syncBusy && !d.st().syncPendingPush);
    const cloudIds = async () => { const k = await mf.getKVNamespace('NOTES'); const keys = (await k.list()).keys; const env = JSON.parse(await k.get(keys[0].name)); const data = await d.decryptEnvelope(env, PW); return new Set(data.notebooks[0].mokchas[0].sebus[0].pages[0].strokes.map(s => s.id)); };

    // 1) normal writing while online: never shows "오프라인" (old code showed it for every pending upload)
    d.statuses.length = 0;
    for (let i = 0; i < 5; i++) { d.write('w' + i); await sleep(5); }
    await until(() => !d.st().syncBusy && !d.st().syncPendingPush);
    assert.ok(!d.statuses.some(s => OFF.test(s)), 'online writing showed offline: ' + d.statuses.join(' → '));
    assert.equal(d.statuses[d.statuses.length - 1], '동기화됨');
    assert.ok((await cloudIds()).has('w4'));

    // 2) network blips (2 failures) → automatic retry with backoff, no "오프라인", no error text, data arrives
    d.statuses.length = 0; d.delays.length = 0; d.net.fail = 2;
    d.write('blip');
    await until(() => !d.st().syncBusy && !d.st().syncPendingPush);
    assert.ok(!d.statuses.some(s => OFF.test(s) || /오류|실패/.test(s)), 'blip flapped: ' + d.statuses.join(' → '));
    assert.ok(d.delays.length >= 2 && d.delays[1] > d.delays[0], 'backoff grows: ' + d.delays);
    assert.ok((await cloudIds()).has('blip'), 'no data lost after retries');

    // 3) longer outage while "online": one steady warning, backoff capped, then recovers by itself
    d.statuses.length = 0; d.delays.length = 0; d.net.fail = 6;
    d.write('outage');
    await until(() => !d.st().syncBusy && !d.st().syncPendingPush, 15000);
    const shown = d.statuses.filter(s => s !== '동기화 중…');
    assert.ok(shown.includes('연결이 불안정해요 · 다시 시도 중'), d.statuses.join(' → '));
    assert.ok(!d.statuses.some(s => OFF.test(s)));
    let flips = 0; for (let i = 1; i < d.statuses.length; i++) if (d.statuses[i] !== d.statuses[i - 1]) flips++;
    assert.ok(flips <= 3, 'status flapped ' + flips + ' times: ' + d.statuses.join(' → '));
    assert.ok(d.delays.every(ms => ms <= 60500) && d.delays.length >= 5);
    assert.ok((await cloudIds()).has('outage'));

    // 4) hung request → time limit → retried (sync never stuck "busy")
    d.net.hang = 1; d.write('hang');
    vm.runInContext('1', d.ctx);
    await until(() => !d.st().syncBusy && !d.st().syncPendingPush, 15000);
    assert.ok((await cloudIds()).has('hang'));

    // 5) no concurrent syncs: slow network + poll + manual + upload all at once
    d.net.maxInFlight = 0; d.net.slowMs = 40;
    d.write('cc');
    await Promise.all([d.syncPullAndMaybeApply({ quiet: true }), d.syncPullAndMaybeApply({}), d.syncPushNow(), d.syncNowManual()]);
    await until(() => !d.st().syncBusy && !d.st().syncPendingPush);
    d.net.slowMs = 0;
    assert.equal(d.net.maxInFlight, 1, 'requests overlapped');
    assert.ok((await cloudIds()).has('cc'));

    // 6) really offline → "오프라인(나중에 올라감)"; back online → uploads, "동기화됨"
    d.ctx.navigator.onLine = false; d.statuses.length = 0;
    d.write('off'); await sleep(80);
    assert.equal(d.statuses[d.statuses.length - 1], '오프라인(나중에 올라감)');
    d.ctx.navigator.onLine = true; await d.syncPushNow();
    await until(() => !d.st().syncBusy && !d.st().syncPendingPush);
    assert.ok((await cloudIds()).has('off'));

    // 7) real error (413): clear message that stays (auto-checks don't hide it), no rapid retry loop, local data kept
    d.net.failWith = 413; d.statuses.length = 0;
    d.write('big'); await until(() => d.st().syncLastError !== '');
    const calls = d.net.calls;
    for (let i = 0; i < 3; i++) await d.syncPullAndMaybeApply({ quiet: true });
    await sleep(150);
    assert.match(d.statuses[d.statuses.length - 1], /용량이 너무 커서/);
    assert.ok(d.net.calls - calls <= 6, 'retry loop on a real error');
    assert.ok(d.DATA.notebooks[0].mokchas[0].sebus[0].pages[0].strokes.some(s => s.id === 'big'), 'local data kept');
    d.net.failWith = null; await d.syncPushNow();
    await until(() => !d.st().syncBusy && !d.st().syncPendingPush);
    assert.equal(d.statuses[d.statuses.length - 1], '동기화됨');
    assert.ok((await cloudIds()).has('big'));
    console.log('PASS: online writing never shows 오프라인; blips retried with growing capped backoff (no flapping, no lost ink); outage → one steady 연결 불안정 message; hung request times out; no overlapping requests; real offline/online; 413 stays visible without retry loop');
  } finally { await mf.dispose(); }
})().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
