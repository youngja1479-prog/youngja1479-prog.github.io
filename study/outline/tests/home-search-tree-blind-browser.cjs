// 홈 통합 빠른 검색(#home-search, Ctrl/⌘+K, /, Esc) + 목차 한눈에 보기 암기 가리기(#btn-tree-blind).
// 샘플 과목·수준·노트·목차·세부목차를 넣고 실제 입력·클릭·탭으로 확인한다. 노트 데이터(DATA)는 검색으로
// 바뀌지 않는지, 저장 키/스키마를 건드리지 않는지 함께 본다. Needs Chrome + puppeteer-core.
// Run: node study/outline/tests/home-search-tree-blind-browser.cjs [rootDir]
// Screenshots (optional): SHOT_DIR=/path node study/outline/tests/home-search-tree-blind-browser.cjs
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const M = process.env.PT_MODULES || ['/workspace/test-tools/node_modules', '/tmp/pt/node_modules'].find(p => fs.existsSync(p)) || '/tmp/pt/node_modules';
let puppeteer; try { puppeteer = require(M + '/puppeteer-core'); } catch (e) { console.log('SKIP: puppeteer-core not installed'); process.exit(0); }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
if (!fs.existsSync(CHROME)) { console.log('SKIP: no Chrome'); process.exit(0); }
const ROOT = process.argv[2] || path.join(__dirname, '../../..');
const SHOT_DIR = process.env.SHOT_DIR || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const NB = () => ({
  version: 1, updatedAt: 1700000000000,
  subjects: [
    { id: 'su1', title: '수학', u: 0, levels: [{ id: 'lv1', title: '기본', u: 0 }, { id: 'lv2', title: '심화', u: 0 }] },
    { id: 'su2', title: '영어', u: 0, levels: [{ id: 'lv3', title: '독해', u: 0 }] }
  ],
  notebooks: [
    { id: 'nb1', title: '함수 노트', type: 'concept', sl: { s: 'su1', l: 'lv1', st: '수학', lt: '기본', at: 1 },
      mokchas: [{ id: 'm1', title: '함수의 정의', sebus: [
        { id: 'sb1', title: '정의역과 치역', pages: [{ strokes: [], texts: [] }] },
        { id: 'sb2', title: '함수의 그래프', pages: [{ strokes: [], texts: [] }] }] }] },
    { id: 'nb2', title: 'Function Basics', type: 'concept', sl: { s: 'su2', l: 'lv3', st: '영어', lt: '독해', at: 2 },
      mokchas: [{ id: 'm2', title: 'Reading Skills', sebus: [{ id: 'sb3', title: 'Main Idea', pages: [{ strokes: [], texts: [] }] }] }] },
    { id: 'nb3', title: '미분', type: 'thought', sl: { s: 'su1', l: 'lv2', st: '수학', lt: '심화', at: 3 },
      mokchas: [{ id: 'm3', title: '도함수', sebus: [{ id: 'sb4', title: '정의역과 치역', pages: [{ strokes: [], texts: [] }] }] }] }
  ]
});

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hsblind-'));
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (u === '/favicon.ico') { res.writeHead(204); res.end(); return; } // 브라우저 기본 요청(테스트 서버에는 없음)
    let f = path.join(ROOT, u); if (u.endsWith('/')) f = path.join(f, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/study/outline/`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'p'), args: ['--no-sandbox', '--no-first-run'] });
  if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });
  try {
    for (const vp of [{ width: 1280, height: 800, mobile: false }, { width: 390, height: 844, mobile: true }]) {
      const tag = vp.mobile ? 'mobile' : 'desktop';
      const page = await browser.newPage();
      await page.setViewport({ width: vp.width, height: vp.height, hasTouch: vp.mobile, isMobile: vp.mobile, deviceScaleFactor: 1 });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      await page.goto(base, { waitUntil: 'networkidle0' });
      await page.evaluate(d => { __gkcSync.setData(d); __gkcNav.goHome(); }, NB());

      const q = (sel, prop = 'textContent') => page.evaluate((s, p) => { const e = document.querySelector(s); return e ? (p === 'text' ? e.textContent : e[p]) : null; }, sel, prop);
      const visible = (sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0 && r.height > 0; }, sel);
      const rows = () => page.evaluate(() => [...document.querySelectorAll('.hs-row')].map(r => ({
        kind: r.querySelector('.hs-kind').textContent,
        title: r.querySelector('.hs-title').textContent,
        path: r.querySelector('.hs-path') ? r.querySelector('.hs-path').textContent : '',
        mark: r.querySelector('mark') ? r.querySelector('mark').textContent : ''
      })));
      const typeQuery = async (t) => {
        await page.click('#home-search', { clickCount: 3 });
        await page.evaluate(() => { document.getElementById('home-search').value = ''; });
        await page.type('#home-search', t);
        await sleep(160); // 40ms debounce + render
      };
      const search = async (t) => { await typeQuery(t); return rows(); };
      const homeReset = () => page.evaluate(() => __gkcNav.goHome());

      // 1) 홈 기본 상태: 검색창이 마스트헤드와 과목 목록 사이에 있고, 검색어가 없으면 기존 목록 그대로
      assert.ok(await visible('#home-search'), 'home search box visible');
      assert.ok(!(await visible('#home-search-clear')), 'clear button hidden with empty query');
      if (vp.mobile) assert.ok(await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('home-search')).fontSize) >= 16), 'touch: input stays 16px (no iOS zoom on focus)');
      assert.ok(await visible('#subj-list'), '과목 목록 visible with empty query');
      assert.ok(!(await visible('#home-search-results')), '결과 목록 hidden with empty query');
      const order = await page.evaluate(() => {
        const mh = document.querySelector('#view-home .masthead'), hs = document.querySelector('#home-search-box'), sh = document.querySelector('#view-home .section-head');
        return mh.getBoundingClientRect().bottom <= hs.getBoundingClientRect().top + 1 && hs.getBoundingClientRect().bottom <= sh.getBoundingClientRect().top + 1;
      });
      assert.ok(order, '검색창이 마스트헤드와 과목 section-head 사이에 위치');

      // 실제 포인터로 결과 행을 누른다 (모바일 뷰포트는 탭)
      const clickRow = async (pred) => {
        const handle = await page.evaluateHandle((src) => {
          const fn = new Function('r', 'return (' + src + ')(r)');
          return [...document.querySelectorAll('.hs-row')].find(fn) || null;
        }, pred.toString());
        const el = handle.asElement();
        assert.ok(el, 'clicked row exists: ' + pred.toString());
        if (vp.mobile) await el.tap(); else await el.click();
      };

      // 2) 부분 일치·대소문자 무시·경로 표시: 같은 이름의 세부목차가 서로 다른 과목/수준 아래에 있어도 각각 나온다
      let res = await search('치역');
      assert.equal(res.length, 2, `"치역" → 2 results (got ${res.length})`);
      assert.deepEqual(res.map(r => r.kind), ['세부목차', '세부목차']);
      assert.deepEqual(res.map(r => r.path), ['수학 › 기본 › 함수 노트 › 함수의 정의', '수학 › 심화 › 미분 › 도함수']);
      assert.deepEqual(res.map(r => r.title), ['정의역과 치역', '정의역과 치역']);
      assert.equal(res[0].mark, '치역', 'matched part highlighted');
      assert.ok(!(await visible('#subj-list')), '검색 중에는 과목 목록을 접는다');
      assert.ok(!(await visible('#view-home .section-head')), '검색 중에는 section-head 도 접는다');
      assert.ok(await visible('#home-search-results'), '결과 목록 visible');
      assert.equal(await q('#home-search-results .hs-summary', 'textContent'), '2개 결과', '결과 개수 표시');
      if (!vp.mobile) await page.screenshot({ path: path.join(SHOT_DIR || tmp, 'outline-search.png') });

      // 3) 세부목차 결과 클릭 → 해당 필기 페이지로 바로 이동 (state·crumb 정확)
      res = await search('치역');
      await clickRow(r => r.querySelector('.hs-path').textContent.includes('심화'));
      await sleep(120);
      let st = await page.evaluate(() => __gkcNav.getState());
      assert.equal(st.view, 'draw', 'sebu result → draw view');
      assert.deepEqual([st.nbId, st.mokId, st.sebuId, st.subjId, st.lvlId], ['nb3', 'm3', 'sb4', 'su1', 'lv2'], 'sebu result sets full state');
      assert.equal(await q('#draw-crumb', 'textContent'), '도함수 › 정의역과 치역', 'draw crumb');
      assert.ok(await visible('#view-draw'), 'draw view visible');
      // 돌아가기 경로도 자연스럽게 (검색 상태가 남지 않음)
      await page.click('#btn-back-draw'); await sleep(80);
      assert.equal(await q('#sebu-heading', 'textContent'), '도함수 — 세부목차', 'back from draw → 세부목차 list');
      await page.click('#btn-back-mok'); await sleep(80);
      assert.equal(await q('#mokcha-crumb', 'textContent'), '과목 › 수학 › 심화 › 미분', 'back → 목차 list with place');
      await page.click('#btn-back-home'); await sleep(80);
      assert.ok(await visible('#view-cats'), 'back → 노트 grid with subject/level');
      const catsCrumb = await q('#cats-crumb', 'textContent');
      assert.ok(catsCrumb.includes('수학') && catsCrumb.includes('심화'), `cats crumb (${catsCrumb})`);

      // 4) 홈으로 돌아오면 검색창은 비어 있고 기존 목록이 그대로
      await homeReset(); await sleep(80);
      assert.equal(await q('#home-search', 'value'), '', 'returning home leaves the box empty');
      assert.ok(await visible('#subj-list'), '과목 목록 back');
      assert.ok(!(await visible('#home-search-results')), '결과 목록 cleared');

      // 5) 과목 / 수준 / 노트 / 목차 결과도 각 뷰로 점프
      res = await search('수학');
      assert.deepEqual(res.map(r => r.kind)[0], '과목', '"수학" 첫 결과는 과목');
      await clickRow(r => r.querySelector('.hs-kind').textContent === '과목');
      await sleep(80);
      assert.equal(await q('#levels-heading', 'textContent'), '수학 — 수준', '과목 result → 수준 list');
      await homeReset();

      res = await search('심화');
      assert.deepEqual(res.map(r => r.kind), ['수준'], '"심화" → 수준 1개');
      assert.equal(res[0].path, '수학', '수준 path = 과목');
      await clickRow(() => true);
      await sleep(80);
      assert.ok(await visible('#view-cats'), '수준 result → 노트 grid');
      assert.ok((await q('#cats-crumb', 'textContent')).includes('심화'), 'cats crumb has level');
      await homeReset();

      res = await search('function'); // 대소문자 무시
      assert.deepEqual(res.map(r => r.kind), ['노트'], '"function" matches note (case-insensitive)');
      assert.equal(res[0].title, 'Function Basics');
      assert.equal(res[0].path, '영어 › 독해');
      await clickRow(() => true);
      await sleep(80);
      assert.ok(await visible('#view-mokcha'), '노트 result → 목차 list');
      assert.ok((await q('#mokcha-crumb', 'textContent')).includes('Function Basics'), 'mokcha crumb has note');
      await homeReset();

      res = await search('도함수');
      assert.deepEqual(res.map(r => r.kind), ['목차'], '"도함수" → 목차 1개');
      assert.equal(res[0].path, '수학 › 심화 › 미분');
      await clickRow(() => true);
      await sleep(80);
      assert.equal(await q('#sebu-heading', 'textContent'), '도함수 — 세부목차', '목차 result → 세부목차 list');
      await homeReset();

      // 6) 일치 없음 / 지우기 버튼 / Esc / 키보드 단축키
      res = await search('zzz없는항목');
      assert.equal(res.length, 0, 'no results');
      assert.ok((await q('#home-search-results .hs-empty', 'textContent') || '').includes('없어요'), 'empty message');
      await page.click('#home-search-clear'); await sleep(80);
      assert.equal(await q('#home-search', 'value'), '', 'clear button empties the box');
      assert.ok(await visible('#subj-list'), 'clear button restores the subject list');

      await typeQuery('치역');
      assert.equal(await page.evaluate(() => document.getElementById('home-search-clear').hidden), false, 'clear button shown while typing');
      assert.ok(await visible('#home-search-clear'), 'clear button actually visible while typing');
      await page.keyboard.press('Escape'); await sleep(80);
      assert.equal(await q('#home-search', 'value'), '', 'Esc clears the query');
      assert.ok(await visible('#subj-list'), 'Esc restores the subject list');
      assert.equal(await page.evaluate(() => document.getElementById('home-search-clear').hidden), true, 'clear button hidden again');
      assert.ok(!(await visible('#home-search-clear')), 'clear button not painted when empty');

      // Esc also clears when the box is not focused
      await typeQuery('도함수');
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.press('Escape'); await sleep(80);
      assert.equal(await q('#home-search', 'value'), '', 'Esc (unfocused) clears too');

      // Ctrl+K / ⌘K focus, / focus
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
      await sleep(60);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'home-search', 'Ctrl+K focuses the search box');
      await page.keyboard.down('Meta'); await page.keyboard.press('KeyK'); await page.keyboard.up('Meta');
      await sleep(60);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'home-search', 'Cmd+K focuses the search box');
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.press('/'); await sleep(60);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'home-search', '/ focuses the search box');
      await page.keyboard.press('Escape'); await sleep(60);

      // Ctrl+K must not hijack typing elsewhere on home (e.g. a rename dialog input)
      await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-probe'; document.querySelector('#view-home .view-body').appendChild(i); i.focus(); });
      await page.keyboard.press('/'); await sleep(50);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'tmp-probe', '/는 입력 중에는 가로채지 않음');
      await page.evaluate(() => { const i = document.getElementById('tmp-probe'); i.remove(); });

      // 7) 검색은 읽기 전용: DATA·저장 키가 바뀌지 않는다
      const dataBefore = await page.evaluate(() => JSON.stringify(__gkcSync.getData()));
      await search('정의');
      await search('치역');
      await homeReset();
      const dataAfter = await page.evaluate(() => JSON.stringify(__gkcSync.getData()));
      assert.equal(dataAfter, dataBefore, 'searching does not touch notebook data');
      assert.equal(await page.evaluate(() => localStorage.getItem('gkc-outline-viewpos-v1')), null, 'no extra device key from searching');

      // 8) 레이아웃: 가로 넘침 없음, 검색창/결과가 화면 안에 들어옴
      await search('치역');
      const fit = await page.evaluate(() => {
        const b = document.querySelector('#view-home .view-body');
        const box = document.getElementById('home-search-box').getBoundingClientRect();
        const rows = [...document.querySelectorAll('.hs-row')].map(r => r.getBoundingClientRect());
        return {
          overflow: b.scrollWidth - b.clientWidth,
          boxIn: box.left >= -0.5 && box.right <= innerWidth + 0.5 && box.height >= 36,
          rowsIn: rows.every(r => r.left >= -0.5 && r.right <= innerWidth + 0.5)
        };
      });
      assert.ok(fit.overflow <= 1, `no horizontal overflow (${fit.overflow}px)`);
      assert.ok(fit.boxIn, 'search box fits the viewport');
      assert.ok(fit.rowsIn, 'result rows fit the viewport');
      await homeReset();

      // 9) 목차 한눈에 보기 — 암기 가리기
      await page.evaluate(() => { __gkcNav.goMokcha('nb1'); });
      await page.click('#btn-tree-view'); await sleep(120);
      assert.ok(await visible('#view-tree'), 'tree view open');
      assert.ok(await visible('#btn-tree-blind'), '#btn-tree-blind in the tree topbar');
      const topbarFit = await page.evaluate(() => {
        const b = document.getElementById('btn-tree-blind').getBoundingClientRect();
        const h = document.querySelector('#view-tree .topbar h1').getBoundingClientRect();
        return { right: b.right, inView: b.right <= innerWidth + 0.5 && b.left > h.right - 1, h: b.height };
      });
      assert.ok(topbarFit.inView, 'toggle sits right of the title inside the topbar');
      assert.equal(await page.evaluate(() => document.getElementById('btn-tree-blind').getAttribute('aria-pressed')), 'false', 'off by default');
      assert.equal(await page.evaluate(() => document.getElementById('tree-content').classList.contains('blind')), false, 'not blind by default');
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('.sebu-open')].every(b => getComputedStyle(b).display === 'none')), true, '열기 buttons hidden in normal mode');
      // 평소 모드: 클릭 한 번에 바로 필기
      await page.click('.tree-sebu[data-sebu="sb2"]'); await sleep(120);
      assert.equal((await page.evaluate(() => __gkcNav.getState())).sebuId, 'sb2', 'normal mode: one click opens the note');
      await page.evaluate(() => { __gkcNav.goMokcha('nb1'); __gkcNav.goTree(); }); await sleep(120);

      await page.click('#btn-tree-blind'); await sleep(80);
      assert.equal(await page.evaluate(() => document.getElementById('btn-tree-blind').getAttribute('aria-pressed')), 'true', 'blind on');
      assert.equal(await page.evaluate(() => document.getElementById('tree-content').classList.contains('blind')), true, 'tree gets .blind');
      const blindState = await page.evaluate(() => {
        const t = document.querySelector('.tree-sebu[data-sebu="sb1"] .sebu-title');
        const cs = getComputedStyle(t);
        const open = getComputedStyle(document.querySelector('.tree-sebu[data-sebu="sb1"] .sebu-open')).display;
        return { color: cs.color, shadow: cs.textShadow, bg: cs.backgroundColor, open };
      });
      assert.ok(blindState.color === 'rgba(0, 0, 0, 0)' || blindState.color === 'transparent', `title text hidden (${blindState.color})`);
      assert.ok(blindState.shadow && blindState.shadow !== 'none', 'blurred silhouette');
      assert.ok(blindState.bg !== 'rgba(0, 0, 0, 0)', 'redaction bar behind the title');
      assert.ok(blindState.open !== 'none', '열기 button shown in blind mode');
      assert.equal(await page.evaluate(() => document.querySelector('.tree-mok-head').textContent.includes('함수의 정의')), true, '대목차는 그대로 보임');

      // 개별 확인: 한 번 탭 → 그 항목만 답이 드러남, 다시 탭 → 가려짐
      await page.click('.tree-sebu[data-sebu="sb1"] .sebu-title'); await sleep(80);
      assert.equal(await page.evaluate(() => document.querySelector('.tree-sebu[data-sebu="sb1"]').classList.contains('revealed')), true, 'tap reveals that row');
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.tree-sebu[data-sebu="sb1"] .sebu-title')).color !== 'rgba(0, 0, 0, 0)'), true, 'revealed title readable');
      assert.equal(await page.evaluate(() => document.querySelector('.tree-sebu[data-sebu="sb2"]').classList.contains('revealed')), false, 'other rows stay hidden');
      if (!vp.mobile) await page.screenshot({ path: path.join(SHOT_DIR || tmp, 'outline-tree-blind.png') });
      await page.click('.tree-sebu[data-sebu="sb1"] .sebu-title'); await sleep(80);
      assert.equal(await page.evaluate(() => document.querySelector('.tree-sebu[data-sebu="sb1"]').classList.contains('revealed')), false, 'tap again hides it');

      // 열기 버튼 → 필기 페이지 (가리기 상태에서도 한 번에 진입)
      await page.click('.tree-sebu[data-sebu="sb1"] .sebu-open'); await sleep(120);
      st = await page.evaluate(() => __gkcNav.getState());
      assert.equal(st.view, 'draw', '열기 opens the drawing page');
      assert.deepEqual([st.nbId, st.mokId, st.sebuId], ['nb1', 'm1', 'sb1'], '열기 opens the right note');
      await page.click('#btn-back-draw'); await sleep(80);
      assert.equal(await q('#sebu-heading', 'textContent'), '함수의 정의 — 세부목차', 'back from 열기 → 세부목차 list');

      // 모드 유지/해제 + 끄면 다시 한 번 클릭으로 열림
      await page.evaluate(() => __gkcNav.goTree()); await sleep(120);
      assert.equal(await page.evaluate(() => document.getElementById('btn-tree-blind').getAttribute('aria-pressed')), 'true', 'mode stays on when returning to the tree');
      await page.click('#btn-tree-blind'); await sleep(80);
      assert.equal(await page.evaluate(() => document.getElementById('tree-content').classList.contains('blind')), false, 'toggle off');
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.tree-sebu[data-sebu="sb1"] .sebu-title')).color !== 'rgba(0, 0, 0, 0)'), true, 'titles readable again');
      await page.click('.tree-sebu[data-sebu="sb1"]'); await sleep(120);
      assert.equal((await page.evaluate(() => __gkcNav.getState())).sebuId, 'sb1', 'normal mode click opens the note again');

      // 10) 블라인드 모드도 데이터를 건드리지 않는다
      await page.evaluate(() => __gkcNav.goMokcha('nb1'));
      const dataTreeBefore = await page.evaluate(() => JSON.stringify(__gkcSync.getData()));
      await page.evaluate(() => __gkcNav.goTree()); await sleep(80);
      await page.click('#btn-tree-blind'); await sleep(60);
      await page.click('.tree-sebu[data-sebu="sb1"] .sebu-title'); await sleep(60);
      await page.click('#btn-tree-blind'); await sleep(60);
      assert.equal(await page.evaluate(() => JSON.stringify(__gkcSync.getData())), dataTreeBefore, 'blind mode does not touch notebook data');

      assert.deepEqual(errors, [], `no console/page errors (${vp.width}x${vp.height}): ${errors.join(' | ')}`);
      if (SHOT_DIR && vp.mobile) {
        // mobile evidence: search results + blind tree (토스트는 사진에서 치운다)
        const hideToast = () => page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.classList.remove('show', 'has-act'); });
        await page.evaluate(() => __gkcNav.goHome()); await sleep(80);
        await page.evaluate(() => { const i = document.getElementById('home-search'); i.value = ''; i.dispatchEvent(new Event('input')); });
        await sleep(120);
        await page.click('#home-search'); await page.type('#home-search', '치역'); await sleep(220);
        await hideToast(); await sleep(350);
        await page.screenshot({ path: path.join(SHOT_DIR, 'outline-search-mobile.png') });
        await page.evaluate(() => { __gkcNav.goMokcha('nb1'); __gkcNav.goTree(); }); await sleep(160);
        const on = await page.evaluate(() => document.getElementById('tree-content').classList.contains('blind'));
        if (!on) { await page.click('#btn-tree-blind'); await sleep(160); }
        await hideToast(); await sleep(350);
        await page.screenshot({ path: path.join(SHOT_DIR, 'outline-tree-blind-mobile.png') });
      }
      await page.close();
      console.log(`ok ${tag} ${vp.width}x${vp.height}`);
    }
    console.log('PASS: 홈 통합 빠른 검색 (과목·수준·노트·목차·세부목차 경로 결과, 클릭 점프·뒤로 경로, Ctrl/⌘+K·/·Esc·지우기, 읽기 전용) + 목차 한눈에 보기 암기 가리기 (토글, 개별 확인, 열기로 필기, 평소 클릭 동작, 데이터 불변), desktop/mobile 콘솔 에러 없음');
  } finally {
    await browser.close(); srv.close();
  }
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
