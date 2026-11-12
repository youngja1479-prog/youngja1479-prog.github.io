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
  const svg = { innerHTML: '', setAttribute() {} };
  const menu = { style: {}, classList: { toggle() {}, remove() {} } };
  const c = { strokes, toasts: [], CSS_W: 800, CSS_H: 1200, Math, Map, Infinity, isFinite,
    getStrokes: () => strokes, toast(t) { c.toasts.push(t); },
    $: q => (q === '#lasso-svg' ? svg : menu), svg,
    canvas: () => ({ hasPointerCapture: () => false, releasePointerCapture() {} }),
    wrap: () => ({ classList: { remove() {} } }),
    redrawInk() {}, scheduleSave() {}, updateUndoBtns() {}, freeCanvas() {} };
  vm.createContext(c);
  const names = ['pointInPoly', 'strokeLineWidth', 'lassoBBox', 'lassoRender', 'lassoClear', 'lassoUp']
    .concat(['inkSegDist', 'inkBounds', 'inkVisibleMask'].filter(has));
  vm.runInContext('const lasso = { mode: null, pid: null, path: [], sel: [], box: null };\n' + names.map(fn).join('\n') + '\nthis.lasso = lasso;', c);
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
assert.ok(c.lasso.sel.includes(1), 'eraser that cut the selected ink moves with it');

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

// 6) eraser tool never enters lasso path
assert.match(script, /if \(state\.tool === 'lasso'\) \{[^\n]*lassoDown\(e\)/);
assert.match(script, /if \(state\.tool !== 'lasso'\) lassoClear\(\)/);
console.log('PASS: lasso ignores erased ink (no selection/outline/box of erased parts), eraser not selectable alone, normal lasso unchanged');
