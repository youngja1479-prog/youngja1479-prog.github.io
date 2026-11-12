// Regression (2026-11-12): "지우개로 지우면 뭔 이상한게 올가미로 잡히는데?"
// Eraser = destination-out stroke stored after the ink, so erased ink still exists in data.
// Lasso used to select and outline that invisible ink. Real lasso functions from index.html.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
function fn(name) {
  const start = script.indexOf('function ' + name + '(');
  assert(start >= 0, name);
  return script.slice(start, script.indexOf('\n}', start) + 2);
}
const has = n => script.indexOf('function ' + n + '(') >= 0;
function setup(strokes) {
  const page = { strokes };
  const svg = { innerHTML: '', setAttribute() {} };
  const menu = { style: {}, classList: { toggle() {}, remove() {} } };
  let n = 0;
  const c = { page, toasts: [], CSS_W: 800, CSS_H: 1200, Math, Map, Set, Infinity, isFinite,
    getStrokes: () => page.strokes, ensurePage: () => page, uid: () => 'new' + (++n), state: { undoStack: [], redoStack: [] },
    canvasPosFromEvent: e => ({ x: e.x, y: e.y }), lassoBuildBase() {}, lassoDrawMoving() {}, redrawAll() {}, toast(t) { c.toasts.push(t); },
    $: q => (q === '#lasso-svg' ? svg : menu), svg,
    canvas: () => ({ hasPointerCapture: () => false, releasePointerCapture() {}, setPointerCapture() {} }),
    wrap: () => ({ classList: { remove() {}, add() {} } }),
    redrawInk() {}, scheduleSave() {}, updateUndoBtns() {}, freeCanvas() {} };
  vm.createContext(c);
  const names = ['pointInPoly', 'strokeLineWidth', 'lassoBBox', 'lassoRender', 'lassoClear', 'lassoUp', 'lassoDown', 'lassoMove',
    'lassoPushUndo', 'lassoCancelMove', 'lassoCopy', 'setStrokes', 'diffTombs', 'addTomb', 'strokeKey', 'strokeSig']
    .concat(['inkSegDist', 'inkBounds', 'inkVisibleMask', 'inkCoverTester', 'inkVisibleRuns', 'lassoBakeSelection'].filter(has));
  vm.runInContext('const TOMB_MAX = 20000; const lasso = { mode: null, pid: null, path: [], sel: [], box: null };\n' + names.map(fn).join('\n') + '\nthis.lasso = lasso;', c);
  return c;
}
const line = (x0, y0, x1, y1, n = 20) => Array.from({ length: n + 1 }, (_, k) => ({ x: x0 + (x1 - x0) * k / n, y: y0 + (y1 - y0) * k / n }));
const pen = (pts, w = 2) => ({ tool: 'pen', color: '#111', width: w, points: pts });
const er = (pts, w = 2) => ({ tool: 'eraser', color: '#111', width: w, points: pts }); // eraser line width = 8
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 + 1 }, { x: x0 + 1, y: y0 + 1 }];
function lassoAround(c, poly) { c.lasso.mode = 'draw'; c.lasso.path = poly; c.lasso.pid = 1; c.lassoUp({ pointerId: 1 }); }
const polylines = c => (c.svg.innerHTML.match(/<polyline points="([^"]*)"/g) || []).map(m => m.slice(18, -1).split(' ').map(s => s.split(',').map(Number)));

// 1) fully erased writing + lasso over it: nothing selected, nothing outlined
let c = setup([pen(line(100, 100, 200, 100)), er(line(95, 100, 205, 100))]);
lassoAround(c, rect(50, 50, 250, 150));
assert.deepEqual([...c.lasso.sel], [], 'erased ink must not be selected');
assert.equal(c.lasso.box, null);
assert.equal(polylines(c).length, 0, 'erased ink must not be outlined');
assert.equal(c.lasso.mode, null);

// 2) eraser stroke by itself is never a selectable object
c = setup([er(line(100, 300, 200, 300))]);
lassoAround(c, rect(50, 250, 250, 350));
assert.equal(c.lasso.sel.length, 0);

// 3) half-erased line: outline/box only cover the visible half
c = setup([pen(line(100, 500, 300, 500)), er(line(100, 500, 200, 500))]);
lassoAround(c, rect(50, 450, 350, 550));
assert.ok(c.lasso.sel.includes(0));
for (const pl of polylines(c)) for (const [x] of pl) assert.ok(x >= 195, 'outline drawn over erased part at x=' + x);
assert.ok(c.lasso.box.x0 >= 180, 'box includes erased part: ' + c.lasso.box.x0);
assert.ok(!c.lasso.sel.includes(1), 'eraser strokes are never part of a selection');

// 4) visible word + nearby fully erased scribble: only the word is outlined, box not stretched
c = setup([pen(line(100, 700, 150, 700)), pen(line(400, 700, 500, 760)), er(line(400, 700, 500, 760))]);
lassoAround(c, rect(50, 650, 550, 800));
assert.deepEqual([...c.lasso.sel], [0]);
assert.ok(c.lasso.box.x1 < 170, 'box stretched to erased scribble: ' + c.lasso.box.x1);

// 5) untouched ink still selects as before
c = setup([pen(line(100, 900, 200, 950))]);
lassoAround(c, rect(50, 850, 250, 1000));
assert.deepEqual([...c.lasso.sel], [0]);
assert.ok(polylines(c).length === 1);

// --- Move/copy (2026-11-12 follow-up: "올가미로 필기 가져오면 지우개 영향 때문에 필기가 삭제됌") ---
const ev = (x, y) => ({ x, y, pointerId: 1, pointerType: 'pen', buttons: 1, preventDefault() {} });
function drag(c, from, to) {
  c.lassoDown(ev(from.x, from.y));
  assert.equal(c.lasso.mode, 'move');
  c.lassoMove(ev((from.x + to.x) / 2, (from.y + to.y) / 2)); c.lassoMove(ev(to.x, to.y));
  c.lassoUp(ev(to.x, to.y));
}
// visible points of every non-eraser stroke, using the production erase geometry
const visibleInk = c => { const S = c.page.strokes, out = []; S.forEach((st, i) => { const m = c.inkVisibleMask(S, i); if (m) st.points.forEach((p, k) => { if (m[k]) out.push({ i, x: p.x, y: p.y, color: st.color }); }); }); return out; };
const inBox = (pts, x0, y0, x1, y1) => pts.filter(p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);

// 7) half-erased line moved down: visible half arrives intact, erased half does not come back
c = setup([pen(line(100, 100, 300, 100, 40)), er(line(100, 100, 200, 100, 20))]);
lassoAround(c, rect(50, 50, 350, 150));
drag(c, { x: 250, y: 100 }, { x: 250, y: 400 });
let moved = inBox(visibleInk(c), 0, 380, 800, 420);
assert.ok(moved.length >= 18, 'moved ink was wiped: only ' + moved.length + ' visible points');
assert.ok(Math.min(...moved.map(p => p.x)) >= 195, 'erased part came back after move');
assert.ok(Math.max(...moved.map(p => p.x)) >= 299, 'right end of moved ink missing');
assert.equal(inBox(visibleInk(c), 0, 80, 800, 120).length, 0, 'ink left behind at old spot');

// 8) moving ink onto a spot erased earlier (old eraser stroke still in data): ink must survive
c = setup([pen(line(100, 600, 200, 600, 20)), pen(line(400, 300, 500, 300, 20)), er(line(380, 300, 520, 300, 20)), pen(line(100, 700, 120, 700, 4))]);
lassoAround(c, rect(50, 550, 250, 650));
drag(c, { x: 150, y: 600 }, { x: 450, y: 300 });
moved = inBox(visibleInk(c), 340, 280, 560, 320);
assert.ok(moved.length >= 21, 'ink moved onto an old erased spot got deleted: ' + moved.length);

// 9) carried eraser must not wipe other writing at the destination
c = setup([pen(line(100, 900, 300, 900, 40)), er(line(100, 900, 200, 900, 20)), pen(line(600, 500, 700, 500, 20))]);
lassoAround(c, rect(50, 850, 350, 950));
drag(c, { x: 250, y: 900 }, { x: 650, y: 500 });
const dest = c.page.strokes.findIndex(st => st.points[0].x === 600 && st.points[0].y === 500);
assert.ok(c.inkVisibleMask(c.page.strokes, dest).every(Boolean), 'writing at destination was erased by moved eraser');

// 10) copy: copy is intact, erased part not copied, original unchanged
c = setup([pen(line(100, 100, 300, 100, 40)), er(line(100, 100, 200, 100, 20)), er(line(110, 124, 330, 124, 20))]);
lassoAround(c, rect(50, 50, 350, 150));
const before = JSON.stringify(c.page.strokes);
c.lassoCopy();
assert.equal(JSON.stringify(c.page.strokes.slice(0, 3)), before, 'copy changed the original');
const copied = inBox(visibleInk(c), 0, 115, 800, 135).filter(p => p.i >= 3);
assert.ok(copied.length >= 18 && Math.min(...copied.map(p => p.x)) >= 219, 'copy wiped or erased part copied');

// 11) cancelled move (pinch) restores the page exactly; undo after move restores originals
c = setup([pen(line(100, 100, 300, 100, 40)), er(line(100, 100, 200, 100, 20))]);
const orig = JSON.stringify(c.page.strokes);
lassoAround(c, rect(50, 50, 350, 150));
c.lassoDown(ev(250, 100)); c.lassoMove(ev(250, 300));
c.lassoCancelMove();
assert.equal(JSON.stringify(c.page.strokes), orig, 'cancel did not restore');
assert.ok(!(c.page.del || []).some(k => JSON.parse(orig).some(st => c.strokeKey(st) === k)), 'cancel left a tombstone for original ink');

// 6) eraser tool never enters lasso path
assert.match(script, /if \(state\.tool === 'lasso'\) \{[^\n]*lassoDown\(e\)/);
assert.match(script, /if \(state\.tool !== 'lasso'\) lassoClear\(\)/);
console.log('PASS: lasso ignores erased ink; moved/copied ink arrives intact (not wiped by carried or old erasers), erased parts stay gone, destination writing untouched, cancel restores');
