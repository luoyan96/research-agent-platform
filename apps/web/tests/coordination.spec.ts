import { describe,it,expect } from 'vitest';
import { emptySchedule, readDated, readSchedule, scheduleFields } from '../src/schedule-editor';
import { CoordinationContext, parseDependencies } from '../src/coordination-view';
import type { TaskModel } from '@research-agent-platform/contracts';

describe('F2b input semantics',()=>{
 it('keeps unknown dates null and zero hours distinct; does not turn suggestions into commitments',()=>{
  const data=new FormData();data.set('s-suggested-value','2026-10-20');data.set('s-suggested-zone','Asia/Shanghai');data.set('s-suggested-source','suggestion');data.set('s-suggested-confirmed','false');data.set('s-hours','0');
  const result=readSchedule(data,'s',emptySchedule());expect(result.suggested).toEqual({value:{kind:'date',date:'2026-10-20',timezone:'Asia/Shanghai'},source:'suggestion',confirmed:false});expect(result.committed).toBeNull();expect(result.hardDeadline).toBeNull();expect(result.estimatedHumanHours).toBe(0);
 });
 it('keeps explicit offset instants and member acknowledgement',()=>{
  const d=new FormData();d.set('x-value','2026-10-20T12:00:00+08:00');expect(readDated(d,'x',true)).toEqual({value:{kind:'instant',at:'2026-10-20T12:00:00+08:00'},source:'member',confirmed:true});
 });
 it('parses dependency revisions without guessing and rejects malformed revision',()=>{
  expect(parseDependencies('task_a 2\ntask_b')).toEqual([{taskId:'task_a',kind:'accepted_deliverable',requiredRevision:2},{taskId:'task_b',kind:'accepted_deliverable',requiredRevision:null}]);expect(()=>parseDependencies('task_a latest')).toThrow();expect(()=>parseDependencies('task_a 0')).toThrow();
 });
 it('retains editing version until explicit rebase and clears on owner reset',()=>{
  const c=new CoordinationContext();const t={id:'task_a',version:2,goal:'original'} as TaskModel;c.retain(t);t.goal='mutated outside';expect(c.base({...t,version:3}).goal).toBe('original');expect(c.base({...t,version:3}).version).toBe(2);c.reset(t.id);expect(c.base({...t,version:3}).version).toBe(3);c.retain(t);c.clear();expect(c.base({...t,version:4}).version).toBe(4);
 });
 it('escapes service-provided values in date fields',()=>{
  const s=emptySchedule();s.suggested={value:{kind:'instant',at:'" onfocus="alert(1)'},source:'suggestion',confirmed:false};expect(scheduleFields('x',s)).toContain('&quot;');expect(scheduleFields('x',s)).not.toContain('value="" onfocus');
 });
});
