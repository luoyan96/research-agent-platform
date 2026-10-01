import {afterEach,describe,expect,it,vi} from 'vitest';
import {ReuseContext,type ReuseHooks} from '../src/reuse-controller';
import {ApiClient,ApiError,type Intent} from '../src/api';
import type {ResponseFor,TaskModel} from '@research-agent-platform/contracts';
type Detail=Extract<ResponseFor<'task'>['data'],{task:TaskModel}>;
const detail=(version=4)=>({task:{id:'task_source',version,allowedActions:['retain_conclusion','share_feedback','decline_feedback']},deliverables:[{id:'delivery_one',version:2,revision:1,summary:'synthetic evidence',artifactRefs:[],review:{decision:'accepted'}}],artifacts:[]} as unknown as Detail);
function harness(){
 const forms=new Map<string,(data:FormData,submitter:HTMLElement|null)=>Promise<void>>(),actions=new Map<string,()=>unknown>(),sent:Intent<any>[]=[];
 const hooks:ReuseHooks={api:new ApiClient(),signal:new AbortController().signal,form:(key,fn)=>{forms.set(key,fn);},action:(key,fn)=>{actions.set(key,fn);},mutate:async intent=>{sent.push(intent);throw new ApiError('NETWORK_ERROR','offline');},reload:vi.fn(async()=>{}),clear:vi.fn(),discard:vi.fn()};
 vi.stubGlobal('document',{querySelector:()=>null});
 return {forms,actions,sent,hooks};
}
function input(){const data=new FormData();for(const [key,value] of Object.entries({'retain-delivery':'delivery_one','retain-text':'Retained synthetic result','retain-applicability':'Only this dataset','retain-scope':'owner_only'}))data.set(key,value);return data;}
afterEach(()=>vi.unstubAllGlobals());
describe('F4a editing context and explicit consent',()=>{
 it('uses the recovered grant version and service action for withdrawal, with failure preserving the original command',async()=>{
  const c=new ReuseContext(),h=harness(),sample={id:'own_sample',version:7,allowedActions:['revoke']} as ResponseFor<'taskSamples'>['data'][number];
  c.bindSamples([sample,{...sample,id:'unavailable',allowedActions:[]}],h.hooks);expect(h.forms.has('revoke-sample-unavailable')).toBe(false);
  const data=new FormData();data.set('sample-revoke-own_sample','Stop future use');await expect(h.forms.get('revoke-sample-own_sample')!(data,null)).rejects.toThrow('offline');
  expect(h.sent[0]).toMatchObject({body:{expectedVersion:7,reason:'Stop future use'},params:{id:'own_sample'}});
 });
 it('hides withdrawn or stale grant text and shows true status with paged navigation',()=>{
  const c=new ReuseContext(),base={id:'sample',version:2,createdAt:'2026-09-30T00:00:00Z',selectedText:'SECRET_EXCERPT',allowedActions:[]};
  for(const status of ['needs_review','revoked','declined'] as const){const html=c.sampleHistoryHtml({data:[{...base,status}],total:12,nextCursor:'next'} as ResponseFor<'taskSamples'>,true);expect(html).not.toContain('SECRET_EXCERPT');expect(html).not.toContain('<form');expect(html).toContain('下一批授权记录');expect(html).toContain('回到首批授权记录');}
 });
 it('keeps the original source version after a failed command until explicit comparison and rebase',async()=>{
  const c=new ReuseContext(),h=harness();c.bindTask(detail(),h.hooks);
  await expect(h.forms.get('retain-conclusion')!(input(),null)).rejects.toThrow('offline');
  c.bindTask(detail(5),h.hooks);
  await expect(h.forms.get('retain-conclusion')!(input(),null)).rejects.toThrow('offline');
  expect(h.sent.map(i=>i.body.expectedVersion)).toEqual([4,4]);
  expect(c.taskHtml(detail(5),[])).toContain('原来源');
  await h.actions.get('reuse-task-rebase')!();c.bindTask(detail(5),h.hooks);
  await expect(h.forms.get('retain-conclusion')!(input(),null)).rejects.toThrow('offline');
  expect(h.sent.at(-1)!.body.expectedVersion).toBe(5);expect(h.hooks.discard).toHaveBeenCalledOnce();
 });
 it('clears previous owner source data with the rest of the editing context',async()=>{
  const c=new ReuseContext(),h=harness();c.bindTask(detail(),h.hooks);await expect(h.forms.get('retain-conclusion')!(input(),null)).rejects.toThrow();c.clear();
  c.bindTask(detail(8),h.hooks);await expect(h.forms.get('retain-conclusion')!(input(),null)).rejects.toThrow();expect(h.sent.at(-1)!.body.expectedVersion).toBe(8);expect(c.taskHtml(detail(8),[])).not.toContain('原来源');
 });
 it('declining sharing sends neither the typed excerpt nor authorization',async()=>{
  const c=new ReuseContext(),h=harness();c.bindTask(detail(),h.hooks);const data=new FormData();data.set('sample-delivery','delivery_one');data.set('sample-text','text that must not be shared');data.set('sample-authorize','on');
  await expect(h.forms.get('share-sample')!(data,{value:'decline'} as unknown as HTMLElement)).rejects.toThrow();expect(h.sent[0].body).toMatchObject({decision:'decline',selectedText:null,authorizeLabUse:false});
 });
 it('does not construct a retained reference to an unavailable attachment',async()=>{
  const c=new ReuseContext(),h=harness(),value=detail();value.deliverables[0].artifactRefs=['missing_material'];c.bindTask(value,h.hooks);
  await expect(h.forms.get('retain-conclusion')!(input(),null)).rejects.toThrow('当前不可使用');expect(h.sent).toHaveLength(0);
 });
 it('offers no retention or sharing form when the service removes those actions',()=>{
  const value=detail();value.task.allowedActions=[];const html=new ReuseContext().taskHtml(value,[]);expect(html).not.toContain('<form');
 });
 it('keeps the activation generation on failure and requires an explicit rebase after another maintainer change',async()=>{
  const c=new ReuseContext(),h=harness();
  const state={generation:4,activeMethodVersion:1,methods:[{version:2,validationRunIds:['run_verified']}]} as unknown as ResponseFor<'publicMethods'>['data'];
  const data=new FormData();data.set('activation-run-2','run_verified');
  c.bindMethods(state,[],h.hooks);await expect(h.forms.get('activate-method-2')!(data,null)).rejects.toThrow();
  const latest={...state,generation:5};c.bindMethods(latest,[],h.hooks);await expect(h.forms.get('activate-method-2')!(data,null)).rejects.toThrow();
  expect(h.sent.map(i=>i.body.expectedVersion)).toEqual([4,4]);expect(h.sent[0].body).toMatchObject({methodVersion:2,runId:'run_verified',confirm:true});
  await h.actions.get('method-rebase')!();c.bindMethods(latest,[],h.hooks);await expect(h.forms.get('activate-method-2')!(data,null)).rejects.toThrow();expect(h.sent.at(-1)!.body.expectedVersion).toBe(5);
 });
});
