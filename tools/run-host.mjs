import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const exe=process.env.VSCODE_EXE;if(!exe)throw Error('Set VSCODE_EXE to the local Code.exe path');
const root=resolve(import.meta.dirname,'..'),scratch=mkdtempSync(join(tmpdir(),'gateway-sync-037-')),user=join(scratch,'user'),extensions=join(scratch,'extensions'),helper=join(scratch,'helper');
mkdirSync(join(user,'User'),{recursive:true});mkdirSync(extensions);mkdirSync(helper);
writeFileSync(join(user,'User','settings.json'),JSON.stringify({'telemetry.telemetryLevel':'off','update.mode':'none','extensions.autoCheckUpdates':false,'extensions.autoUpdate':false,'workbench.startupEditor':'none','security.workspace.trust.enabled':false}));
writeFileSync(join(helper,'package.json'),JSON.stringify({name:'gateway-test-helper',version:'1.0.0',publisher:'local-test',engines:{vscode:'^1.80.0'},main:'index.cjs'}));writeFileSync(join(helper,'index.cjs'),'exports.activate=()=>{};');copyFileSync(join(root,'tools','host-test.cjs'),join(helper,'test.cjs'));
const env={...process.env,GATEWAY_TEST_INSTALLED:process.argv[2]?'1':'0',GATEWAY_TEST_REPORT:resolve(process.env.GATEWAY_TEST_REPORT||join(scratch,'report.json'))};delete env.ELECTRON_RUN_AS_NODE;
const common=['--user-data-dir',user,'--extensions-dir',extensions,'--skip-welcome','--skip-release-notes','--disable-workspace-trust','--disable-updates','--disable-telemetry'];
if(process.argv[2]){const home=resolve(exe,'..');const cli=[join(home,'resources/app/out/cli.js'),...readdirSync(home).map(name=>join(home,name,'resources/app/out/cli.js'))].find(existsSync);if(!cli)throw Error('VS Code CLI entry not found');const install=spawnSync(exe,[cli,...common,'--install-extension',resolve(process.argv[2]),'--force'],{env:{...env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit',timeout:120000});if(install.status!==0)throw Error('Isolated VSIX install failed');}
console.log('Isolated test directory:',scratch);
const run=spawnSync(exe,[...common,'--new-window','--extensionDevelopmentPath',process.argv[2]?helper:root,'--extensionTestsPath',join(helper,'test.cjs')],{env,stdio:'inherit',timeout:120000});
if(run.error)throw run.error;if(run.status!==0)throw Error('VS Code host test failed: '+run.status);
