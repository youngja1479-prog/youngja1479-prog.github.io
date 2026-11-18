// 기기 연결 in headless Chrome: two phones/tablets (separate browsers = separate storage), the real
// sync Worker in Miniflare behind request interception, QR shown on the connected device, scanned
// by the new device's (fake) camera, typed-code path, camera-app link (#link=CODE), touch only.
// Needs Chrome, puppeteer-core, miniflare, @napi-rs/canvas and ffmpeg (PT_MODULES or /workspace/test-tools/node_modules).
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http'), vm = require('node:vm'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const M = process.env.PT_MODULES || ['/workspace/test-tools/node_modules', '/tmp/pt/node_modules'].find(p => fs.existsSync(p)) || '/tmp/pt/node_modules';
let puppeteer, Miniflare, NC;
try { puppeteer = require(M + '/puppeteer-core'); ({ Miniflare } = require(process.env.MINIFLARE_PATH || M + '/miniflare')); NC = require(M + '/@napi-rs/canvas'); }
catch (e) { console.log('SKIP: puppeteer-core / miniflare / @napi-rs/canvas not installed'); process.exit(0); }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
if (!fs.existsSync(CHROME)) { console.log('SKIP: no Chrome'); process.exit(0); }
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch (_) { console.log('SKIP: no ffmpeg'); process.exit(0); }
const ROOT = path.join(__dirname, '../../..');
const SYNC = 'https://gkc-notes-sync.youngja1479.workers.dev';
const PW = 'throwaway-link-test-' + Math.random().toString(36).slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jctx = { module: { exports: {} } }; jctx.exports = jctx.module.exports; vm.createContext(jctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/qr/jsQR.js'), 'utf8'), jctx);
const jsQR = jctx.module.exports;
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'link-'));
  const mf = new Miniflare({ modules: true, script: fs.readFileSync(path.join(__dirname, '../sync-worker/worker.js'), 'utf8'), kvNamespaces: ['NOTES'], durableObjects: { LINK: 'LinkRoom' }, compatibilityDate: '2024-11-01' });
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(ROOT, u); if (u.endsWith('/')) f = path.join(f, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/study/outline/`;
  const browsers = [];
  const launch = async (name, extra = []) => {
    const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, name), args: ['--no-sandbox', '--no-first-run', '--use-fake-ui-for-media-stream', ...extra] });
    browsers.push(b); return b;
  };
  const errors = [];
  const preparePage = async (page, ip) => {
    await page.setViewport({ width: 820, height: 1100, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      if (!req.url().startsWith(SYNC)) { req.continue(); return; }
      const u = new URL(req.url());
      const r = await mf.dispatchFetch('http://sync' + u.pathname + u.search, { method: req.method(), headers: { ...req.headers(), 'CF-Connecting-IP': ip }, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method()) ? undefined : (req.postData() || undefined) });
      const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
      headers['access-control-allow-origin'] = new URL(base).origin;   // local test origin instead of github.io
      req.respond({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
    });
  };
  const toasts = page => page.evaluate(() => Array.from(document.querySelectorAll('.toast')).map(t => t.textContent).join(' | '));
  try {
    // ---- device A (tablet): already connected with a test vault ----
    const bA = await launch('A'); const A = await bA.newPage(); await preparePage(A, '198.51.100.30');
    await A.goto(base, { waitUntil: 'networkidle0' });
    await A.evaluate(async (PW) => {
      __gkcSync.setData({ version: 1, updatedAt: Date.now(), notebooks: [{ id: 'nb1', title: '국어', type: 'thought', mokchas: [{ id: 'm1', title: '목차', sebus: [{ id: 's1', title: '세부', pageHeight: 1200,
        pages: [{ strokes: [{ id: 'a1', tool: 'pen', color: '#111', width: 1.5, points: [{ x: 10, y: 10 }, { x: 90, y: 40 }] }], texts: [], notes: [{ id: 'n1', x: 50, y: 50, w: 200, h: 150, c: '#fff59d', t: '연결 테스트', f: false, u: 1 }] }] }] }] }] });
      return __gkcSync.connectWithPassword(PW);
    }, PW);
    await A.waitForFunction(() => !__gkcSync.getSyncState().syncBusy && !__gkcSync.getSyncState().syncPendingPush, { timeout: 15000 });
    // sync window: password UI unchanged + new 다른 기기 연결 section
    await A.tap('#btn-sync'); await A.waitForSelector('#m-link-show');
    assert.ok(await A.$('#sync-pw') && await A.$('#m-connect') && await A.$('#m-disconnect'), 'password controls still there');
    const sb = await A.$eval('#m-link-show', b => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height }; });
    assert.ok(sb.h >= 44, 'touch-size button');
    await A.tap('#m-link-show');
    await A.waitForFunction(() => /^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/.test((document.getElementById('link-code-show') || {}).textContent || ''), { timeout: 15000 });
    const shown = await A.$eval('#link-code-show', e => e.textContent);
    await A.waitForFunction(() => /남은 시간 (9|10):/.test(document.getElementById('link-meta').textContent), { timeout: 5000 });
    // QR on screen → decode the canvas pixels like a camera would
    const qrPng = Buffer.from((await A.$eval('#link-qr', c => c.toDataURL('image/png'))).split(',')[1], 'base64');
    const img = await NC.loadImage(qrPng), c0 = NC.createCanvas(img.width, img.height), g0 = c0.getContext('2d'); g0.drawImage(img, 0, 0);
    const dec = jsQR(g0.getImageData(0, 0, img.width, img.height).data, img.width, img.height);
    assert.ok(dec, 'QR readable'); assert.match(dec.data, /#link=[2-9A-HJ-NP-Z]{10}$/);
    assert.equal(dec.data.slice(-10), shown.replace('-', ''), 'QR = shown code');
    // ---- device B (phone): empty, scans the QR with its camera (fake camera plays the QR) ----
    const frame = NC.createCanvas(640, 480), gf = frame.getContext('2d'); gf.fillStyle = '#fff'; gf.fillRect(0, 0, 640, 480);
    gf.imageSmoothingEnabled = false; gf.drawImage(img, 140, 60, 360, 360);
    fs.writeFileSync(path.join(tmp, 'qr.png'), frame.toBuffer('image/png'));
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-loop', '1', '-i', path.join(tmp, 'qr.png'), '-t', '2', '-r', '10', '-pix_fmt', 'yuv420p', path.join(tmp, 'qr.y4m')]);
    const bB = await launch('B', ['--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + path.join(tmp, 'qr.y4m')]);
    const B = await bB.newPage(); await preparePage(B, '198.51.100.31');
    await B.evaluateOnNewDocument(() => { try { delete window.BarcodeDetector; } catch (_) {} window.BarcodeDetector = undefined; });   // like iOS Safari → jsQR path
    await B.goto(base, { waitUntil: 'networkidle0' });
    assert.equal(await B.evaluate(() => __gkcSync.getSyncPassword()), null);
    await B.tap('#btn-sync'); await B.waitForSelector('#m-link-scan');
    assert.ok(await B.$('#sync-pw') && await B.$('#link-code'), 'password field + code field');
    await B.tap('#m-link-scan');
    await B.waitForFunction(() => !!__gkcSync.getSyncPassword(), { timeout: 30000 });
    assert.equal(await B.evaluate(() => __gkcSync.getSyncPassword()), PW, 'phone joined the same vault by QR');
    await B.waitForFunction(() => { const s = __gkcSync.getData().notebooks[0]; return s && s.mokchas[0].sebus[0].pages[0].strokes.length === 1; }, { timeout: 15000 });
    const bData = await B.evaluate(() => __gkcSync.getData().notebooks[0].mokchas[0].sebus[0].pages[0]);
    assert.equal(bData.strokes[0].id, 'a1'); assert.equal(bData.notes[0].t, '연결 테스트');
    assert.equal(await B.evaluate(() => !!document.getElementById('link-video')), false, 'camera window closed');
    assert.equal(await B.evaluate(() => typeof window.jsQR), 'function', 'decoded with the jsQR fallback');
    assert.match(await toasts(B), /연결됐어요/);
    // A notices it was used
    await A.waitForFunction(() => /연결됐어요/.test(document.getElementById('link-meta').textContent), { timeout: 10000 });
    // the same QR/code again → refused
    const pageC = await (await bB.createBrowserContext()).newPage(); await preparePage(pageC, '198.51.100.32');
    await pageC.goto(base + '#link=' + shown.replace('-', ''), { waitUntil: 'networkidle0' });
    await pageC.waitForSelector('#link-code');
    assert.equal(await pageC.$eval('#link-code', i => i.value), shown, 'camera-app link fills the code');
    assert.equal(await pageC.evaluate(() => location.hash), '', 'code removed from the address bar');
    await pageC.tap('#m-link-claim'); await sleep(1500);
    assert.equal(await pageC.evaluate(() => __gkcSync.getSyncPassword()), null);
    assert.match(await toasts(pageC), /이미 사용한/);
    // ---- typed code path on a third device: new code on A, type it with the on-screen keyboard ----
    await A.tap('#m-link-new');
    await A.waitForFunction(old => { const t = document.getElementById('link-code-show').textContent; return /^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/.test(t) && t !== old; }, { timeout: 15000 }, shown);
    const code2 = await A.$eval('#link-code-show', e => e.textContent);
    // wrong code first
    await pageC.tap('#link-code'); await pageC.$eval('#link-code', i => { i.value = ''; });
    await pageC.keyboard.type('23456-23456'); await pageC.tap('#m-link-claim'); await sleep(1500);
    assert.equal(await pageC.evaluate(() => __gkcSync.getSyncPassword()), null); assert.match(await toasts(pageC), /맞지 않거나/);
    await pageC.$eval('#link-code', i => { i.value = ''; }); await pageC.tap('#link-code');
    await pageC.keyboard.type(code2.replace('-', '').toLowerCase());
    assert.equal(await pageC.$eval('#link-code', i => i.value), code2, 'auto-formats XXXXX-XXXXX');
    await pageC.tap('#m-link-claim');
    await pageC.waitForFunction(() => !!__gkcSync.getSyncPassword(), { timeout: 20000 });
    assert.equal(await pageC.evaluate(() => __gkcSync.getSyncPassword()), PW);
    // ---- two-device sync after linking: B writes → A gets it ----
    await B.evaluate(() => { const p = __gkcSync.getData().notebooks[0].mokchas[0].sebus[0].pages[0]; p.strokes.push({ id: 'b1', tool: 'pen', color: '#2563eb', width: 1.5, points: [{ x: 5, y: 5 }, { x: 60, y: 60 }] }); __gkcSync.getData().updatedAt = Date.now(); return __gkcSync.syncPushNow(); });
    await B.waitForFunction(() => !__gkcSync.getSyncState().syncBusy && !__gkcSync.getSyncState().syncPendingPush, { timeout: 15000 });
    await A.evaluate(() => __gkcSync.syncPullAndMaybeApply({}));
    await A.waitForFunction(() => __gkcSync.getData().notebooks[0].mokchas[0].sebus[0].pages[0].strokes.some(s => s.id === 'b1'), { timeout: 15000 });
    // closing the window on A cancels a waiting code
    await A.tap('#m-link-new');
    await A.waitForFunction(old => { const t = document.getElementById('link-code-show').textContent; return /^[2-9A-HJ-NP-Z]{5}-/.test(t) && t !== old; }, { timeout: 15000 }, code2);
    const code3 = await A.$eval('#link-code-show', e => e.textContent);
    await A.tap('#m-link-close'); await sleep(500);
    const pageD = await (await bB.createBrowserContext()).newPage(); await preparePage(pageD, '198.51.100.33');
    await pageD.goto(base + '#link=' + code3.replace('-', ''), { waitUntil: 'networkidle0' });
    await pageD.waitForSelector('#m-link-claim'); await pageD.tap('#m-link-claim'); await sleep(1500);
    assert.equal(await pageD.evaluate(() => __gkcSync.getSyncPassword()), null, 'closed code is cancelled');
    assert.deepEqual(errors, [], errors.join('; '));
    console.log('PASS: 기기 연결 (browser) — QR+code on the connected device, fake-camera QR scan links the new phone (notes arrive, no password typed), A sees "연결됐어요", reused code refused, #link= camera-app link fills the code, typed code with auto-format, wrong code refused, sync both ways after linking, closing cancels the code');
  } finally { for (const b of browsers) await b.close(); srv.close(); await mf.dispose(); fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
