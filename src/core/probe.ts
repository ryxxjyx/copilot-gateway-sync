import {Capabilities,Model,Protocol,endpoint} from './models';
import {readJson} from './gateway';
import {testImage} from './test-image';
export interface ProbeResult{status:string;message:string;checkedAt:string;latencyMs:number;}
export interface FullResult{items:Record<string,ProbeResult>;checkedAt:string;protocol?:Protocol;}
export type ProbeKind='text'|'tools'|'image'|'effort';
export function effortCandidates(c:Capabilities){return c.supportsReasoningEffort?.length?c.supportsReasoningEffort:['low','medium','high','xhigh','max'];}
export interface ProbeJob{id:string;kind:ProbeKind;effort?:string;protocol?:Protocol;}
export function buildProbeJobs(c:Capabilities):ProbeJob[]{return [{id:'text',kind:'text'},{id:'tools',kind:'tools'},{id:'image',kind:'image'},...effortCandidates(c).map(e=>({id:'effort:'+e,kind:'effort' as const,effort:e}))];}
export function probeCount(c:Capabilities){return buildProbeJobs(c).length;}
export function requestBody(m:Model,c:Capabilities,kind:ProbeKind,effort?:string):any{
 const protocol=c.apiType;const text=kind==='image'?'Name the dominant color in this image. Answer one English color word.':kind==='tools'?'Call gateway_capability_test with value="probe-ok". Do not answer with text.':'Reply with OK.';
 const budget=Math.min(c.maxOutputTokens,kind==='effort'?1024:128);
 let body:any;
 if(protocol==='responses')body={model:m.id,input:[{role:'user',content:[{type:'input_text',text},...(kind==='image'?[{type:'input_image',image_url:'data:image/png;base64,'+testImage()}]:[])]}],max_output_tokens:budget,stream:false};
 else body={model:m.id,messages:[{role:'user',content:kind==='image'?(protocol==='messages'?[{type:'text',text},{type:'image',source:{type:'base64',media_type:'image/png',data:testImage()}}]:[{type:'text',text},{type:'image_url',image_url:{url:'data:image/png;base64,'+testImage()}}]):text}],max_tokens:budget,stream:false};
 if(kind==='tools'){
  const parameters={type:'object',properties:{value:{type:'string',enum:['probe-ok']}},required:['value'],additionalProperties:false};
  if(protocol==='messages'){body.tools=[{name:'gateway_capability_test',description:'Harmless test. This tool is never executed.',input_schema:parameters}];body.tool_choice={type:'tool',name:'gateway_capability_test'};}
  else if(protocol==='responses'){body.tools=[{type:'function',name:'gateway_capability_test',description:'Harmless test; never executed.',parameters,strict:true}];body.tool_choice={type:'function',name:'gateway_capability_test'};}
  else{body.tools=[{type:'function',function:{name:'gateway_capability_test',description:'Harmless test; never executed.',parameters}}];body.tool_choice={type:'function',function:{name:'gateway_capability_test'}};}
 }
 if(kind==='effort'&&effort){if(protocol==='messages')body.output_config={effort};else if(protocol==='responses')body.reasoning={effort};else body.reasoning_effort=effort;}
 return body;
}
export function inspectResponse(d:any,c:Capabilities,kind:ProbeKind):{status:string;message:string}{
 if(d?.error)return{status:'protocol',message:'网关返回错误对象'};
 if(d?.status==='incomplete'||d?.stop_reason==='max_tokens'||d?.choices?.some((v:any)=>v.finish_reason==='length'))return{status:'unconfirmed',message:'响应触及检测输出预算，不能确认能力'};
 if(kind==='tools'){
  const calls=c.apiType==='messages'?d.content?.filter((v:any)=>v.type==='tool_use').map((v:any)=>({name:v.name,args:v.input})):c.apiType==='responses'?d.output?.filter((v:any)=>v.type==='function_call').map((v:any)=>({name:v.name,args:v.arguments})):d.choices?.[0]?.message?.tool_calls?.map((v:any)=>({name:v.function?.name,args:v.function?.arguments}));
  const valid=calls?.some((call:any)=>{let args=call.args;try{if(typeof args==='string')args=JSON.parse(args);}catch{return false;}return call.name==='gateway_capability_test'&&args?.value==='probe-ok';});
  return valid?{status:'success',message:'工具结构及参数有效（未执行工具/未验证续接）'}:{status:'unconfirmed',message:'未返回有效测试工具调用'};
 }
 const text=c.apiType==='messages'?d.content?.filter((v:any)=>v.type==='text').map((v:any)=>v.text).join(''):c.apiType==='responses'?(d.output_text??d.output?.filter((v:any)=>v.type==='message').flatMap((v:any)=>v.content??[]).filter((v:any)=>v.type==='output_text').map((v:any)=>v.text).join('')):d.choices?.[0]?.message?.content;
 if(typeof text!=='string'||!text.trim())return{status:'unconfirmed',message:'无有效文本，可能输出预算不足或协议不匹配'};
 if(kind==='image')return /\bblue\b/i.test(text)?{status:'success',message:'正确识别合成测试图片颜色'}:{status:'unconfirmed',message:'图片请求返回，但颜色回答不符合预期'};
 return{status:'success',message:kind==='effort'?'档位请求完成（不能证明网关未忽略参数）':'文本调用成功'};
}
export async function probe(base:string,key:string,m:Model,c:Capabilities,signal?:AbortSignal,kind:ProbeKind='text',effort?:string,timeoutMs=30000):Promise<ProbeResult>{
 const start=Date.now();let timedOut=false;const controller=new AbortController();const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)controller.abort();
 const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
 const result=(status:string,message:string):ProbeResult=>({status,message,checkedAt:new Date().toISOString(),latencyMs:Date.now()-start});
 try{
  const headers:Record<string,string>={Authorization:`Bearer ${key}`,'Content-Type':'application/json'};if(c.apiType==='messages')headers['anthropic-version']='2023-06-01';
  const response=await fetch(endpoint(base,c.apiType),{method:'POST',headers,body:JSON.stringify(requestBody(m,c,kind,effort)),redirect:'error',signal:controller.signal});
  if(!response.ok){await response.body?.cancel();return result(response.status===401?'auth':response.status===403?'forbidden':response.status===429?'rate-limit':response.status>=500?'server':'unconfirmed',`HTTP ${response.status}（未将单次失败当成永久不支持）`);}
  const inspected=inspectResponse(await readJson(response,1024*1024),c,kind);return result(inspected.status,inspected.message);
 }catch{return result(signal?.aborted?'cancelled':timedOut?'timeout':'network',signal?.aborted?'已取消':timedOut?'请求超时':'网络或响应格式错误');}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
export async function probeFull(base:string,key:string,m:Model,c:Capabilities,signal:AbortSignal,onUpdate?:(r:FullResult)=>void):Promise<FullResult>{
 const r:FullResult={items:{},checkedAt:new Date().toISOString()};
 const jobs:[string,ProbeKind,string?][]=[['text','text'],['tools','tools'],['image','image'],...effortCandidates(c).map(e=>['effort:'+e,'effort',e] as [string,ProbeKind,string])];
 for(const [id,kind,effort]of jobs){if(signal.aborted)break;r.items[id]=await probe(base,key,m,c,signal,kind,effort);onUpdate?.(structuredClone(r));if(['auth','forbidden','rate-limit'].includes(r.items[id].status))break;}
 return r;
}
