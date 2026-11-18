// 텍스트 상자 ✕: 글자가 있는 상자는 "이 텍스트를 지울까요?" 확인 후에만 지움(취소하면 그대로). 텍스트 삭제는 실행취소가
// 안 되므로 손가락이 ✕에 잘못 닿아도 글이 사라지지 않게 함. 빈 상자는 지금처럼 바로 지움. 데이터 형식 변화 없음.
// Synthetic notebook in a throwaway profile, phone viewport, real CDP touch taps. Needs Chrome + puppeteer-core.
// Run: node study/outline/tests/textbox-delete-confirm-browser.cjs [rootDir]
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const M = process.env.PT_MODULES || ['/workspace/test-tools/node_modules', '/tmp/pt/node_modules'].find(p => fs.existsSync(p)) || '/tmp/pt/node_modules';
let puppeteer; try { puppeteer = require(M + '/puppeteer-core'); } catch (e) { console.log('SKIP: puppeteer-core not installed'); process.exit(0); }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
if (!fs.existsSync(CHROME)) { console.log('SKIP: no Chrome'); process.exit(0); }
const ROOT = process.argv[2] || path.join(__dirname, '../../..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NB = () => ({ version: 1, updatedAt: Date.now(), notebooks: [{ id: 'nb1', title: 'T', mokchas: [{ id: 'm1', title: 'M', sebus: [
  { id: 's1', title: 'A', pageHeight: 3000, pages: [{ strokes: [], texts: [
    { id: 't1', x: 40, y: 80, w: 220, h: 60, text: '중요한 필기 내용' },
    { id: 't2', x: 40, y: 300, w: 220, h: 60, text: '' }] }] }] }] }] });
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tbdel-'));
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
    await page.setViewport({ width: 390, height: 800, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const dialogs = []; let answer = false;
    page.on('dialog', d => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss(); });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.evaluate(d => { __gkcSync.setData(d); __gkcNav.goMokcha('nb1'); __gkcNav.goSebu('m1'); __gkcNav.goDraw('s1'); }, NB());
    await page.evaluate(() => document.getElementById('btn-mode-kb').click()); await sleep(200);
    const cdp = await page.target().createCDPSession();
    const tapDel = async id => {
      const r = await page.evaluate(id => { const b = document.querySelector(`.text-box[data-id="${id}"] .tb-del`); b.scrollIntoView({ block: 'center' }); const q = b.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2, w: q.width }; }, id);
      assert(r.w > 0, 'delete button visible');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y }] }); await sleep(40);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300);
    };
    const ids = () => page.evaluate(() => [...document.querySelectorAll('#text-layer .text-box')].map(b => b.dataset.id).join(','));
    const dataTexts = () => page.evaluate(() => JSON.stringify(__gkcSync.getData().notebooks[0].mokchas[0].sebus[0].pages.flatMap(p => p.texts || []).map(t => t.id + ':' + t.text)));
    assert.equal(await ids(), 't1,t2');
    // 1) mis-tap ✕ on a box with text → confirm shown, cancel keeps it (screen + data)
    await tapDel('t1');
    assert.deepEqual(dialogs, ['이 텍스트를 지울까요?'], 'confirm shown for text box with content');
    assert.equal(await ids(), 't1,t2', 'cancel keeps the text box');
    assert(String(await dataTexts()).includes('t1:중요한 필기 내용'), 'text kept in data');
    // 2) empty box → deleted right away, no dialog
    await tapDel('t2');
    assert.equal(dialogs.length, 1, 'no confirm for an empty box'); assert.equal(await ids(), 't1', 'empty box deleted');
    // 3) confirm → deleted
    answer = true; await tapDel('t1');
    assert.equal(dialogs.length, 2); assert.equal(await ids(), '', 'confirmed delete removes the box');
    assert(!String(await dataTexts()).includes('t1:'), 'removed from data');
    assert.deepEqual(errors, [], 'no page errors: ' + errors.join('; '));
    console.log('PASS: text box ✕ asks before deleting typed text (cancel keeps it), empty box deletes immediately, confirm deletes');
  } finally { await browser.close(); srv.close(); }
})().catch(e => { console.error(e); process.exit(1); });
