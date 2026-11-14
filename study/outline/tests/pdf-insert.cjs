// PDF 넣기 logic (no browser): page-range parsing, sheet placement, size limits/warnings.
// Production functions from index.html with a mocked pdf.js; real rendering is in pdf-insert-browser.cjs.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const script = fs.readFileSync(__dirname + '/../index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
function fn(n) { const a = script.indexOf((script.includes('async function ' + n + '(') ? 'async ' : '') + 'function ' + n + '('); assert(a >= 0, n); return script.slice(a, script.indexOf('\n}', a) + 2); }
const constBlock = script.slice(script.indexOf('const PDFJS_DIR'), script.indexOf('let pdfjsPromise'));
function setup({ lastBytes = 0, vault = 'v', answer = '', confirmOk = true, pageBytes = 250000, numPages = 5 } = {}) {
  const sebu = { pageHeight: 1200, pages: [{ strokes: [{ tool: 'pen', points: [{ x: 1, y: 300 }] }, { tool: 'eraser', points: [{ x: 1, y: 5000 }] }], texts: [], images: [] }] };
  const c = { toasts: [], confirms: [], prompts: [], saves: 0, Math, Array, Set, String, Uint8Array, Promise, Object, Number,
    PAGE_W: 800, SHEET_H: 1200, SYNC_MAX_BYTES: 25 * 1024 * 1024 - 8192, syncLastBytes: lastBytes, syncVaultId: vault, CSS_H: 1200, DATA: {},
    getSebu: () => sebu, getStrokes: () => sebu.pages[0].strokes, getTexts: () => sebu.pages[0].texts, getImages: () => sebu.pages[0].images,
    uid: (() => { let i = 0; return () => 'u' + (++i); })(), toast(t) { c.toasts.push(t); }, pushImgUndo() { c.undo = true; },
    scheduleSave() { c.saves++; }, resizeCanvas() {}, redrawAll() {}, updateGuideOverlay() {}, renderTextLayer() {}, renderImages() {},
    wrap: () => ({}), $: () => ({ getBoundingClientRect: () => ({ height: 1 }) }), freeCanvas() {},
    window: { prompt: (m, d) => { c.prompts.push([m, d]); return answer; }, confirm: m => { c.confirms.push(m); return confirmOk; } },
    document: { createElement: () => ({ getContext: () => ({ fillRect() {} }), toDataURL: () => 'data:image/jpeg;base64,' + 'A'.repeat(pageBytes) }) },
    loadPdfJs: async () => ({ getDocument: () => ({ promise: Promise.resolve({ numPages, destroy() {},
      getPage: async n => ({ getViewport: ({ scale }) => (n === 3 ? { width: 842 * scale, height: 595 * scale } : { width: 595 * scale, height: 842 * scale }),
        render: () => ({ promise: Promise.resolve() }), cleanup() {} }) }) }) }),
    sebu };
  vm.createContext(c);
  vm.runInContext(constBlock + 'let pdfBusy = false; const fmtMB = b => (b / 1048576).toFixed(1);\n' +
    ['parsePdfPages', 'pdfPageBox', 'pdfStartY', 'estimateSyncBytes', 'renderPdfPage', 'insertPdfFile'].map(fn).join('\n'), c);
  return c;
}
const file = { arrayBuffer: async () => new ArrayBuffer(8) };
(async () => {
  let c = setup();
  assert.deepEqual([...c.parsePdfPages('', 3)], [1, 2, 3]);
  assert.deepEqual([...c.parsePdfPages('전체', 2)], [1, 2]);
  assert.deepEqual([...c.parsePdfPages('1-3, 5 ,7~8', 9)], [1, 2, 3, 5, 7, 8]);
  assert.deepEqual([...c.parsePdfPages('4-2', 5)], [2, 3, 4]);
  assert.equal(c.parsePdfPages('0', 5), null); assert.equal(c.parsePdfPages('6', 5), null); assert.equal(c.parsePdfPages('a', 5), null);
  assert.deepEqual(JSON.parse(JSON.stringify(c.pdfPageBox(595, 842))), { w: 800, h: 1132, x: 0, dy: 34 });
  const land = c.pdfPageBox(842, 595); assert.equal(land.w, 800); assert(land.h < 600);
  const tall = c.pdfPageBox(300, 1000); assert.equal(tall.h, 1200); assert(tall.w < 800 && tall.x > 0);
  // normal insert: below existing ink (eraser ignored), one page per sheet
  await c.insertPdfFile(file);
  let im = c.sebu.pages[0].images;
  assert.equal(im.length, 5); assert.equal(im[0].y, 1200 + 34); assert.equal(im[4].y, 1200 * 5 + 34); assert.equal(c.sebu.pageHeight, 7200);
  assert(c.undo && c.saves === 1); assert.match(c.toasts.pop(), /PDF 5쪽을 넣었어요/);
  // >30 pages: prompt proposes 1-30 and refuses more
  c = setup({ numPages: 40, answer: '1-40' }); await c.insertPdfFile(file);
  assert.equal(c.prompts[0][1], '1-30'); assert.match(c.toasts.pop(), /최대 30쪽/); assert.equal(c.sebu.pages[0].images.length, 0);
  // near the limit: confirm shown; cancel adds nothing
  c = setup({ lastBytes: 19.5 * 1048576, confirmOk: false }); await c.insertPdfFile(file);
  assert.equal(c.confirms.length, 1); assert.match(c.confirms[0], /동기화 용량이 거의 찼어요/); assert.equal(c.sebu.pages[0].images.length, 0);
  c = setup({ lastBytes: 19.5 * 1048576, confirmOk: true }); await c.insertPdfFile(file); assert.equal(c.sebu.pages[0].images.length, 5);
  // over 25 MB: blocked with clear message, nothing added
  c = setup({ lastBytes: 24 * 1048576 }); await c.insertPdfFile(file);
  assert.match(c.toasts.pop(), /용량이 너무 커서 넣을 수 없어요/); assert.equal(c.sebu.pages[0].images.length, 0);
  // not syncing: no limit prompt
  c = setup({ lastBytes: 24 * 1048576, vault: null }); await c.insertPdfFile(file); assert.equal(c.sebu.pages[0].images.length, 5);
  // estimate without a measured payload counts image data already in the notebook
  c = setup(); c.DATA = { notebooks: [{ x: { images: [{ src: 'data:image/jpeg;base64,' + 'A'.repeat(4000) }] } }] };
  vm.runInContext('DATA = this.DATA', c); assert(c.estimateSyncBytes() >= 4000);
  // the existing 413 message path is untouched
  assert(script.includes("if (/\\b413\\b/.test(msg)) return '용량이 너무 커서 못 올렸어요"));
  console.log('PASS: page ranges, A4/landscape/tall fit, one page per sheet below content, 30-page cap, near-limit confirm, >25MB block, no-sync bypass, estimate, 413 message kept');
})().catch(e => { console.error(e); process.exitCode = 1; });
