import {fetch as legacyFetch} from 'undici';
import {serialize,deserialize} from 'node:v8';
// VS Code extension hosts can omit web globals even when their Node version supports them.
export function installRuntimeCompatibility(target:any=globalThis){
 if(typeof target.fetch!=='function')target.fetch=legacyFetch;
 if(typeof target.structuredClone!=='function')target.structuredClone=(value:unknown)=>deserialize(serialize(value));
}
installRuntimeCompatibility();
