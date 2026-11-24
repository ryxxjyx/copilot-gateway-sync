import {createRequire} from 'node:module';
import {mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {createVSIX} from '@vscode/vsce';
const require=createRequire(import.meta.url),yazl=require('yazl');
const root=process.cwd(),dest=resolve(root,'../deliverables');mkdirSync(dest,{recursive:true});
const version=JSON.parse(readFileSync('package.json','utf8')).version;
const vsix=join(dest,`copilot-gateway-sync-${version}.vsix`),source=join(dest,`copilot-gateway-sync-source-${version}.zip`);
await createVSIX({cwd:root,packagePath:vsix,dependencies:false,allowMissingRepository:true});
const {createWriteStream}=await import('node:fs');
const zip=new yazl.ZipFile();
function walk(dir){for(const entry of readdirSync(join(root,dir),{withFileTypes:true})){const relative=dir?dir+'/'+entry.name:entry.name;if(['node_modules','dist','.git'].includes(entry.name)||entry.name.endsWith('.vsix')||entry.name.endsWith('.log'))continue;if(entry.isDirectory())walk(relative);else zip.addFile(join(root,relative),relative);}}
walk('');await new Promise((ok,no)=>{zip.outputStream.pipe(createWriteStream(source)).on('close',ok).on('error',no);zip.end();});
const lines=[vsix,source].map(p=>createHash('sha256').update(readFileSync(p)).digest('hex')+'  '+p.split(/[\\/]/).at(-1));
writeFileSync(join(dest,`SHA256SUMS-${version}.txt`),lines.join('\n')+'\n');console.log(lines.join('\n'));
