import {Capabilities,Model,effectiveCapabilities} from './models';
import {DetectionResult} from './detection-runner';
import {recommendedCapabilities} from './protocol-selection';
export function prepareApplication(provider:{baseUrl:string;template:Capabilities;templateConfirmed:boolean;overrides:Record<string,Capabilities>;models:Model[]},ids:string[],detections:Record<string,DetectionResult>={}){
 const overrides={...provider.overrides},applied:string[]=[],skipped:string[]=[],preview:string[]=[];
 for(const id of ids){try{
  const model=provider.models.find(m=>m.id===id);if(!model)throw Error('模型不存在');
  const c=effectiveCapabilities(model,provider.template,provider.overrides[id]),r=detections[id];let next=c;
  if(r){if(!r.complete)throw Error('本模型检测被中断，请重新检测');if(r.baseUrl!==provider.baseUrl||JSON.stringify(r.capabilities)!==JSON.stringify(c))throw Error('配置已变化，请重新检测');if(r.comparison.recommendation)next=recommendedCapabilities(r.comparison,c,provider.baseUrl);if(r.full.protocol===next.apiType)next={...next,toolCalling:next.toolCalling||r.full.items.tools?.status==='success',vision:next.vision||r.full.items.image?.status==='success'};}
  else if(!model.capabilities&&!provider.overrides[id]&&!provider.templateConfirmed)throw Error('未检测，请先确认能力模板');
  overrides[id]=next;applied.push(id);preview.push(`${id}: ${c.apiType} → ${next.apiType}（${r?'本轮检测':'未检测，用户/网关声明'}）`);
 }catch(e){skipped.push(`${id}：${e instanceof Error?e.message:String(e)}`);}}
 return{overrides,applied,skipped,preview};
}
