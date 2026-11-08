// CPU pixel raster regression, not an Android/Chrome compositor test.
// Dependency installed outside repo: npm i --prefix /workspace/canvas-regression-tools @napi-rs/canvas
const {createCanvas}=require('/workspace/canvas-regression-tools/node_modules/@napi-rs/canvas');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(__dirname+'/../index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function fn(n){const a=src.indexOf('function '+n+'('),b=src.indexOf('\n}',a);return src.slice(a,b+2);}
let cases=0;
for(const zoom of [.37,1,1.14])for(const bg of ['lined','grid','blank'])for(const sheets of [1,100])for(const dpr of [1,2]){
 const y=sheets===1?0:72000,w=720,h=1000;
 const paper=createCanvas(w*dpr,h*dpr),ink=createCanvas(w*dpr,h*dpr),out=createCanvas(Math.round(w*zoom),Math.round(h*zoom));
 const c={CSS_W:w,CSS_H:sheets*1200,state:{bg},DPR:dpr,VX:0,VY:y,VW:w,VH:h,Uint8Array};vm.createContext(c);
 vm.runInContext(['drawBackground','strokeLineWidth','segWidth','drawPressureStroke','drawStroke'].map(fn).join('\n'),c);
 const b=paper.getContext('2d'),i=ink.getContext('2d');b.setTransform(dpr,0,0,dpr,0,-y*dpr);i.setTransform(dpr,0,0,dpr,0,-y*dpr);
 c.drawBackground(b,{x:0,y,w,h});
 c.drawStroke(i,{tool:'pen',color:'#111111',width:12,points:[{x:100,y:y+200},{x:400,y:y+200}]});
 c.drawStroke(i,{tool:'eraser',width:15,points:[{x:200,y:y+100},{x:200,y:y+300}]});
 assert.equal(i.getImageData(200*dpr,200*dpr,1,1).data[3],0,'eraser must leave transparent ink');
 const o=out.getContext('2d');o.drawImage(paper,0,0,out.width,out.height);o.drawImage(ink,0,0,out.width,out.height);
 const pixels=o.getImageData(0,0,out.width,out.height).data;let dark=0,opaque=0;
 for(let n=0;n<pixels.length;n+=4){if(pixels[n]<32&&pixels[n+1]<32&&pixels[n+2]<32)dark++;if(pixels[n+3]===255)opaque++;}
 assert(dark/(pixels.length/4)<.02,'paper must not become black');assert.equal(opaque,pixels.length/4,'paper stays opaque');
 cases++;
}
assert(!src.includes('desynchronized: true'));assert(!src.includes("globalCompositeOperation = 'copy'"));
console.log('PASS:',cases,'pixel cases: zoom 37/100/114%, lined/grid/blank, 1/100 sheets, DPR1/2, scrolled viewport, pen/eraser transparency; accelerated self-copy absent');
