// 지우개 → 필기 획수 must never go up (GKC 2026-11-19). Stylus in headless Chrome on a synthetic notebook:
// draw 3 strokes, erase one fully, erase one partly, erase over empty paper, erase the rest, undo/redo;
// checks the "필기 N획" label, the stored strokes (no invisible junk, tombstones for removed ink) and that
// old versions (PR38 1967308) still open the data. Also: old data that already holds eraser passes /
// fully erased ink is counted right and is not rewritten just by opening it.
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const M = process.env.PT_MODULES || ['/workspace/test-tools/node_modules', '/tmp/pt/node_modules'].find(p => fs.existsSync(p)) || '/tmp/pt/node_modules';
let puppeteer; try { puppeteer = require(M + '/puppeteer-core'); } catch (e) { console.log('SKIP: puppeteer-core not installed'); process.exit(0); }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
if (!fs.existsSync(CHROME)) { console.log('SKIP: no Chrome'); process.exit(0); }
const ROOT = path.join(__dirname, '../../..');
const CUR = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
let OLD = null; try { OLD = execFileSync('git', ['show', '1967308:study/outline/index.html'], { cwd: ROOT, maxBuffer: 64e6 }).toString(); } catch (_) {}
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eraser-'));
  let html = CUR;
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (u === '/study/outline/' || u === '/study/outline/index.html') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(html); return; }
    res.writeHead(404); res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/study/outline/`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'p'), args: ['--no-sandbox', '--no-first-run'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 1100, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    await page.goto(url, { waitUntil: 'networkidle0' });
    // s1: empty page for drawing; s2: old-style data that already has eraser passes in it
    const ER = (id, pts) => ({ id, tool: 'eraser', color: '#000', width: 12, points: pts });
    const PEN = (id, y, x0 = 100, x1 = 300) => ({ id, tool: 'pen', color: '#111', width: 1.5, points: [{ x: x0, y }, { x: (x0 + x1) / 2, y }, { x: x1, y }] });
    const s2page = { strokes: [PEN('o1', 100), PEN('o2', 300), ER('oe1', [{ x: 80, y: 100 }, { x: 320, y: 100 }]), ER('oe2', [{ x: 200, y: 260 }, { x: 200, y: 340 }]), ER('oe3', [{ x: 600, y: 900 }, { x: 650, y: 900 }])], texts: [], del: ['x0'] };
    await page.evaluate((s2page) => {
      __gkcSync.setData({ version: 1, updatedAt: Date.now(), notebooks: [{ id: 'nb1', title: 'T', type: 'thought', mokchas: [{ id: 'm1', title: 'M', sebus: [
        { id: 's1', title: 'S1', pageHeight: 2400, pages: [{ strokes: [], texts: [] }] },
        { id: 's2', title: 'S2', pageHeight: 2400, pages: [s2page] }] }] }] });
    }, s2page);
    const subs = async () => { await page.evaluate(() => { __gkcNav.goMokcha('nb1'); __gkcNav.goSebu('m1'); }); await sleep(150); return page.$$eval('#sebu-list .item-row .item-sub', a => a.map(e => e.textContent.split('·')[0].trim())); };
    // old data: 5 stored strokes, but only o2 is visible (o1 fully erased, o2 cut in two) → 1획, data untouched
    assert.deepEqual(await subs(), ['빈 페이지', '필기 1획'], 'old data counted by visible ink');
    const pgOf = i => page.evaluate(i => __gkcSync.getData().notebooks[0].mokchas[0].sebus[i].pages[0], i);
    assert.deepEqual((await pgOf(1)).strokes, s2page.strokes, 'opening the list does not rewrite old data');
    await page.evaluate(() => __gkcNav.goDraw('s2')); await sleep(200);
    assert.deepEqual((await pgOf(1)).strokes, s2page.strokes, 'opening the page does not rewrite old data');

    await page.evaluate(() => __gkcNav.goDraw('s1')); await sleep(200);
    const cdp = await page.createCDPSession();
    const pen = async (pts) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0].x, y: pts[0].y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.6 });
      for (const q of pts.slice(1)) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.x, y: q.y, button: 'left', buttons: 1, pointerType: 'pen', force: 0.6 }); await sleep(8); }
      const z = pts[pts.length - 1];
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: z.x, y: z.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
      await sleep(60);
    };
    const kk = await page.evaluate(() => document.getElementById('page-stage').getBoundingClientRect().width / 800);
    const cv = await page.$eval('#drawCanvas', el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top }; });
    const at = (px, py) => ({ x: cv.x + px * kk, y: cv.y + py * kk });
    const seg = (x0, y0, x1, y1, n = 16) => Array.from({ length: n + 1 }, (_, i) => at(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n));
    const tool = t => page.evaluate(t => document.querySelector(`.tool-btn[data-tool="${t}"]`).click(), t);
    const thick = w => page.evaluate(w => document.querySelector(`.thickness-btn[data-w="${w}"]`).click(), w);
    const s1 = () => pgOf(0);
    const ink = st => st.filter(o => o.tool !== 'eraser');
    const label = async () => { const t = (await subs())[0]; await page.evaluate(() => __gkcNav.goDraw('s1')); await sleep(150); return t; };

    await page.evaluate(() => { document.getElementById('canvas-wrap').scrollTop = 0; });
    await tool('pen'); await thick('1.5');
    await pen(seg(100, 200, 300, 200)); await pen(seg(100, 400, 300, 400)); await pen(seg(100, 600, 300, 600));
    let p = await s1(); assert.equal(p.strokes.length, 3);
    const [A, B, C] = p.strokes.map(o => o.id);
    assert.equal(await label(), '필기 3획');

    await tool('eraser'); await thick('12');
    // 1) erase A completely → A and the pass are gone from the data, A tombstoned, count 2
    await pen(seg(70, 200, 330, 200, 24));
    p = await s1();
    assert.deepEqual(p.strokes.map(o => o.id), [B, C], 'fully erased stroke + its pass removed (no junk)');
    assert.ok((p.del || []).includes(A), 'tombstone so other devices drop it too');
    assert.equal(await label(), '필기 2획', 'full erase lowers the count');
    // 2) erase the middle of B → B stays one stroke (visible in two pieces), pass kept, count still 2
    await pen(seg(200, 360, 200, 440, 10));
    p = await s1();
    assert.deepEqual(ink(p.strokes).map(o => o.id), [B, C]); assert.equal(p.strokes.length, 3, 'partial-erase pass kept');
    const Ev = p.strokes[2].id;
    assert.equal(await label(), '필기 2획', 'partial erase does not raise the count');
    // 3) eraser over empty paper → nothing stored, no undo step
    const undoN = await page.evaluate(() => document.getElementById('btn-undo').disabled);
    await pen(seg(500, 1000, 700, 1000));
    p = await s1(); assert.equal(p.strokes.length, 3, 'pass over empty paper not stored');
    assert.ok(!(p.del || []).some(k => ![A].includes(k)), 'no tombstone for an unsaved pass');
    assert.equal(await label(), '필기 2획');
    // 4) erase the left half of B, then the right half → B, both passes and the earlier middle pass all removed
    await pen(seg(70, 400, 195, 400, 16));
    p = await s1(); assert.equal(ink(p.strokes).length, 2); assert.equal(await label(), '필기 2획');
    const before4 = p.strokes.slice();
    await pen(seg(190, 400, 330, 400, 16));
    p = await s1();
    assert.deepEqual(p.strokes.map(o => o.id), [C], 'no invisible ink or orphan eraser passes left');
    for (const id of [B, Ev]) assert.ok(p.del.includes(id), 'tombstone ' + id);
    // 5) undo brings the state before the last pass back, redo removes it again (undo history is per visit)
    await page.evaluate(() => document.getElementById('btn-undo').click()); await sleep(80);
    p = await s1(); assert.deepEqual(p.strokes.map(o => o.id), before4.map(o => o.id), 'undo restores');
    assert.ok(!p.del.includes(B), 'undo lifts the tombstone');
    await page.evaluate(() => document.getElementById('btn-redo').click()); await sleep(80);
    p = await s1(); assert.deepEqual(p.strokes.map(o => o.id), [C]); assert.equal(await label(), '필기 1획');
    // 6) every pass never raised the count; data shape unchanged (same stroke fields)
    for (const st of p.strokes) assert.deepEqual(Object.keys(st).filter(k => !['id', 'tool', 'color', 'width', 'points', 'pr'].includes(k)), []);
    assert.deepEqual(errors, [], errors.join('; '));
    // 7) persisted, and the previous version (PR38) opens the new data unchanged
    await sleep(2500);
    const saved = await page.evaluate(() => __gkcSync.getData());
    if (OLD) {
      html = OLD; await page.reload({ waitUntil: 'networkidle0' }); await sleep(300);
      const got = await page.evaluate(() => __gkcSync.getData());
      assert.deepEqual(got.notebooks, saved.notebooks, 'PR38 reads data written by this version');
      await page.evaluate(() => { __gkcNav.goMokcha('nb1'); __gkcNav.goSebu('m1'); __gkcNav.goDraw('s1'); }); await sleep(200);
      assert.deepEqual(errors, [], 'PR38: ' + errors.join('; '));
      html = CUR;
    }
    console.log('PASS: 지우개 — full erase removes the stroke from 필기 획수 (3→2→1), partial erase keeps it 1 stroke, empty passes not stored, no invisible junk (tombstoned), undo/redo, old data counted by visible ink and not rewritten' + (OLD ? ', PR38 reads the new data' : ''));
  } finally { await browser.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
