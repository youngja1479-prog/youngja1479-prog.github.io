// 포스트잇 in headless Chrome (touch + pen/mouse), synthetic notebook, throwaway profile.
// Needs Chrome + puppeteer-core (PT_MODULES or /workspace/test-tools/node_modules).
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const M = process.env.PT_MODULES || ['/workspace/test-tools/node_modules', '/tmp/pt/node_modules'].find(p => fs.existsSync(p)) || '/tmp/pt/node_modules';
let puppeteer; try { puppeteer = require(M + '/puppeteer-core'); } catch (e) { console.log('SKIP: puppeteer-core not installed'); process.exit(0); }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
if (!fs.existsSync(CHROME)) { console.log('SKIP: no Chrome'); process.exit(0); }
const ROOT = path.join(__dirname, '../../..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sticky-'));
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
    await page.setViewport({ width: 900, height: 1100, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(base, { waitUntil: 'networkidle0' });
    const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await page.evaluate((IMG) => {
      __gkcSync.setData({ version: 1, updatedAt: Date.now(), notebooks: [{ id: 'nb1', title: 'T', type: 'thought', mokchas: [{ id: 'm1', title: 'M', sebus: [{ id: 's1', title: 'S', pageHeight: 2400,
        pages: [{ strokes: [{ id: 'k1', tool: 'pen', color: '#111', width: 1.5, points: [{ x: 100, y: 900 }, { x: 300, y: 900 }] }], texts: [], images: [{ id: 'pdf1', x: 0, y: 1234, w: 800, h: 1131, src: IMG }] }] }] }] }] });
      __gkcNav.goMokcha('nb1'); __gkcNav.goSebu('m1'); __gkcNav.goDraw('s1');
    }, IMG);
    await sleep(200);
    const pg = () => page.evaluate(() => __gkcSync.getData().notebooks[0].mokchas[0].sebus[0].pages[0]);
    const k = () => page.evaluate(() => document.getElementById('page-stage').getBoundingClientRect().width / 800);
    const rectOf = sel => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    // 1) toolbar button adds a note on the visible page
    await page.tap('#btn-add-note');
    let p = await pg();
    assert.equal(p.notes.length, 1); const n0 = p.notes[0];
    assert.ok(await page.$('#note-layer .sticky'));
    // 2) tap and type
    await page.tap('#note-layer .sticky textarea');
    await page.keyboard.type('단어 외우기 DAY3');
    await page.evaluate(() => document.activeElement.blur());
    p = await pg(); assert.equal(p.notes[0].t, '단어 외우기 DAY3');
    // 3) touch-drag the top bar → moves by the same distance on the page
    const kk = await k();
    let bar = await rectOf('#note-layer .sticky .st-grip');
    const from = { x: bar.x + 20, y: bar.y + bar.h / 2 };
    await page.touchscreen.touchStart(from.x, from.y);
    for (let i = 1; i <= 10; i++) { await page.touchscreen.touchMove(from.x + 15 * i, from.y + 20 * i); await sleep(10); }
    await page.touchscreen.touchEnd(); await sleep(50);
    p = await pg();
    assert.ok(Math.abs(p.notes[0].x - (n0.x + 150 / kk)) <= 3 && Math.abs(p.notes[0].y - (n0.y + 200 / kk)) <= 3, `moved ${n0.x},${n0.y} → ${p.notes[0].x},${p.notes[0].y}`);
    // 4) resize with the corner
    const rs = await rectOf('#note-layer .sticky .st-rs');
    await page.touchscreen.touchStart(rs.x + rs.w / 2, rs.y + rs.h / 2);
    for (let i = 1; i <= 8; i++) { await page.touchscreen.touchMove(rs.x + rs.w / 2 + 10 * i, rs.y + rs.h / 2 + 8 * i); await sleep(10); }
    await page.touchscreen.touchEnd(); await sleep(50);
    p = await pg(); assert.ok(p.notes[0].w > 200 + 60 / kk && p.notes[0].h > 150 + 50 / kk, `resized ${p.notes[0].w}x${p.notes[0].h}`);
    // 5) color cycles
    await page.tap('#note-layer .sticky [data-st="color"]');
    p = await pg(); assert.equal(p.notes[0].c, '#ffcdd2');
    // 6) fold → small icon; tap icon → open again
    await page.tap('#note-layer .sticky [data-st="fold"]');
    p = await pg(); assert.equal(p.notes[0].f, true);
    const ic = await rectOf('#note-layer .sticky');
    assert.ok(ic.w < 60 && ic.h < 60, 'folded icon size');
    await page.tap('#note-layer .sticky.folded');
    p = await pg(); assert.equal(p.notes[0].f, false); assert.equal(p.notes[0].t, '단어 외우기 DAY3', 'text kept');
    // 7) pen/eraser/lasso still work around it; pen started on the note does not draw; PDF page untouched
    const nr = await rectOf('#note-layer .sticky');
    const st0 = (await pg()).strokes.length;
    const drawMouse = async (tool, pts) => {
      await page.evaluate(t => document.querySelector(`.tool-btn[data-tool="${t}"]`).click(), tool);
      await page.mouse.move(pts[0].x, pts[0].y); await page.mouse.down();
      for (const q of pts.slice(1)) await page.mouse.move(q.x, q.y);
      await page.mouse.up(); await sleep(30);
    };
    const cv = await rectOf('#drawCanvas');
    const at = (px, py) => ({ x: cv.x + px * kk, y: cv.y + py * kk });
    await page.evaluate(() => { const w = document.getElementById('canvas-wrap'); w.scrollTop = 0; });
    await drawMouse('pen', [at(100, 100), at(200, 120), at(300, 110)]);
    p = await pg(); assert.equal(p.strokes.length, st0 + 1, 'pen draws outside note');
    await drawMouse('pen', [{ x: nr.x + nr.w / 2, y: nr.y + nr.h / 2 }, { x: nr.x + nr.w / 2 + 30, y: nr.y + nr.h / 2 + 10 }]);
    p = await pg(); assert.equal(p.strokes.length, st0 + 1, 'pen on note must not draw on the sheet'); assert.equal((p.notes[0].k || []).length, 1, 'it writes on the note instead');
    await drawMouse('eraser', [at(150, 100), at(150, 130)]);
    p = await pg(); assert.equal(p.strokes.filter(x => x.tool === 'eraser').length, 1);
    await drawMouse('lasso', [at(60, 60), at(340, 60), at(340, 160), at(60, 160), at(60, 62)]);
    assert.ok(await page.$$eval('#lasso-svg polyline', a => a.length) >= 1, 'lasso works');
    p = await pg(); assert.equal(p.images.length, 1); assert.equal(p.notes.length, 1);
    await page.evaluate(() => document.querySelector('.tool-btn[data-tool="pen"]').click());
    // 8) persists after reload
    await sleep(2500);
    const before = (await pg()).notes[0];
    await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(() => { __gkcNav.goMokcha('nb1'); __gkcNav.goSebu('m1'); __gkcNav.goDraw('s1'); }); await sleep(200);
    p = await pg(); assert.deepEqual(p.notes[0], before);
    assert.equal(await page.$eval('#note-layer .sticky textarea', t => t.value), '단어 외우기 DAY3');
    // 9) delete (asks when it has text) → tombstone for sync
    await page.tap('#note-layer .sticky [data-st="del"]');
    p = await pg(); assert.equal(p.notes.length, 0); assert.ok((p.delN || []).includes(before.id));
    assert.equal(await page.$$eval('#note-layer .sticky', a => a.length), 0);
    assert.deepEqual(errors, [], errors.join('; '));
    console.log('PASS: 🗒 포스트잇 add, type, touch-move, resize, color, fold/unfold, pen/eraser/lasso unaffected (pen on note writes on the note, not the sheet), PDF image untouched, persists after reload, delete with tombstone');
  } finally { await browser.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
