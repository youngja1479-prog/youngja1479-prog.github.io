// 그림(이미지)을 '클릭/탭만' 했을 때 확대·축소가 튀지 않는지, 그리고 일부러 벌린 핀치만
// 확대/축소로 동작하는지 확인한다 (headless Chrome, 실제 CDP 터치 이벤트).
// 증상: 기기를 쥔 손·손바닥·두 손가락 탭처럼 두 접촉이 우연히 잡히면 시작 간격이 좁아
//       ratio = dist/dist0 이 폭발해, 그림을 한 번 건드리기만 해도 화면이 31%~187%로 튀었다.
// 실행: PT_MODULES=<puppeteer-core 있는 곳> CHROME=<chrome 실행 파일> node study/outline/tests/image-zoom-stability-browser.cjs
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const M = process.env.PT_MODULES || ['/workspace/test-tools/node_modules', '/tmp/pt/node_modules'].find(p => fs.existsSync(p)) || '/tmp/pt/node_modules';
let puppeteer; try { puppeteer = require(M + '/puppeteer-core'); } catch (e) { console.log('SKIP: puppeteer-core not installed'); process.exit(0); }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
if (!fs.existsSync(CHROME)) { console.log('SKIP: no Chrome'); process.exit(0); }
const ROOT = process.argv[2] || path.join(__dirname, '../../..');

// 1x1 PNG (data URL) — 노트 안의 그림 한 장
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'imgzoom-'));
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(ROOT, u); if (u.endsWith('/')) f = path.join(f, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/study/outline/`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'p'), args: ['--no-sandbox', '--no-first-run'] });
  let pass = 0;
  const ok = (msg) => { pass++; console.log('  ok ' + msg); };
  try {
    for (const vp of [{ w: 800, h: 1100, touch: true, tag: 'tablet' }, { w: 390, h: 800, touch: true, tag: 'phone' }, { w: 1280, h: 800, touch: false, tag: 'desktop' }]) {
      console.log(`[${vp.tag} ${vp.w}x${vp.h}]`);
      const page = await browser.newPage();
      await page.setViewport({ width: vp.w, height: vp.h, hasTouch: vp.touch, isMobile: vp.touch, deviceScaleFactor: 2 });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      await page.goto(base, { waitUntil: 'networkidle0' });
      await page.evaluate((IMG) => {
        __gkcSync.setData({ version: 1, updatedAt: Date.now(), notebooks: [{ id: 'nb1', title: 'T', mokchas: [{ id: 'm1', title: 'M', sebus: [{ id: 's1', title: 'S', pageHeight: 1600, pages: [{ strokes: [], texts: [], images: [{ id: 'img1', x: 120, y: 140, w: 400, h: 260, src: IMG }] }] }] }] }] });
        __gkcNav.goMokcha('nb1'); __gkcNav.goSebu('m1'); __gkcNav.goDraw('s1');
      }, IMG);
      await sleep(500);
      const zoom = () => page.evaluate(() => __gkcZoom.get());
      const label = () => page.$eval('#btn-zoom-reset', b => b.textContent);
      const imgBox = () => page.evaluate(() => { const e = document.querySelector('#img-layer .img-item'); const r = e.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; });
      const anchor = () => page.evaluate(() => { const r = document.querySelector('#img-layer .img-item').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      // 화면 안에 보이는 지점(그림 중앙이 화면 밖이면 wrap 안쪽으로 당감) — 핀치 좌표가 뷰포트를 벗어나면 CDP가 이벤트를 버린다
      const visiblePoint = () => page.evaluate(() => {
        const w = document.querySelector('#canvas-wrap').getBoundingClientRect();
        const r = document.querySelector('#img-layer .img-item').getBoundingClientRect();
        const cl = (v, a, b) => Math.max(a, Math.min(b, v));
        // 가로는 화면 중앙(핀치를 양쪽으로 벌릴 여유), 세로는 그림 중앙
        return { x: (w.left + w.right) / 2, y: cl(r.top + r.height / 2, w.top + 12, w.bottom - 12), left: w.left, right: w.right };
      });
      const cdp = await page.target().createCDPSession();
      const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
      const z0 = await zoom(), box0 = await imgBox(), label0 = await label();
      assert.ok(Math.abs(z0 - parseFloat(label0) / 100) < 0.01, 'zoom label matches internal zoom');

      // 1) 그림을 여러 번 클릭/탭 — 확대·축소가 전혀 일어나지 않아야 한다
      const a = await anchor();
      if (vp.touch) {
        for (let i = 0; i < 5; i++) { await page.touchscreen.tap(a.x, a.y); await sleep(120); }
        ok('touch: 그림 5회 탭 → 확대/축소 없음');
      } else {
        for (let i = 0; i < 5; i++) { await page.mouse.click(a.x, a.y); await sleep(120); }
        ok('mouse: 그림 5회 클릭 → 확대/축소 없음');
      }
      assert.equal(await zoom(), z0, '그림 클릭/탭은 배율을 바꾸지 않는다');
      assert.deepEqual(await imgBox(), box0, '그림 위치·크기가 클릭으로 변하지 않는다');
      assert.equal(await label(), label0, '배율 표시가 그대로');

      if (!vp.touch) { await page.close(); continue; }

      // 2) 기기를 쥔 손가락(8px 옆)이 같이 닿은 채 그림을 한 번 누름 — 우연한 두 접촉
      await page.evaluate(() => __gkcZoom.set(0.8, { force: true })); await sleep(80);
      const b = await anchor();
      await touch('touchStart', [{ x: b.x, y: b.y }]);
      await touch('touchStart', [{ x: b.x, y: b.y }, { x: b.x + 8, y: b.y + 2 }]);
      for (const d of [1, 3, 2, 5]) { await touch('touchMove', [{ x: b.x - d, y: b.y }, { x: b.x + 8 + d, y: b.y + 2 }]); await sleep(30); }
      await touch('touchEnd', []);
      await sleep(120);
      assert.equal(await zoom(), 0.8, '8px 우연 접촉으로는 확대/축소되지 않는다');
      ok('가까운 두 접촉(8px) → 배율 그대로 80%');

      // 3) 손바닥 + 손가락 (40px 떨어진 두 접촉이 데드존 안에서 흔들림)
      await page.evaluate(() => __gkcZoom.set(0.8, { force: true })); await sleep(80);
      await touch('touchStart', [{ x: b.x, y: b.y }]);
      await touch('touchStart', [{ x: b.x, y: b.y }, { x: b.x + 40, y: b.y }]);
      for (const d of [2, 4, 3, 5]) { await touch('touchMove', [{ x: b.x, y: b.y }, { x: b.x + 40 + d, y: b.y }]); await sleep(30); }
      await touch('touchEnd', []);
      await sleep(120);
      assert.equal(await zoom(), 0.8, '데드존(12px) 안의 미세 흔들림은 확대/축소하지 않는다');
      ok('40px 두 접촉의 미세 흔들림(≤5px) → 배율 그대로 80%');

      // 4) 손바닥 접촉면(반지름 60px)은 핀치에서 무시
      await page.evaluate(() => __gkcZoom.set(0.8, { force: true })); await sleep(80);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y, id: 1, radiusX: 60, radiusY: 60 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y, id: 1, radiusX: 60, radiusY: 60 }, { x: b.x + 200, y: b.y, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x, y: b.y, id: 1, radiusX: 60, radiusY: 60 }, { x: b.x + 300, y: b.y, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(120);
      assert.equal(await zoom(), 0.8, '손바닥(큰 접촉면)이 섞인 두 접촉은 확대/축소하지 않는다');
      ok('손바닥 + 손가락 → 배율 그대로 80%');

      // 5) 일부러 벌린 핀치: 한 방향으로만, 튀지 않고 이어서 커진다
      await page.evaluate(() => __gkcZoom.set(0.8, { force: true })); await sleep(80);
      const zBefore = await zoom();
      await touch('touchStart', [{ x: b.x - 30, y: b.y }]);
      await touch('touchStart', [{ x: b.x - 30, y: b.y }, { x: b.x + 30, y: b.y }]);
      const seen = [];
      for (let s = 2; s <= 60; s += 2) {
        await touch('touchMove', [{ x: b.x - 30 - s / 2, y: b.y }, { x: b.x + 30 + s / 2, y: b.y }]);
        seen.push(await zoom());
      }
      await touch('touchEnd', []);
      await sleep(150);
      const zAfter = await zoom();
      assert.ok(zAfter > zBefore + 0.2, '일부러 벌린 핀치는 확대된다 (80% → ' + Math.round(zAfter * 100) + '%)');
      for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1] - 1e-9, '핀치 중 배율이 뒤로 튀지 않는다');
      const maxStep = seen.reduce((m, z, i) => i ? Math.max(m, z / seen[i - 1]) : m, 1);
      assert.ok(maxStep < 1.35, '한 이벤트에서 배율이 급점프하지 않는다 (max ×' + maxStep.toFixed(2) + ')');
      ok('벌린 핀치: 80% → ' + Math.round(zAfter * 100) + '%, 단조 증가, 이벤트당 최대 ×' + maxStep.toFixed(2));

      // 6) 핀치 후 그림은 배율에 정확히 비례한다 (배율과 그림 크기가 어긋나지 않음)
      const boxAfter = await imgBox();
      const ratio = boxAfter.w / box0.w;
      assert.ok(Math.abs(ratio - zAfter / z0) < 0.02, '그림 크기가 배율을 따라간다 (' + ratio.toFixed(3) + ' vs ' + (zAfter / z0).toFixed(3) + ')');
      ok('그림 크기 비율 ' + ratio.toFixed(3) + ' = 배율 비율 ' + (zAfter / z0).toFixed(3));

      // 7) 핀치를 최대로 벌려도 상한(300%)에서 멈추고 NaN/역전이 없다
      await page.evaluate(() => __gkcZoom.set(2.5, { force: true })); await sleep(120);
      const c = await visiblePoint();
      const lim = Math.max(24, Math.min(c.x - c.left, c.right - c.x) - 6);
      await touch('touchStart', [{ x: c.x - 20, y: c.y }]);
      await touch('touchStart', [{ x: c.x - 20, y: c.y }, { x: c.x + 20, y: c.y }]);
      let s = 20;
      while (s < lim) { s = Math.min(lim, Math.round(s * 1.25)); await touch('touchMove', [{ x: c.x - s, y: c.y }, { x: c.x + s, y: c.y }]); }
      for (let k = 0; k < 4; k++) await touch('touchMove', [{ x: c.x - lim, y: c.y }, { x: c.x + lim, y: c.y }]);
      await touch('touchEnd', []);
      await sleep(100);
      assert.equal(await zoom(), 3, '확대 상한 300%에서 멈춘다');
      ok('확대 상한 300% 클램프');

      // 8) 축소도 하한(30%)에서 멈춘다
      await sleep(120);
      const d2 = await visiblePoint();
      const lim2 = Math.max(24, Math.min(d2.x - d2.left, d2.right - d2.x) - 6);
      let s2 = Math.min(lim2, 100);
      await touch('touchStart', [{ x: d2.x - s2, y: d2.y }]);
      await touch('touchStart', [{ x: d2.x - s2, y: d2.y }, { x: d2.x + s2, y: d2.y }]);
      while (s2 > 6) { s2 = Math.max(6, Math.round(s2 / 1.25)); await touch('touchMove', [{ x: d2.x - s2, y: d2.y }, { x: d2.x + s2, y: d2.y }]); }
      for (let k = 0; k < 4; k++) await touch('touchMove', [{ x: d2.x - 6, y: d2.y }, { x: d2.x + 6, y: d2.y }]);
      await touch('touchEnd', []);
      await sleep(100);
      assert.equal(await zoom(), 0.3, '축소 하한 30%에서 멈춘다');
      ok('축소 하한 30% 클램프');

      // 9) 확대된 상태에서 그림 클릭/탭 → 배율·그림 크기 그대로
      const zNow = await zoom(), bNow = await imgBox();
      const d = await anchor();
      for (let i = 0; i < 3; i++) { await page.touchscreen.tap(d.x, d.y); await sleep(120); }
      assert.equal(await zoom(), zNow, '확대 상태에서도 그림 탭은 배율을 바꾸지 않는다');
      assert.deepEqual(await imgBox(), bNow, '확대 상태에서도 그림 크기가 그대로');
      ok('확대 상태에서 그림 3회 탭 → 배율·그림 크기 그대로');

      assert.deepEqual(errors, [], '콘솔/페이지 에러 없음: ' + errors.join(' | '));
      ok('콘솔 에러 0건');
      await page.close();
    }
    console.log(`PASS: 그림 클릭/탭 확대·축소 없음, 우연한 두 접촉·손바닥 무시, 일부러 벌린 핀치만 단조 확대/축소 (${pass} checks)`);
  } finally { await browser.close(); srv.close(); }
})().catch(e => { console.error(e); process.exit(1); });
