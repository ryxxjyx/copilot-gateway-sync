import {test,expect} from 'bun:test';
import {prepareApplication} from '../src/core/application';
import {parseModels} from '../src/core/models';
// Explicit legacy fixture keeps protocol/limit regressions independent of UI defaults.
const DEFAULT_TEMPLATE={apiType:'chat-completions' as const,toolCalling:false,vision:false,thinking:false,contextWindow:32768,maxOutputTokens:4096,supportsReasoningEffort:undefined as string[]|undefined};
import {DetectionResult} from '../src/core/detection-runner';
import {compareProtocols} from '../src/core/protocol-selection';
const p={baseUrl:'local',template:DEFAULT_TEMPLATE,templateConfirmed:false,models:parseModels(['a','b']),overrides:{}};
function detection():DetectionResult{return{complete:true,baseUrl:'local',capabilities:DEFAULT_TEMPLATE,full:{protocol:'chat-completions',checkedAt:'now',items:{tools:{status:'success',message:'ok',latencyMs:1,checkedAt:'now'}}},comparison:compareProtocols({items:{},checkedAt:'now'},DEFAULT_TEMPLATE,'local',true)};}
test('all completed batch models are applicable without extra detection',()=>{const r=prepareApplication(p,['a','b'],{a:detection(),b:detection()});expect(r.applied).toEqual(['a','b']);expect(r.skipped).toEqual([]);expect(r.overrides.a.toolCalling).toBe(true);});
test('stale and interrupted models are skipped without blocking completed model',()=>{for(const bad of [{...detection(),complete:false},{...detection(),baseUrl:'changed'}]){const r=prepareApplication(p,['a','b'],{a:detection(),b:bad});expect(r.applied).toEqual(['a']);expect(r.skipped).toHaveLength(1);expect(r.overrides.b).toBeUndefined();}});
test('unsafe default reasoning migration is reported per model, not silently applied',()=>{const c={...DEFAULT_TEMPLATE,supportsReasoningEffort:['max'],defaultReasoningEffort:'max'},bad=detection();bad.capabilities=c;bad.comparison={...bad.comparison,capabilities:c,recommendation:'messages'};const r=prepareApplication({...p,overrides:{b:c}},['a','b'],{a:detection(),b:bad});expect(r.applied).toEqual(['a']);expect(r.skipped[0]).toContain('推理');expect(r.overrides.b).toEqual(c);});
test('no applicable models provides reasons and does not invent declarations',()=>{const r=prepareApplication(p,['a','b']);expect(r.applied).toEqual([]);expect(r.skipped).toHaveLength(2);expect(r.overrides).toEqual({});});
