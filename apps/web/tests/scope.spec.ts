import { describe, expect, it } from 'vitest';
import { Assignment, Task } from '@research-agent-platform/contracts';
import type { TaskModel, AssignmentModel } from '@research-agent-platform/contracts';
import { contractTasks, fixture } from '../src/fixture-adapter';
import { projectTask } from '../src/contract-projection';
import { tasksInScope } from '../src/view-model';

// Each positive case has exactly one relationship to A. This prevents initiator
// or reviewer membership from masking broken lead/participant/invitation logic.
const unrelated = Task.parse({...contractTasks[0], initiatorId:'member_B',
  leadId:'member_C', reviewerId:'member_D', participantIds:[]});
const invitation = Assignment.parse({id:'invite_A',taskId:unrelated.id,
  kind:'invitation',memberId:'member_A',capability:null,status:'pending',
  commitment:null,transferToMemberId:null,version:1});
const scopeFor = (task: TaskModel, assignments: AssignmentModel[] = []) => {
  const card = projectTask(task,fixture.tasks[0]!,assignments)!;
  return tasksInScope({...fixture,currentMemberId:'member_A',tasks:[card]},'mine');
};

describe('contract role-based demo scope',()=>{
  it.each([
    ['initiator',{initiatorId:'member_A'}],
    ['lead',{leadId:'member_A'}],
    ['participant',{participantIds:['member_A']}],
    ['reviewer',{reviewerId:'member_A'}],
  ] as const)('includes A solely as %s',(_role,patch)=>{
    expect(scopeFor(Task.parse({...unrelated,...patch}))).toHaveLength(1);
  });
  it('includes a pending invitee without presenting them as a committed lead',()=>{
    expect(scopeFor(unrelated,[invitation])).toHaveLength(1);
    expect(unrelated.leadId).toBe('member_C');
    expect(invitation.commitment).toBeNull();
  });
  it('excludes an unrelated member and a missing current identity',()=>{
    expect(scopeFor(unrelated)).toEqual([]);
    expect(tasksInScope({...fixture,currentMemberId:undefined},'mine')).toEqual([]);
  });
  it.each(['declined','withdrawn','cancelled','transferred'] as const)(
    'does not treat a %s invitation as pending',(status)=>{
      expect(scopeFor(unrelated,[Assignment.parse({...invitation,status})])).toEqual([]);
    });
  it('does not match invitations for another task, another member, or another kind',()=>{
    for(const patch of [{taskId:'another_task'},{memberId:'member_B'},{kind:'claim'},{memberId:null}]) {
      expect(scopeFor(unrelated,[Assignment.parse({...invitation,...patch})])).toEqual([]);
    }
  });
  it('an accepted invitation alone is no longer pending; accepted roles come from Task',()=>{
    const accepted = Assignment.parse({...invitation,status:'accepted',commitment:{
      scope:'合成承诺',schedule:unrelated.schedule,acceptedAt:'2026-09-21T08:00:00+08:00',
    }});
    expect(scopeFor(unrelated,[accepted])).toEqual([]);
    expect(scopeFor(Task.parse({...unrelated,leadId:'member_A'}),[accepted])).toHaveLength(1);
  });
  it('reproduces the audit dataset: all six must be mine if A initiates/reviews all six',()=>{
    const tasks=contractTasks.map((task,index)=>projectTask(
      Task.parse({...task,initiatorId:'member_A',reviewerId:'member_A'}),fixture.tasks[index]!,
    )!);
    expect(tasksInScope({...fixture,tasks},'mine')).toHaveLength(6);
  });
  it('removing the sole relationship removes the task; duplicate roles do not duplicate cards',()=>{
    const related = Task.parse({...unrelated,initiatorId:'member_A',reviewerId:'member_A'});
    expect(scopeFor(related,[invitation])).toHaveLength(1);
    expect(scopeFor(unrelated)).toEqual([]);
  });
  it('normal fixture scope matches explicit relationships, not presentation flags',()=>{
    expect(tasksInScope(fixture,'lab').map(t=>t.id)).toEqual(['patent','intern','proposal','paper','data','meeting']);
    const mine=tasksInScope(fixture,'mine');
    expect(mine.map(t=>t.id)).toEqual(['proposal','data','meeting']);
    expect([0,1,2,3].map(column=>mine.filter(t=>t.column===column).length)).toEqual([0,1,1,1]);
    expect(mine.filter(t=>['受阻','待安排'].includes(t.state)).map(t=>t.id)).toEqual(['proposal']);
    for(const id of ['patent','intern','paper']) {
      const task=contractTasks.find(t=>t.id===id)!;
      expect([task.initiatorId,task.leadId,task.reviewerId,...task.participantIds]).not.toContain('member_A');
    }
    expect(tasksInScope({...fixture,currentMemberId:'member_unrelated'},'mine')).toEqual([]);
  });
});
