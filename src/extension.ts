import './core/runtime';
import * as vscode from 'vscode';
import {randomUUID} from 'node:crypto';
import {fetchGatewayModels,errorText} from './core/gateway';
import {normalizeBaseUrl,validateCapabilities,DEFAULT_TEMPLATE,copilotModel,effectiveCapabilities,validId,gatewayLimits,withGatewayLimits} from './core/models';
import {Provider,Store} from './vscode/storage';
import {applyProvider,removeProviderModels} from './vscode/bridge';
import {probeCount,FullResult} from './core/probe';
import {runProbeBatch,BatchProgress} from './core/probe-runner';
import {runDetection,DetectionProgress,DetectionResult} from './core/detection-runner';
import {DEFAULT_PREFERENCES,ProbePreferences,validatePreferences} from './core/probe-preferences';
import {compareProtocols,recommendedCapabilities,ProtocolComparison} from './core/protocol-selection';
import {prepareApplication} from './core/application';
import {renderPage} from './webview';
export function activate(context:vscode.ExtensionContext){
 let feedback:{message:string;error:boolean}|undefined;
 let panel:vscode.WebviewPanel|undefined;let store:Store={providers:[]};let busy=false;let cancel:AbortController|undefined;
 const detections:Record<string,Record<string,DetectionResult>>={};
 const comparisons:Record<string,Record<string,ProtocolComparison>>={};
 const results:Record<string,Record<string,FullResult>>={};const output=vscode.window.createOutputChannel('Copilot Gateway Sync');
 let progress:(BatchProgress&Partial<DetectionProgress>&{providerId:string;timeoutMs:number})|undefined;let operation:{label:string;startedAt:number}|undefined;
 const preferences=()=>validatePreferences(context.globalState.get<Partial<ProbePreferences>>('probePreferences')??{});
 const state=()=>panel?.webview.postMessage({type:'state',version:context.extension.packageJSON.version,...store,results,comparisons,detections,feedback,detecting:!!cancel,busy,progress,operation,preferences:preferences()});
 const stage=(label:string)=>{operation={label,startedAt:Date.now()};panel?.webview.postMessage({type:'operation',operation});};
 const persist=async()=>{await context.globalState.update('store.v2',store);};
 const find=(id:any)=>{if(typeof id!=='string')throw Error('供应商ID无效');const p=store.providers.find(p=>p.id===id);if(!p)throw Error('请先保存供应商');return p;};
 const keyFor=async(p:Provider)=>{const k=await context.secrets.get('key.'+p.id);if(!k)throw Error('缺少API Key，请重新填写');return k;};
 let confirmHook:undefined|((text:string)=>Promise<boolean>);
 const requested=async(text:string)=>confirmHook?confirmHook(text):await vscode.window.showWarningMessage(text,{modal:true},'继续')==='继续';
 const withProgress=async<T>(title:string,task:(reporter:any,token:any)=>Promise<T>):Promise<T>=>{const fn=(vscode.window as any).withProgress;if(typeof fn!=='function')return task({report(){}},{isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})});const loc=(vscode.ProgressLocation as any)?.Notification??(vscode.ProgressLocation as any)?.Window??15;return fn.call(vscode.window,{location:loc,title,cancellable:true},task);};
 const sync=async(p:Provider)=>{
  if(!p.selected.length&&!p.binding)return {...p,syncError:undefined};
  const chosen=p.selected.map(id=>{const m=p.models.find(m=>m.id===id);if(!m)throw Error('所选模型缺少缓存，请刷新列表');return copilotModel(p.baseUrl,m,p.template,p.overrides[id]);});
  stage('正在写入 Copilot 模型配置');
  return {...await applyProvider(p,await keyFor(p),chosen),syncError:undefined};
 };
 const replace=async(p:Provider)=>{const next={...store,providers:store.providers.map(e=>e.id===p.id?p:e)};await context.globalState.update('store.v2',next);store=next;};
 const saveLocal=async(p:Provider)=>{await replace({...p,syncError:p.selected.length||p.binding?'本地已保存，等待同步':undefined});try{await replace(await sync(p));}catch(e){const message='本地已保存，Copilot未同步：'+errorText(e);await replace({...p,syncError:message});throw Error(message);}};
 const refresh=async(p:Provider)=>{
  stage('正在连接网关并获取模型列表');
  try{const remote=await fetchGatewayModels(p.baseUrl,await keyFor(p),'models');for(const model of remote){const previous=p.models.find(x=>x.id===model.id);if(previous&&JSON.stringify(effectiveCapabilities(previous,p.template,p.overrides[model.id]))!==JSON.stringify(effectiveCapabilities(model,p.template,p.overrides[model.id])))delete results[p.id]?.[model.id];}const missing=p.models.filter(m=>p.selected.includes(m.id)&&!remote.some(r=>r.id===m.id));p={...p,models:[...remote,...missing],lastRefresh:new Date().toISOString(),error:undefined};
   const next=await sync(p);await replace(next);
  }catch(e){await replace({...p,error:errorText(e)});throw e;}
 };
 const dispatch=async(m:any)=>{
  if(!m||typeof m.type!=='string')throw Error('请求格式无效');
  if(m.type==='load'){state();return;}
  if(m.type==='cancel'){cancel?.abort();return;}
  if(m.type==='selectProvider'){find(m.id);store.activeId=m.id;await persist();state();return;}
  if(busy)throw Error('操作进行中，请稍候');busy=true;feedback=undefined;operation={label:'正在处理',startedAt:Date.now()};state();
  try{
   if(m.type==='new'){store.activeId=undefined;state();return;}
   if(m.type==='save'){
    const old=m.id?find(m.id):undefined;const baseUrl=normalizeBaseUrl(m.baseUrl);
    if(typeof m.name!=='string'||!m.name.trim()||m.name.length>100)throw Error('供应商名称不能为空，最多100字符');
    const inputKey=typeof m.apiKey==='string'?m.apiKey.trim():'';const key=inputKey|| (old&&normalizeBaseUrl(old.baseUrl)===baseUrl?await keyFor(old):'');
    if(!key||/[^\x21-\x7e]/.test(key))throw Error('请输入有效Key，不要包含空格、中文或Bearer前缀');
    if(old?.binding&&(baseUrl!==normalizeBaseUrl(old.baseUrl)||key!==await keyFor(old)))throw Error('已绑定供应商不允许静默更换地址/密钥，请新建供应商并移除旧组中已选择模型');
    if(baseUrl.startsWith('http:')&&(!old?.httpApproved||old.baseUrl!==baseUrl)&&!(await requested('HTTP会明文传输API Key，确认使用此网关？')))throw Error('已取消');
    const template=validateCapabilities(m.template);const source='models' as const;
    if(old&&normalizeBaseUrl(old.baseUrl)===baseUrl){await replace({...old,template,templateConfirmed:!!m.templateConfirmed,syncError:'模板已本地保存，等待同步'});delete results[old.id];}
    stage('正在连接网关并获取模型列表');
    const models=await fetchGatewayModels(baseUrl,key,source);
    const p:Provider={...(old??{id:randomUUID(),selected:[],owned:[],overrides:{}}),name:m.name.trim(),baseUrl,source,providerId:undefined,automatic:!!m.automatic,interval:Math.max(5,Math.min(1440,Number(m.interval)||60)),httpApproved:baseUrl.startsWith('http:'),template,templateConfirmed:!!m.templateConfirmed,models,lastRefresh:new Date().toISOString(),error:undefined};
    const changed=old&&(JSON.stringify(old.template)!==JSON.stringify(template)||old.baseUrl!==baseUrl||inputKey);
    if(changed){delete results[p.id];delete comparisons[p.id];delete detections[p.id];}
    const updated=old?.binding?{...await applyProvider(p,key,p.selected.map(id=>{const model=models.find(x=>x.id===id)??old.models.find(x=>x.id===id);if(!model)throw Error('所选模型不在缓存中');return copilotModel(baseUrl,model,template,p.overrides[id]);})),syncError:undefined}:{...p,syncError:undefined};
    await context.secrets.store('key.'+p.id,key);
    store.providers=old?store.providers.map(x=>x.id===p.id?updated:x):[...store.providers,updated];store.activeId=p.id;await persist();
   }else if(m.type==='deleteProvider'){
    const p=find(m.id);
    if(!(await requested(`删除供应商“${p.name}”？将停止自动刷新，移除本扩展管理的${p.owned.length}个Copilot模型（当前选择${p.selected.length}个），删除本扩展保存的API Key和供应商记录。其他供应商及手动模型不变；清理后为空的绑定管理组及其apiKey配置引用将删除，仍有手动模型的组保留引用。Copilot密钥库中的独立凭据不由本扩展删除。此操作不可撤销。`))){feedback={message:'已取消删除供应商',error:false};return;}
    let phase='尚未修改';
    try{
     await replace({...p,automatic:false});phase='已停止自动刷新，尚未清理模型';stage('正在清理本扩展管理的模型');
     const cleanup=await removeProviderModels(p);phase='已清理管理模型及可删除的空组，尚未删除本扩展API Key';
     await replace({...p,automatic:false,selected:[],owned:[],syncError:undefined});
     await context.secrets.delete('key.'+p.id);phase='已清理模型及本扩展API Key，尚未删除供应商记录';
     const providers=store.providers.filter(x=>x.id!==p.id),next={...store,providers,activeId:store.activeId===p.id?providers[0]?.id:store.activeId};
     await context.globalState.update('store.v2',next);store=next;
     delete results[p.id];delete comparisons[p.id];delete detections[p.id];if(progress?.providerId===p.id)progress=undefined;
     feedback={message:`已删除供应商“${p.name}”及本扩展API Key，自动刷新已停止。${cleanup.groupRemoved?'Copilot空管理组及apiKey配置引用已删除。':cleanup.reason??''}`,error:false};
    }catch(e){throw Error(`删除未完成：${phase}。供应商记录保留，可排除问题后重试删除。${errorText(e)}`);}
   }else if(m.type==='refresh'){await refresh(find(m.id));}
   else if(m.type==='selection'){
    const p=find(m.id);if(!Array.isArray(m.ids)||!m.ids.every(validId))throw Error('模型选择格式无效');const ids=[...new Set<string>(m.ids)];if(ids.some(id=>!p.models.some(x=>x.id===id)))throw Error('模型不在缓存列表中');
    if(ids.length===0&&p.selected.length&&!(await requested('将从Copilot移除本扩展已添加的全部模型，继续？')))throw Error('已取消');
    if(ids.some(id=>!p.models.find(x=>x.id===id)?.capabilities&&!p.overrides[id])&&!p.templateConfirmed)throw Error('请先在连接设置中确认能力模板（这些参数不是网关实测结果）');
    const updated=await sync({...p,selected:ids});await replace(updated);
   }else if(m.type==='saveTemplate'){
    const p=find(m.id),template=validateCapabilities(m.template);delete results[p.id];await saveLocal({...p,template,templateConfirmed:!!m.templateConfirmed});
   }else if(m.type==='retrySync'){await saveLocal(find(m.id));}
   else if(m.type==='configure'){
    const p=find(m.id);if(!validId(m.modelId)||!p.models.some(x=>x.id===m.modelId))throw Error('无效模型');const c=validateCapabilities(m.capabilities);delete results[p.id]?.[m.modelId];await saveLocal({...p,overrides:{...p.overrides,[m.modelId]:c}});
   }else if(m.type==='applyVerified'){
    const p=find(m.id);const model=p.models.find(x=>x.id===m.modelId);const r=results[p.id]?.[m.modelId];if(!model||!r)throw Error('请先完成能力检测');
    const c=effectiveCapabilities(model,p.template,p.overrides[model.id]);const verified={...c,toolCalling:c.toolCalling||r.items.tools?.status==='success',vision:c.vision||r.items.image?.status==='success'};
    if(!(await requested('仅将已通过的工具/图片能力设为启用，未确认项保留原值；推理档位通过仅说明请求被接受，不自动宣称支持。继续？')))return;
    await replace(await sync({...p,overrides:{...p.overrides,[model.id]:verified}}));
   }else if(m.type==='restoreLimits'){
    const p=find(m.id),model=p.models.find(x=>x.id===m.modelId);if(!model)throw Error('模型不存在');const limits=model.capabilities??model.limits;if(!limits)throw Error('网关未提供最大限制，不能自动恢复');
    const c=effectiveCapabilities(model,p.template,p.overrides[model.id]);const next=withGatewayLimits(model,c);
    delete results[p.id]?.[model.id];await saveLocal({...p,overrides:{...p.overrides,[model.id]:next}});
   }else if(m.type==='maximizeLimits'){
    const p=find(m.id),overrides={...p.overrides},applied:string[]=[],skipped:string[]=[],preview:string[]=[];
    for(const model of p.models){if(!gatewayLimits(model)){skipped.push(model.id+'（上限未知）');continue;}try{const c=withGatewayLimits(model,p.overrides[model.id]??model.capabilities??p.template);overrides[model.id]=c;applied.push(model.id);preview.push(`${model.id}: 上下文 ${c.contextWindow} / 输入 ${c.maxInputTokens??'未知'} / 输出 ${c.maxOutputTokens}`);}catch{skipped.push(model.id+'（元数据组合无效，保留原值）');}}
    if(!applied.length)throw Error('没有可应用的网关上限。'+skipped.join('、'));
    if(!(await requested(`对当前供应商${applied.length}个模型应用网关声明上限（非实测），只替换网关已提供字段，覆盖对应手动限制。\n${preview.join('\n')}\n保留${skipped.length}项：${skipped.join('、')||'无'}。继续？`)))throw Error('已取消');
    delete results[p.id];await saveLocal({...p,overrides});
   }else if(m.type==='detect'){
    const p=find(m.id),models=p.models.filter(x=>Array.isArray(m.ids)&&m.ids.includes(x.id));if(!models.length)throw Error('未选择模型');const pref=validatePreferences(m.preferences??preferences());await context.globalState.update('probePreferences',pref);
    const targets=models.map(model=>({model,capabilities:effectiveCapabilities(model,p.template,p.overrides[model.id])})),maximum=targets.reduce((n,t)=>n+6+probeCount(t.capabilities),0);
    if(!(await requested(`检测${models.length}个模型，最多${maximum}次请求（按需回退协议，复用本轮结果）。全局${pref.concurrency}/同模型${pref.perModelConcurrency}并发，超时${pref.timeoutSeconds}秒；常规128/推理1024输出token，可能计费。高并发可能触发限流，不自动重试。继续？`)))return;
    cancel=new AbortController();state();const key=await keyFor(p);operation=undefined;detections[p.id]??={};comparisons[p.id]??={};results[p.id]??={};
    await withProgress('统一模型检测',async(reporter,token)=>{const sub=token.onCancellationRequested(()=>cancel?.abort());let timer:ReturnType<typeof setTimeout>|undefined,last=0,previous=0;const pending:Record<string,DetectionResult>={};
     const push=()=>{clearTimeout(timer);timer=undefined;last=Date.now();panel?.webview.postMessage({type:'detectionProgress',providerId:p.id,progress,patch:{...pending}});for(const id of Object.keys(pending))delete pending[id];const x=progress as DetectionProgress;const percent=x.total?(x.completed+x.skipped+x.omitted)/x.total*100:0;reporter.report({increment:Math.max(0,percent-previous),message:`已检测${x.completed}，省略${x.omitted}，跳过${x.skipped}，运行${x.running.length}`});previous=percent;};
     try{await runDetection(p.baseUrl,key,targets,pref,cancel!.signal,(update,patch)=>{progress={...update,providerId:p.id,timeoutMs:pref.timeoutSeconds*1000};for(const[id,r]of Object.entries(patch)){detections[p.id][id]=r;comparisons[p.id][id]=r.comparison;if(r.full.protocol===r.capabilities.apiType)results[p.id][id]=r.full;else delete results[p.id][id];pending[id]=r;}if(update.finishedAt||Date.now()-last>=100)push();else timer??=setTimeout(push,100-(Date.now()-last));});}finally{clearTimeout(timer);sub.dispose();}
    });
   }else if(m.type==='apply'||m.type==='remove'){
    const p=find(m.id),ids=p.models.filter(x=>Array.isArray(m.ids)&&m.ids.includes(x.id)).map(x=>x.id);if(!ids.length)throw Error('筛选范围为空');
    if(m.type==='remove'){const removed=p.selected.filter(id=>ids.includes(id));if(!removed.length)return;if(!(await requested(`从Copilot移除筛选范围${removed.length}个模型：${removed.join('、')}？`)))return;await saveLocal({...p,selected:p.selected.filter(id=>!ids.includes(id))});}
    else{const prepared=prepareApplication(p,ids,detections[p.id]);const {overrides,applied,skipped,preview}=prepared;
     if(!applied.length)throw Error('没有可应用的模型。\n'+skipped.join('\n'));
     if(!(await requested(`将应用并添加${applied.length}个模型，跳过${skipped.length}个；保留用户上限，只启用正向验证能力。\n${preview.join('\n')}\n${skipped.length?'跳过原因：\n'+skipped.join('\n'):''}\n继续？`))){feedback={message:'已取消应用，未修改配置',error:false};return;}
     await saveLocal({...p,overrides,selected:[...new Set([...p.selected,...applied])]});for(const id of applied){delete results[p.id]?.[id];delete detections[p.id]?.[id];delete comparisons[p.id]?.[id];}
     feedback={message:`已应用${applied.length}个模型；跳过${skipped.length}个。${skipped.length?'\n'+skipped.join('\n'):''}`,error:false};
    }
   }else if(m.type==='probePreferences'){
    await context.globalState.update('probePreferences',validatePreferences({concurrency:m.concurrency,timeoutSeconds:m.timeoutSeconds,...(m.perModelConcurrency!==undefined?{perModelConcurrency:m.perModelConcurrency}:{}),...(m.forceAllProtocols!==undefined?{forceAllProtocols:m.forceAllProtocols}:{})}));
   }else if(m.type==='applyProtocol'){
    const p=find(m.id),ids=Array.isArray(m.ids)?m.ids:[],overrides={...p.overrides},changes:string[]=[];
    for(const id of [...new Set<string>(ids)]){const model=p.models.find(x=>x.id===id),comparison=comparisons[p.id]?.[id];if(!model||!comparison)throw Error('请先完成协议比较');const c=effectiveCapabilities(model,p.template,p.overrides[id]);overrides[id]=recommendedCapabilities(comparison,c,p.baseUrl);changes.push(`${id}: ${c.apiType} → ${overrides[id].apiType}`);}
    if(!changes.length)throw Error('未选择推荐');if(!(await requested('仅更改API协议，保留上限及能力；推理档位未比较。\n'+changes.join('\n')+'\n应用到本地并同步已添加模型？')))return;
    for(const id of ids)delete results[p.id]?.[id];await saveLocal({...p,overrides});
   }else if(m.type==='probe'||m.type==='compareProtocols'){
    const comparing=m.type==='compareProtocols';
    const p=find(m.id);const ids=Array.isArray(m.ids)?m.ids:[];const models=p.models.filter(x=>ids.includes(x.id));if(!models.length)throw Error('未选择检测模型');
    const estimate=comparing?models.length*9:models.reduce((n,model)=>n+probeCount(effectiveCapabilities(model,p.template,p.overrides[model.id])),0);
    const pref=preferences();
    if(!(await requested(`${comparing?'三协议比较（文本/工具/图片，不比较推理）':'完整检测'}${models.length}个模型，最多${estimate}次请求；全局并发${pref.concurrency}、同模型跨协议最多2项，单项超时${pref.timeoutSeconds}秒。${comparing?'每项最多128':'常规128/推理1024'}输出token预算，可能计费，无自动重试。${pref.timeoutSeconds===15?'15秒可能过短，超时不代表不支持。':''}继续？`)))return;
    cancel=new AbortController();state();const key=await keyFor(p);results[p.id]??={};comparisons[p.id]??={};operation=undefined;
    await withProgress('网关模型能力检测',async(reporter,token)=>{
     const subscription=token.onCancellationRequested(()=>cancel?.abort());let previous=0,lastPush=0,pushTimer:ReturnType<typeof setTimeout>|undefined;
     const pending=new Map<string,FullResult>();
     const push=()=>{clearTimeout(pushTimer);pushTimer=undefined;lastPush=Date.now();panel?.webview.postMessage({type:comparing?'protocolProgress':'probeProgress',progress,providerId:p.id,patch:comparing?Object.fromEntries([...pending.keys()].map(id=>[id,comparisons[p.id][id]])):Object.fromEntries(pending)});pending.clear();};
     try{
      await runProbeBatch(p.baseUrl,key,models.map(model=>({model,capabilities:effectiveCapabilities(model,p.template,p.overrides[model.id])})),{protocolComparison:comparing,concurrency:pref.concurrency,timeoutMs:pref.timeoutSeconds*1000,signal:cancel!.signal,onUpdate:(update,batch,changed)=>{
       progress={...update,providerId:p.id,timeoutMs:pref.timeoutSeconds*1000};if(comparing){for(const [id,r]of Object.entries(batch)){const model=models.find(x=>x.id===id)!;comparisons[p.id][id]=compareProtocols(r,effectiveCapabilities(model,p.template,p.overrides[id]),p.baseUrl,!!update.finishedAt&&!update.reason);}}else Object.assign(results[p.id],batch);
       if(changed)pending.set(changed,batch[changed]);else for(const [id,r]of Object.entries(batch))pending.set(id,r);
       const percent=update.total?(update.completed+update.skipped)/update.total*100:0;
       reporter.report({increment:Math.max(0,percent-previous),message:`完成 ${update.completed}/${update.total}，跳过 ${update.skipped}，运行 ${update.running.length} · ${update.reason??'检测中'}`});previous=percent;
       if(update.finishedAt||Date.now()-lastPush>=100)push();else pushTimer??=setTimeout(push,100-(Date.now()-lastPush));
      }});
     }finally{subscription.dispose();push();}
    });
   }else if(m.type==='openConfig'){const p=find(m.id);if(p.binding)await vscode.window.showTextDocument(vscode.Uri.file(p.binding.file));}
   else if(m.type==='logs'){output.show();}
   else throw Error('未知操作');
  }finally{busy=false;operation=undefined;cancel=undefined;state();}
 };
 const safe=async(m:any)=>{let response:{ok:boolean;error?:string};try{await dispatch(m);response={ok:true};}catch(e){const message=errorText(e);feedback={message,error:true};output.appendLine(new Date().toISOString()+' '+message);panel?.webview.postMessage({type:'error',message,requestId:m?.requestId});response={ok:false,error:message};}if(m?.requestId)panel?.webview.postMessage({type:'actionResult',requestId:m.requestId,...response});return response;};
 const open=async()=>{
  if(panel){panel.reveal();return;}
  panel=vscode.window.createWebviewPanel('gatewaySync','网关模型管理',vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[vscode.Uri.joinPath(context.extensionUri,'media')]});
  panel.webview.html=renderPage(panel.webview,context.extensionUri);
  panel.onDidDispose(()=>panel=undefined,undefined,context.subscriptions);panel.webview.onDidReceiveMessage(m=>void safe(m),undefined,context.subscriptions);
 };
 // Register before reading persistent state or starting any network activity.
 context.subscriptions.push(output,vscode.commands.registerCommand('gatewaySync.open',open),vscode.commands.registerCommand('gatewaySync.sync',()=>{const p=store.providers.find(x=>x.id===store.activeId);return p?safe({type:'refresh',id:p.id}):open();}));
 store=context.globalState.get<Store>('store.v2')??{providers:[]};store={...store,providers:store.providers.map(p=>({...p,source:'models',providerId:undefined}))};
 let ticking=false;const tick=async()=>{if(busy||ticking)return;ticking=true;try{for(const id of store.providers.map(p=>p.id)){const p=store.providers.find(p=>p.id===id);if(p?.automatic&&(!p.lastRefresh||Date.now()-Date.parse(p.lastRefresh)>p.interval*60000)){busy=true;try{await refresh(p);}catch(e){output.appendLine(errorText(e));}finally{busy=false;operation=undefined;state();}}}}finally{ticking=false;}};
 const timer=setInterval(()=>void tick(),60000);const startup=setTimeout(()=>void tick(),3000);
 context.subscriptions.push({dispose(){clearInterval(timer);clearTimeout(startup);cancel?.abort();panel?.dispose();}});
 // Isolated integration harness calls the same handlers; unavailable as a user command.
 return (context.extensionMode===vscode.ExtensionMode?.Development||context.extensionMode===vscode.ExtensionMode?.Test)&&context.extensionMode!==undefined?{dispatch:safe,state:()=>structuredClone(store),diagnostics:()=>structuredClone({busy,progress,results,comparisons,detections,preferences:preferences()}),setConfirmForTest:(fn:(text:string)=>Promise<boolean>)=>confirmHook=fn}:undefined;
}
