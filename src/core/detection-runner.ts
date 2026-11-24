import {Capabilities,Protocol} from './models';
import {FullResult,ProbeJob,ProbeResult,effortCandidates,probe} from './probe';
import {ProbeTarget,BatchProgress} from './probe-runner';
import {ProbePreferences} from './probe-preferences';
import {protocolJobs,compareProtocols,ProtocolComparison} from './protocol-selection';
export interface DetectionResult{capabilities:Capabilities;baseUrl:string;full:FullResult;comparison:ProtocolComparison;complete:boolean;}
export interface DetectionProgress extends BatchProgress{omitted:number;concurrency:number;perModelConcurrency:number;}
export async function runDetection(base:string,key:string,targets:ProbeTarget[],pref:ProbePreferences,signal:AbortSignal,onUpdate:(p:DetectionProgress,patch:Record<string,DetectionResult>)=>void,execute?:(t:ProbeTarget,j:ProbeJob,s:AbortSignal)=>Promise<ProbeResult>){
 const groups=targets.map(target=>({target,jobs:protocolJobs(),running:0,stage:'current',protocol:target.capabilities.apiType,items:{} as Record<string,ProbeResult>,efforts:effortCandidates(target.capabilities),reserved:effortCandidates(target.capabilities).length,blocked:new Set<Protocol>(),textDone:new Set<Protocol>(),textStarted:new Set<Protocol>()}));
 const out:Record<string,DetectionResult>={},running=new Map<string,{modelId:string;jobId:string;startedAt:number}>();
 const p:DetectionProgress={total:groups.reduce((n,g)=>n+9+g.reserved,0),completed:0,skipped:0,omitted:0,passed:0,unconfirmed:0,failed:0,queued:0,startedAt:Date.now(),running:[],perModel:{},concurrency:pref.concurrency,perModelConcurrency:pref.perModelConcurrency};
 for(const g of groups){p.perModel[g.target.model.id]={total:9+g.reserved,completed:0,skipped:0};out[g.target.model.id]={capabilities:structuredClone(g.target.capabilities),baseUrl:base,complete:false,full:{items:{},checkedAt:new Date().toISOString()},comparison:compareProtocols({items:{},checkedAt:new Date().toISOString()},g.target.capabilities,base,false)};}
 const controller=new AbortController();let stopped=false,cursor=0;
 const emit=(id?:string)=>{p.running=[...running.values()];p.queued=groups.reduce((n,g)=>n+g.jobs.length+g.reserved,0);onUpdate(structuredClone(p),structuredClone(id?{[id]:out[id]}:out));};
 const finishBranch=(g:typeof groups[number])=>{
  const id=g.target.model.id,r=out[id];r.comparison.result.items={...g.items};
  if(g.running)return;
  if(g.stage==='current'&&!g.jobs.some(j=>j.protocol===g.protocol)){
   const passed=['text','tools','image'].every(k=>g.items[g.protocol+':'+k]?.status==='success');
   if(passed&&!pref.forceAllProtocols){const count=g.jobs.length;p.omitted+=count;g.jobs=[];r.comparison={...r.comparison,complete:true,recommendation:g.protocol,reason:'当前协议三项通过；其他协议按策略省略，未比较其速度/能力。'};g.stage='effort';}
   else g.stage='alternatives';
  }
  if(g.stage==='alternatives'&&!g.jobs.length){r.comparison=compareProtocols({items:{...g.items},checkedAt:new Date().toISOString()},g.target.capabilities,base,true);g.protocol=r.comparison.recommendation??g.target.capabilities.apiType;g.stage='effort';}
  if(g.stage==='effort'&&g.reserved){
   r.full={protocol:g.protocol,checkedAt:new Date().toISOString(),items:Object.fromEntries(['text','tools','image'].filter(k=>g.items[g.protocol+':'+k]).map(k=>[k,g.items[g.protocol+':'+k]]))};
   if(g.blocked.has(g.protocol)){p.skipped+=g.reserved;p.perModel[id].skipped+=g.reserved;g.reserved=0;}
   else{g.jobs=g.efforts.map(e=>({id:g.protocol+':effort:'+e,kind:'effort',effort:e,protocol:g.protocol}));g.reserved=0;}
  }
  if(g.stage==='effort'&&!g.jobs.length&&!g.running){g.stage='done';r.complete=true;}
 };
 const stop=(reason:string,abort=false)=>{if(abort)controller.abort();if(stopped)return;stopped=true;p.reason=reason;for(const g of groups){if(g.stage==='done')continue;const n=g.jobs.length+g.reserved;p.skipped+=n;p.perModel[g.target.model.id].skipped+=n;g.jobs=[];g.reserved=0;out[g.target.model.id].complete=false;out[g.target.model.id].comparison.complete=false;out[g.target.model.id].comparison.recommendation=undefined;out[g.target.model.id].comparison.reason=reason;}emit();};
 const cancel=()=>stop('用户取消',true);signal.addEventListener('abort',cancel,{once:true});
 const eligible=(g:typeof groups[number],j:ProbeJob)=>{if(g.stage==='current'&&j.protocol!==g.target.capabilities.apiType)return false;if(g.stage==='effort')return true;return j.kind==='text'||g.textDone.has(j.protocol!);};
 await new Promise<void>(resolve=>{
  const pump=()=>{
   if(signal.aborted&&!stopped)cancel();
   while(!stopped&&running.size<pref.concurrency){let selected:typeof groups[number]|undefined,index=-1;
    for(let i=0;i<groups.length;i++){const at=(cursor+i)%groups.length,g=groups[at];if(g.running>=pref.perModelConcurrency)continue;const j=g.jobs.findIndex(j=>eligible(g,j));if(j>=0){selected=g;index=j;cursor=(at+1)%groups.length;break;}}
    if(!selected)break;const g=selected,j=g.jobs.splice(index,1)[0],id=g.target.model.id,k=id+'\0'+j.id;g.running++;running.set(k,{modelId:id,jobId:j.id,startedAt:Date.now()});emit(id);
    void (async()=>{let result:ProbeResult;try{result=await(execute?execute(g.target,j,controller.signal):probe(base,key,g.target.model,{...g.target.capabilities,apiType:j.protocol!},controller.signal,j.kind,j.effort,pref.timeoutSeconds*1000));}catch{result={status:controller.signal.aborted?'cancelled':'network',message:'请求取消或失败',latencyMs:0,checkedAt:new Date().toISOString()};}
     g.running--;running.delete(k);g.items[j.id]=result;p.completed++;p.perModel[id].completed++;if(result.status==='success')p.passed++;else if(result.status==='unconfirmed')p.unconfirmed++;else p.failed++;
     if(j.kind==='text')g.textDone.add(j.protocol!);if(j.kind==='effort')out[id].full.items['effort:'+j.effort]=result;
     if(result.status==='auth'||result.status==='rate-limit')stop(result.status==='auth'?'认证失败，停止新增请求':'网关限流，停止新增请求（无重试）');
     else if(result.status==='forbidden'){g.blocked.add(j.protocol!);const skipped=g.jobs.filter(job=>job.protocol===j.protocol).length;g.jobs=g.jobs.filter(job=>job.protocol!==j.protocol);p.skipped+=skipped;p.perModel[id].skipped+=skipped;}
     if(!stopped)finishBranch(g);else out[id].comparison.result.items={...g.items};emit(id);pump();
    })();
   }
   if(!running.size&&(stopped||groups.every(g=>g.stage==='done'))){resolve();}
  };
  if(signal.aborted)cancel();pump();
 });
 signal.removeEventListener('abort',cancel);p.finishedAt=Date.now();emit();return{progress:p,results:out};
}
