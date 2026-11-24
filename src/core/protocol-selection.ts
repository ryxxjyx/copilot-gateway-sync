import {Capabilities,Protocol} from './models';
import {FullResult,ProbeJob} from './probe';
export const PROTOCOLS:Protocol[]=['chat-completions','responses','messages'];
export function protocolJobs():ProbeJob[]{return PROTOCOLS.flatMap(protocol=>(['text','tools','image'] as const).map(kind=>({id:protocol+':'+kind,kind,protocol})));}
export interface ProtocolComparison{result:FullResult;capabilities:Capabilities;baseUrl:string;complete:boolean;recommendation?:Protocol;reason:string;}
export function compareProtocols(result:FullResult,c:Capabilities,baseUrl:string,complete:boolean):ProtocolComparison{
 const comparison:ProtocolComparison={result,capabilities:structuredClone(c),baseUrl,complete,reason:'比较尚未完整结束，不能推荐'};
 if(!complete)return comparison;
 const rows=PROTOCOLS.map(protocol=>{const items=['text','tools','image'].map(kind=>result.items[protocol+':'+kind]);const valid=items[0]?.status==='success'&&(!c.toolCalling||items[1]?.status==='success')&&(!c.vision||items[2]?.status==='success');return{protocol,items,valid,passed:items.filter(i=>i?.status==='success').length};}).filter(r=>r.valid);
 if(!rows.length)return {...comparison,reason:'没有协议通过文本及当前声明的必需能力；超时不等于永久不支持'};
 const best=Math.max(...rows.map(r=>r.passed)),candidates=rows.filter(r=>r.passed===best);
 const shared=[0,1,2].filter(i=>candidates.every(r=>r.items[i]?.status==='success'));
 const latency=(r:typeof candidates[number])=>shared.reduce((n,i)=>n+r.items[i].latencyMs,0)/shared.length;
 candidates.sort((a,b)=>latency(a)-latency(b)||PROTOCOLS.indexOf(a.protocol)-PROTOCOLS.indexOf(b.protocol));
 const current=candidates.find(r=>r.protocol===c.apiType),fastest=candidates[0];const selected=current&&latency(current)<=latency(fastest)*1.2?current:fastest;
 return {...comparison,recommendation:selected.protocol,reason:`通过必需能力及${best}/3项检查；相同能力按共同成功项目耗时比较，20%内优先现有协议。单轮结果不保证长期最快；未比较推理档位。`};
}
export function recommendedCapabilities(comparison:ProtocolComparison,c:Capabilities,baseUrl:string){
 if(!comparison.complete||!comparison.recommendation)throw Error('无可应用的完整推荐');
 if(comparison.baseUrl!==baseUrl||JSON.stringify(comparison.capabilities)!==JSON.stringify(c))throw Error('配置已变化，请重新比较协议');
 if(c.apiType!==comparison.recommendation&&c.defaultReasoningEffort)throw Error('新协议未验证默认推理档位，请先清除默认思维级别后重新比较');
 return {...c,apiType:comparison.recommendation};
}
