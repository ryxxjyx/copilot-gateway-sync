export interface ProbePreferences{concurrency:number;perModelConcurrency:number;timeoutSeconds:number;forceAllProtocols:boolean;}
export const DEFAULT_PREFERENCES:ProbePreferences={concurrency:32,perModelConcurrency:8,timeoutSeconds:30,forceAllProtocols:false};
export function validatePreferences(value:Partial<ProbePreferences>):ProbePreferences{
 const p={...DEFAULT_PREFERENCES,...value};
 for(const [key,max]of [['concurrency',128],['perModelConcurrency',32],['timeoutSeconds',600]] as const)if(!Number.isInteger(p[key])||p[key]<1||p[key]>max)throw Error(`${key} 必须为1–${max}整数`);
 if(typeof p.forceAllProtocols!=='boolean')throw Error('三协议比较设置无效');return p;
}
