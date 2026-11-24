import * as fs from 'node:fs';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
export async function withFileLock<T>(file:string,run:()=>Promise<T>):Promise<T>{
 const lock=file+'.gateway-sync.lock';let fd:number;try{fd=fs.openSync(lock,'wx');}catch{throw Error('配置文件正被另一同步操作使用；若异常退出请确认没有同步进程后清理.lock');}
 try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,time:new Date().toISOString()}));return await run();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
export function backup(file:string){
 if(!fs.existsSync(file))return;
 const dir=path.join(path.dirname(file),'GatewaySync-backups');fs.mkdirSync(dir,{recursive:true});
 fs.copyFileSync(file,path.join(dir,`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}.json`));
 const old=fs.readdirSync(dir).filter(n=>/^\d{4}-.*\.json$/.test(n)).sort().reverse().slice(10);for(const n of old)fs.unlinkSync(path.join(dir,n));
}
export async function atomicWrite(file:string,before:string,after:string){
 if(before===after)return;if(fs.readFileSync(file,'utf8')!==before)throw Error('配置被其他程序修改，请重试');
 backup(file);const temp=file+'.'+randomUUID()+'.tmp';
 try{
  fs.writeFileSync(temp,after,{flag:'wx'});
  for(let attempt=0;;attempt++){
   if(fs.readFileSync(file,'utf8')!==before)throw Error('配置被其他程序修改，请重试');
   try{fs.renameSync(temp,file);break;}catch(error:any){
    if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=15)throw Error('配置暂时被占用，请稍后重试（原文件未覆盖）');
    await new Promise(resolve=>setTimeout(resolve,100));
   }
  }
 }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
