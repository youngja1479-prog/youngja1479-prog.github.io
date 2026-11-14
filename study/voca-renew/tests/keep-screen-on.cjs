// 화면 켜짐 유지 (Screen Wake Lock) while studying cards/quiz/examples; released on home/lists,
// re-acquired after returning to the app, silently ignored when unsupported/denied.
// Node VM with stub DOM (same approach as gicho-regression.cjs). Run: node study/voca-renew/tests/keep-screen-on.cjs
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const file=process.argv[2]||path.join(__dirname,'../index.html');
const html=fs.readFileSync(file,'utf8');
let script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
const expose=`globalThis.API={showPanel,openDays,startRangeCards,startRangeQuiz,startCloze,allLevelWords,getState:()=>state};`;
const last=script.lastIndexOf('})();');assert(last>0);script=script.slice(0,last)+expose+script.slice(last);
const flush=()=>new Promise(r=>setImmediate(r));
function boot(wakeLockImpl){
  const nodes={};
  const node=id=>nodes[id]??=({id,style:{},classList:{toggle(){},add(){},remove(){}},attributes:{},parentElement:{classList:{toggle(){}}},textContent:'',innerHTML:'',value:'',checked:false,hidden:false,disabled:false,events:{},addEventListener(k,f){(this.events[k]??=[]).push(f)},setAttribute(k,v){this.attributes[k]=v},getAttribute(k){return this.attributes[k]},querySelectorAll(){return []},querySelector(){return null},focus(){}});
  for(const m of html.matchAll(/id="([^"]+)"/g))node(m[1]);
  const docEvents={};
  const store={'gkc-voca2-settings-v1':JSON.stringify({autoSpeak:false})},writes=[];
  const document={visibilityState:'visible',getElementById(id){assert(nodes[id],`missing DOM #${id}`);return nodes[id]},querySelectorAll(){return []},addEventListener(k,f){(docEvents[k]??=[]).push(f)},querySelector(){return null}};
  const ctx={document,localStorage:{getItem:k=>store[k]??null,setItem(k,v){writes.push(k);store[k]=v},removeItem(){throw Error('delete storage prohibited')}},console,setTimeout:()=>1,clearTimeout(){},confirm:()=>true,Promise,SpeechSynthesisUtterance:function(w){this.text=w},speechSynthesis:{cancel(){},speak(){}}};
  if(wakeLockImpl!==undefined)ctx.navigator={wakeLock:wakeLockImpl};
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(script,ctx,{filename:file,timeout:10000});
  return {a:ctx.API,nodes,document,docEvents,store,writes};
}
function mockWakeLock(){
  const m={requests:0,active:0,locks:[],deny:false};
  m.request=type=>{assert.strictEqual(type,'screen');m.requests++;if(m.deny)return Promise.reject(Object.assign(new Error('denied'),{name:'NotAllowedError'}));
    const lock={released:false,ev:{},addEventListener(k,f){(this.ev[k]??=[]).push(f)},release(){if(!this.released){this.released=true;m.active--;(this.ev.release||[]).forEach(f=>f())}return Promise.resolve()}};
    m.active++;m.locks.push(lock);return Promise.resolve(lock);};
  m.systemRelease=()=>m.locks.filter(l=>!l.released).forEach(l=>l.release()); // browser drops lock when tab hidden
  return m;
}
(async()=>{
  // 1) supported: acquire while studying, single lock, release on home, re-acquire after tab returns
  const wl=mockWakeLock();const {a,nodes,document,docEvents}=boot(wl);
  assert.strictEqual(wl.requests,0,'no lock at startup/home');
  nodes.rangeStart.value='1';nodes.rangeEnd.value='1';
  a.startRangeCards();await flush();assert.strictEqual(wl.active,1,'cards keep screen on');
  a.startRangeQuiz();await flush();assert.strictEqual(wl.active,1,'still one lock in quiz');assert.strictEqual(wl.requests,1,'no duplicate requests');
  const w=a.allLevelWords('gicho1000-v1');
  a.startCloze([w[0]],'t','range',false,'cloze');await flush();assert.strictEqual(wl.active,1,'cloze keeps screen on');
  a.openDays();await flush();assert.strictEqual(wl.active,0,'released on DAY list');
  a.showPanel('home');await flush();assert.strictEqual(wl.active,0,'stays released on home');
  a.showPanel('card');await flush();assert.strictEqual(wl.active,1,'re-acquired on card');
  document.visibilityState='hidden';wl.systemRelease();docEvents.visibilitychange.forEach(f=>f());await flush();assert.strictEqual(wl.active,0);
  document.visibilityState='visible';docEvents.visibilitychange.forEach(f=>f());await flush();assert.strictEqual(wl.active,1,'re-acquired after returning to app');
  a.showPanel('wrong');await flush();assert.strictEqual(wl.active,0,'released on 오답 list');
  // fast in/out while request pending → no leaked lock
  a.showPanel('card');a.showPanel('home');await flush();assert.strictEqual(wl.active,0,'pending lock released if user already left');
  for(const p of ['calendar','prep','examples']){a.showPanel(p);await flush();assert.strictEqual(wl.active,1,p+' keeps screen on');a.showPanel('home');await flush();}
  // 2) denied: no throw, study still works, retried next time
  const wl2=mockWakeLock();wl2.deny=true;const b=boot(wl2);b.nodes.rangeStart.value='1';b.nodes.rangeEnd.value='1';
  b.a.startRangeCards();await flush();assert.strictEqual(wl2.active,0);b.a.showPanel('home');wl2.deny=false;b.a.showPanel('quiz');await flush();assert.strictEqual(wl2.active,1,'retry after denial');
  // 3) unsupported browser / no navigator: silently ignored
  for(const impl of [undefined,null,{}]){const c=boot(impl);c.nodes.rangeStart.value='1';c.nodes.rangeEnd.value='1';c.a.startRangeCards();c.a.startRangeQuiz();c.a.showPanel('home');await flush();
    assert(c.writes.every(k=>!/wake/i.test(k)),'no storage for wake lock');}
  // 4) no storage writes for this feature; learning records untouched by panel changes
  const before=JSON.stringify(a.getState());a.showPanel('card');a.showPanel('home');assert.strictEqual(JSON.stringify(a.getState()),before);
  console.log('PASS: screen stays on in card/quiz/cloze/examples/calendar/prep; released on home/DAY/오답; re-acquired after app returns; no duplicate or leaked locks; denial/unsupported ignored; no storage changes');
})().catch(e=>{console.error(e);process.exit(1)});
