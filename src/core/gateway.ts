import {normalizeBaseUrl,parseModels,parseOpenCode,Model} from './models';
export async function readJson(response:Response,limit=4*1024*1024):Promise<any>{
  const reader=response.body?.getReader();if(!reader)throw Error('空响应');const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('响应超过大小限制');chunks.push(value);}}finally{await reader.cancel();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('响应不是有效JSON');}
}
export function httpError(status:number){return status===401?'认证失败（401），请检查公司网关Key':status===403?'无权访问（403）':status===429?'请求限流（429）':`网关请求失败（HTTP ${status}）`;}
export async function fetchGatewayModels(base:string,key:string,source:'models'|'opencode'='models',providerId?:string):Promise<Model[]>{
  const url=normalizeBaseUrl(base)+(source==='models'?'/models':'/opencode/config');
  let response:Response;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
  try{response=await fetch(url,{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},redirect:'error',signal:controller.signal});}catch{throw Error('连接失败：请检查地址、网络、证书或超时（不跟随重定向）');}
  if(!response.ok){await response.body?.cancel();throw Error(httpError(response.status));}
  const payload=await readJson(response);
  return source==='models'?parseModels(payload):parseOpenCode(payload,normalizeBaseUrl(base),providerId);
  }finally{clearTimeout(timer);}
}
export function errorText(error:unknown){return error instanceof Error?error.message.replace(/Bearer\s+\S+/gi,'Bearer [隐藏]').slice(0,300):'操作失败';}
