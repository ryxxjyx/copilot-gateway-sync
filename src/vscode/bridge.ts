import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {modify,applyEdits} from 'jsonc-parser';
import {Provider} from './storage';
import {backup,atomicWrite,withFileLock} from '../core/files';
import {decode,reconcile,endpointOwnedIds} from '../core/sync';
const secretRef=(value:any)=>typeof value==='string'&&/^\$\{input:chat\.lm\.secret\.[^}]+\}$/.test(value);
export async function activeModelFile():Promise<string>{
 const commands=await vscode.commands.getCommands(true);
 if(!commands.includes('workbench.action.openLanguageModelsJson'))throw Error('当前VS Code缺少模型配置命令，请使用受支持的桌面版本');
 await vscode.commands.executeCommand('workbench.action.openLanguageModelsJson');
 let doc=vscode.window.activeTextEditor?.document;
 for(let attempt=0;attempt<40;attempt++){
  doc=vscode.window.activeTextEditor?.document;
  if(doc&&['file','vscode-userdata'].includes(doc.uri.scheme)&&path.basename(doc.uri.fsPath)==='chatLanguageModels.json')break;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 if(!doc||!['file','vscode-userdata'].includes(doc.uri.scheme)||path.basename(doc.uri.fsPath)!=='chatLanguageModels.json')throw Error('未能确定当前profile的模型配置文件，请先在VS Code打开“语言模型(JSON)”');
 if(doc.isDirty)throw Error('模型配置有未保存编辑，请先保存或撤销');
 return doc.uri.fsPath;
}
function checkDirty(file:string){if(vscode.workspace.textDocuments.some(d=>['file','vscode-userdata'].includes(d.uri.scheme)&&d.uri.fsPath.toLowerCase()===file.toLowerCase()&&d.isDirty))throw Error('模型配置文件有未保存更改，请先处理');}
export interface RemoveProviderResult{groupRemoved:boolean;apiKeyRetained:boolean;reason?:string;}
export async function removeProviderModels(provider:Provider):Promise<RemoveProviderResult>{
 const binding=provider.binding;if(!binding)return{groupRemoved:false,apiKeyRetained:false};const file=binding.file;checkDirty(file);
 return withFileLock(file,async()=>{const raw=fs.readFileSync(file,'utf8');const data=decode(raw);const matches=data.map((g:any,i:number)=>({g,i})).filter(({g})=>g?.vendor==='customendpoint'&&g?.name===binding.group);
  if(matches.length===0)return{groupRemoved:false,apiKeyRetained:false,reason:'管理组已不存在'};
  if(matches.length!==1)throw Error('管理组名称冲突，未继续删除');const {g,i}=matches[0];if(g.apiKey!==binding.reference)throw Error('Copilot密钥引用已变化，请停止删除并检查配置');if(!Array.isArray(g.models))throw Error('管理组models无效');
  const managed=new Set<string>(endpointOwnedIds(g,provider.baseUrl,provider.owned)),unowned=g.models.filter((m:any)=>!managed.has(m.id));
  if(unowned.length){const result=reconcile(raw,binding.group,binding.reference,[...managed],[],provider.baseUrl);checkDirty(file);if(result.text!==raw)await atomicWrite(file,raw,result.text);return{groupRemoved:false,apiKeyRetained:true,reason:`保留API Key引用：管理组仍有${unowned.length}个非本扩展模型`};}
  const text=applyEdits(raw,modify(raw,[i],undefined,{formattingOptions:{insertSpaces:!raw.includes('\n\t'),tabSize:2,eol:raw.includes('\r\n')?'\r\n':'\n'}}));decode(text);checkDirty(file);await atomicWrite(file,raw,text);return{groupRemoved:true,apiKeyRetained:false};});
}
export async function applyProvider(provider:Provider,key:string,wanted:any[]):Promise<Provider>{
 const file=provider.binding?.file??await activeModelFile();checkDirty(file);
 return withFileLock(file,async()=>{
  let binding=provider.binding;
  if(!binding){
   const copilot=vscode.extensions.getExtension('GitHub.copilot-chat');
   if(copilot&&!copilot.isActive)await copilot.activate();
   if(!(await vscode.commands.getCommands(true)).includes('lm.addLanguageModelsProviderGroup'))throw Error('当前VS Code / Copilot不提供安全模型组配置命令；可继续管理列表和检测，请升级VS Code或启用兼容Copilot后再应用。未写入明文Key。');
   const group=`Gateway Sync · ${provider.name} · ${provider.id.slice(0,8)}`;
   const original=fs.readFileSync(file,'utf8');
   if(decode(original).some(g=>g.name===group&&g.vendor==='customendpoint'))throw Error('模型组已存在但未绑定，请新建供应商，不会接管未知配置');
   backup(file);
   try{await vscode.commands.executeCommand('lm.addLanguageModelsProviderGroup',{name:group,vendor:'customendpoint',apiKey:key,models:[]});}
   catch{throw Error('Copilot未注册customendpoint或原生命令不可用；请先启用Copilot模型服务并重新加载窗口');}
   const after=decode(fs.readFileSync(file,'utf8'));const found=after.filter(g=>g.name===group&&g.vendor==='customendpoint');
   if(found.length!==1||!secretRef(found[0].apiKey))throw Error('未在当前profile找到安全密钥引用，已停止；请检查模型配置');
   binding={file,group,reference:found[0].apiKey};
  }
  const raw=fs.readFileSync(file,'utf8');const result=reconcile(raw,binding.group,binding.reference,provider.owned,wanted,provider.baseUrl);
  checkDirty(file);await atomicWrite(file,raw,result.text);
  return {...provider,binding,owned:result.ownedIds};
 });
}
