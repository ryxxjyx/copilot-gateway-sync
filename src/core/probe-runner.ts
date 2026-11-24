import {protocolJobs} from './protocol-selection';
import {Capabilities,Model} from './models';
import {buildProbeJobs,FullResult,probe,ProbeJob,ProbeResult} from './probe';
export interface ProbeTarget{model:Model;capabilities:Capabilities;}
export interface RunningJob{modelId:string;jobId:string;startedAt:number;}
export interface BatchProgress{
 total:number;completed:number;skipped:number;passed:number;unconfirmed:number;failed:number;
 startedAt:number;finishedAt?:number;reason?:string;running:RunningJob[];queued:number;
 perModel:Record<string,{total:number;completed:number;skipped:number}>;
}
export interface BatchOptions{perModelConcurrency?:number;protocolComparison?:boolean;concurrency:number;timeoutMs:number;signal:AbortSignal;onUpdate?:(progress:BatchProgress,results:Record<string,FullResult>,changedId?:string)=>void;
 execute?:(target:ProbeTarget,job:ProbeJob,signal:AbortSignal)=>Promise<ProbeResult>;}
export async function runProbeBatch(base:string,key:string,targets:ProbeTarget[],options:BatchOptions){
 const limit=Math.max(1,Math.min(128,Math.floor(options.concurrency)||32)),modelLimit=Math.max(1,Math.min(32,Math.floor(options.perModelConcurrency??8)));
 const groups=targets.map(target=>({target,pending:options.protocolComparison?protocolJobs():buildProbeJobs(target.capabilities),running:0,textDone:new Set<string>(),blocked:false}));
 const results:Record<string,FullResult>={};const running=new Map<string,RunningJob>();
 const progress:BatchProgress={total:groups.reduce((n,g)=>n+g.pending.length,0),completed:0,skipped:0,passed:0,unconfirmed:0,failed:0,startedAt:Date.now(),running:[],queued:0,perModel:{}};
 for(const g of groups){results[g.target.model.id]={items:{},checkedAt:new Date().toISOString()};progress.perModel[g.target.model.id]={total:g.pending.length,completed:0,skipped:0};}
 const waiters=new Set<()=>void>();const notify=()=>{for(const resolve of waiters)resolve();waiters.clear();};
 let cursor=0,stopped=false;const controller=new AbortController();
 const snapshot=(changed?:string)=>{progress.running=[...running.values()];progress.queued=groups.reduce((n,g)=>n+g.pending.length,0);options.onUpdate?.(structuredClone(progress),structuredClone(changed?{[changed]:results[changed]}:results),changed);};
 const skip=(g:typeof groups[number],reason:string)=>{const count=g.pending.length;for(const job of g.pending)results[g.target.model.id].items[job.id]={status:'skipped',message:reason,latencyMs:0,checkedAt:new Date().toISOString()};g.pending=[];g.blocked=true;progress.skipped+=count;progress.perModel[g.target.model.id].skipped+=count;};
 const stop=(reason:string,abort=false)=>{if(abort)controller.abort();if(stopped)return;stopped=true;progress.reason=reason;for(const g of groups)skip(g,reason);snapshot();notify();};
 const cancel=()=>stop('用户取消，未启动项目已跳过',true);options.signal.addEventListener('abort',cancel,{once:true});
 if(options.signal.aborted)cancel();
 const eligible=(job:ProbeJob,g:typeof groups[number])=>job.kind==='text'||g.textDone.has(job.protocol??'current');
 const pick=()=>{if(stopped)return;for(let i=0;i<groups.length;i++){const index=(cursor+i)%groups.length,g=groups[index];if(g.blocked||g.running>=modelLimit||!g.pending.some(job=>eligible(job,g)))continue;cursor=(index+1)%groups.length;return g;}};
 const worker=async()=>{
  for(;;){const g=pick();if(!g){if(stopped||!groups.some(x=>x.pending.length)||running.size===0)return;await new Promise<void>(resolve=>waiters.add(resolve));continue;}
   const job=g.pending.splice(g.pending.findIndex(job=>eligible(job,g)),1)[0];g.running++;const id=g.target.model.id,jobKey=id+'\0'+job.id;
   running.set(jobKey,{modelId:id,jobId:job.id,startedAt:Date.now()});snapshot(id);
   let result:ProbeResult;
   try{result=await (options.execute?options.execute(g.target,job,controller.signal):probe(base,key,g.target.model,{...g.target.capabilities,apiType:job.protocol??g.target.capabilities.apiType},controller.signal,job.kind,job.effort,options.timeoutMs));}
   catch{result={status:'network',message:'检测执行失败',checkedAt:new Date().toISOString(),latencyMs:0};}
   results[id].items[job.id]=result;g.running--;running.delete(jobKey);if(job.kind==='text')g.textDone.add(job.protocol??'current');
   progress.completed++;progress.perModel[id].completed++;
   if(result.status==='success')progress.passed++;else if(result.status==='unconfirmed')progress.unconfirmed++;else progress.failed++;
   if(result.status==='auth')stop('认证失败，已停止新增请求');
   else if(result.status==='rate-limit')stop('网关限流，已停止新增请求（不自动重试）');
   else if(result.status==='forbidden'){if(!job.protocol)skip(g,'模型无权限，剩余项目已跳过');else{const pending=g.pending.filter(j=>j.protocol===job.protocol);g.pending=g.pending.filter(j=>j.protocol!==job.protocol);for(const j of pending)results[id].items[j.id]={status:'skipped',message:'该协议权限失败，未确认其他协议权限',latencyMs:0,checkedAt:new Date().toISOString()};progress.skipped+=pending.length;progress.perModel[id].skipped+=pending.length;}}
   snapshot(id);notify();
  }
 };
 // Start waves; a text gate can temporarily leave slots free until a model unlocks.
 try{
  while(!stopped&&groups.some(g=>g.pending.length)){
   await Promise.all(Array.from({length:limit},worker));
   if(!pick())break;
  }
 }finally{
  options.signal.removeEventListener('abort',cancel);progress.finishedAt=Date.now();snapshot();
 }
 return {progress,results};
}
