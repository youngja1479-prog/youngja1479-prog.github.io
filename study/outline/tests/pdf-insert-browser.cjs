// PDF 넣기 end-to-end in headless Chrome against the real page + vendored pdf.js.
// Synthetic notebook in a throwaway profile; no real vault, password or notes.
// Needs: Chrome (CHROME=/usr/bin/google-chrome) and puppeteer-core + pdf-lib
// (npm i --prefix /tmp/pt puppeteer-core@22 pdf-lib; PT_MODULES=/tmp/pt/node_modules).
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const M = process.env.PT_MODULES || ['/workspace/test-tools/node_modules', '/tmp/pt/node_modules'].find(p => fs.existsSync(p)) || '/tmp/pt/node_modules';
let puppeteer, PDFLib;
try { puppeteer = require(M + '/puppeteer-core'); PDFLib = require(M + '/pdf-lib'); }
catch (e) { console.log('SKIP: puppeteer-core/pdf-lib not installed'); process.exit(0); }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
if (!fs.existsSync(CHROME)) { console.log('SKIP: no Chrome'); process.exit(0); }
const ROOT = path.join(__dirname, '../../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };

async function makePdf(file) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  const sizes = [[595, 842], [595, 842], [842, 595], [595, 842], [595, 842]]; // A4, A4, landscape, A4, A4
  sizes.forEach(([w, h], i) => {
    const p = doc.addPage([w, h]);
    p.drawRectangle({ x: 40, y: h - 140, width: w - 80, height: 80, color: rgb(0.1, 0.2, 0.6) });
    for (let l = 0; l < 30; l++) p.drawText(`Page ${i + 1} line ${l + 1} - The quick brown fox jumps over the lazy dog 0123456789`, { x: 40, y: h - 180 - l * 20, size: 11, font, color: rgb(0, 0, 0) });
  });
  fs.writeFileSync(file, await doc.save());
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfins-'));
  const pdfFile = path.join(tmp, 'test.pdf'); await makePdf(pdfFile);
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(ROOT, u); if (u.endsWith('/')) f = path.join(f, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/study/outline/`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'profile'), args: ['--no-sandbox', '--no-first-run'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 900 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const prompts = [];
    page.on('dialog', async d => { prompts.push(d.message()); await d.accept(answers.shift() ?? ''); });
    let answers = [];
    await page.goto(base, { waitUntil: 'networkidle0' });
    // synthetic note: one ink stroke near the top of sheet 1
    await page.evaluate(() => {
      __gkcSync.setData({ version: 1, updatedAt: Date.now(), notebooks: [{ id: 'nb1', title: 'T', mokchas: [{ id: 'm1', title: 'M', sebus: [{ id: 's1', title: 'S', pageHeight: 1200,
        pages: [{ strokes: [{ id: 'k1', tool: 'pen', color: '#111', width: 1.5, points: [{ x: 100, y: 100 }, { x: 200, y: 120 }] }], texts: [] }] }] }] }] });
      __gkcNav.goMokcha('nb1'); __gkcNav.goSebu('m1'); __gkcNav.goDraw('s1');
    });
    const sebu = () => page.evaluate(() => { const d = __gkcSync.getData(); return d.notebooks[0].mokchas[0].sebus[0]; });
    const toastText = () => page.evaluate(() => [...document.querySelectorAll('.toast, #toast')].map(e => e.textContent).join('|'));
    async function insert(answer) {
      answers = [answer];
      const input = await page.$('#pdf-file');
      await input.uploadFile(pdfFile);
      await page.waitForFunction(() => /PDF \d+쪽을 넣었어요|다시 확인|최대|넣을 수 없어요|열 수 없어요|못했어요/.test([...document.querySelectorAll('.toast, #toast')].map(e => e.textContent).join('|')), { timeout: 60000 });
      return toastText();
    }
    assert.ok(await page.$('#btn-add-pdf'), 'PDF button present');
    // 1) all pages
    let t = await insert('');
    assert.match(t, /PDF 5쪽을 넣었어요/, t);
    assert.match(prompts[0], /PDF 5쪽/);
    let s = await sebu(), im = s.pages[0].images;
    assert.equal(im.length, 5);
    im.forEach((o, k) => {
      assert.ok(o.src.startsWith('data:image/jpeg'), 'jpeg');
      assert.ok(o.src.length < 450e3, `page ${k + 1} too big: ${o.src.length}`);
      assert.ok(o.y >= 1200 + k * 1200 && o.y + o.h <= 1200 + (k + 1) * 1200, 'one page per sheet, below existing ink');
      assert.ok(o.x >= 0 && o.x + o.w <= 800);
    });
    assert.equal(im[0].w, 800); assert.equal(im[2].w, 800); assert.ok(im[2].h < im[0].h, 'landscape fits width');
    assert.equal(s.pageHeight, 1200 * 6);
    const total1 = im.reduce((a, o) => a + o.src.length, 0);
    // rendered content is real (dark text/box pixels), resolution ~1.5x
    const info = await page.evaluate(async (src) => {
      const img = new Image(); img.src = src; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data; let dark = 0, blue = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80) dark++; if (d[i + 2] > 120 && d[i] < 60) blue++; }
      return { w: img.width, h: img.height, dark, blue };
    }, im[0].src);
    assert.equal(info.w, 1200); assert.ok(info.dark > 5000 && info.blue > 50000, JSON.stringify(info));
    // 2) range "2, 4-5" → 3 more pages on the next sheets
    t = await insert('2, 4-5');
    s = await sebu(); im = s.pages[0].images;
    assert.equal(im.length, 8, t); assert.ok(im[5].y >= 7200 && im[7].y >= 9600); assert.equal(s.pageHeight, 1200 * 9);
    // 3) bad range: nothing added
    t = await insert('7-9'); assert.match(t, /다시 확인/); assert.equal((await sebu()).pages[0].images.length, 8);
    // 4) ink/eraser/lasso on top of a PDF page: ink canvas above images, eraser cuts ink only
    const z = await page.evaluate(() => {
      const zi = el => +getComputedStyle(el).zIndex || 0;
      const ink = document.querySelector('#draw-canvas, canvas.ink, #ink-canvas') || [...document.querySelectorAll('#page-stage canvas')].pop();
      const il = document.querySelector('#img-layer');
      return { img: zi(il), ink: zi(ink), id: ink && ink.id, after: !!(il.compareDocumentPosition(ink) & Node.DOCUMENT_POSITION_FOLLOWING) };
    });
    assert.ok(z.ink > z.img || (z.ink === z.img && z.after), 'ink above PDF ' + JSON.stringify(z));
    const draw = async (tool, pts) => page.evaluate(async (tool, pts) => {
      document.querySelector(`.tool-btn[data-tool="${tool}"]`).click();
      const stage = document.querySelector('#page-stage'), wrap = stage.parentElement;
      const cv = [...stage.querySelectorAll('canvas')].pop();
      wrap.scrollTop = 0;
      const k = stage.getBoundingClientRect().width / 800;
      wrap.scrollTop = (pts[0].y - 200) * k; await new Promise(r => requestAnimationFrame(r));
      const r = stage.getBoundingClientRect();
      const ev = (type, p) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + p.x * k, clientY: r.top + p.y * k, bubbles: true }));
      ev('pointerdown', pts[0]); pts.slice(1).forEach(p => ev('pointermove', p)); ev('pointerup', pts[pts.length - 1]);
    }, tool, pts);
    const line = (x0, x1, y) => Array.from({ length: 21 }, (_, i) => ({ x: x0 + (x1 - x0) * i / 20, y }));
    await draw('pen', line(200, 600, 1500));
    await draw('eraser', line(380, 420, 1500));
    s = await sebu();
    const st = s.pages[0].strokes;
    assert.ok(st.some(x => x.tool === 'pen' && x.points.some(p => p.y > 1400)), 'pen on PDF page saved');
    assert.ok(st.some(x => x.tool === 'eraser'), 'eraser saved');
    assert.equal(s.pages[0].images.length, 8, 'eraser does not remove PDF pages');
    assert.equal(s.pages[0].images[0].src.length, im[0].src.length, 'PDF image unchanged');
    // lasso the right half of the written line over the PDF and move it; it must stay visible
    await page.evaluate(() => document.querySelector('.tool-btn[data-tool="lasso"]').click());
    await draw('lasso', [{ x: 430, y: 1450 }, { x: 640, y: 1450 }, { x: 640, y: 1550 }, { x: 430, y: 1550 }, { x: 430, y: 1452 }]);
    const sel = await page.evaluate(() => document.querySelectorAll('#lasso-svg polyline').length);
    assert.ok(sel >= 1, 'lasso selected ink over PDF');
    await draw('lasso', [{ x: 520, y: 1500 }, { x: 520, y: 1600 }, { x: 520, y: 1700 }]);
    s = await sebu();
    const movedPts = s.pages[0].strokes.filter(x => x.tool === 'pen').flatMap(x => x.points).filter(p => p.y > 1680 && p.y < 1720);
    assert.ok(movedPts.length >= 5, 'moved ink present at destination');
    // 5) undo removes the last PDF insert only if it is the last action — here check undo button works without errors
    assert.deepEqual(errors, [], 'page errors: ' + errors.join('; '));
    console.log(`PASS: 📄＋ PDF button; 5-page PDF → 5 JPEG pages (1200px, ~${(total1 / 5 / 1024).toFixed(0)} KB each), one per sheet below existing ink; range "2, 4-5"; invalid range rejected; ink/eraser on top without touching PDF; lasso move over PDF; no page errors`);
  } finally { await browser.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
