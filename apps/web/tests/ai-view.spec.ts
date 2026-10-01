import { describe,it,expect } from 'vitest';
import { AdaptiveReply } from '@research-agent-platform/contracts';
import { planningView, runView, usage, type Planning, type Run } from '../src/ai-view';
import type { TaskModel } from '@research-agent-platform/contracts';
const at='2026-09-30T00:00:00Z';
const request:Planning={id:'plan_request',status:'running',planId:null,failure:null,version:1,reply:null,usage:null,createdAt:at,updatedAt:at};
describe('F3 controlled reply and run presentation',()=>{
 it('rejects unversioned arbitrary components and executable model fields',()=>{expect(AdaptiveReply.safeParse({replyVersion:'1.0.0',intent:'draft',readAt:at,origin:'model_suggestion',plan:null,tasks:[],truncated:false,gaps:[],actions:[],html:'<script>bad()</script>'}).success).toBe(false);});
 it('shows in-progress without a confirm action or fabricated percentage',()=>{const html=planningView(request,id=>id);expect(html).toContain('正在生成');expect(html).not.toContain('确认此版本并安排');expect(html).not.toMatch(/\d+%/);expect(html).toContain('取消这次生成');});
 it('renders authorized fact gaps as escaped text without treating them as executable markup',()=>{const html=planningView({...request,status:'ready',reply:{replyVersion:'1.0.0',intent:'find_work',readAt:at,origin:'service_facts',plan:null,tasks:[],truncated:false,gaps:['<img src=x onerror=bad()>'],actions:[]}},id=>id);expect(html).toContain('&lt;img');expect(html).not.toContain('<img');expect(html).toContain('没有符合当前授权范围的结果');});
 it('preserves unknown usage instead of inventing free or zero-cost execution',()=>{expect(usage(null)).toContain('费用：未知');expect(usage({inputTokens:0,outputTokens:null,elapsedMs:12,cost:null,currency:null})).toContain('输入 tokens：0');});
 it('reopened confirmed or superseded plans do not invite another draft confirmation',()=>{
  const plan={id:'saved_plan',ownerId:'member_A',labId:'lab_synthetic',goal:'Saved goal',proposedItems:[],unresolvedQuestions:[],version:3,status:'confirmed' as const,createdAt:at};
  const reply={replyVersion:'1.0.0' as const,intent:'draft' as const,readAt:at,origin:'model_suggestion' as const,plan,tasks:[],truncated:false,gaps:[],actions:[]};
  const html=planningView({...request,status:'draft',reply},id=>id);
  expect(html).toContain('方案已确认');expect(html).toContain('查看已确认方案');
  expect(html).not.toContain('尚未确认或承诺');expect(html).not.toContain('继续编辑同一草案');expect(html).not.toContain('再明确确认');expect(html).not.toContain('继续编辑与确认方案');
  const superseded=planningView({...request,status:'draft',reply:{...reply,plan:{...plan,status:'superseded'}}},id=>id);
  expect(superseded).toContain('方案已被替代');expect(superseded).not.toContain('继续编辑同一草案');expect(superseded).not.toContain('继续编辑与确认方案');
 });
 it('finished, cancelled and interrupted generation never claims ongoing background work',()=>{
  for(const status of ['draft','ready','failed','interrupted','cancelled','waiting_input'] as const){
   const html=planningView({...request,status},id=>id);expect(html).not.toContain('生成在后台进行');
  }
  expect(planningView(request,id=>id)).toContain('生成在后台进行');
 });
 it('succeeded is only a candidate, with only service-authorized actions',()=>{
  const r={id:'run_test',taskId:'task_test',status:'succeeded',version:2,taskVersion:3,attempt:1,maxAttempts:3,capability:{id:'text-evidence-checklist',version:1,visibility:'lab_public'},provider:'deepseek-official',model:'test',harnessVersion:'0.2.0-rc.1',budget:{maxTokens:10000,maxSeconds:60},nextAttemptAt:null,usageDetail:null,inputs:[],failure:null,candidate:{title:'<unsafe>',items:[{requirement:'metric',assessment:'gap',citations:[],gap:'unknown'}],limitations:[]},candidateDeliverableId:null,allowedActions:[]} as unknown as Run;
  const html=runView(r,{version:3} as TaskModel);expect(html).toContain('候选产物已生成');expect(html).toContain('&lt;unsafe&gt;');expect(html).not.toContain('data-action="submit-run-');expect(html).not.toContain('data-action="retry-run-');
  expect(runView({...r,allowedActions:['submit_candidate']},{version:3} as TaskModel)).toContain('data-action="submit-run-');
 });
});
