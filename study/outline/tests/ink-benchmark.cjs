// Synthetic event-loop benchmark, NOT browser rasterization or user-device latency.
const fs = require('node:fs'), vm = require('node:vm'), {performance} = require('node:perf_hooks');
const html = fs.readFileSync(__dirname + '/../index.html','utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function fn(name) { const a=script.indexOf('function '+name+'('), b=script.indexOf('\n}',a); return script.slice(a,b+2); }
const points = Array.from({length:80},(_,i)=>({x:i,y:i*.8,p:.5}));
const data={notebooks:[{pages:Array.from({length:12},(_,page)=>({strokes:Array.from({length:700},(_,i)=>({id:`${page}-${i}`,tool:'pen',width:2,color:'#111',points})),images:[{src:'data:image/jpeg;base64,'+'x'.repeat(100000)}]}))}]};
for (const mode of ['baseline-rAF','immediate-input']) {
  let frames=[], firstPaint=0, calls=0;
  const ctx = new Proxy({}, {get:(o,k)=>o[k] || (()=>{if(k==='stroke'||k==='fill') {calls++; if(!firstPaint)firstPaint=performance.now();}})});
  const c={state:{drawing:true,currentStroke:{tool:'pen',width:2,color:'#111',pr:1,points:points.slice(0,10)}},
    getInkCtx:()=>ctx, inkT(){},requestAnimationFrame:f=>{frames.push(f);return 1;}};
  vm.createContext(c);vm.runInContext('let liveRaf=0,liveDrawnCount=0;\n'+['strokeLineWidth','segWidth','flushLiveInk'].map(fn).join('\n')+'\n'+(mode==='baseline-rAF'?'function scheduleLiveInk(){liveRaf=requestAnimationFrame(()=>{liveRaf=0;flushLiveInk();});}':fn('scheduleLiveInk')),c);
  const start=performance.now(); c.scheduleLiveInk();
  const serializationStart=performance.now(); const serialized=JSON.stringify(data,(k,v)=>k==='src'?undefined:v); const serializationMs=performance.now()-serializationStart;
  frames.forEach(f=>f());
  console.log(JSON.stringify({mode,syntheticPages:12,syntheticStrokes:8400,pointsPerStroke:80,images:12,serializedMB:+(serialized.length/1e6).toFixed(1),serializationMs:+serializationMs.toFixed(1),inputToFirstCanvasCallMs:+(firstPaint-start).toFixed(2),newSegmentDrawCalls:calls}));
}
