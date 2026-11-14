// Ctrl/⌘+Z 실행취소 · Ctrl/⌘+Shift+Z / Ctrl+Y 다시실행 on the drawing page, in headless Chrome.
// Synthetic notebook in a throwaway profile; no real vault, password or notes.
// Needs Chrome + puppeteer-core (PT_MODULES=/tmp/pt/node_modules).
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const M = process.env.PT_MODULES || ['/workspace/test-tools/node_modules', '/tmp/pt/node_modules'].find(p => fs.existsSync(p)) || '/tmp/pt/node_modules';
let puppeteer; try { puppeteer = require(M + '/puppeteer-core'); } catch (e) { console.log('SKIP: puppeteer-core not installed'); process.exit(0); }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
if (!fs.existsSync(CHROME)) { console.log('SKIP: no Chrome'); process.exit(0); }
const ROOT = path.join(__dirname, '../../..');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'undokey-'));
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
    await page.setViewport({ width: 1100, height: 900 });
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
    const key = async (mods, k) => { for (const m of mods) await page.keyboard.down(m); await page.keyboard.press(k); for (const m of mods.slice().reverse()) await page.keyboard.up(m); await new Promise(r => setTimeout(r, 30)); };
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await draw(300); await draw(400);
    assert.equal(await n(), 3, 'two strokes drawn');
    await key(['Control'], 'KeyZ'); assert.equal(await n(), 2, 'Ctrl+Z undoes');
    await key(['Meta'], 'KeyZ'); assert.equal(await n(), 1, '⌘+Z undoes');
    await key(['Control'], 'KeyZ'); assert.equal(await n(), 1, 'undo stack empty → original stroke kept');
    await key(['Control', 'Shift'], 'KeyZ'); assert.equal(await n(), 2, 'Ctrl+Shift+Z redoes');
    await key(['Control'], 'KeyY'); assert.equal(await n(), 3, 'Ctrl+Y redoes');
    await key([], 'KeyZ'); assert.equal(await n(), 3, 'plain Z ignored');
    // typing in an input: native undo, notebook untouched
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 't-in'; document.body.appendChild(i); i.focus(); });
    await key(['Control'], 'KeyZ'); assert.equal(await n(), 3, 'ignored while typing');
    await page.evaluate(() => { document.getElementById('t-in').remove(); });
    // dialog open → ignored
    await page.evaluate(() => { document.getElementById('modal-root').innerHTML = '<div class="modal">x</div>'; document.activeElement && document.activeElement.blur(); });
    await key(['Control'], 'KeyZ'); assert.equal(await n(), 3, 'ignored with dialog open');
    await page.evaluate(() => { document.getElementById('modal-root').innerHTML = ''; });
    await key(['Control'], 'KeyZ'); assert.equal(await n(), 2, 'works again after dialog closes');
    // other views → ignored
    await page.evaluate(() => __gkcNav.goHome());
    await key(['Control'], 'KeyZ'); assert.equal(await n(), 2, 'ignored outside drawing page');
    assert.ok(await page.$eval('#btn-undo', b => /Ctrl\+Z/.test(b.title)), 'hint in button title');
    // persisted after reload
    await new Promise(r => setTimeout(r, 1500));
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await n(), 2, 'state persisted');
    assert.deepEqual(errors, []);
    console.log('PASS: Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z & Ctrl+Y redo on drawing page; ignored while typing, with dialog open, outside drawing page, plain Z; saved after reload');
  } finally { await browser.close(); srv.close(); }
})().catch(e => { console.error(e); process.exit(1); });
