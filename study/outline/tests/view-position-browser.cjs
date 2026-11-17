// 세부목차 필기를 다시 열면 마지막으로 보던 위치(세로)로 돌아옴 — 앱을 껐다 켜도 유지(이 기기 localStorage
// 'gkc-outline-viewpos-v1' 별도 키). 처음 여는 노트는 맨 위(이전 노트의 스크롤 위치가 따라오지 않음). 확대 배율이
// 바뀌어도 같은 내용 위치. 동기화로 다시 그려질 때는 보던 자리를 건드리지 않음. 노트 데이터(DATA)는 바뀌지 않음.
// Synthetic notebook in a throwaway profile, phone + tablet viewports, real touch scroll. Needs Chrome + puppeteer-core.
// Run: node study/outline/tests/view-position-browser.cjs [rootDir]
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const M = process.env.PT_MODULES || ['/workspace/test-tools/node_modules', '/tmp/pt/node_modules'].find(p => fs.existsSync(p)) || '/tmp/pt/node_modules';
let puppeteer; try { puppeteer = require(M + '/puppeteer-core'); } catch (e) { console.log('SKIP: puppeteer-core not installed'); process.exit(0); }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
if (!fs.existsSync(CHROME)) { console.log('SKIP: no Chrome'); process.exit(0); }
const ROOT = process.argv[2] || path.join(__dirname, '../../..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NB = () => ({ version: 1, updatedAt: Date.now(), notebooks: [{ id: 'nb1', title: 'T', mokchas: [{ id: 'm1', title: 'M', sebus: [
  { id: 's1', title: 'A', pageHeight: 6000, pages: [{ strokes: [{ id: 'k1', tool: 'pen', color: '#111111', width: 2, points: [{ x: 100, y: 3000 }, { x: 300, y: 3010 }] }], texts: [] }] },
  { id: 's2', title: 'B', pageHeight: 6000, pages: [{ strokes: [], texts: [] }] }] }] }] });
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vpos-'));
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
    for (const vp of [{ width: 390, height: 800 }, { width: 800, height: 1200 }]) {
      const page = await browser.newPage();
      await page.setViewport({ ...vp, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(base, { waitUntil: 'networkidle0' });
      await page.evaluate(() => localStorage.removeItem('gkc-outline-viewpos-v1')); // per-viewport fresh (test profile only)
      await page.evaluate(d => { __gkcSync.setData(d); __gkcNav.goMokcha('nb1'); __gkcNav.goSebu('m1'); }, NB());
      const top = () => page.evaluate(() => document.getElementById('canvas-wrap').scrollTop);
      const pageY = async () => (await top()) / (await page.evaluate(() => __gkcZoom.get()));
      // open A by tapping the row, scroll with a finger (pen mode: finger pans)
      await page.evaluate(() => __gkcNav.goDraw('s1'));
      assert.equal(await top(), 0, 'first open starts at top');
      await page.evaluate(() => { document.getElementById('canvas-wrap').scrollTop = 2800 * __gkcZoom.get(); });
      const cdp = await page.target().createCDPSession();
      const r = await page.evaluate(() => { const b = document.getElementById('canvas-wrap').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y }] });
      for (let i = 1; i <= 6; i++) { await sleep(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: r.x, y: r.y - i * 15 }] }); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      let yA = -1; for (let i = 0; i < 40 && yA !== await pageY(); i++) { yA = await pageY(); await sleep(120); } // wait for fling to settle
      assert(yA > 2800 && yA < 6000, `finger scroll moved A down (got ${yA})`);
      // leave immediately (before debounce) with the ← button
      await page.evaluate(() => document.getElementById('btn-back-draw').click());
      // B must not inherit A's position
      await page.evaluate(() => __gkcNav.goDraw('s2'));
      assert.equal(await top(), 0, 'other note opens at top, not at A\'s scroll position');
      const data0 = await page.evaluate(() => JSON.stringify(__gkcSync.getData())); // after both notes were opened once (app normalizes pages on open)
      await page.evaluate(() => { document.getElementById('canvas-wrap').scrollTop = 1000 * __gkcZoom.get(); }); await sleep(500);
      await page.evaluate(() => document.getElementById('btn-back-draw').click());
      await page.evaluate(() => __gkcNav.goDraw('s1'));
      assert(Math.abs((await pageY()) - yA) < 2, `A restored (${await pageY()} vs ${yA})`);
      // a sync re-render (initDrawPage) does not jump the view
      await page.evaluate(() => { document.getElementById('canvas-wrap').scrollTop = 3500 * __gkcZoom.get(); });
      await page.evaluate(() => __gkcNav.initDrawPage());
      assert(Math.abs((await pageY()) - 3500) < 2, 'sync re-render keeps current position');
      await sleep(500);
      // zoom change: same content position (page coordinates)
      await page.evaluate(() => document.getElementById('btn-back-draw').click());
      await page.evaluate(() => __gkcZoom.set(1.5, { force: true }));
      await page.evaluate(() => __gkcNav.goDraw('s1'));
      assert(Math.abs((await pageY()) - 3500) < 3, `restored at zoom 1.5 (${await pageY()})`);
      await page.evaluate(() => __gkcZoom.set(1, { force: true }));
      // survives reload (app restart): notebook from IndexedDB, position from its own key
      await page.evaluate(() => document.getElementById('btn-back-draw').click());
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gkc-outline-viewpos-v1')));
      assert.deepEqual(Object.keys(stored).sort(), ['s1', 's2']);
      assert.equal(JSON.stringify(await page.evaluate(() => __gkcSync.getData())), data0, 'notebook data unchanged by scrolling');
      // corrupt/foreign value in the key never breaks opening
      await page.evaluate(() => localStorage.setItem('gkc-outline-viewpos-v1', '[1,2'));
      await page.reload({ waitUntil: 'networkidle0' });
      await page.evaluate(d => { __gkcSync.setData(d); __gkcNav.goMokcha('nb1'); __gkcNav.goSebu('m1'); __gkcNav.goDraw('s1'); }, NB());
      assert.equal(await top(), 0, 'corrupt key → just opens at top');
      await page.evaluate(() => { document.getElementById('canvas-wrap').scrollTop = 1500 * __gkcZoom.get(); });
      await sleep(500);
      await page.reload({ waitUntil: 'networkidle0' });
      await page.evaluate(d => { __gkcSync.setData(d); __gkcNav.goMokcha('nb1'); __gkcNav.goSebu('m1'); __gkcNav.goDraw('s1'); }, NB());
      assert(Math.abs((await pageY()) - 1500) < 2, `restored after reload (${await pageY()})`);
      // pen still draws after restore (no stuck state)
      assert.equal(await page.evaluate(() => __gkcNav.getState().view), 'draw');
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: note reopens at last viewed position (after ←, reload, zoom change); other notes start at top; sync re-render keeps view; corrupt key harmless; notebook data unchanged');
  } finally { await browser.close(); srv.close(); }
})().catch(e => { console.error(e); process.exit(1); });
