// 포스트잇 필기 (ink on sticky notes) in headless Chrome: real pen pointer events via CDP, touch, synthetic notebook.
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
        pages: [{ strokes: [{ id: 'k1', tool: 'pen', color: '#111', width: 1.5, points: [{ x: 100, y: 900 }, { x: 300, y: 900 }] }], texts: [], images: [{ id: 'pdf1', x: 0, y: 1234, w: 800, h: 1131, src: IMG }],
        notes: [{ id: 'n1', x: 200, y: 200, w: 300, h: 230, c: '#fff59d', t: '메모', f: false, u: 1 }] }] }] }] }] });
      __gkcNav.goMokcha('nb1'); __gkcNav.goSebu('m1'); __gkcNav.goDraw('s1');
    }, IMG);
    await sleep(200);
    const pg = () => page.evaluate(() => __gkcSync.getData().notebooks[0].mokchas[0].sebus[0].pages[0]);
    const k = () => page.evaluate(() => document.getElementById('page-stage').getBoundingClientRect().width / 800);
    const rectOf = sel => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const cdp = await page.createCDPSession();
    const pen = async (pts) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0].x, y: pts[0].y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.6 });
      for (const q of pts.slice(1)) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.x, y: q.y, button: 'left', buttons: 1, pointerType: 'pen', force: 0.6 }); await sleep(8); }
      const z = pts[pts.length - 1];
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: z.x, y: z.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
      await sleep(40);
    };
    const tool = t => page.evaluate(t => document.querySelector(`.tool-btn[data-tool="${t}"]`).click(), t);
    const note = async () => (await pg()).notes[0];
    const inkRect = () => rectOf('#note-layer .sticky .st-ink');
    const inkPixels = () => page.$eval('#note-layer .sticky .st-ink', c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++; return n; });
    const line = (r, fx0, fy, fx1, n = 12) => Array.from({ length: n + 1 }, (_, i) => ({ x: r.x + r.w * (fx0 + (fx1 - fx0) * i / n), y: r.y + r.h * fy }));
    const sheetStrokes = (await pg()).strokes.length;
    let r = await inkRect();
    // 1) pen tool + stylus on the note → ink belongs to the note (note coords), not the sheet; no keyboard
    await tool('pen');
    await pen(line(r, 0.1, 0.5, 0.9));
    let o = await note();
    assert.equal((o.k || []).length, 1, 'pen ink on note'); assert.equal((await pg()).strokes.length, sheetStrokes, 'sheet untouched');
    const s1 = o.k[0]; assert.equal(s1.tool, 'pen'); assert.equal(s1.pr, 1, 'real stylus pointer'); assert.ok(s1.points.length > 5);
    assert.ok(s1.points.every(p => p.x >= 0 && p.x <= 300 && p.y >= 0 && p.y <= 200), 'note-local coords');
    assert.ok(Math.abs(s1.points[0].x - 30) < 3 && Math.abs(s1.points[0].y - 100) < 3, JSON.stringify(s1.points[0]));
    assert.notEqual(await page.evaluate(() => document.activeElement && document.activeElement.tagName), 'TEXTAREA', 'pen does not open keyboard');
    assert.ok(await inkPixels() > 50, 'ink visible');
    // 2) highlighter on the note
    await tool('highlighter'); await pen(line(r, 0.1, 0.3, 0.8));
    o = await note(); assert.equal(o.k.length, 2); assert.equal(o.k[1].tool, 'highlighter');
    // 3) finger tap types (ink kept)
    await page.touchscreen.tap(r.x + r.w * 0.5, r.y + r.h * 0.8); await sleep(50);
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA', 'finger tap focuses text');
    await page.keyboard.type(' 추가'); await page.evaluate(() => document.activeElement.blur()); await sleep(30);
    o = await note(); assert.equal(o.t, '메모 추가'); assert.equal(o.k.length, 2);
    // 4) eraser on the note erases note ink only (no sheet eraser stroke)
    const px0 = await inkPixels();
    await tool('eraser'); await pen(line(r, 0.45, 0.5, 0.55, 4).concat(line(r, 0.55, 0.3, 0.45, 4)));
    o = await note(); assert.equal(o.k.length, 3); assert.equal(o.k[2].tool, 'eraser');
    assert.equal((await pg()).strokes.length, sheetStrokes, 'eraser on note leaves the sheet alone');
    const px1 = await inkPixels(); assert.ok(px1 < px0, `erased ${px0} → ${px1}`);
    // 5) undo / redo note ink
    const erId = o.k[2].id;
    await page.evaluate(() => document.getElementById('btn-undo').click()); await sleep(30);
    o = await note(); assert.equal(o.k.length, 2); assert.ok((o.dk || []).includes(erId), 'undo leaves an ink tombstone for sync');
    assert.equal(await inkPixels(), px0, 'undo restores pixels');
    await page.evaluate(() => document.getElementById('btn-redo').click()); await sleep(30);
    o = await note(); assert.equal(o.k.length, 3); assert.ok(!(o.dk || []).includes(o.k[2].id), 'redo clears tombstone');
    assert.equal(await inkPixels(), px1);
    // 6) move with the bar → ink moves with the note (stored coords unchanged)
    await tool('pen');
    const k0 = JSON.stringify(o.k), kk = await k();
    const bar = await rectOf('#note-layer .sticky .st-grip');
    await page.touchscreen.touchStart(bar.x + 20, bar.y + bar.h / 2);
    for (let i = 1; i <= 8; i++) { await page.touchscreen.touchMove(bar.x + 20 + 10 * i, bar.y + bar.h / 2 + 15 * i); await sleep(10); }
    await page.touchscreen.touchEnd(); await sleep(50);
    o = await note(); assert.ok(o.x > 240 && o.y > 280, `moved to ${o.x},${o.y}`); assert.equal(JSON.stringify(o.k), k0);
    const r2 = await inkRect(); assert.ok(Math.abs(r2.x - r.x - 80) < 4 && Math.abs(r2.y - r.y - 120) < 4, 'ink layer moved');
    assert.equal(await inkPixels(), px1, 'ink pixels same after move');
    // 7) resize → ink stays at its place (clipped by the note), canvas follows the size
    const rs = await rectOf('#note-layer .sticky .st-rs');
    await page.touchscreen.touchStart(rs.x + rs.w / 2, rs.y + rs.h / 2);
    for (let i = 1; i <= 6; i++) { await page.touchscreen.touchMove(rs.x + rs.w / 2 + 10 * i, rs.y + rs.h / 2 + 10 * i); await sleep(10); }
    await page.touchscreen.touchEnd(); await sleep(50);
    o = await note(); assert.ok(o.w > 330); assert.equal(JSON.stringify(o.k), k0);
    const r3 = await inkRect(); assert.ok(r3.w > r2.w + 40 && r3.h > r2.h + 40, 'ink canvas resized');
    assert.equal(await inkPixels() > px1 * 0.9, true, 'ink still drawn after resize');
    // 8) fold hides ink, unfold shows it
    await page.tap('#note-layer .sticky [data-st="fold"]');
    assert.equal(await page.$eval('#note-layer .sticky .st-ink', c => getComputedStyle(c).display), 'none');
    await page.tap('#note-layer .sticky.folded'); await sleep(30);
    o = await note(); assert.equal(o.f, false); assert.equal(JSON.stringify(o.k), k0); assert.ok(await inkPixels() > 50);
    // 9) finger drag on the note (손가락: 이동) scrolls the sheet — no ink, no keyboard
    r = await inkRect();
    const st0 = await page.$eval('#canvas-wrap', w => w.scrollTop);
    await page.touchscreen.touchStart(r.x + r.w / 2, r.y + r.h * 0.8);
    for (let i = 1; i <= 8; i++) { await page.touchscreen.touchMove(r.x + r.w / 2, r.y + r.h * 0.8 - 12 * i); await sleep(10); }
    await page.touchscreen.touchEnd(); await sleep(50);
    assert.ok(await page.$eval('#canvas-wrap', w => w.scrollTop) > st0 + 40, 'finger drag scrolls');
    o = await note(); assert.equal(o.k.length, 3);
    assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA');
    // 10) 손가락: 쓰기 → finger draws on the note too
    await page.evaluate(() => document.getElementById('btn-finger-mode').click());
    r = await inkRect();
    await page.touchscreen.touchStart(r.x + r.w * 0.2, r.y + r.h * 0.7);
    for (let i = 1; i <= 8; i++) { await page.touchscreen.touchMove(r.x + r.w * (0.2 + 0.05 * i), r.y + r.h * 0.7); await sleep(10); }
    await page.touchscreen.touchEnd(); await sleep(50);
    o = await note(); assert.equal(o.k.length, 4, 'finger draws in 쓰기 mode');
    await page.evaluate(() => document.getElementById('btn-finger-mode').click());
    // 11) sheet pen / lasso / PDF unaffected; lasso over the note does not grab note ink
    const cvr = await rectOf('#drawCanvas');
    await page.evaluate(() => { document.getElementById('canvas-wrap').scrollTop = 0; }); await sleep(30);
    const cv2 = await rectOf('#drawCanvas'), at = (px, py) => ({ x: cv2.x + px * kk, y: cv2.y + py * kk });
    await pen([at(60, 80), at(120, 90), at(180, 85)]);
    let p = await pg(); assert.equal(p.strokes.length, sheetStrokes + 1, 'stylus still draws on the sheet');
    await tool('lasso'); await pen([at(10, 10), at(790, 10), at(790, 790), at(10, 790), at(10, 12)]);
    await page.evaluate(() => document.querySelector('.tool-btn[data-tool="pen"]').click()); await sleep(30);
    p = await pg(); assert.equal(p.notes[0].k.length, 4); assert.equal(p.images.length, 1); assert.equal(p.images[0].y, 1234);
    // 12) persists after reload
    await sleep(2500);
    const before = (await pg()).notes[0];
    await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(() => { __gkcNav.goMokcha('nb1'); __gkcNav.goSebu('m1'); __gkcNav.goDraw('s1'); }); await sleep(300);
    p = await pg(); assert.deepEqual(p.notes[0], before); assert.ok(await inkPixels() > 50, 'ink drawn after reload');
    // 13) delete note → its ink goes with it
    await page.tap('#note-layer .sticky [data-st="del"]');
    p = await pg(); assert.equal(p.notes.length, 0); assert.ok(p.delN.includes('n1'));
    assert.deepEqual(errors, [], errors.join('; '));
    console.log('PASS: 포스트잇 필기 — stylus pen/highlighter/eraser ink on the note (note coords, sheet untouched), finger tap types, finger drag scrolls, 손가락:쓰기 draws, undo/redo with tombstones, moves/resizes/folds/deletes with the note, sheet pen/lasso/PDF unaffected, persists');
  } finally { await browser.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
