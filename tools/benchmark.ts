import {runProbeBatch} from '../src/core/probe-runner';
import {probeFull} from '../src/core/probe';
import {DEFAULT_TEMPLATE,parseModels} from '../src/core/models';
const targets=parseModels(['mock-a','mock-b','mock-c','mock-d']).map(model=>({model,capabilities:DEFAULT_TEMPLATE}));
let requests=0,active=0,peak=0;const counts:Record<string,number>={},peaks:Record<string,number>={};
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){const b:any=await req.json();requests++;active++;peak=Math.max(peak,active);counts[b.model]=(counts[b.model]||0)+1;peaks[b.model]=Math.max(peaks[b.model]||0,counts[b.model]);await Bun.sleep(80);active--;counts[b.model]--;return Response.json({choices:[{message:b.tools?{tool_calls:[{function:{name:'gateway_capability_test',arguments:'{"value":"probe-ok"}'}}]}:{content:JSON.stringify(b).includes('image/png')?'blue':'OK'}}]});}});
try{
 const base=`http://127.0.0.1:${server.port}`;const rows=[];
 for(let round=1;round<=3;round++)for(const mode of ['legacy-two-model-workers','bounded-four-requests']){
  requests=0;peak=0;for(const key of Object.keys(peaks))delete peaks[key];const start=performance.now();
  if(mode.startsWith('legacy')){let index=0;await Promise.all(Array.from({length:2},async()=>{while(index<targets.length){const t=targets[index++];await probeFull(base,'fake-mock',t.model,t.capabilities,new AbortController().signal);}}));}
  else await runProbeBatch(base,'fake-mock',targets,{concurrency:4,timeoutMs:30000,signal:new AbortController().signal});
  rows.push({round,mode,elapsedMs:Math.round(performance.now()-start),requests,globalPeak:peak,modelPeak:Math.max(...Object.values(peaks))});
 }
 const average=(mode:string)=>rows.filter(r=>r.mode.startsWith(mode)).reduce((n,r)=>n+r.elapsedMs,0)/3;
 console.log(JSON.stringify({fixture:'loopback HTTP, four models, eight jobs each, 80ms per request, three rounds',rows,averageSpeedup:Number((average('legacy')/average('bounded')).toFixed(2)),scope:'Local mock scheduling only; not a real gateway speed guarantee.'},null,2));
}finally{server.stop(true);}
