export type Protocol = 'chat-completions' | 'responses' | 'messages';
export interface Capabilities {
  apiType: Protocol; toolCalling: boolean; vision: boolean; thinking: boolean;
  contextWindow: number; maxOutputTokens: number; maxInputTokens?: number; supportsReasoningEffort?: string[]; defaultReasoningEffort?: string;
}
export interface Model {
  id: string; name: string; capabilities?: Capabilities; source: 'gateway' | 'user-template'; limits?: Partial<Pick<Capabilities,'contextWindow'|'maxOutputTokens'|'maxInputTokens'>>;
}
export const DEFAULT_TEMPLATE: Capabilities = { apiType:'messages', toolCalling:true, vision:true, thinking:true, contextWindow:1000000, maxOutputTokens:256000, supportsReasoningEffort:['low','medium','high','xhigh','max'] };
export function normalizeBaseUrl(input: string) {
  if (typeof input !== 'string' || /[\x00-\x20\x7f]/.test(input.trim())) throw Error('URL 不能包含空格或控制字符');
  let url: URL; try { url = new URL(input.trim()); } catch { throw Error('请输入完整的 HTTP(S) 基础地址'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('URL 不允许账号、密码、查询参数或片段');
  const base=url.toString().replace(/\/+$/,'');
  return base.endsWith('/v1')?base:base+'/v1';
}
export function validId(id: unknown): id is string { return typeof id === 'string' && id.length > 0 && id.length <= 300 && !/[\x00-\x20\x7f]/.test(id); }
export function validateCapabilities(c: any): Capabilities {
  if (!c || !['chat-completions','responses','messages'].includes(c.apiType) || !['toolCalling','vision','thinking'].every(k=>typeof c[k]==='boolean') || !Number.isSafeInteger(c.contextWindow) || !Number.isSafeInteger(c.maxOutputTokens) || c.maxOutputTokens<1 || c.contextWindow<=c.maxOutputTokens || c.contextWindow>100000000) throw Error('请填写有效的协议、能力开关和上下文/输出上限');
  const effort = c.supportsReasoningEffort;
  if (effort !== undefined && (!Array.isArray(effort) || !effort.every((v:any)=>typeof v==='string' && /^[a-z0-9_-]{1,30}$/.test(v)))) throw Error('推理档位无效');
  const defaultEffort=c.defaultReasoningEffort;
  if(defaultEffort && (!effort?.includes(defaultEffort)))throw Error('默认思维级别必须属于已声明档位');
  if(c.maxInputTokens!==undefined && (!Number.isSafeInteger(c.maxInputTokens)||c.maxInputTokens<1||c.maxInputTokens>c.contextWindow))throw Error('输入上限必须为正整数且不超过总上下文');
  return {apiType:c.apiType,toolCalling:c.toolCalling,vision:c.vision,thinking:c.thinking,contextWindow:c.contextWindow,maxOutputTokens:c.maxOutputTokens,...(c.maxInputTokens?{maxInputTokens:c.maxInputTokens}:{}),...(effort?.length?{supportsReasoningEffort:[...new Set(effort)] as string[]}: {}),...(defaultEffort?{defaultReasoningEffort:defaultEffort}:{})};
}
export function parseModels(payload:any):Model[] {
  if (payload?.has_more || payload?.next || payload?.next_page) throw Error('该接口返回分页列表，当前版本要求完整模型列表');
  let entries=payload?.data ?? payload?.models ?? (Array.isArray(payload)?payload:undefined);
  if (entries && typeof entries==='object' && !Array.isArray(entries)) entries=Object.entries(entries).map(([id,m]:any)=>({...(m&&typeof m==='object'?m:{}),id}));
  if (!Array.isArray(entries) || !entries.length || entries.length>10000) throw Error('网关没有返回有效的模型列表');
  const seen=new Set<string>();
  return entries.map((e:any)=>{
    const entry=typeof e==='string'?{id:e}:e;
    if (!validId(entry?.id)) throw Error('网关包含无效模型 ID');
    if (seen.has(entry.id)) return null;
    seen.add(entry.id);
    let capabilities:Capabilities|undefined;
    if (entry.copilot) capabilities=validateCapabilities(entry.copilot);
    else {
      const context=entry.context_length??entry.contextWindow??entry.limit?.context;
      const output=entry.max_output_tokens??entry.maxOutputTokens??entry.limit?.output;
      const input=entry.max_input_tokens??entry.maxInputTokens??entry.limit?.input;
      const protocol=entry.apiType??entry.api_type;
      if(context && output && ['chat-completions','responses','messages'].includes(protocol)) {
        capabilities=validateCapabilities({apiType:protocol,contextWindow:context,maxOutputTokens:output,maxInputTokens:input,toolCalling:entry.tool_call===true||entry.toolCalling===true,vision:entry.vision===true||entry.modalities?.input?.includes('image')===true,thinking:entry.reasoning===true||entry.thinking===true,supportsReasoningEffort:entry.supportsReasoningEffort,defaultReasoningEffort:entry.defaultReasoningEffort});
      }
    }
    const context=entry.context_length??entry.contextWindow??entry.limit?.context;
    const output=entry.max_output_tokens??entry.maxOutputTokens??entry.limit?.output;
    const input=entry.max_input_tokens??entry.maxInputTokens??entry.limit?.input;
    const limits:Model['limits']={};
    if(Number.isSafeInteger(context)&&context>1&&context<=100000000)limits.contextWindow=context;
    if(Number.isSafeInteger(output)&&output>0)limits.maxOutputTokens=output;
    if(Number.isSafeInteger(input)&&input>0)limits.maxInputTokens=input;
    if(limits.contextWindow&&limits.maxOutputTokens&&limits.maxOutputTokens>=limits.contextWindow)throw Error('网关输出上限必须小于总上下文');
    if(limits.contextWindow&&limits.maxInputTokens&&limits.maxInputTokens>limits.contextWindow)throw Error('网关输入上限超过总上下文');
    return {id:entry.id,name:typeof entry.name==='string'?entry.name.slice(0,300):entry.id,capabilities,limits:Object.keys(limits).length?limits:undefined,source:capabilities?'gateway':'user-template'};
  }).filter(Boolean) as Model[];
}
export function parseOpenCode(payload:any,base:string,providerId?:string):Model[] {
  const candidates=Object.entries(payload?.provider??{}).filter(([,p]:any)=>p?.models && typeof p.models==='object');
  const chosen=providerId?candidates.find(([id])=>id===providerId):candidates.length===1?candidates[0]:undefined;
  if (!chosen) throw Error('请指定 OpenCode 提供商 ID（或使用默认 /models 来源）');
  const p:any=chosen[1];
  if (p.options?.baseURL && normalizeBaseUrl(p.options.baseURL)!==base) throw Error('配置返回不同的基础地址，已停止');
  const adapters:Record<string,Protocol>={'@ai-sdk/anthropic':'messages','@ai-sdk/openai':'responses','@ai-sdk/openai-compatible':'chat-completions'};
  const list=Object.entries(p.models).map(([id,m]:any)=>{
    const apiType=adapters[m.provider?.npm??p.npm];let capabilities;
    if (apiType && typeof m.tool_call==='boolean' && Array.isArray(m.modalities?.input) && m.limit?.context && m.limit?.output) {
      const effort=Object.values(m.variants??{}).filter((v:any)=>v&&!v.disabled).map((v:any)=>apiType==='messages'?v.effort:v.reasoningEffort).filter((v:any)=>typeof v==='string');
      capabilities=validateCapabilities({apiType,toolCalling:m.tool_call,vision:m.modalities.input.includes('image'),thinking:m.reasoning===true,contextWindow:m.limit.context,maxInputTokens:m.limit.input,maxOutputTokens:m.limit.output,supportsReasoningEffort:[...new Set(effort)],defaultReasoningEffort:m.defaultReasoningEffort});
    }
    return {id,name:m.name??id,limit:m.limit,...(capabilities?{copilot:capabilities}:{})};
  });
  return parseModels({data:list});
}
export function endpoint(base:string,protocol:Protocol) {return normalizeBaseUrl(base)+({messages:'/messages',responses:'/responses','chat-completions':'/chat/completions'}[protocol]);}
export function gatewayLimits(m:Model):Model['limits']{return m.capabilities?{contextWindow:m.capabilities.contextWindow,maxOutputTokens:m.capabilities.maxOutputTokens,...(m.capabilities.maxInputTokens?{maxInputTokens:m.capabilities.maxInputTokens}:{})}:m.limits;}
export function withGatewayLimits(m:Model,c:Capabilities){const limits=gatewayLimits(m);if(!limits)throw Error('网关未提供上限，保留用户配置');return validateCapabilities({...c,...limits});}
export function effectiveCapabilities(m:Model,template:Capabilities,override?:Capabilities){return validateCapabilities(override??m.capabilities??{...template,...m.limits});}
export function copilotModel(base:string,m:Model,template:Capabilities,override?:Capabilities) {
  const c=effectiveCapabilities(m,template,override);
  return {id:m.id,name:m.name,url:endpoint(base,c.apiType),...c,...(c.supportsReasoningEffort?.length?{reasoningEffortFormat:c.apiType}:{})};
}
