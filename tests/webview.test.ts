import {test,expect} from 'bun:test';
import {DEFAULT_TEMPLATE} from '../src/core/models';
import {Window} from 'happy-dom';
import {readFileSync} from 'node:fs';
const source=readFileSync(__dirname+'/../media/index.js','utf8');
function harness(){
 const window=new Window({url:'https://local.test'}),document=window.document,sent:any[]=[];const intervals=new Map<number,Function>();let next=0;
 const page=readFileSync(__dirname+'/../src/webview.ts','utf8');document.body.innerHTML=page.slice(page.indexOf('<body>')+6,page.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g,'');
 (window as any).acquireVsCodeApi=()=>({postMessage:(m:any)=>sent.push(m)});(window as any).setInterval=(fn:Function)=>{intervals.set(++next,fn);return next;};(window as any).clearInterval=(id:number)=>intervals.delete(id);window.eval(source);
 const emit=(data:any)=>window.dispatchEvent(new window.MessageEvent('message',{data}));
 const provider={id:'p',name:'Mock',baseUrl:'http://127.0.0.1',models:[{id:'m',name:'Model'}],selected:[],overrides:{},template:{apiType:'chat-completions',contextWindow:32768,maxOutputTokens:4096}};
 const state:any={type:'state',providers:[provider],activeId:'p',results:{},busy:false,preferences:{concurrency:4,timeoutSeconds:30}};
 emit(state);return{window,document,sent,intervals,emit,state,$:(id:string)=>document.getElementById(id) as any};
}
test('1M override remains open on failure, keeps draft and closes only on save acknowledgement',()=>{
 const h=harness();try{
  ([...h.$('models').querySelectorAll('button')].find((b:any)=>b.textContent==='配置') as any).click();
  const input=h.$('override').querySelector('[data-field="contextWindow"]');input.value='1M';h.$('saveOverride').click();const request=h.sent.at(-1);expect(request.capabilities.contextWindow).toBe(1000000);expect(h.$('editor').open).toBe(true);
  h.emit({type:'actionResult',requestId:request.requestId,ok:false,error:'本地已保存，Copilot未同步：锁定'});expect(h.$('editor').open).toBe(true);expect(input.value).toBe('1M');expect(h.$('editorError').textContent).toContain('未同步');
  h.$('saveOverride').click();h.emit({type:'actionResult',requestId:h.sent.at(-1).requestId,ok:true});expect(h.$('editor').open).toBe(false);
 }finally{h.window.close();}
});
test('template draft survives gateway refresh; separate save uses numeric limits and no connection save',()=>{
 const h=harness();try{
  const input=h.$('template').querySelector('[data-field="contextWindow"]');input.value='1000000';input.dispatchEvent(new h.window.Event('input',{bubbles:true}));
  h.emit({...h.state,providers:[{...h.state.providers[0],lastRefresh:'2026-10-26'}]});expect(h.$('template').querySelector('[data-field="contextWindow"]')).toBe(input);expect(input.value).toBe('1000000');
  h.$('saveTemplate').click();expect(h.sent.at(-1)).toMatchObject({type:'saveTemplate',template:{contextWindow:1000000}});
 }finally{h.window.close();}
});
test('invalid token limits stay visible in editor without submitting a request',()=>{const h=harness();try{([...h.$('models').querySelectorAll('button')].find((b:any)=>b.textContent==='配置') as any).click();const before=h.sent.length;h.$('override').querySelector('[data-field="maxOutputTokens"]').value='1M';h.$('saveOverride').click();expect(h.sent.length).toBe(before);expect(h.$('editorError').textContent).toContain('小于');expect(h.$('editor').open).toBe(true);}finally{h.window.close();}});
test('protocol comparison renders isolated matrix and application action without replacing model row',()=>{const h=harness();try{h.$('probeAll').click();expect(h.sent.at(-1).type).toBe('detect');const node=h.document.querySelector('[data-protocol]');const c={baseUrl:h.state.providers[0].baseUrl,capabilities:h.state.providers[0].template,complete:true,recommendation:'messages',reason:'能力优先',result:{items:{'messages:text':{status:'success',latencyMs:12}}}};h.emit({type:'protocolProgress',providerId:'p',progress:{...progress(),finishedAt:Date.now()},patch:{m:c}});expect(h.document.querySelector('[data-protocol]')).toBe(node);expect(node!.textContent).toContain('messages');expect(node!.textContent).toContain('12ms');expect(h.document.querySelector('[data-result]')!.textContent).not.toContain('12ms');h.$('addVisible').click();expect(h.sent.at(-1)).toMatchObject({type:'apply',ids:['m']});}finally{h.window.close();}});
test('only four main actions, arbitrary numeric preferences and filtered removal',()=>{const h=harness();try{expect([...h.$('mainActions').querySelectorAll('button')].map((b:any)=>b.textContent)).toEqual(['同步','检测','应用','移除']);h.$('probeConcurrency').value='128';h.$('probeModelConcurrency').value='16';h.$('probeTimeout').value='47';h.$('probeAll').click();expect(h.sent.at(-1).preferences).toMatchObject({concurrency:128,perModelConcurrency:16,timeoutSeconds:47});h.$('removeAll').click();expect(h.sent.at(-1)).toMatchObject({type:'remove',ids:['m']});h.$('probeTimeout').value='0';const before=h.sent.length;h.$('probeAll').click();expect(h.sent.length).toBe(before);expect(h.$('status').textContent).toContain('整数');}finally{h.window.close();}});
test('application feedback remains visible beside the model list',()=>{const h=harness();try{h.emit({...h.state,feedback:{message:'已应用1个模型；跳过1个',error:false}});expect(h.$('actionFeedback').hidden).toBe(false);expect(h.$('actionFeedback').textContent).toContain('已应用1');h.emit({type:'error',message:'没有可应用的模型：检测被中断'});expect(h.$('actionFeedback').textContent).toContain('被中断');expect(h.$('actionFeedback').className).toBe('error');}finally{h.window.close();}});
test('one button toggles detection/cancel across running, completion, error and panel restore',()=>{const h=harness();try{const button=h.$('probeAll');expect(h.$('source')).toBeNull();expect(h.$('providerId')).toBeNull();expect(h.$('cancel')).toBeNull();button.click();expect(h.sent.at(-1).type).toBe('detect');h.emit({...h.state,busy:true,detecting:true});expect(button.textContent).toBe('取消检测');expect(button.disabled).toBe(false);button.click();expect(h.sent.at(-1).type).toBe('cancel');h.emit({...h.state,busy:false,detecting:false});expect(button.textContent).toBe('检测');expect(button.disabled).toBe(false);h.emit({...h.state,busy:true,detecting:false});expect(button.disabled).toBe(true);h.emit({...h.state,busy:false,detecting:false});h.emit({type:'error',message:'已取消确认'});expect(button.textContent).toBe('检测');h.$('save').click();expect(h.sent.at(-1).type).toBe('save');expect(h.sent.at(-1).providerId).toBeUndefined();expect(h.sent.at(-1).source).toBeUndefined();}finally{h.window.close();}});
test('delete supplier button targets active provider, waits for state, and hides on empty store',()=>{const h=harness();try{const button=h.$('deleteProvider');expect(button.hidden).toBe(false);button.click();expect(h.sent.at(-1)).toMatchObject({type:'deleteProvider',id:'p'});expect(h.$('name').value).toBe('Mock');h.emit({...h.state,busy:true});expect(button.disabled).toBe(true);h.emit({...h.state,providers:[],activeId:undefined});expect(button.hidden).toBe(true);expect(h.$('name').value).toBe('');}finally{h.window.close();}});
const progress=()=>({providerId:'p',timeoutMs:30000,total:8,completed:1,skipped:0,passed:1,unconfirmed:0,failed:0,queued:6,startedAt:Date.now()-12000,running:[{modelId:'m',jobId:'tools',startedAt:Date.now()-11000}],perModel:{m:{total:8,completed:1,skipped:0}}});
test('webview incrementally patches results, preserves details/form nodes and cleans timer',()=>{
 const h=harness();try{
  const model=h.document.querySelector('[data-result]')!,group=h.$('models').firstElementChild;model.querySelector('details')!.open=true;group.open=false;h.$('name').value='unsaved draft';
  h.emit({...h.state,busy:true});h.emit({type:'probeProgress',providerId:'p',progress:progress(),patch:{m:{items:{text:{status:'success',message:'OK',latencyMs:5}}}}});
  expect(h.document.querySelector('[data-result]')).toBe(model);expect(model.querySelector('details')!.open).toBe(true);expect(group.open).toBe(false);expect(h.$('name').value).toBe('unsaved draft');expect(h.$('taskProgress').hidden).toBe(false);expect(h.$('taskBar').value).toBe(12.5);expect(h.$('taskRunning').textContent).toContain('网关响应较慢');expect(h.$('probeAll').disabled).toBe(false);expect(h.intervals.size).toBe(1);
  for(const tick of h.intervals.values())tick();expect(h.$('taskBar').value).toBe(12.5);
  const done={...progress(),finishedAt:Date.now(),completed:2,skipped:6,running:[],queued:0,reason:'用户取消'};
  h.emit({type:'probeProgress',providerId:'p',progress:done,patch:{}});expect(h.intervals.size).toBe(0);expect(h.$('taskTitle').textContent).toBe('检测已停止');expect(h.$('taskSummary').textContent).toContain('跳过 6');expect(h.$('probeAll').disabled).toBe(true);
 }finally{h.window.close();}
});
test('preferences and cancel are wired; operation waits without fake percentage; restored active task has one timer',()=>{
 const h=harness();try{
  h.$('probeConcurrency').value='6';h.$('probeTimeout').value='60';h.$('probeAll').click();expect(h.sent.at(-1)).toMatchObject({type:'detect',preferences:{concurrency:6,timeoutSeconds:60}});
  h.emit({...h.state,busy:true,operation:{label:'读取列表',startedAt:Date.now()}});expect(h.$('taskBar').hasAttribute('value')).toBe(false);expect(h.intervals.size).toBe(1);
  h.emit({...h.state,busy:true,progress:progress()});h.emit({...h.state,busy:true,progress:progress()});expect(h.intervals.size).toBe(1);h.$('probeAll').click();expect(h.sent.at(-1).type).toBe('cancel');
  h.window.dispatchEvent(new h.window.Event('unload'));expect(h.intervals.size).toBe(0);
 }finally{h.window.close();}
});
test('candidate quick fill exposes xhigh/max without implying verified support',()=>{const h=harness();try{const button=[...h.$('template').querySelectorAll('button')].find((b:any)=>b.textContent.includes('填入候选')) as any;expect(button.textContent).toContain('不代表支持');button.click();const select=h.$('template').querySelector('[data-field="defaultReasoningEffort"]');expect([...select.options].map((o:any)=>o.value)).toContain('xhigh');expect([...select.options].map((o:any)=>o.value)).toContain('max');expect(select.value).toBe('');}finally{h.window.close();}});

test('new provider form matches core defaults without auto-confirming or claiming verification',()=>{const h=harness();try{
 h.emit({...h.state,providers:[],activeId:undefined});expect(h.$('confirmed').checked).toBe(false);
 expect(h.$('template').querySelector('[data-field="maxInputTokens"]').value).toBe('');expect(h.$('template').querySelector('[data-field="defaultReasoningEffort"]').value).toBe('');
 h.$('save').click();expect(h.sent.at(-1).template).toEqual(DEFAULT_TEMPLATE);expect(h.sent.at(-1).templateConfirmed).toBe(false);
 expect(h.$('template').textContent).toContain('不代表支持');
 h.emit(h.state);h.$('save').click();expect(h.sent.at(-1).template).toMatchObject({apiType:'chat-completions',contextWindow:32768,maxOutputTokens:4096,toolCalling:false,vision:false,thinking:false});expect(h.sent.at(-1).template.supportsReasoningEffort).toEqual([]);
}finally{h.window.close();}});
