import { build } from 'esbuild';
await build({ entryPoints:['src/extension.ts'], outfile:'dist/extension.js', bundle:true, platform:'node', format:'cjs', target:'node16.17', mainFields:['module','main'], external:['vscode'], sourcemap:false, logLevel:'info' });
