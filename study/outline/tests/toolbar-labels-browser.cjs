// 필기 도구줄: 글자 붙은 버튼(지우개·올가미·이미지·선택·PDF·포스트잇·종이)이 36px 칸에서 두 줄로 꺾여 위아래가
// 잘리던 문제. 아이콘 위·이름 아래 한 줄로, 버튼 밖으로 넘치지 않는지 폰·태블릿·가로 화면에서 확인(headless Chrome).
// 글자를 눌러도 도구가 선택되고, 도구줄 버튼은 touch-action: manipulation(빠른 연타 시 두 번 탭 확대 없음).
// Synthetic notebook in a throwaway profile. Needs Chrome + puppeteer-core. Run: node study/outline/tests/toolbar-labels-browser.cjs [rootDir]
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const M = process.env.PT_MODULES || ['/workspace/test-tools/node_modules', '/tmp/pt/node_modules'].find(p => fs.existsSync(p)) || '/tmp/pt/node_modules';
let puppeteer; try { puppeteer = require(M + '/puppeteer-core'); } catch (e) { console.log('SKIP: puppeteer-core not installed'); process.exit(0); }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
if (!fs.existsSync(CHROME)) { console.log('SKIP: no Chrome'); process.exit(0); }
const ROOT = process.argv[2] || path.join(__dirname, '../../..');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tblbl-'));
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
    for (const vp of [{ width: 390, height: 800 }, { width: 800, height: 1100 }, { width: 1280, height: 800 }, { width: 800, height: 420 }]) {
      const page = await browser.newPage();
      await page.setViewport({ ...vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(base, { waitUntil: 'networkidle0' });
      await page.evaluate(() => {
        __gkcSync.setData({ version: 1, updatedAt: Date.now(), notebooks: [{ id: 'nb1', title: 'T', mokchas: [{ id: 'm1', title: 'M', sebus: [{ id: 's1', title: 'S', pageHeight: 1200, pages: [{ strokes: [], texts: [] }] }] }] }] });
        __gkcNav.goMokcha('nb1'); __gkcNav.goSebu('m1'); __gkcNav.goDraw('s1');
      });
      const r = await page.evaluate(() => [...document.querySelectorAll('#draw-toolbar button')].filter(b => b.offsetParent).map(b => {
        const lines = [...b.childNodes].filter(n => n.nodeType === 1 && n.classList.contains('tl')).map(n => n.getClientRects().length);
        return { t: b.textContent.trim(), sh: b.scrollHeight, ch: b.clientHeight, sw: b.scrollWidth, cw: b.clientWidth, ta: getComputedStyle(b).touchAction, lines };
      }));
      const labelled = r.filter(x => /[가-힣A-Z]{2,}/.test(x.t));
      assert(labelled.length >= 7, 'labelled buttons found: ' + labelled.length);
      for (const x of labelled) {
        assert(x.sh <= x.ch + 1 && x.sw <= x.cw + 1, `${vp.width}x${vp.height}: "${x.t}" overflows its button (${x.sw}x${x.sh} in ${x.cw}x${x.ch})`);
        assert(x.lines.every(n => n === 1), `${vp.width}: "${x.t}" label wraps`);
      }
      for (const x of r) assert.equal(x.ta, 'manipulation', `"${x.t}" touch-action`);
      // tapping the label text still selects the tool
      await page.evaluate(() => document.querySelector('.tool-btn[data-tool="eraser"] .tl').click());
      assert(await page.evaluate(() => document.querySelector('.tool-btn[data-tool="eraser"]').classList.contains('active')), 'eraser selected via label');
      await page.evaluate(() => document.querySelector('.tool-btn[data-tool="pen"]').click());
      assert(await page.evaluate(() => document.querySelector('.tool-btn[data-tool="pen"]').classList.contains('active')), 'pen back');
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: toolbar labels fit in one line inside their buttons (phone, tablet, landscape, short landscape); label tap selects tool; toolbar buttons touch-action: manipulation');
  } finally { await browser.close(); srv.close(); }
})().catch(e => { console.error(e); process.exit(1); });
