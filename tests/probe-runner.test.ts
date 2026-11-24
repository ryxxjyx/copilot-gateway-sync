import {test,expect} from 'bun:test';
import {runProbeBatch,ProbeTarget} from '../src/core/probe-runner';
import {parseModels} from '../src/core/models';
// Explicit legacy fixture keeps protocol/limit regressions independent of UI defaults.
const DEFAULT_TEMPLATE={apiType:'chat-completions' as const,toolCalling:false,vision:false,thinking:false,contextWindow:32768,maxOutputTokens:4096,supportsReasoningEffort:undefined as string[]|undefined};
import {probe,effortCandidates,inspectResponse} from '../src/core/probe';
const targets=(n=4):ProbeTarget[]=>parseModels(Array.from({length:n},(_,i)=>'model-'+i)).map(model=>({model,capabilities:DEFAULT_TEMPLATE}));
const result=(status='success')=>({status,message:status,checkedAt:new Date().toISOString(),latencyMs:1});
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test('global four / per-model two, text gate, fair queue, monotonic counts and no lost results',async()=>{
 let running=0,max=0,last=0;const per:Record<string,number>={},peak:Record<string,number>={},text=new Set<string>(),order:string[]=[];
 const r=await runProbeBatch('http://unused','fake',targets(),{perModelConcurrency:2,concurrency:4,timeoutMs:1000,signal:new AbortController().signal,
  async execute(t,j){const id=t.model.id;if(j.id!=='text')expect(text.has(id)).toBe(true);order.push(id);running++;per[id]=(per[id]||0)+1;max=Math.max(max,running);peak[id]=Math.max(peak[id]||0,per[id]);await delay(5);if(j.id==='text')text.add(id);running--;per[id]--;return result();},
  onUpdate(p){expect(p.completed+p.skipped).toBeGreaterThanOrEqual(last);last=p.completed+p.skipped;expect(p.completed+p.skipped+p.running.length+p.queued).toBe(p.total);expect(p.passed+p.unconfirmed+p.failed).toBe(p.completed);}
 });
 expect(max).toBe(4);expect(Object.values(peak).every(v=>v<=2)).toBe(true);expect(new Set(order.slice(0,4)).size).toBe(4);expect(r.progress.completed).toBe(32);expect(r.progress.finishedAt).toBeDefined();for(const value of Object.values(r.results))expect(Object.keys(value.items).length).toBe(8);
});
test('single model actually uses two slots after text',async()=>{let running=0,max=0;await runProbeBatch('http://unused','fake',targets(1),{perModelConcurrency:2,concurrency:4,timeoutMs:1000,signal:new AbortController().signal,async execute(){max=Math.max(max,++running);await delay(5);running--;return result();}});expect(max).toBe(2);});
for(const status of ['auth','rate-limit','forbidden'])test(`${status} stops the right queues without retries`,async()=>{
 let calls=0;const r=await runProbeBatch('http://unused','fake',targets(2),{concurrency:1,timeoutMs:1000,signal:new AbortController().signal,async execute(t){calls++;return result(t.model.id==='model-0'?status:'success');}});
 expect(calls).toBe(status==='forbidden'?9:1);expect(r.progress.completed+r.progress.skipped).toBe(16);expect(r.progress.running.length).toBe(0);expect(r.results['model-0'].items.tools.status).toBe('skipped');
});
test('ordinary text failure still runs other checks',async()=>{const r=await runProbeBatch('http://unused','fake',targets(1),{perModelConcurrency:2,concurrency:4,timeoutMs:1000,signal:new AbortController().signal,async execute(t,j){return result(j.kind==='text'?'server':'unconfirmed');}});expect(r.progress.completed).toBe(8);expect(r.progress.unconfirmed).toBe(7);});
test('cancel aborts all in-flight requests and never starts queued jobs',async()=>{
 const c=new AbortController();let calls=0,aborted=0;const run=runProbeBatch('http://unused','fake',targets(),{perModelConcurrency:2,concurrency:4,timeoutMs:1000,signal:c.signal,execute:async(t,j,s)=>{calls++;return new Promise(resolve=>s.addEventListener('abort',()=>{aborted++;resolve(result('cancelled'));},{once:true}));}});c.abort();const r=await run;expect(calls).toBe(4);expect(aborted).toBe(4);expect(r.progress.skipped).toBe(28);expect(r.progress.completed).toBe(4);
});
test('cancel still aborts in-flight jobs after rate limit stops scheduling',async()=>{
 const c=new AbortController();let aborted=0;const r=await runProbeBatch('http://unused','fake',targets(2),{perModelConcurrency:2,concurrency:4,timeoutMs:1000,signal:c.signal,execute:async(t,j,s)=>t.model.id==='model-0'?result('rate-limit'):new Promise(resolve=>s.addEventListener('abort',()=>{aborted++;resolve(result('cancelled'));})),onUpdate(p){if(p.reason)c.abort();}});expect(aborted).toBe(1);expect(r.progress.completed+r.progress.skipped).toBe(16);
});
test('pre-cancelled signal makes zero requests',async()=>{const c=new AbortController();c.abort();let calls=0;const r=await runProbeBatch('http://unused','fake',targets(),{perModelConcurrency:2,concurrency:4,timeoutMs:1000,signal:c.signal,async execute(){calls++;return result();}});expect(calls).toBe(0);expect(r.progress.skipped).toBe(32);});
test('real local HTTP timeout and cancellation stay distinct',async()=>{
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(){await delay(150);return Response.json({choices:[{message:{content:'OK'}}]});}});
 try{const base=`http://127.0.0.1:${server.port}`,m=targets(1)[0].model;expect((await probe(base,'fake',m,DEFAULT_TEMPLATE,undefined,'text',undefined,20)).status).toBe('timeout');const c=new AbortController();const pending=probe(base,'fake',m,DEFAULT_TEMPLATE,c.signal,'text',undefined,1000);c.abort();expect((await pending).status).toBe('cancelled');expect((await probe(base,'fake',m,DEFAULT_TEMPLATE,undefined,'text',undefined,1000)).status).toBe('success');}finally{server.stop(true);}
});
test('xhigh/max remain candidates, successful effort requests do not prove parameter support',()=>{expect(effortCandidates(DEFAULT_TEMPLATE)).toEqual(['low','medium','high','xhigh','max']);expect(DEFAULT_TEMPLATE.supportsReasoningEffort).toBeUndefined();expect(inspectResponse({choices:[{message:{content:'OK'}}]},DEFAULT_TEMPLATE,'effort').message).toContain('不能证明');});
