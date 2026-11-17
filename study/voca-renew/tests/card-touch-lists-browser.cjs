// 폰 터치: (1) 카드 위에 손가락을 대고 화면을 스크롤(드래그)하면 손을 뗄 때 카드가 뒤집히던 문제 — 10px 넘게
// 움직이거나 두 손가락이면 뒤집지 않음, 보통 탭은 그대로 뒤집기. (2) 외움/모르겠음 탭마다 보이지 않는 오답·외움
// 목록(수백 줄)을 다시 그리던 지연 — 카드 화면에서는 목록을 그리지 않고, 오답 탭/누적 오답을 열면 최신 상태로 그림.
// Real CDP touch, phone viewport, throwaway profile + synthetic marks. Needs Chrome + puppeteer-core.
// Run: node study/voca-renew/tests/card-touch-lists-browser.cjs [rootDir]
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const M = process.env.PT_MODULES || ['/workspace/test-tools/node_modules', '/tmp/pt/node_modules'].find(p => fs.existsSync(p)) || '/tmp/pt/node_modules';
let puppeteer; try { puppeteer = require(M + '/puppeteer-core'); } catch (e) { console.log('SKIP: puppeteer-core not installed'); process.exit(0); }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
if (!fs.existsSync(CHROME)) { console.log('SKIP: no Chrome'); process.exit(0); }
const ROOT = process.argv[2] || path.join(__dirname, '../../..');
const KEY = 'gkc-voca-gicho1000-v1-marks-v1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vtouch-'));
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(ROOT, u); if (u.endsWith('/')) f = path.join(f, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : f.endsWith('.json') ? 'application/json' : 'text/javascript' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/study/voca-renew/`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'p'), args: ['--no-sandbox', '--no-first-run'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 760, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base, { waitUntil: 'networkidle0' });
    // existing learner: 20 known + 20 wrong on DAY 2 (must survive untouched)
    await page.evaluate(k => { const known = {}, wrong = {}; for (let i = 0; i < 40; i++) ((i % 2) ? wrong : known)['gicho1000-v1:2:' + i] = 1; localStorage.setItem(k, JSON.stringify({ known, wrong })); }, KEY);
    await page.reload({ waitUntil: 'networkidle0' });
    const cdp = await page.target().createCDPSession();
    const touch = async (pts) => { // pts: list of [x,y]; start, moves, end
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
      for (const p of pts.slice(1)) { await sleep(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] }); }
      await sleep(30); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(80);
    };
    const shown = () => page.evaluate(() => document.getElementById('flashMean').style.display === 'block');
    const wrongLis = () => page.evaluate(() => document.querySelectorAll('#wrongList li').length);
    assert.equal(await wrongLis(), 20, 'initial list rendered');
    await page.evaluate(() => { const $ = id => document.getElementById(id); $('btnRangeEntry').click(); $('rangeStart').value = '1'; $('rangeEnd').value = '1'; $('rangeModeCard').checked = true; $('btnRangeStart').click(); });
    assert.equal(await page.evaluate(() => document.getElementById('panel-card').classList.contains('active')), true, 'card panel open');
    const r = await page.evaluate(() => { const b = document.getElementById('flashWrap').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 30, h: b.height }; });
    // (1) plain tap flips, again hides
    await touch([[r.x, r.y]]); assert.equal(await shown(), true, 'tap shows meaning');
    await touch([[r.x, r.y]]); assert.equal(await shown(), false, 'tap again hides');
    // drag (scroll) starting on card must not flip — both directions, and when revealed must not hide
    await touch([[r.x, r.y + 60], [r.x, r.y + 40], [r.x, r.y + 10], [r.x, r.y - 20]]);
    assert.equal(await shown(), false, 'vertical drag on card does not flip');
    await touch([[r.x, r.y], [r.x + 30, r.y + 2], [r.x + 70, r.y + 4]]);
    assert.equal(await shown(), false, 'sideways drag does not flip');
    await touch([[r.x, r.y]]); assert.equal(await shown(), true, 'tap after drag still works');
    await touch([[r.x, r.y], [r.x, r.y + 25], [r.x, r.y + 60]]);
    assert.equal(await shown(), true, 'drag does not hide a revealed card');
    await touch([[r.x, r.y], [r.x + 3, r.y + 4]]); assert.equal(await shown(), false, 'tiny finger wobble (<10px) is still a tap');
    // two-finger pinch on the card does not flip
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x - 30, y: r.y, id: 1 }, { x: r.x + 30, y: r.y, id: 2 }] });
    await sleep(30); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(80);
    assert.equal(await shown(), false, 'two-finger touch does not flip');
    // 🔊 button tap does not flip
    const t = await page.evaluate(() => { const b = document.getElementById('ttsBtn').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await touch([[t.x, t.y]]); assert.equal(await shown(), false, '🔊 does not flip');
    // (2) 모르겠음 ×3 on DAY 1 cards: hidden lists not rebuilt during study, but correct when opened
    const ids = [];
    for (let i = 0; i < 3; i++) {
      await sleep(400);
      const b = await page.evaluate(() => { const e = document.getElementById('btnDontKnow').getBoundingClientRect(); return { x: e.left + e.width / 2, y: e.top + e.height / 2 }; });
      await touch([[b.x, b.y]]);
    }
    assert.equal(await page.evaluate(() => document.getElementById('cardCounter').textContent), '4 / 40', '3 cards marked');
    assert.equal(await wrongLis(), 20, 'hidden 누적 오답 list not rebuilt on every card tap');
    const st = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
    assert.equal(Object.keys(st.wrong).length, 23, 'marks saved immediately'); assert.equal(Object.keys(st.known).length, 20, 'known untouched');
    await page.evaluate(() => document.querySelector('.nav button[data-tab="wrong"]').click());
    assert.equal(await wrongLis(), 23, 'opening 오답 tab shows fresh list');
    assert.equal(await page.evaluate(() => document.getElementById('knownCount').textContent), '20');
    // actions inside the open wrong panel update the list immediately
    await page.evaluate(() => document.querySelector('#wrongList li [data-act="mem"]').click());
    assert.equal(await wrongLis(), 22, '외움 in list re-renders immediately');
    assert.equal(await page.evaluate(() => document.getElementById('knownCount').textContent), '21');
    // back to cards (nav), mark one more, then open via home → 누적 오답 button
    await page.evaluate(() => document.querySelector('.nav button[data-tab="card"]').click());
    await sleep(400);
    await page.evaluate(() => document.getElementById('btnKnow').click());
    await page.evaluate(() => document.querySelector('.nav button[data-tab="home"]').click());
    await page.evaluate(() => document.getElementById('btnCumulativeWrong').click());
    assert.equal(await page.evaluate(() => document.getElementById('knownCount').textContent), '22', 'list fresh via 누적 오답 button');
    // reload: everything persisted
    await page.reload({ waitUntil: 'networkidle0' });
    const st2 = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
    assert.equal(Object.keys(st2.known).length, 22); assert.equal(Object.keys(st2.wrong).length, 22);
    assert.deepEqual(errors, []);
    console.log('PASS: card flips on tap only (drag/scroll, pinch, 🔊 do not flip; small wobble ok); hidden 오답/외움 lists not rebuilt per card tap, fresh when opened, immediate inside the wrong panel; marks persisted');
  } finally { await browser.close(); srv.close(); }
})().catch(e => { console.error(e); process.exit(1); });
