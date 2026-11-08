const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const {Worker}=require('node:worker_threads');
const script=fs.readFileSync(__dirname+'/../index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function fn(name){const a=script.indexOf('function '+name+'('),b=script.indexOf('\n}',a);return script.slice(script.slice(a-6,a)==='async '?a-6:a,b+2);}
function codeCtx(extra={}) {const c={...extra};vm.createContext(c);return c;}
function recorder() {const ops=[];return {ops,ctx:new Proxy({}, {get:(o,k)=>o[k]||((...args)=>ops.push([k,...args]))})};}
function makeWorker() {
 const w=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.crypto=require('node:crypto').webcrypto;globalThis.self=globalThis;globalThis.postMessage=m=>parentPort.postMessage(m);require(${JSON.stringify(require('node:path').resolve(__dirname,'../perf-worker.js'))});parentPort.on('message',data=>self.onmessage({data}));`,{eval:true});
 let id=0;const pending=new Map();w.on('message',m=>{const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Object.assign(new Error(m.error.message),{name:m.error.name})):p.resolve(m.result);});
 return {w,task:(kind,payload,password)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});w.postMessage({id,kind,payload,password});})};
}
(async()=>{
 // Viewport ruled/grid geometry must equal full export geometry clipped to region.
 for(const bg of ['lined','grid','blank']) {
  const c=codeCtx({CSS_W:720,CSS_H:120000,state:{bg}});vm.runInContext(fn('drawBackground'),c);
  const full=recorder(), visible=recorder();c.drawBackground(full.ctx);c.drawBackground(visible.ctx,{x:0,y:48000,w:720,h:1200});
  const horizontal = r => r.ops.filter((o,i)=>o[0]==='moveTo' && r.ops[i+1] && r.ops[i+1][0]==='lineTo' && r.ops[i+1][2]===o[2]).map(o=>o[2]);
  const fullY=horizontal(full).filter(y=>y>=48000 && y<=49200);
  const viewY=horizontal(visible);
  assert.deepEqual(viewY,fullY);assert(visible.ops.length<300);
 }
 // Live raster commands scale with NEW points, never historical page contents.
 for(const tool of ['pen','eraser']) {
  const r=recorder();const points=Array.from({length:101},(_,i)=>({x:i,y:i*.5,p:.5}));
  const c=codeCtx({state:{drawing:true,currentStroke:{tool,width:2,color:'#111',points}},getInkCtx:()=>r.ctx,inkT(){}});
  vm.runInContext('let liveDrawnCount=0;'+['strokeLineWidth','segWidth','flushLiveInk'].map(fn).join('\n'),c);
  c.flushLiveInk();assert.equal(r.ops.filter(o=>o[0]==='stroke').length,1);
  assert.equal(r.ops.filter(o=>o[0]==='quadraticCurveTo').length,99);
  const prior=r.ops.length;c.flushLiveInk();assert.equal(r.ops.slice(prior).filter(o=>o[0]==='stroke').length,0);
  points.push({x:102,y:51,p:.5});c.flushLiveInk();assert.equal(r.ops.filter(o=>o[0]==='stroke').length,2);
  assert.equal(r.ctx.globalCompositeOperation,tool==='eraser'?'destination-out':'source-over');
 }
 const data={version:1,updatedAt:123,notebooks:[{id:'n',mokchas:[{id:'m',sebus:[{id:'s',pages:[{strokes:[{id:'stroke',points:[{x:2,y:3,p:.5}]}],images:[{id:'i',src:'data:image/png;base64,AAAA'}],texts:[{id:'t',text:'한글'}],del:['old']}]}]}]}]};
 const {w,task}=makeWorker();
 try {
  const env=await task('encrypt',data,'test-only-password');assert.equal(env.v,1);assert.equal(env.updatedAt,123);
  assert.deepEqual(await task('decrypt',env,'test-only-password'),data);
  await assert.rejects(task('decrypt',env,'wrong-password'),{name:'OperationError'});
  const fallback=JSON.parse(await task('fallback',data));assert.equal(fallback.notebooks[0].mokchas[0].sebus[0].pages[0].images[0].src,undefined);
  assert.equal(fallback.notebooks[0].mokchas[0].sebus[0].pages[0].strokes[0].points[0].x,2);
  // Worker format interoperates with old in-page crypto, in BOTH directions.
  const c=codeCtx({crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,Uint8Array,btoa,atob,Date,PBKDF2_ITERS:150000});
  vm.runInContext(['bufToB64','b64ToBuf','deriveAesKey','encryptDataFallback','decryptEnvelopeFallback'].map(fn).join('\n'),c);
  assert.deepEqual(JSON.parse(JSON.stringify(await c.decryptEnvelopeFallback(env,'test-only-password'))),data);
  assert.deepEqual(await task('decrypt',await c.encryptDataFallback(data,'test-only-password'),'test-only-password'),data);
 } finally {await w.terminate();}
 // Unchanged poll optimization is invalidated by every relevant revision/input.
 const env={v:1,updatedAt:10,salt:'s',iv:'i',ct:'c'};
 const c=codeCtx({DATA:{updatedAt:10},syncVaultId:'v',syncPassword:'p',lastQuietPull:null});
 vm.runInContext(fn('sameQuietPull'),c);c.lastQuietPull={env,data:c.DATA,updatedAt:10,vault:'v',password:'p'};
 assert(c.sameQuietPull({...env}));assert(!c.sameQuietPull({...env,ct:'changed'}));
 c.DATA.updatedAt++;assert(!c.sameQuietPull(env));c.DATA.updatedAt=10;
 c.DATA={updatedAt:10};assert(!c.sameQuietPull(env));
 // Normal fallback generation must never replace a newer revision; lifecycle
 // fallback must not wait on a worker which can be suspended with the page.
 let reply, writes=0, workerCalls=0;
 const lsctx=codeCtx({DATA:{updatedAt:1,notebooks:[]},state:{drawing:false},Date,JSON,
   document:{visibilityState:'visible'},localStorage:{setItem(){writes++;}},LS_KEY:'test',
   runPerfTask(){workerCalls++;return new Promise(r=>{reply=r;});}});
 vm.runInContext('let lsLastSave=0,lsTooBig=0,lsSaveGeneration=0;'+fn('lsSaveData'),lsctx);
 const pending=lsctx.lsSaveData();lsctx.DATA.updatedAt=2;reply({result:'old'});await pending;assert.equal(writes,0);
 lsctx.document.visibilityState='visible';await lsctx.lsSaveData(true,true);assert.equal(writes,1);assert.equal(workerCalls,1);
 // Redraw must precede IDB completion, so it cannot cancel a newer active stroke.
 let idbFinish, rendered=0;
 const apply=codeCtx({DATA:{},syncApplyingRemote:false,syncPushTimer:null,saveTimer:null,clearTimeout(){},Date,reRenderAfterSync(){rendered++;},
   idbSet(){return new Promise(r=>{idbFinish=r;});},lsSaveData(){}});
 vm.runInContext(fn('applyRemoteData'),apply);const applying=apply.applyRemoteData({version:1,updatedAt:1});
 assert.equal(rendered,1);idbFinish(true);await applying;assert.equal(rendered,1);
 // An edit made while the worker encrypts must schedule a subsequent upload.
 let finishEncrypt, queued=0;
 const push=codeCtx({state:{drawing:false},DATA:{updatedAt:1},syncPassword:'test',syncVaultId:'v',navigator:{onLine:true},
  syncPendingPush:false,syncLastError:'',syncBusy:false,syncPushTimer:null,clearTimeout(){},setTimeout(){queued++;return 1;},
  updateSyncStatusUI(){},syncFetchGet:async()=>null,encryptData:()=>new Promise(r=>{finishEncrypt=r;}),syncFetchPut:async()=>{}});
 vm.runInContext(fn('syncPushNow'),push);const pushing=push.syncPushNow();await new Promise(r=>setImmediate(r));
 push.DATA.updatedAt=2;finishEncrypt({updatedAt:1});const pushed=await pushing;
 assert.equal(pushed.pending,true);assert.equal(push.syncPendingPush,true);assert.equal(queued,1);
 // Optional worker failures must resolve to the original implementation, while
 // wrong-password/data errors must reject (not silently fall back).
 for (const behavior of ['load-failure','crypto-error','success']) {
  class FakeWorker {
   terminate() {}
   postMessage(message) { queueMicrotask(()=>{
    if(behavior==='load-failure')this.onerror();
    else this.onmessage({data:behavior==='crypto-error'?{id:message.id,error:{name:'OperationError',message:'decrypt'}}:{id:message.id,result:'ok'}});
   }); }
  }
  const adapter=codeCtx({Worker:FakeWorker,URL,document:{baseURI:'https://example.test/study/outline/'},Promise,Map,Error});
  vm.runInContext('let perfWorker=null,perfWorkerDisabled=false,perfTaskId=0;const perfTasks=new Map();'+fn('disablePerfWorker')+fn('runPerfTask'),adapter);
  if(behavior==='crypto-error')await assert.rejects(adapter.runPerfTask('decrypt',{},'test'),{name:'OperationError'});
  else {const result=await adapter.runPerfTask('fallback',{});assert.equal(behavior==='success'?result.result:result.unavailable,behavior==='success'?'ok':true);}
 }
 console.log('PASS: viewport/export line geometry; pen/eraser incremental command batching; worker crypto roundtrip, wrong-password failure, old-format interoperability, fallback data preservation; unchanged-poll invalidation');
})().catch(e=>{console.error(e);process.exitCode=1;});
