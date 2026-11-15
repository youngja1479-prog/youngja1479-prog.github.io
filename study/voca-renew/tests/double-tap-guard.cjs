// 빠른 연타 방지: a 2nd tap on 모르겠음/외움/정답 확인 within 350 ms of the previous one is ignored
// (accidental double tap on phone/tablet must not skip an unseen card or open the next answer).
// Normal-speed taps still work. Node VM with stub DOM + fake clock. Run: node study/voca-renew/tests/double-tap-guard.cjs
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const file=process.argv[2]||path.join(__dirname,'../index.html');
const html=fs.readFileSync(file,'utf8');
let script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
const expose=`globalThis.API={startRangeCards,startCloze,allLevelWords,getState:()=>state,getCard:()=>cardIdx,getPool:()=>pool,getCloze:()=>JSON.stringify({i:clozeIdx,rev:clozeRevealed})};`;
const last=script.lastIndexOf('})();');assert(last>0);script=script.slice(0,last)+expose+script.slice(last);
const nodes={};
const node=id=>nodes[id]??=({id,style:{},classList:{toggle(){},add(){},remove(){}},attributes:{},parentElement:{classList:{toggle(){}}},textContent:'',innerHTML:'',value:'',checked:false,hidden:false,disabled:false,events:{},addEventListener(k,f){(this.events[k]??=[]).push(f)},setAttribute(k,v){this.attributes[k]=v},getAttribute(k){return this.attributes[k]},querySelectorAll(){return []},querySelector(){return null},focus(){}});
for(const m of html.matchAll(/id="([^"]+)"/g))node(m[1]);
const store={'gkc-voca2-settings-v1':JSON.stringify({autoSpeak:false})};
const document={visibilityState:'visible',getElementById(id){assert(nodes[id],`missing DOM #${id}`);return nodes[id]},querySelectorAll(){return []},addEventListener(){},querySelector(){return null}};
let clock=1e12;const RealDate=Date;
class FakeDate extends RealDate{constructor(...a){a.length?super(...a):super(clock)}static now(){return clock}}
const ctx={document,Date:FakeDate,localStorage:{getItem:k=>store[k]??null,setItem(k,v){store[k]=v},removeItem(){throw Error('delete storage prohibited')}},console,setTimeout:()=>1,clearTimeout(){},confirm:()=>true,Promise,SpeechSynthesisUtterance:function(w){this.text=w},speechSynthesis:{cancel(){},speak(){}}};
ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(script,ctx,{filename:file,timeout:10000});
const a=ctx.API;
const tap=(id,dt)=>{clock+=dt;for(const f of nodes[id].events.click||[])f({});};
// flashcards
nodes.rangeStart.value='1';nodes.rangeEnd.value='1';a.startRangeCards();
assert.strictEqual(a.getCard(),0);
tap('btnKnow',1000);assert.strictEqual(a.getCard(),1,'normal tap advances');
tap('btnKnow',120);assert.strictEqual(a.getCard(),1,'accidental double tap (120 ms) ignored → next card not skipped');
tap('btnDontKnow',100);assert.strictEqual(a.getCard(),1,'fast tap on the other button also ignored');
tap('btnDontKnow',400);assert.strictEqual(a.getCard(),2,'tap after 350 ms works');
tap('btnKnow',360);assert.strictEqual(a.getCard(),3,'quick but deliberate pace still works');
const st=a.getState(),pl=a.getPool();const ws=a.allLevelWords('gicho1000-v1');
assert.strictEqual(st.known[pl[0].id],1,'card 1: 외움 saved once');assert(st.wrong[pl[1].id]&&!st.known[pl[1].id],'card 2: only the deliberate 모르겠음 saved');assert.strictEqual(st.known[pl[2].id],1,'card 3: 외움 saved');
// undo button is not throttled (fixing mistakes stays instant)
tap('btnCardUndo',10);assert.strictEqual(a.getCard(),2,'↩ 이전 works immediately');assert(!a.getState().known[pl[2].id],'undo restored card 3');
// cloze: double tap on 정답 확인 must not mark; double tap on 외움·다음 must not open next answer
a.startCloze([ws[0],ws[1]],'t','range',false,'cloze');
tap('btnClozeReveal',1000);assert.strictEqual(a.getCloze(),JSON.stringify({i:0,rev:true}));
tap('btnClozeKnown',150);assert.strictEqual(a.getCloze(),JSON.stringify({i:0,rev:true}),'double tap on 정답 확인 does not mark');
tap('btnClozeKnown',800);assert.strictEqual(a.getCloze(),JSON.stringify({i:1,rev:false}),'deliberate 외움 works');
tap('btnClozeReveal',150);assert.strictEqual(a.getCloze(),JSON.stringify({i:1,rev:false}),'double tap on 외움·다음 does not reveal next answer');
tap('btnClozeReveal',700);assert.strictEqual(a.getCloze(),JSON.stringify({i:1,rev:true}));
// clock moving backwards (device time change) never locks the buttons
tap('btnClozeWrong',-60000);assert.strictEqual(JSON.parse(a.getCloze()).i,2,'clock change does not block');
// no new storage keys
assert(Object.keys(store).every(k=>['gkc-voca-gicho1000-v1-marks-v1','gkc-voca2-settings-v1'].includes(k)),'only existing storage keys used: '+Object.keys(store));
console.log('PASS: 모르겠음/외움/정답 확인 accidental double tap (<350 ms) ignored in cards & 예문; normal taps, ↩ 이전, clock changes unaffected; no new storage');
