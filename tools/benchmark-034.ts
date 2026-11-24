import {runProbeBatch} from '../src/core/probe-runner';
import {runDetection} from '../src/core/detection-runner';
import {DEFAULT_PREFERENCES} from '../src/core/probe-preferences';
import {DEFAULT_TEMPLATE,parseModels} from '../src/core/models';
const targets=parseModels(Array.from({length:15},(_,i)=>'mock-'+i)).map(model=>({model,capabilities:DEFAULT_TEMPLATE}));
let requests=0,active=0,peak=0;
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){const b:any=await req.json();requests++;peak=Math.max(peak,++active);await Bun.sleep(40);active--;return Response.json({choices:[{message:b.tools?{tool_calls:[{function:{name:'gateway_capability_test',arguments:'{"value":"probe-ok"}'}}]}:{content:JSON.stringify(b).includes('image/png')?'blue':'OK'}}]});}});
try{const rows=[];for(let round=1;round<=3;round++)for(const mode of ['old-6-2','new-32-8','unified-32-8']){requests=0;peak=0;const start=performance.now(),signal=new AbortController().signal,base=`http://127.0.0.1:${server.port}`;if(mode==='unified-32-8')await runDetection(base,'fake',targets,DEFAULT_PREFERENCES,signal,()=>{});else await runProbeBatch(base,'fake',targets,{concurrency:mode==='old-6-2'?6:32,perModelConcurrency:mode==='old-6-2'?2:8,timeoutMs:30000,signal});rows.push({round,mode,ms:Math.round(performance.now()-start),requests,peak});}console.log(JSON.stringify({fixture:'15 models, identical 120 requests, loopback HTTP 40ms delay; no real gateway',rows},null,2));}finally{server.stop(true);}
