// The app must start (no errors, UI + data visible) on a phone that already has notes saved by
// earlier versions (PR #37 ffad710, PR #38 1967308 incl. its 연결 전 백업), and index.html must be
// the whole app (guards against a truncated/placeholder file like the 2026-11-19 20:29 commit).
// Old versions are taken from git; their own storage format is written by their own code path.
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const M = process.env.PT_MODULES || ['/workspace/test-tools/node_modules', '/tmp/pt/node_modules'].find(p => fs.existsSync(p)) || '/tmp/pt/node_modules';
const CUR = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
// 1) file integrity (no browser needed)
assert.ok(CUR.length > 150000, 'index.html is the full app (' + CUR.length + ' bytes)');
assert.ok(/<script>[\s\S]{100000,}<\/script>/.test(CUR), 'main script present');
for (const s of ['window.__gkcSync', 'function loadData', 'id="btn-sync"', 'id="draw-toolbar"']) assert.ok(CUR.includes(s), 'missing ' + s);
new (require('node:vm').Script)(CUR.match(/<script>([\s\S]*?)<\/script>/)[1]);
let puppeteer; try { puppeteer = require(M + '/puppeteer-core'); } catch (e) { console.log('PASS (file only): app file intact; SKIP browser: no puppeteer-core'); process.exit(0); }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
if (!fs.existsSync(CHROME)) { console.log('PASS (file only); SKIP browser: no Chrome'); process.exit(0); }
const ROOT = path.join(__dirname, '../../..');
const old = rev => { try { return execFileSync('git', ['show', rev + ':study/outline/index.html'], { cwd: ROOT, maxBuffer: 64e6 }).toString(); } catch (_) { return null; } };
const VERSIONS = [['PR37 ffad710', old('ffad710')], ['PR38 1967308', old('1967308')]].filter(v => v[1]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let html = CUR;
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (u === '/study/outline/' || u === '/study/outline/index.html') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(html); return; }
    const f = path.join(ROOT, u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/study/outline/`;
  const sample = () => ({ version: 1, updatedAt: Date.now(), notebooks: [{ id: 'nb1', title: '국어', type: 'thought', mokchas: [{ id: 'm1', title: '1단원', ordAt: 5, sebus: [{ id: 's1', title: '세부', pageHeight: 2400,
    pages: [{ strokes: [{ id: 'k1', tool: 'pen', color: '#111', width: 1.5, pr: 1, points: [{ x: 10, y: 10, p: 0.5 }, { x: 90, y: 40, p: 0.6 }] }, { id: 'k2', tool: 'highlighter', color: '#f472b6', width: 3, points: [{ x: 20, y: 60 }, { x: 200, y: 60 }] }],
      texts: [{ id: 't1', x: 30, y: 300, w: 200, h: 40, text: '메모' }], del: ['gone1'],
      notes: [{ id: 'n1', x: 100, y: 500, w: 200, h: 150, c: '#ffcdd2', t: '포스트잇', f: false, u: 1, k: [{ id: 'nk1', tool: 'pen', color: '#111', width: 1.5, points: [{ x: 5, y: 5 }, { x: 50, y: 20 }] }], dk: ['nk0'] }], delN: ['n0'] }] }] }] }] });
  const checked = [];
  try {
    for (const [label, oldHtml] of VERSIONS) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-'));
      const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'p'), args: ['--no-sandbox', '--no-first-run'] });
      try {
        const page = await browser.newPage();
        await page.setViewport({ width: 412, height: 900, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
        const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
        // a) the old version saves notes the way it does (DATA → IndexedDB 'app' + localStorage)
        html = oldHtml;
        await page.goto(url, { waitUntil: 'networkidle0' });
        const saved = sample();
        await page.evaluate(async (d, withBackup) => {
          __gkcSync.setData(d);
          const db = await new Promise((res, rej) => { const r = indexedDB.open('gkc-study-notes', 1); r.onupgradeneeded = () => r.result.createObjectStore('data'); r.onsuccess = () => res(r.result); r.onerror = rej; });
          const put = (k, v) => new Promise((res, rej) => { const tx = db.transaction('data', 'readwrite'); tx.objectStore('data').put(v, k); tx.oncomplete = res; tx.onerror = rej; });
          await put('app', d);
          localStorage.setItem('gkc-study-notes-v1', JSON.stringify(d));
          if (withBackup) await put('link-backups', [{ id: 'bk1', at: Date.now(), kind: 'local', label: '연결 전 이 기기 노트', counts: { nb: 1, mk: 1, sb: 1, ink: 1 }, data: { version: 1, updatedAt: 1, notebooks: [{ id: 'old1', title: '예전 노트', mokchas: [] }] } }]);
        }, saved, label.startsWith('PR38'));
        assert.deepEqual(errors, [], label + ' (old) errors: ' + errors.join('; '));
        // b) the current version starts with that data
        html = CUR;
        await page.reload({ waitUntil: 'networkidle0' }); await sleep(300);
        assert.deepEqual(errors, [], label + ' → current: ' + errors.join('; '));
        assert.equal(await page.evaluate(() => typeof window.__gkcSync), 'object', 'app script ran');
        assert.ok(await page.title(), 'title');
        assert.ok(await page.$('#btn-sync'), 'UI rendered');
        const loaded = await page.evaluate(() => __gkcSync.getData());
        assert.deepEqual(loaded.notebooks, saved.notebooks, label + ': notes load unchanged');
        // home lists 과목 now: old categories sit under 미분류 › 미분류 (since 과목/수준, PR41)
        assert.match(await page.evaluate(() => document.body.innerText), /미분류/, '미분류 on home');
        await page.evaluate(() => __gkcNav.goCats('subj-default', 'lvl-default')); await sleep(100);
        assert.match(await page.evaluate(() => document.getElementById('nb-grid').innerText), /국어/, 'notebook visible under 미분류');
        // open the page: ink, highlighter, sticky note (with its ink) render without errors
        await page.evaluate(() => { __gkcNav.goMokcha('nb1'); __gkcNav.goSebu('m1'); __gkcNav.goDraw('s1'); }); await sleep(300);
        assert.equal(await page.$eval('#note-layer .sticky textarea', t => t.value), '포스트잇');
        assert.deepEqual(errors, [], label + ' draw page: ' + errors.join('; '));
        // stored data still there after start (not reset / overwritten by an empty copy)
        const stored = await page.evaluate(async () => {
          const db = await new Promise(res => { const r = indexedDB.open('gkc-study-notes', 1); r.onsuccess = () => res(r.result); });
          const get = k => new Promise(res => { const r = db.transaction('data').objectStore('data').get(k); r.onsuccess = () => res(r.result); });
          return { app: await get('app'), bk: await get('link-backups') };
        });
        assert.deepEqual(stored.app.notebooks, saved.notebooks, label + ': IndexedDB notes kept');
        const mig = (stored.bk || []).find(b => b.kind === 'migrate');
        assert.ok(mig, label + ': automatic backup before the 과목/수준 migration');
        assert.deepEqual(mig.data.notebooks, saved.notebooks, label + ': backup holds the notes as they were');
        if (label.startsWith('PR38')) {
          assert.ok(stored.bk.some(b => b.id === 'bk1'), 'PR38 backups kept');
          await page.evaluate(() => { __gkcNav.goHome && __gkcNav.goHome(); });
          await page.evaluate(() => document.getElementById('btn-sync').click());
          await page.waitForSelector('#m-link-backups', { timeout: 5000 });
        }
        checked.push(label);
      } finally { await browser.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
    }
    assert.equal(checked.length, 2, 'both old versions tested');
    console.log('PASS: app file intact; current app starts with notes saved by ' + checked.join(' and ') + ' (ink, pink highlighter, sticky note + ink, tombstones, 연결 전 백업), nothing reset, no errors');
  } finally { srv.close(); }
})().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
