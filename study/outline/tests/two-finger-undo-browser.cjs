// 두 손가락 탭 = 실행취소 on the drawing page (real CDP touch events, tablet viewport), in headless Chrome.
// Synthetic notebook in a throwaway profile; no real vault, password or notes.
// Needs Chrome + puppeteer-core (PT_MODULES=/tmp/pt/node_modules).
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const M = process.env.PT_MODULES || ['/workspace/test-tools/node_modules', '/tmp/pt/node_modules'].find(p => fs.existsSync(p)) || '/tmp/pt/node_modules';
let puppeteer; try { puppeteer = require(M + '/puppeteer-core'); } catch (e) { console.log('SKIP: puppeteer-core not installed'); process.exit(0); }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
if (!fs.existsSync(CHROME)) { console.log('SKIP: no Chrome'); process.exit(0); }
const ROOT = path.join(__dirname, '../../..');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twotap-'));
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(ROOT, u); if (u.endsWith('/')) f = path.join(f, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/study/outline/`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'p'), args: ['--no-sandbox', '--no-first-run'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 1100, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      __gkcSync.setData({ version: 1, updatedAt: Date.now(), notebooks: [{ id: 'nb1', title: 'T', mokchas: [{ id: 'm1', title: 'M', sebus: [{ id: 's1', title: 'S', pageHeight: 1200,
        pages: [{ strokes: [{ id: 'k1', tool: 'pen', color: '#111', width: 1.5, points: [{ x: 100, y: 100 }, { x: 200, y: 120 }] }], texts: [] }] }] }] }] });
      __gkcNav.goMokcha('nb1'); __gkcNav.goSebu('m1'); __gkcNav.goDraw('s1');
    });
    const n = () => page.evaluate(() => __gkcSync.getData().notebooks[0].mokchas[0].sebus[0].pages[0].strokes.length);
    const draw = (y) => page.evaluate(async (y) => {
      document.querySelector('.tool-btn[data-tool="pen"]').click();
      const stage = document.querySelector('#page-stage'), cv = [...stage.querySelectorAll('canvas')].pop();
      stage.parentElement.scrollTop = 0; await new Promise(r => requestAnimationFrame(r));
      const r = stage.getBoundingClientRect(), k = r.width / 800;
      const ev = (type, x) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + x * k, clientY: r.top + y * k, bubbles: true }));
      ev('pointerdown', 200); for (let x = 220; x <= 600; x += 20) ev('pointermove', x); ev('pointerup', 600);
    }, y);
    const cdp = await page.target().createCDPSession();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const box = await page.evaluate(() => { const r = document.querySelector('#canvas-wrap').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 300 }; });
    const pts = (k, dx = 0) => Array.from({ length: k }, (_, i) => ({ x: box.x - 60 + i * 60 + dx * (i ? 1 : -1), y: box.y, id: i + 1 }));
    // tap with k fingers; hold ms; optional spread (pinch) px
    const tap = async (k, { hold = 60, spread = 0, stagger = 0 } = {}) => {
      const p = pts(k);
      for (let i = 0; i < k; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: p.slice(0, i + 1) }); if (stagger) await sleep(stagger); }
      if (spread) for (let s = 4; s <= spread; s += 4) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(k, s) });
      await sleep(hold);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(80);
    };
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await draw(300); await draw(400); await draw(500);
    assert.equal(await n(), 4, 'three strokes drawn');
    await tap(2); assert.equal(await n(), 3, 'two-finger tap undoes one stroke');
    assert.match(await page.$eval('#toast', t => t.textContent), /실행취소/, 'toast tells what happened');
    await tap(2, { stagger: 40 }); assert.equal(await n(), 2, 'second finger slightly later still counts');
    await page.$eval('#btn-redo', b => b.click()); assert.equal(await n(), 3, 'redo button restores it');
    await tap(1); assert.equal(await n(), 3, 'one-finger tap ignored');
    await tap(3); assert.equal(await n(), 3, 'three-finger tap ignored');
    await tap(2, { hold: 600 }); assert.equal(await n(), 3, 'long two-finger hold ignored');
    const z0 = await page.$eval('#btn-zoom-reset', b => b.textContent);
    await tap(2, { spread: 60 }); assert.equal(await n(), 3, 'pinch zoom does not undo');
    assert.notEqual(await page.$eval('#btn-zoom-reset', b => b.textContent), z0, 'pinch still zooms');
    await page.$eval('#btn-zoom-reset', b => b.click()); await sleep(100);
    // pen hovering / just lifted → palm, ignored
    await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'pen', bubbles: true })));
    await tap(2); assert.equal(await n(), 3, 'ignored right after pen activity (palm)');
    await sleep(800);
    // 손가락: 쓰기 mode: the two touches draw nothing and undo exactly one
    await page.$eval('#btn-finger-mode', b => b.click());
    assert.equal(await page.evaluate(() => __gkcFinger ? __gkcFinger.get ? __gkcFinger.get() : '' : ''), 'draw');
    await tap(2); assert.equal(await n(), 2, 'finger-draw mode: tap leaves no dot, undoes one');
    await page.$eval('#btn-finger-mode', b => b.click());
    // dialog open / 자판 mode → ignored
    await page.evaluate(() => { document.getElementById('modal-root').innerHTML = '<div class="modal">x</div>'; });
    await tap(2); assert.equal(await n(), 2, 'ignored with dialog open');
    await page.evaluate(() => { document.getElementById('modal-root').innerHTML = ''; });
    await page.$eval('#btn-mode-kb', b => b.click()); await sleep(50);
    await tap(2); assert.equal(await n(), 2, 'ignored in 자판 mode');
    await page.$eval('#btn-mode-pen', b => b.click()); await sleep(50);
    await tap(2); assert.equal(await n(), 1, 'works again in 펜 mode');
    await tap(2); assert.equal(await n(), 1, 'empty undo stack → original stroke kept');
    await sleep(1500);
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await n(), 1, 'state persisted');
    assert.deepEqual(errors, []);
    console.log('PASS: 두 손가락 탭 → 실행취소 (one step, toast); ignored for 1/3 fingers, long hold, pinch zoom, pen/palm, dialog, 자판 mode; finger-draw leaves no dot; saved after reload');
  } finally { await browser.close(); srv.close(); }
})().catch(e => { console.error(e); process.exit(1); });
