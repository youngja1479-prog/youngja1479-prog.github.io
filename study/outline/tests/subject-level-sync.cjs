// 과목 → 수준 sync (PR41): the new fields (DATA.subjects, DATA.subjOrdAt, category.sl) go through the
// same E2E-encrypted sync against the REAL Worker in Miniflare, survive merges, and an older app
// (PR40 5b05d8b, taken from git) on another device still opens and syncs categories normally —
// even when its merge drops the new fields, the new app brings them back. Throwaway vault only.
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
let Miniflare;
try { ({ Miniflare } = require(process.env.MINIFLARE_PATH || 'miniflare')); }
catch (e) { console.log('SKIP: miniflare not installed'); process.exit(0); }
const ROOT = path.join(__dirname, '../../..');
const blockOf = (html) => { const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]; return script.slice(script.indexOf('const SYNC_PW_KEY'), script.indexOf('/* ========== State ========== */')); };
const CUR = blockOf(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'));
let OLD = null; try { OLD = blockOf(execFileSync('git', ['show', '5b05d8b:study/outline/index.html'], { cwd: ROOT, maxBuffer: 64e6 }).toString()); } catch (_) {}
const workerSrc = fs.readFileSync(path.join(__dirname, '../sync-worker/worker.js'), 'utf8');
const PW = 'throwaway-test-' + Math.random().toString(36).slice(2);

function device(name, mf, block, clockSkew = 0) {
  const store = {};
  const ctx = {
    console, Math, JSON, Promise, Map, Set, Array, Object, Error, Uint8Array, TextEncoder, TextDecoder, Blob, Response,
    CompressionStream, DecompressionStream, btoa, atob, URL, String, Number, Boolean,
    crypto: require('node:crypto').webcrypto,
    Date: class extends Date { constructor(...x) { x.length ? super(...x) : super(Date.now() + clockSkew); } static now() { return Date.now() + clockSkew; } },
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 30)), clearTimeout, setInterval: () => 0, clearInterval() {},
    navigator: { onLine: true }, document: { visibilityState: 'visible', baseURI: 'https://x/' },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    confirm: () => true, toasts: [],
    fetch: async (u, init = {}) => {
      const url = new URL(u);
      const r = await mf.dispatchFetch('http://sync' + url.pathname + url.search, { ...init, headers: { ...(init.headers || {}), Origin: 'https://youngja1479-prog.github.io' } });
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
    const state = { view: 'home', drawing: false };
    async function idbSet() { return true; } async function idbGet() { return null; }
    async function lsSaveData() {}
    function renderHome(){} function renderLevels(){} function renderCats(){} function renderMokcha(){} function renderSebu(){} function renderTree(){} function goHome(){}
    function getSebu() { return null; } function initDrawPage() {}
    function openModal(){} function closeModal(){}
  ` + block + `
    globalThis.api = { get DATA() { return DATA; }, set DATA(d) { DATA = d; },
      connectWithPassword, syncPushNow, syncPullAndMaybeApply, mergeData,
      st: () => ({ syncBusy, syncPendingPush, syncLastError }) };
  `, ctx);
  const api = ctx.api; api.ctx = ctx; api.name = name;
  api.touch = () => { api.DATA.updatedAt = ctx.Date.now(); };
  return api;
}
const until = async (fn, ms = 5000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 20)); } };
const idle = (d) => until(() => !d.st().syncBusy && !d.st().syncPendingPush);
const nb = (id, title) => ({ id, title, type: 'thought', mokchas: [{ id: id + '-m', title: '목차', sebus: [{ id: id + '-s', title: '세부', pageHeight: 2400, pages: [{ strokes: [{ id: id + '-k', tool: 'pen', color: '#111', width: 1.5, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }], texts: [{ id: id + '-t', x: 1, y: 1, text: '메모' }], notes: [{ id: id + '-n', x: 5, y: 5, w: 100, h: 80, t: '포스트잇', u: 1 }] }] }] }] });
const J = x => JSON.parse(JSON.stringify(x));
const place = (d, id) => { const n = d.notebooks.find(x => x.id === id); return n && n.sl ? n.sl.s + '/' + n.sl.l : '-'; };
const subjIds = d => (d.subjects || []).map(s => s.id + ':' + s.title + '[' + (s.levels || []).map(l => l.id + ':' + l.title).join(',') + ']').join(' ');

(async () => {
  const mf = new Miniflare({ modules: true, script: workerSrc, kvNamespaces: ['NOTES'], compatibilityDate: '2024-11-01' });
  try {
    const t0 = Date.now() - 60000;
    const legacy = { version: 1, updatedAt: t0, notebooks: [nb('nb1', '문학'), nb('nb2', '함수')] };
    // 1) phone (new app) after migration: 국어 › 기본 holds 문학; 함수 has no sl (→ 미분류)
    const phone = device('phone', mf, CUR);
    phone.DATA = J(legacy);
    phone.DATA.subjects = [{ id: 'subj-default', title: '미분류', u: 0, levels: [{ id: 'lvl-default', title: '미분류', u: 0 }] },
      { id: 'sK', title: '국어', u: t0 + 1, levels: [{ id: 'lB', title: '기본', u: t0 + 1 }, { id: 'lA', title: '심화', u: t0 + 1 }] }];
    phone.DATA.notebooks[0].sl = { s: 'sK', l: 'lB', st: '국어', lt: '기본', at: t0 + 2 };
    phone.touch();
    assert.equal(await phone.connectWithPassword(PW), true); await idle(phone);
    // 2) a NEW tablet connects: gets the new fields unchanged
    const tab = device('tablet', mf, CUR);
    assert.equal(await tab.connectWithPassword(PW), true); await idle(tab);
    assert.deepEqual(J(tab.DATA.subjects), J(phone.DATA.subjects)); assert.equal(place(tab.DATA, 'nb1'), 'sK/lB');
    // 3) concurrent edits on the two new devices: tablet renames 국어 + moves 함수 to 국어›심화;
    //    phone adds a level 입문 at the top (reorder)
    tab.DATA.subjects[1].title = '국어 (고1)'; tab.DATA.subjects[1].u = Date.now();
    tab.DATA.notebooks[1].sl = { s: 'sK', l: 'lA', st: '국어 (고1)', lt: '심화', at: Date.now() }; tab.touch();
    phone.DATA.subjects[1].levels.unshift({ id: 'lI', title: '입문', u: Date.now() }); phone.DATA.subjects[1].ordAt = Date.now(); phone.touch();
    await Promise.all([tab.syncPushNow(), phone.syncPushNow()]); await Promise.all([idle(tab), idle(phone)]);
    for (let i = 0; i < 2; i++) { await tab.syncPullAndMaybeApply({}); await phone.syncPullAndMaybeApply({}); await Promise.all([idle(tab), idle(phone)]); }
    for (const d of [tab, phone]) {
      assert.equal(d.DATA.subjects[1].title, '국어 (고1)', d.name + ': newer rename wins');
      assert.deepEqual(J(d.DATA.subjects[1].levels.map(l => l.id)), ['lI', 'lB', 'lA'], d.name + ': added level + order kept');
      assert.equal(place(d.DATA, 'nb2'), 'sK/lA', d.name + ': move synced');
      assert.equal(place(d.DATA, 'nb1'), 'sK/lB');
    }
    assert.deepEqual(subjIds(tab.DATA), subjIds(phone.DATA), 'converged');
    // 4) deleting an empty level on one device reaches the other (shared delIds tombstones)
    phone.DATA.subjects[1].levels = phone.DATA.subjects[1].levels.filter(l => l.id !== 'lI');
    phone.DATA.delIds = (phone.DATA.delIds || []).concat('lI'); phone.touch();
    await phone.syncPushNow(); await idle(phone); await tab.syncPullAndMaybeApply({}); await idle(tab);
    assert.deepEqual(J(tab.DATA.subjects[1].levels.map(l => l.id)), ['lB', 'lA'], 'level deletion synced');
    let oldNote = 'old-app part skipped (no git)';
    if (OLD) {
      // 5) an OLD app (PR40) connects: categories sync normally and the new fields stay in its copy
      const old = device('old-tablet', mf, OLD);
      assert.equal(await old.connectWithPassword(PW), true); await idle(old);
      assert.deepEqual(J(old.DATA.notebooks.map(n => n.id).sort()), ['nb1', 'nb2']);
      assert.deepEqual(J(old.DATA.subjects), J(phone.DATA.subjects), 'old app keeps the new fields it received');
      old.DATA.notebooks.push(nb('nb3', '영어 독해')); old.touch();       // old app adds a category
      await old.syncPushNow(); await idle(old);
      await phone.syncPullAndMaybeApply({}); await idle(phone);
      assert.ok(phone.DATA.notebooks.some(n => n.id === 'nb3' && !n.sl), 'category from the old app arrives (→ 미분류)');
      assert.equal(place(phone.DATA, 'nb1'), 'sK/lB'); assert.ok(phone.DATA.subjects.length === 2);
      // 6) worst case: an old app with a STALE copy from before 과목/수준 (no subjects, no sl) and a clock
      //    1 h ahead edits and pushes; its merge keeps its own top-level/category objects and drops the
      //    new fields in the cloud copy. The new app restores them on its next sync and re-uploads.
      const stale = device('old-stale', mf, OLD, 3600e3);
      stale.DATA = J(legacy); stale.DATA.notebooks[0].title = '문학 (수정)'; stale.touch();
      stale.ctx.localStorage.setItem('gkc-sync-pw', PW);
      await vm.runInContext(`syncPassword='${PW}'; vaultIdFromPassword('${PW}').then(v => { syncVaultId = v; })`, stale.ctx);
      await stale.syncPushNow(); await idle(stale);
      await stale.syncPullAndMaybeApply({}); await idle(stale);
      const cloud0 = device('probe0', mf, CUR); assert.equal(await cloud0.connectWithPassword(PW), true); await idle(cloud0);
      const dropped = !cloud0.DATA.subjects || place(cloud0.DATA, 'nb1') === '-';
      await phone.syncPullAndMaybeApply({}); await idle(phone); await phone.syncPullAndMaybeApply({}); await idle(phone);
      assert.equal(phone.DATA.notebooks.find(n => n.id === 'nb1').title, '문학 (수정)', 'old app edit arrives');
      assert.equal(place(phone.DATA, 'nb1'), 'sK/lB', 'new app keeps the category in its 과목/수준');
      assert.equal(place(phone.DATA, 'nb2'), 'sK/lA');
      assert.equal(phone.DATA.subjects[1].title, '국어 (고1)');
      const probe = device('probe', mf, CUR); assert.equal(await probe.connectWithPassword(PW), true); await idle(probe);
      assert.equal(place(probe.DATA, 'nb1'), 'sK/lB', 'cloud copy repaired'); assert.equal(probe.DATA.subjects[1].title, '국어 (고1)');
      assert.deepEqual(J(probe.DATA.notebooks.map(n => n.id).sort()), ['nb1', 'nb2', 'nb3'], 'no category lost');
      for (const id of ['nb1', 'nb2', 'nb3']) { const n = probe.DATA.notebooks.find(x => x.id === id); assert.equal(n.mokchas[0].sebus[0].pages[0].strokes.length, 1); assert.equal(n.mokchas[0].sebus[0].pages[0].notes.length, 1); }
      oldNote = 'old app (PR40) syncs categories and keeps the fields' + (dropped ? '; stale old copy dropped them in the cloud and the new app restored them' : '; stale old copy did not drop them');
    }
    console.log('PASS: 과목/수준 sync — fields E2E-synced via real Worker, rename/level add/reorder/move/delete merge, ' + oldNote);
  } finally { await mf.dispose(); }
})().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
