// Code-only harness: real functions extracted from index.html; no browser/device claim.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script); // whole production script syntax
function fn(name) {
  const start = script.indexOf('function ' + name + '(');
  assert(start >= 0, name);
  const next = script.indexOf('\n}', start);
  return script.slice(script.slice(start - 6, start) === 'async ' ? start - 6 : start, next + 2);
}
let timers, idle, frames, saves, paints, ls, resolveIDB, cancelled;
function setup() {
  timers = new Map(); idle = new Map(); frames = []; saves = paints = ls = 0; cancelled = [];
  let id = 0;
  const c = { state: { drawing: false, currentStroke: null, pointers: new Map() },
    DATA: { updatedAt: 0 }, Date, Array,
    setTimeout: f => { timers.set(++id, f); return id; }, clearTimeout: i => timers.delete(i),
    requestAnimationFrame: f => { frames.push(f); return ++id; },
    flushLiveInk: () => paints++,
    idbSet: () => { saves++; return new Promise(r => { resolveIDB = r; }); },
    lsSaveData: () => ls++, scheduleSyncPush() {}, toast() {},
    onPointerUp(e) { cancelled.push(e); c.state.pointers.delete(e.pointerId); c.state.currentStroke = null; c.state.drawing = false; },
    window: { requestIdleCallback: f => { idle.set(++id, f); return id; }, cancelIdleCallback: i => idle.delete(i) }
  };
  vm.createContext(c);
  vm.runInContext('let saveTimer=null, saveIdle=null, liveRaf=0, saveWarned=false;\n' +
    ['cancelScheduledSave','runScheduledSave','queueIdleSave','scheduleSave','doSave','flushSave','scheduleLiveInk'].map(fn).join('\n'), c);
  return c;
}
function fire(map) { const [id, f] = map.entries().next().value; map.delete(id); f(); }
(async () => {
  let c = setup();
  c.scheduleSave(); fire(timers); assert.equal(idle.size, 1);
  c.state.drawing = true; fire(idle); assert.equal(saves, 0, 'idle callback must recheck pen');
  c.state.drawing = false; fire(timers); fire(idle); assert.equal(saves, 1);
  c.state.drawing = true; resolveIDB(true); await Promise.resolve();
  assert.equal(ls, 0, 'IDB completion must not stringify during next stroke');
  c = setup(); c.scheduleSave(); fire(timers); c.scheduleSave();
  assert.equal(idle.size, 0, 'new changes cancel stale idle callback');
  c = setup(); c.state.currentStroke = { tool: 'pen' }; c.state.drawing = true;
  c.scheduleLiveInk(); assert.equal(paints, 1); assert.equal(frames.length, 0);
  c.state.currentStroke.tool = 'eraser'; c.scheduleLiveInk(); assert.equal(paints, 2);
  c.state.currentStroke.tool = 'highlighter'; c.scheduleLiveInk(); c.scheduleLiveInk();
  assert.equal(frames.length, 1, 'highlighter remains batched'); frames.shift()(); assert.equal(paints, 3);
  c = setup(); c.state.drawing = true; c.state.currentStroke = {points: [{x:1,y:2}]}; c.state.pointers.set(42, true);
  const flushing = c.flushSave(); assert.equal(cancelled[0].pointerId, 42); assert.equal(saves, 1);
  resolveIDB(true); await flushing; assert.equal(ls, 1);
  // Actual pen-up production path with a small context. No canvas rasterization simulated.
  const strokes = [], ctx = new Proxy({}, { get: (o,k) => o[k] || (()=>{}) });
  c = { state: { drawing: true, currentStroke: {tool:'pen',points:[{x:1,y:2}],width:2}, pointers: new Map([[7,true]]), undoStack:[], redoStack:[] },
    lasso:{mode:null}, activePenPointerId:7, palmBlockUntil:0, performance,
    panDrag:null, canvas:()=>({hasPointerCapture:()=>false}), wrap:()=>({classList:{remove(){}}}),
    getStrokes:()=>strokes, setStrokes(){}, flushLiveInk(){}, liveNeedsRedraw:false,
    uid:()=> 'saved-stroke', scheduleSave(){}, updateUndoBtns(){}, resetStrokeSmoothing(){},
    getInkCtx:()=>ctx, inkT(){}, segWidth:()=>2 };
  vm.createContext(c); vm.runInContext(fn('onPointerUp'),c);
  c.onPointerUp({type:'pointercancel',pointerId:7,pointerType:'pen'});
  assert.equal(strokes.length, 1); assert.equal(strokes[0].points.length,1);
  assert.equal(c.state.undoStack.length,1); assert.equal(c.state.currentStroke,null);
  console.log('PASS: syntax, idle race, IDB completion race, stale callback cancellation, immediate pen/eraser, batched highlighter, lifecycle save, production cancel/undo commit');
})().catch(e=>{console.error(e);process.exitCode=1;});
