// 분홍 형광펜 (pink highlighter) in headless Chrome: touch-pick the colour, stylus strokes on paper and on a sticky note,
// same translucency as the yellow highlighter, undo/redo, toolbar state, reload. Synthetic notebook, throwaway profile.
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
    let NC; try { NC = require(M + '/@napi-rs/canvas'); } catch (_) { NC = null; }
    const PINK = '#f472b6', YELLOW = '#fef08a';
    const pinkBtn = `.tool-btn[data-tool="highlighter"][data-color="${PINK}"]`, yelBtn = `.tool-btn[data-tool="highlighter"][data-color="${YELLOW}"]`;
    const active = () => page.$$eval('.tool-btn[data-tool].active', a => a.map(b => b.dataset.tool + (b.dataset.color || '')));
    // 1) the pink button sits right after the yellow highlighter and is a 36px touch target
    assert.equal(await page.$eval(yelBtn, b => b.nextElementSibling && b.nextElementSibling.dataset.color), PINK);
    const pb = await rectOf(pinkBtn); assert.ok(pb.w >= 34 && pb.h >= 34, 'touch target');
    await page.evaluate(() => { document.getElementById('canvas-wrap').scrollTop = 0; });
    await page.evaluate(sel => document.querySelector(sel).scrollIntoView({ inline: 'center', block: 'nearest' }), pinkBtn);
    await page.tap(pinkBtn); await sleep(30);
    assert.deepEqual(await active(), ['highlighter' + PINK], 'only pink is active');
    await page.tap('.thickness-btn[data-w="3"]');
    // 2) stylus on paper → highlighter stroke with the pink colour
    const kk = await k(), cv = await rectOf('#drawCanvas'), at = (px, py) => ({ x: cv.x + px * kk, y: cv.y + py * kk });
    const row = (y, x0, x1) => Array.from({ length: 13 }, (_, i) => at(x0 + (x1 - x0) * i / 12, y));
    const s0 = (await pg()).strokes.length;
    await pen(row(760, 120, 520));
    let p = await pg(); const sp = p.strokes[p.strokes.length - 1];
    assert.equal(p.strokes.length, s0 + 1); assert.equal(sp.tool, 'highlighter'); assert.equal(sp.color, PINK); assert.equal(sp.width, 3);
    // yellow for comparison (same tool → same 40% translucency in drawStroke)
    await page.tap(yelBtn); await sleep(20); assert.deepEqual(await active(), ['highlighter' + YELLOW]);
    await pen(row(680, 120, 520));
    p = await pg(); assert.equal(p.strokes[p.strokes.length - 1].color, YELLOW);
    if (NC) {   // screen pixels: pink is a translucent pink over the paper (paper lines still show through)
      const shot = await NC.loadImage(await page.screenshot({ type: 'png' }));
      const c2 = NC.createCanvas(shot.width, shot.height), g = c2.getContext('2d'); g.drawImage(shot, 0, 0);
      const dpr = shot.width / 900;
      const px = (q) => Array.from(g.getImageData(Math.round(q.x * dpr), Math.round(q.y * dpr), 1, 1).data);
      const med = (y) => { const a = [200, 260, 320, 380, 440].map(x => px(at(x, y))).sort((u, v) => (u[0] + u[1] + u[2]) - (v[0] + v[1] + v[2])); return a[2]; };
      const pk = med(760), yl = med(680), paper = med(640);   // rows between ruled lines
      assert.ok(pk[0] > pk[1] + 40 && pk[2] > pk[1] + 20, 'pink on paper ' + pk);
      assert.ok(yl[0] > yl[2] + 40 && yl[1] > yl[2] + 40, 'yellow on paper ' + yl);
      assert.ok(pk[1] > 150, 'pink is translucent (not opaque #f472b6) ' + pk);
      assert.ok(pk[0] > 230 && paper[0] > 230, 'light like yellow ' + pk + ' / ' + paper);
    }
    // 3) on a sticky note: pink ink belongs to the note
    await page.tap(pinkBtn); await sleep(20);
    const r = await rectOf('#note-layer .sticky .st-ink');
    await pen(Array.from({ length: 13 }, (_, i) => ({ x: r.x + r.w * (0.1 + 0.07 * i), y: r.y + r.h * 0.5 })));
    p = await pg(); assert.equal(p.notes[0].k.length, 1); assert.equal(p.notes[0].k[0].tool, 'highlighter'); assert.equal(p.notes[0].k[0].color, PINK);
    const notePx = await page.$eval('#note-layer .sticky .st-ink', c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let mx = 0; for (let i = 3; i < d.length; i += 4) mx = Math.max(mx, d[i]); return mx; });
    assert.ok(notePx > 80 && notePx < 120, 'note ink alpha ≈ 40% (' + notePx + ')');
    // 4) undo / redo
    await page.evaluate(() => document.getElementById('btn-undo').click()); await sleep(30);
    p = await pg(); assert.equal((p.notes[0].k || []).length, 0);
    await page.evaluate(() => document.getElementById('btn-undo').click()); await sleep(30);
    p = await pg(); assert.equal(p.strokes.length, s0 + 1, 'yellow undone'); assert.equal(p.strokes[p.strokes.length - 1].color, PINK);
    await page.evaluate(() => document.getElementById('btn-redo').click()); await page.evaluate(() => document.getElementById('btn-redo').click()); await sleep(30);
    p = await pg(); assert.equal(p.strokes.length, s0 + 2); assert.equal(p.notes[0].k[0].color, PINK);
    // 5) reopening the page keeps pink selected in the toolbar; reload keeps the strokes
    await page.evaluate(() => { __gkcNav.goSebu('m1'); __gkcNav.goDraw('s1'); }); await sleep(200);
    assert.deepEqual(await active(), ['highlighter' + PINK], 'toolbar shows pink after reopening');
    await sleep(2500);
    const before = await pg();
    await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(() => { __gkcNav.goMokcha('nb1'); __gkcNav.goSebu('m1'); __gkcNav.goDraw('s1'); }); await sleep(300);
    p = await pg(); assert.deepEqual(p.strokes, before.strokes); assert.deepEqual(p.notes, before.notes);
    // 6) other tools unchanged
    assert.deepEqual(await page.$$eval('.tool-btn[data-tool="pen"]', a => a.map(b => b.dataset.color)), ['#1a1a1a', '#2563eb', '#dc2626']);
    assert.deepEqual(errors, [], errors.join('; '));
    console.log('PASS: 분홍 형광펜 — touch pick (only pink active), pink highlighter on paper and on a sticky note, same ~40% translucency as yellow' + (NC ? ' (pixels checked)' : '') + ', undo/redo, toolbar state on reopen, persists after reload');
  } finally { await browser.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
