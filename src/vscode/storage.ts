import {Capabilities,Model} from '../core/models';
export interface Provider {
 id:string;name:string;baseUrl:string;source:'models'|'opencode';providerId?:string;
 automatic:boolean;interval:number;httpApproved:boolean;template:Capabilities;templateConfirmed:boolean;
 overrides:Record<string,Capabilities>;models:Model[];selected:string[];owned:string[];
 binding?:{file:string;group:string;reference:string};lastRefresh?:string;error?:string;syncError?:string;
}
export interface Store {providers:Provider[];activeId?:string;}
