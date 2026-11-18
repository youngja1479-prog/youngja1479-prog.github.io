// 퀴즈 연타 방지: after a choice is tapped the next question's choices appear in the same spot 0.55 s later.
// A tap within 300 ms of the new choices appearing (late 2nd finger of a double tap) is ignored, so the next
// question is never answered unseen (guard is on the tap handler; answerQuiz itself unchanged). Normal taps (≥300 ms after it appears) still answer; clock going
// backwards never blocks. Node VM with stub DOM + fake clock/timers. Run: node study/voca-renew/tests/quiz-next-tap-guard.cjs
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const file=process.argv[2]||path.join(__dirname,'../index.html');
const html=fs.readFileSync(file,'utf8');
let script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
const expose=`globalThis.API={startRangeQuiz,studyMeanings,getQ:()=>({idx:quizIdx,score:quizScore,answered:quizAnswered,pool:quizPool,wrong:quizWrongIds.slice()}),getState:()=>state};`;
const last=script.lastIndexOf('})();');assert(last>0);script=script.slice(0,last)+expose+script.slice(last);
const nodes={};
const node=id=>nodes[id]??=({id,style:{},classList:{toggle(){},add(){},remove(){}},attributes:{},parentElement:{classList:{toggle(){}}},textContent:'',innerHTML:'',value:'',checked:false,hidden:false,disabled:false,events:{},addEventListener(k,f){(this.events[k]??=[]).push(f)},setAttribute(k,v){this.attributes[k]=v},getAttribute(k){return this.attributes[k]},querySelectorAll(){return []},querySelector(){return null},focus(){}});
for(const m of html.matchAll(/id="([^"]+)"/g))node(m[1]);
const store={'gkc-voca2-settings-v1':JSON.stringify({autoSpeak:false})};
const document={visibilityState:'visible',getElementById(id){assert(nodes[id],`missing DOM #${id}`);return nodes[id]},querySelectorAll(){return []},addEventListener(){},querySelector(){return null}};
let clock=1e12;const RealDate=Date;const timers=[];
class FakeDate extends RealDate{constructor(...a){a.length?super(...a):super(clock)}static now(){return clock}}
const ctx={document,Date:FakeDate,localStorage:{getItem:k=>store[k]??null,setItem(k,v){store[k]=v},removeItem(){throw Error('delete storage prohibited')}},console,setTimeout:(f,ms)=>{timers.push({f,at:clock+(ms||0)});return timers.length},clearTimeout(){},confirm:()=>true,Promise,SpeechSynthesisUtterance:function(w){this.text=w},speechSynthesis:{cancel(){},speak(){}}};
ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(script,ctx,{filename:file,timeout:10000});
const a=ctx.API;
const advance=ms=>{clock+=ms;for(let i=0;i<timers.length;i++){const t=timers[i];if(t&&t.at<=clock){timers[i]=null;t.f();}}};
const tapChoice=c=>{for(const f of nodes.quizChoices.events.click||[])f({target:{closest:()=>({disabled:false,getAttribute:()=>c})}});};
const right=()=>a.studyMeanings(a.getQ().pool[a.getQ().idx])[0];
nodes.rangeStart.value='1';nodes.rangeEnd.value='1';nodes.rangeShuffle.checked=false;a.startRangeQuiz();
const N=a.getQ().pool.length;assert(N>3,'quiz has questions');
advance(1000);
tapChoice(right());assert.strictEqual(a.getQ().score,1,'normal tap on Q1 answers');
advance(560); // Q2 appears at +550 ms
assert.strictEqual(a.getQ().idx,1);assert.strictEqual(a.getQ().answered,false);
tapChoice('__wrong__');advance(10); // late finger of a double tap, ~10 ms after Q2 appeared
assert.strictEqual(a.getQ().answered,false,'tap right after Q2 appeared ignored');assert.strictEqual(a.getQ().idx,1);assert.strictEqual(a.getQ().wrong.length,0,'Q2 not marked wrong');
advance(200);tapChoice('__wrong__');assert.strictEqual(a.getQ().answered,false,'still within 300 ms → ignored');
advance(100);tapChoice(right());assert.strictEqual(a.getQ().answered,true,'tap ≥300 ms after Q2 appeared answers');assert.strictEqual(a.getQ().score,2);
advance(560);assert.strictEqual(a.getQ().idx,2);
advance(400);const w3=a.getQ().pool[2];tapChoice('__wrong__');assert.strictEqual(a.getQ().answered,true,'wrong answer at normal pace counts');assert(a.getState().wrong[w3.id],'wrong saved to 누적 오답');
advance(560);assert.strictEqual(a.getQ().idx,3);
clock-=60000;tapChoice(right());assert.strictEqual(a.getQ().answered,true,'clock moved backwards does not block');
assert(Object.keys(store).every(k=>['gkc-voca-gicho1000-v1-marks-v1','gkc-voca2-settings-v1'].includes(k)),'only existing storage keys: '+Object.keys(store));
console.log('PASS: quiz tap within 300 ms of new choices ignored (no unseen answer); normal taps, wrong answers, clock changes OK; no new storage');
