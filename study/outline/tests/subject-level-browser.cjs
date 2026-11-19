// 과목 → 수준 → 카테고리(노트) in headless Chrome as a touch phone (PR41):
//  - migration of data saved by PR38 (1967308) and PR40 (5b05d8b): everything shows under 미분류, notes
//    unchanged, one automatic local backup first (not repeated on the next start)
//  - add / rename / reorder (▲▼ and touch drag) 과목·수준, new 노트 lands in the open 과목›수준,
//    📂 move a 노트, breadcrumbs by touch, delete refused while not empty, empty delete + 되돌리기
//  - the previous app (PR40) opens and edits the new data, keeping the new fields
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const M = process.env.PT_MODULES || ['/workspace/test-tools/node_modules', '/tmp/pt/node_modules'].find(p => fs.existsSync(p)) || '/tmp/pt/node_modules';
let puppeteer; try { puppeteer = require(M + '/puppeteer-core'); } catch (e) { console.log('SKIP: puppeteer-core not installed'); process.exit(0); }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
if (!fs.existsSync(CHROME)) { console.log('SKIP: no Chrome'); process.exit(0); }
const ROOT = path.join(__dirname, '../../..');
const CUR = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const old = rev => { try { return execFileSync('git', ['show', rev + ':study/outline/index.html'], { cwd: ROOT, maxBuffer: 64e6 }).toString(); } catch (_) { return null; } };
const VERSIONS = [['PR38 1967308', old('1967308')], ['PR40 5b05d8b', old('5b05d8b')]].filter(v => v[1]);
const PR40 = old('5b05d8b');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const NB = (id, title) => ({ id, title, type: 'concept', mokchas: [{ id: id + 'm', title: '1단원', sebus: [{ id: id + 's', title: '세부', pageHeight: 2400,
  pages: [{ strokes: [{ id: id + 'k', tool: 'pen', color: '#111', width: 1.5, points: [{ x: 10, y: 10 }, { x: 90, y: 40 }] }, { id: id + 'h', tool: 'highlighter', color: '#f472b6', width: 3, points: [{ x: 20, y: 60 }, { x: 200, y: 60 }] }],
    texts: [{ id: id + 't', x: 30, y: 300, w: 200, h: 40, text: '메모' }], images: [{ id: id + 'p', x: 0, y: 1234, w: 800, h: 1131, src: IMG }],
    notes: [{ id: id + 'n', x: 100, y: 500, w: 200, h: 150, c: '#ffcdd2', t: '포스트잇', f: false, u: 1, k: [{ id: id + 'nk', tool: 'pen', color: '#111', width: 1.5, points: [{ x: 5, y: 5 }, { x: 50, y: 20 }] }] }] }] }] }] });
(async () => {
  let html = CUR;
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (u === '/study/outline/' || u === '/study/outline/index.html') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(html); return; }
    res.writeHead(404); res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/study/outline/`;
  const sample = () => ({ version: 1, updatedAt: Date.now(), notebooks: [NB('a', '문학'), NB('b', '함수')], delIds: ['gone'] });
  const done = [];
  try {
    for (const [label, oldHtml] of VERSIONS) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'subj-'));
      const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'p'), args: ['--no-sandbox', '--no-first-run'] });
      try {
        const page = await browser.newPage();
        await page.setViewport({ width: 412, height: 900, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
        const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
        const D = () => page.evaluate(() => JSON.parse(JSON.stringify(__gkcSync.getData())));
        const idb = (k) => page.evaluate(async (k) => { const db = await new Promise(res => { const r = indexedDB.open('gkc-study-notes', 1); r.onsuccess = () => res(r.result); }); return new Promise(res => { const r = db.transaction('data').objectStore('data').get(k); r.onsuccess = () => res(r.result); }); }, k);
        // a) old version saves its notes its own way
        html = oldHtml; await page.goto(url, { waitUntil: 'networkidle0' });
        const saved = sample();
        await page.evaluate(async (d) => {
          __gkcSync.setData(d);
          const db = await new Promise((res, rej) => { const r = indexedDB.open('gkc-study-notes', 1); r.onupgradeneeded = () => r.result.createObjectStore('data'); r.onsuccess = () => res(r.result); r.onerror = rej; });
          await new Promise((res, rej) => { const tx = db.transaction('data', 'readwrite'); tx.objectStore('data').put(d, 'app'); tx.oncomplete = res; tx.onerror = rej; });
          localStorage.setItem('gkc-study-notes-v1', JSON.stringify(d));
        }, saved);
        // b) current version: migration
        html = CUR; await page.reload({ waitUntil: 'networkidle0' }); await sleep(300);
        assert.deepEqual(errors, [], label + ': ' + errors.join('; '));
        const rows = () => page.$$eval('#subj-list .item-row', a => a.map(r => r.querySelector('.item-title').textContent + '|' + r.querySelector('.item-sub').textContent));
        assert.deepEqual(await rows(), ['미분류|수준 1개 · 노트 2개'], label + ': everything under 미분류');
        let d = await D();
        assert.deepEqual(d.notebooks, saved.notebooks, label + ': categories and all notes unchanged');
        assert.deepEqual(d.delIds, ['gone']);
        assert.equal(d.subjects[0].id, 'subj-default');
        let bks = (await idb('link-backups')) || [];
        assert.equal(bks.filter(b => b.kind === 'migrate').length, 1, label + ': automatic backup made');
        assert.deepEqual(bks[0].data.notebooks, saved.notebooks, 'backup = notes before the migration');
        assert.deepEqual((await idb('app')).notebooks, saved.notebooks, 'IndexedDB categories not rewritten');
        await page.reload({ waitUntil: 'networkidle0' }); await sleep(200);
        bks = (await idb('link-backups')) || [];
        assert.equal(bks.filter(b => b.kind === 'migrate').length, 1, 'no second migration backup');
        done.push(label);
        if (oldHtml !== PR40) continue;

        // c) CRUD by touch
        const tap = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 4000 }); await page.tap(sel); await sleep(120); };
        const typeIn = async (sel, text) => { await page.waitForSelector(sel); await page.$eval(sel, i => { i.value = ''; }); await page.type(sel, text); };
        const rowSel = (list, title) => page.evaluate((list, title) => { const r = [...document.querySelectorAll(list + ' .item-row')].find(x => x.querySelector('.item-title').textContent === title); return r ? '[data-id="' + r.dataset.id + '"]' : null; }, list, title);
        const addSubj = async (t) => { await tap('#btn-new-subj'); await typeIn('#subj-title', t); await tap('#m-ok'); };
        await addSubj('국어'); await addSubj('수학');
        assert.deepEqual((await rows()).map(r => r.split('|')[0]), ['미분류', '국어', '수학']);
        // rename 수학 → 수학Ⅰ
        await tap('#subj-list ' + await rowSel('#subj-list', '수학') + ' [data-act="edit"]');
        await typeIn('#subj-title', '수학Ⅰ'); await tap('#m-ok');
        // reorder: tap ⋮⋮ then ▲ (touch) …
        let r = await rowSel('#subj-list', '수학Ⅰ');
        await tap('#subj-list ' + r + ' .drag-handle'); await tap('#subj-list ' + r + ' [data-act="up"]');
        assert.deepEqual((await rows()).map(r => r.split('|')[0]), ['미분류', '수학Ⅰ', '국어']);
        // … and a touch drag of 국어 above 수학Ⅰ
        const cdp = await page.createCDPSession();
        const hb = await page.$eval('#subj-list ' + await rowSel('#subj-list', '국어') + ' .drag-handle', e => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
        const rh = await page.$eval('#subj-list .item-row', e => e.getBoundingClientRect().height + 8);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hb.x, y: hb.y }] });
        for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: hb.x, y: hb.y - rh * 1.1 * i / 10 }] }); await sleep(16); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(250);
        assert.deepEqual((await rows()).map(r => r.split('|')[0]), ['미분류', '국어', '수학Ⅰ'], 'touch drag reorder');
        d = await D(); assert.deepEqual(d.subjects.map(s => s.title), ['미분류', '국어', '수학Ⅰ']); assert.ok(d.subjOrdAt > 0);
        // into 국어: add levels 입문, 기본
        await tap('#subj-list ' + await rowSel('#subj-list', '국어') + ' .item-title');
        assert.equal(await page.$eval('#levels-crumb', e => e.textContent), '과목 › 국어');
        for (const t of ['입문', '기본']) { await tap('#btn-new-level'); await typeIn('#subj-title', t); await tap('#m-ok'); }
        const lrows = () => page.$$eval('#level-list .item-row', a => a.map(r => r.querySelector('.item-title').textContent + '|' + r.querySelector('.item-sub').textContent));
        assert.deepEqual(await lrows(), ['입문|노트 0개', '기본|노트 0개']);
        // into 기본: new 노트 lands here
        await tap('#level-list ' + await rowSel('#level-list', '기본') + ' .item-title');
        assert.equal(await page.$eval('#cats-crumb', e => e.textContent), '과목 › 국어 › 기본');
        await tap('#btn-new-nb'); await typeIn('#nb-title', '비문학'); await tap('#m-ok'); await sleep(150);
        d = await D();
        const sK = d.subjects.find(s => s.title === '국어'), lB = sK.levels.find(l => l.title === '기본'), lI = sK.levels.find(l => l.title === '입문');
        const bimun = d.notebooks.find(n => n.title === '비문학');
        assert.equal(bimun.sl.s, sK.id); assert.equal(bimun.sl.l, lB.id);
        // breadcrumbs by touch: 목차 view → 기본 → (back) 국어 → 과목
        assert.equal(await page.$eval('#mokcha-crumb', e => e.textContent), '과목 › 국어 › 기본 › 비문학');
        await tap('#mokcha-crumb .cr-link[data-go="lvl"]');
        assert.equal((await page.evaluate(() => __gkcNav.getState())).view, 'cats');
        assert.match(await page.$eval('#nb-grid', e => e.innerText), /비문학/);
        await tap('#btn-back-cats'); assert.equal((await page.evaluate(() => __gkcNav.getState())).view, 'levels');
        await tap('#levels-crumb .cr-link[data-go="home"]'); assert.equal((await page.evaluate(() => __gkcNav.getState())).view, 'home');
        // 📂 move 문학 and 함수 out of 미분류 (contents untouched)
        for (const [title, lvl] of [['문학', '기본'], ['함수', '입문']]) {
          await page.evaluate(() => __gkcNav.goCats('subj-default', 'lvl-default')); await sleep(100);
          const id = (await D()).notebooks.find(n => n.title === title).id;
          await tap(`#nb-grid .nb-card[data-id="${id}"] [data-act="move"]`);
          await page.select('#mv-subj', sK.id); await page.select('#mv-lvl', lvl === '기본' ? lB.id : lI.id); await tap('#m-ok');
        }
        d = await D();
        assert.equal(d.notebooks.find(n => n.title === '문학').sl.l, lB.id); assert.equal(d.notebooks.find(n => n.title === '함수').sl.l, lI.id);
        for (const n of saved.notebooks) assert.deepEqual(d.notebooks.find(x => x.id === n.id).mokchas, n.mokchas, 'moved 노트 keeps everything');
        await page.evaluate(() => __gkcNav.goHome()); await sleep(100);
        assert.deepEqual(await rows(), ['국어|수준 2개 · 노트 3개', '수학Ⅰ|수준 0개 · 노트 0개'], '미분류 hidden once empty');
        // delete safety: 국어 (has 노트) refused, nothing changed
        const before = await D();
        await tap('#subj-list ' + await rowSel('#subj-list', '국어') + ' [data-act="del"]');
        assert.match(await page.$eval('#modal-root', e => e.innerText), /노트 3개가 있어서 삭제할 수 없어요/);
        assert.equal(await page.$('#modal-root .btn.danger'), null, 'no delete button offered');
        await tap('#m-ok'); assert.deepEqual(await D(), before, 'refused delete changes nothing');
        // level 기본 (has 노트) refused; empty 입문? has 함수 → refused too; add empty 심화 and delete it + 되돌리기
        await tap('#subj-list ' + await rowSel('#subj-list', '국어') + ' .item-title');
        await tap('#level-list ' + await rowSel('#level-list', '기본') + ' [data-act="del"]');
        assert.match(await page.$eval('#modal-root', e => e.innerText), /삭제할 수 없어요/); await tap('#m-ok');
        await tap('#btn-new-level'); await typeIn('#subj-title', '심화'); await tap('#m-ok');
        const simId = (await D()).subjects.find(s => s.id === sK.id).levels.find(l => l.title === '심화').id;
        await tap('#level-list ' + await rowSel('#level-list', '심화') + ' [data-act="del"]');
        assert.match(await page.$eval('#modal-root', e => e.innerText), /지워지는 노트는 없어요/);
        await tap('#modal-root .btn.danger');
        d = await D();
        assert.ok(!d.subjects.find(s => s.id === sK.id).levels.some(l => l.title === '심화')); assert.ok(d.delIds.includes(simId), 'tombstone for sync');
        await tap('#toast .toast-act');
        d = await D();
        const back = d.subjects.find(s => s.id === sK.id).levels.find(l => l.title === '심화');
        assert.ok(back && back.id !== simId, '되돌리기 brings it back (fresh id)');
        assert.deepEqual(await lrows(), ['입문|노트 1개', '기본|노트 2개', '심화|노트 0개']);
        // empty 과목 수학Ⅰ: confirm → deleted
        await page.evaluate(() => __gkcNav.goHome()); await sleep(100);
        await tap('#subj-list ' + await rowSel('#subj-list', '수학Ⅰ') + ' [data-act="del"]'); await tap('#modal-root .btn.danger');
        assert.deepEqual((await rows()).map(r => r.split('|')[0]), ['국어']);
        d = await D();
        assert.equal(d.notebooks.length, 3); for (const n of saved.notebooks) assert.deepEqual(d.notebooks.find(x => x.id === n.id).mokchas, n.mokchas);
        assert.deepEqual(errors, [], errors.join('; '));
        // d) the previous app (PR40) opens and edits this data; new fields survive its save
        await sleep(2600);
        const newData = await D();
        html = PR40; await page.reload({ waitUntil: 'networkidle0' }); await sleep(300);
        assert.equal(await page.$$eval('#nb-grid .nb-card[data-id]', a => a.length), 3, 'old app lists every category');
        await page.tap('#nb-grid .nb-card[data-id="a"] [data-act="edit"]'); await sleep(100);
        await typeIn('#nb-title', '문학 (구버전에서 수정)'); await page.tap('#m-ok'); await sleep(2600);
        const oldSaved = await idb('app');
        assert.equal(oldSaved.notebooks.find(n => n.id === 'a').title, '문학 (구버전에서 수정)');
        assert.deepEqual(oldSaved.subjects, newData.subjects, 'subjects kept by the old app');
        assert.deepEqual(oldSaved.notebooks.map(n => n.sl), newData.notebooks.map(n => n.sl), 'places kept by the old app');
        await page.evaluate(() => { __gkcNav.goMokcha('a'); __gkcNav.goSebu('am'); __gkcNav.goDraw('as'); }); await sleep(300);
        assert.deepEqual(errors, [], 'old app: ' + errors.join('; '));
        // e) and back on the new app it is still in 국어 › 기본
        html = CUR; await page.reload({ waitUntil: 'networkidle0' }); await sleep(300);
        assert.equal(JSON.stringify(await page.evaluate(() => __gkcNav.nbPlace(__gkcSync.getData().notebooks.find(n => n.id === 'a')))), JSON.stringify({ s: sK.id, l: lB.id }));
        await page.evaluate(() => { __gkcNav.goMokcha('a'); __gkcNav.goSebu('am'); __gkcNav.goDraw('as'); }); await sleep(300);
        assert.equal(await page.$eval('#note-layer .sticky textarea', t => t.value), '포스트잇');
        assert.deepEqual(errors, [], errors.join('; '));
        done.push('CRUD');
      } finally { await browser.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
    }
    assert.ok(done.includes('CRUD') && done.length === 3, 'all parts ran: ' + done.join(', '));
    console.log('PASS: 과목/수준 — migration of ' + done.slice(0, 2).join(' & ') + ' data (미분류, notes unchanged, one auto backup), touch add/rename/reorder(▲▼ + drag), 수준, new 노트 in place, 📂 move, breadcrumbs, delete refused when not empty, empty delete + 되돌리기, PR40 app opens/edits new data keeping the fields');
  } finally { srv.close(); }
})().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
