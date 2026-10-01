import { describe, expect, it } from 'vitest';
import { fixtures } from '@research-agent-platform/contracts/fixtures';
import { availabilityText, planCard, taskCard, taskColumn } from '../src/collaboration-view';

describe('service task card presentation', () => {
  it('links a saved plan to the existing editor without exposing its proposed assignments', () => {
    const plan = fixtures.missingDeadlineDraft.schema.parse(fixtures.missingDeadlineDraft.value).data;
    const html = planCard({ ...plan, goal: '<script>goal</script>' });
    expect(html).toContain(`href="#/plans/${plan.id}"`);
    expect(html).toContain('已保存版本 1');
    expect(html).toContain('创建于');
    expect(html).not.toContain('最近更新');
    expect(html).not.toContain(plan.proposedItems[0]!.deliverable);
    expect(html).toContain('&lt;script&gt;goal');
  });
  it('keeps a pending invitation distinct from a commitment and does not invent task status', () => {
    const task = fixtures.invitationSummary.schema.parse(fixtures.invitationSummary.value).data;
    const html = taskCard(task, id => id);
    expect(html).toContain('待回应邀请 · 尚未承诺');
    expect(html).toContain('可处理：回应邀请');
    expect(html).not.toContain('进行中');
    expect(html).not.toContain('可处理：认领');
  });
  it('uses the shared column mapping for an authorized summary, without guessing absent status', () => {
    const task = fixtures.claimSummary.schema.parse(fixtures.claimSummary.value).data;
    expect(taskColumn({...task,visibleStatus:'awaiting_acceptance'})).toBe('unassigned');
    expect(taskColumn({...task,visibleStatus:'cancelled'})).toBeNull();
    expect(taskColumn({...task,visibleStatus:undefined})).toBeUndefined();
  });
  it('keeps expired and future self-reports unknown for current availability, and preserves zero hours', () => {
    const member = fixtures.unknownAvailability.schema.parse(fixtures.unknownAvailability.value).data;
    expect(availabilityText(member)).toContain('未知');
    const availability={from:'2026-01-01',to:'2026-01-02',timezone:'Asia/Shanghai',level:'available' as const,hours:0,updatedAt:'2026-01-01T00:00:00Z'};
    expect(availabilityText({...member,availability,availabilityStatus:'expired'})).toContain('待更新 · 当前可用情况未知');
    expect(availabilityText({...member,availability,availabilityStatus:'upcoming'})).toContain('未来区间 · 当前可用情况未知');
    expect(availabilityText({...member,availability,availabilityStatus:'current'})).toContain('0 小时');
    expect(availabilityText({...member,availability:{...availability,hours:null},availabilityStatus:'current'})).toContain('时数未知');
  });
  it('renders cancelled tasks separately from completed without adding unavailable actions', () => {
    const task = fixtures.cancelledTask.schema.parse(fixtures.cancelledTask.value).data;
    const html = taskCard(task, id => id);
    expect(html).toContain('已取消');
    expect(html).not.toContain('已完成');
    expect(html).not.toContain('可处理：');
  });
  it('escapes task and member content in a navigable card', () => {
    const task = fixtures.claimSummary.schema.parse(fixtures.claimSummary.value).data;
    const html = taskCard({ ...task, title: '<img src=x onerror=alert(1)>', summary: '<script>private()</script>' }, () => '<b>name</b>');
    expect(html).toContain(`href="#/tasks/${task.id}"`);
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;name');
    expect(html).not.toMatch(/<(img|script|b)[ >]/);
  });
});
