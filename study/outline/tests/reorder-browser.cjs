// 목차/세부목차 순서 바꾸기 in headless Chrome: real touch (CDP touch events → pointer
// events), ▲▼ fallback, mouse drag, persistence after reload. Synthetic data, throwaway profile.
// Needs Chrome + puppeteer-core (PT_MODULES=/tmp/pt/node_modules).
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const M = process.env.PT_MODULES || ['/workspace/test-tools/node_modules', '/tmp/pt/node_modules'].find(p => fs.existsSync(p)) || '/tmp/pt/node_modules';
let puppeteer; try { puppeteer = require(M + '/puppeteer-core'); } catch (e) { console.log('SKIP: puppeteer-core not installed'); process.exit(0); }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
if (!fs.existsSync(CHROME)) { console.log('SKIP: no Chrome'); process.exit(0); }
const ROOT = path.join(__dirname, '../../..');
const MOKS = ['마인드맵 분석법', '행동 이론(독해법)', '운문 문학', '산문 문학', '(독서)비문학 RNP', '언어(문법)'];
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reorder-'));
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(ROOT, u); if (u.endsWith('/')) f = path.join(f, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = process.env.BASE_URL || `http://127.0.0.1:${srv.address().port}/study/outline/`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'p'), args: ['--no-sandbox', '--no-first-run'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 1100, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }); // tablet portrait
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.evaluate((MOKS) => {
      const sebus = n => Array.from({ length: n }, (_, i) => ({ id: 's' + i, title: '세부 ' + (i + 1), pages: [{ strokes: [], texts: [] }] }));
      __gkcSync.setData({ version: 1, updatedAt: Date.now(), notebooks: [
        { id: 'nb1', title: '(국어)Base', type: 'thought', mokchas: MOKS.map((t, i) => ({ id: 'm' + (i + 1), title: t, sebus: i === 0 ? sebus(4) : [] })) },
        { id: 'nb2', title: 'long', type: 'concept', mokchas: Array.from({ length: 30 }, (_, i) => ({ id: 'L' + (i + 1), title: '긴 목록 ' + (i + 1), sebus: [] })) }] });
      __gkcNav.goMokcha('nb1');
    }, MOKS);
    const titles = (sel = '#mokcha-list') => page.$$eval(sel + ' .item-row', rs => rs.map(r => r.querySelector('.item-title').textContent));
    const nums = (sel = '#mokcha-list') => page.$$eval(sel + ' .item-row .item-num', rs => rs.map(r => +r.textContent));
    const dataTitles = (nb = 0) => page.evaluate(nb => __gkcSync.getData().notebooks[nb].mokchas.map(m => m.title), nb);
    const center = async (sel) => page.$eval(sel, el => { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    async function touchDrag(from, toY, steps = 12) {
      await page.touchscreen.touchStart(from.x, from.y);
      for (let i = 1; i <= steps; i++) { await page.touchscreen.touchMove(from.x, from.y + (toY - from.y) * i / steps); await new Promise(r => setTimeout(r, 16)); }
      await page.touchscreen.touchEnd();
      await new Promise(r => setTimeout(r, 50));
    }
    // 1) touch-drag "마인드맵 분석법" (1) below "운문 문학" (3)
    const h1 = await center('#mokcha-list .item-row[data-id="m1"] .drag-handle');
    const r3 = await page.$eval('#mokcha-list .item-row[data-id="m3"]', el => { const r = el.getBoundingClientRect(); return r.top + r.height * 0.75; });
    const scroll0 = await page.evaluate(() => scrollY);
    await touchDrag(h1, r3);
    assert.deepEqual(await titles(), [MOKS[1], MOKS[2], MOKS[0], MOKS[3], MOKS[4], MOKS[5]], 'touch drag reorder');
    assert.deepEqual(await nums(), [1, 2, 3, 4, 5, 6], 'numbers updated');
    assert.deepEqual(await dataTitles(), await titles(), 'saved in data');
    assert.ok(await page.evaluate(() => __gkcSync.getData().notebooks[0].ordAt > 0), 'ordAt set');
    assert.equal(await page.evaluate(() => scrollY), scroll0, 'page did not scroll during handle drag');
    assert.equal(await page.evaluate(() => __gkcNav.getState().view), 'mokcha', 'drag did not open the item');
    // 2) tap ⋮⋮ → ▲▼ fallback; ▲ twice moves "산문 문학" from 4 to 2; tap row elsewhere closes
    await page.tap('#mokcha-list .item-row[data-id="m4"] .drag-handle');
    assert.ok(await page.$eval('#mokcha-list .item-row[data-id="m4"] .move-btns', el => getComputedStyle(el).display !== 'none'), '▲▼ shown');
    await page.tap('#mokcha-list .item-row[data-id="m4"] [data-act="up"]');
    await page.tap('#mokcha-list .item-row[data-id="m4"] [data-act="up"]');
    assert.deepEqual(await titles(), [MOKS[1], MOKS[3], MOKS[2], MOKS[0], MOKS[4], MOKS[5]], '▲ moves up');
    await page.tap('#mokcha-list .item-row[data-id="m4"] [data-act="down"]');
    assert.deepEqual(await titles(), [MOKS[1], MOKS[2], MOKS[3], MOKS[0], MOKS[4], MOKS[5]], '▼ moves down');
    assert.deepEqual(await nums(), [1, 2, 3, 4, 5, 6]);
    await page.tap('#mokcha-list .item-row[data-id="m6"] .item-title'); // closes ▲▼, does not open
    assert.equal(await page.$$eval('#mokcha-list .item-row.pick', r => r.length), 0);
    assert.equal(await page.evaluate(() => __gkcNav.getState().view), 'mokcha');
    await page.tap('#mokcha-list .item-row[data-id="m6"] .item-title'); // normal tap opens
    assert.equal(await page.evaluate(() => __gkcNav.getState().view), 'sebu');
    // 3) 세부목차: mouse drag (desktop) last → first
    await page.evaluate(() => __gkcNav.goSebu('m1'));
    const hs = await center('#sebu-list .item-row[data-id="s3"] .drag-handle');
    const top0 = await page.$eval('#sebu-list .item-row[data-id="s0"]', el => el.getBoundingClientRect().top + 5);
    await page.mouse.move(hs.x, hs.y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(hs.x, hs.y + (top0 - hs.y) * i / 10);
    await page.mouse.up();
    assert.deepEqual(await titles('#sebu-list'), ['세부 4', '세부 1', '세부 2', '세부 3'], 'mouse drag reorder sebu');
    assert.deepEqual(await nums('#sebu-list'), [1, 2, 3, 4]);
    // 4) long list on a phone: drag to the bottom edge auto-scrolls; move item 1 far down
    await page.setViewport({ width: 400, height: 700, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await page.evaluate(() => __gkcNav.goMokcha('nb2')); await page.evaluate(() => scrollTo(0, 0));
    const hl = await page.$eval('#mokcha-list .item-row[data-id="L1"] .drag-handle', el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.touchscreen.touchStart(hl.x, hl.y);
    for (let i = 1; i <= 10; i++) { await page.touchscreen.touchMove(hl.x, hl.y + (690 - hl.y) * i / 10); await new Promise(r => setTimeout(r, 16)); }
    await new Promise(r => setTimeout(r, 700)); // hold at edge → auto-scroll
    await page.touchscreen.touchMove(hl.x, 689);
    await page.touchscreen.touchEnd(); await new Promise(r => setTimeout(r, 50));
    const longIdx = (await dataTitles(1)).indexOf('긴 목록 1');
    assert.ok(longIdx >= 12, 'auto-scroll moved item far down: index ' + longIdx);
    // 5) persists after reload (IndexedDB)
    await new Promise(r => setTimeout(r, 2500));
    const want = await dataTitles(0);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(() => __gkcNav.goMokcha('nb1'));
    assert.deepEqual(await titles(), want, 'order kept after reload');
    assert.deepEqual(errors, [], errors.join('; '));
    console.log('PASS: touch drag on ⋮⋮ reorders 목차 (numbers 1..N, no page scroll, no accidental open); tap ⋮⋮ → ▲▼ fallback; mouse drag 세부목차; phone long-list edge auto-scroll; order persists after reload');
  } finally { await browser.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
