// 퀴즈에서 보기를 누른 직후(0.55초 안) 건너뛰기·홈 등으로 나가면, 숨은 퀴즈가 다음 단어를 자동 발음해
// 카드 화면 발음을 끊거나 홈에서 엉뚱한 단어가 들리던 문제. 새 퀴즈를 그 사이 시작하면 첫 문제가 건너뛰어지던 문제.
// Node VM with stub DOM + manual timers. Run: node study/voca-renew/tests/quiz-stray-audio.cjs [index.html]
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const file=process.argv[2]||path.join(__dirname,'../index.html');
const html=fs.readFileSync(file,'utf8');
let script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
const expose=`globalThis.API={startRangeQuiz,startRangeCards,answerQuiz,showPanel,getQuiz:()=>({i:quizIdx,pool:quizPool,score:quizScore}),getState:()=>state};`;
const last=script.lastIndexOf('})();');assert(last>0);script=script.slice(0,last)+expose+script.slice(last);
const nodes={};
const node=id=>nodes[id]??=({id,style:{},classList:{toggle(){},add(){},remove(){}},attributes:{},parentElement:{classList:{toggle(){}}},textContent:'',innerHTML:'',value:'',checked:false,hidden:false,disabled:false,events:{},addEventListener(k,f){(this.events[k]??=[]).push(f)},setAttribute(k,v){this.attributes[k]=v},getAttribute(k){return this.attributes[k]},querySelectorAll(){return []},querySelector(){return null},focus(){}});
for(const m of html.matchAll(/id="([^"]+)"/g))node(m[1]);
const store={'gkc-voca2-settings-v1':JSON.stringify({autoSpeak:true})};
const spoken=[];let timers=[];
const document={visibilityState:'visible',getElementById(id){assert(nodes[id],`missing DOM #${id}`);return nodes[id]},querySelectorAll(){return []},addEventListener(){},querySelector(){return null}};
const ctx={document,Date,localStorage:{getItem:k=>store[k]??null,setItem(k,v){store[k]=v},removeItem(){throw Error('delete storage prohibited')}},console,
  setTimeout:(f,ms)=>{timers.push({f,ms});return timers.length},clearTimeout(){},confirm:()=>true,Promise,
  SpeechSynthesisUtterance:function(w){this.text=w},speechSynthesis:{cancel(){},speak(u){spoken.push(u.text)}}};
ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(script,ctx,{filename:file,timeout:10000});
const a=ctx.API;
const flush550=()=>{const t=timers.filter(x=>x.ms===550);timers=timers.filter(x=>x.ms!==550);t.forEach(x=>x.f());};
nodes.rangeStart.value='1';nodes.rangeEnd.value='1';nodes.rangeShuffle.checked=false;
// 1) normal quiz flow: answering speaks the next quiz word (auto-pronunciation unchanged)
a.startRangeQuiz();
let q=a.getQuiz();assert.strictEqual(spoken.at(-1),q.pool[0].word,'first quiz word spoken');
a.answerQuiz('__wrong__');flush550();
q=a.getQuiz();assert.strictEqual(q.i,1);assert.strictEqual(spoken.at(-1),q.pool[1].word,'next quiz word auto-spoken while on quiz');
// 2) answer, then leave to cards before 0.55 s: the card word must be the last thing spoken
a.answerQuiz('__wrong__');
a.startRangeCards();const cardWord=spoken.at(-1);
const nBefore=spoken.length;flush550();
assert.strictEqual(spoken.length,nBefore,'hidden quiz did not speak over the card: '+spoken.slice(nBefore));
assert.strictEqual(a.getQuiz().i,2,'quiz progress still advanced (records unchanged)');
// 3) answer, go home before 0.55 s: no stray word on the home screen
a.startRangeQuiz();a.answerQuiz('__wrong__');a.showPanel('home');
const n2=spoken.length;flush550();assert.strictEqual(spoken.length,n2,'no stray pronunciation on home');
// 4) answer, then a new quiz starts within 0.55 s: the new quiz must not skip its first question
a.startRangeQuiz();a.answerQuiz('__wrong__');a.startRangeQuiz();flush550();
assert.strictEqual(a.getQuiz().i,0,'new quiz starts at question 1');
// 5) last question answered then left: result/score is still recorded as before
a.startRangeQuiz();const len=a.getQuiz().pool.length;
for(let i=0;i<len-1;i++){a.answerQuiz(a.getQuiz().pool[a.getQuiz().i].meaning||'x');flush550();}
a.answerQuiz('__wrong__');a.showPanel('home');flush550();
assert.strictEqual(a.getQuiz().i,len,'finished');assert.strictEqual(nodes.quizResult.style.display,'block','result rendered');
assert(Object.keys(store).every(k=>['gkc-voca-gicho1000-v1-marks-v1','gkc-voca2-settings-v1'].includes(k)),'only existing storage keys: '+Object.keys(store));
console.log('PASS: quiz auto-pronunciation only while the quiz is on screen; leaving within 0.55 s causes no stray audio; new quiz not skipped; progress/records unchanged');
