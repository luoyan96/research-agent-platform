import { taskColumns } from '@research-agent-platform/contracts';
import type { MemberModel, PlanModel, ResponseFor } from '@research-agent-platform/contracts';
import { labels } from './contract-projection';
import { escapeHtml as e } from './view-model';

// Presentation of an already-authorized service projection. No local ACL or state transitions.
export type VisibleTask = ResponseFor<'tasks'>['data'][number];
const actionLabels: Record<string, string> = {
  run:'公共能力运行',block:'报告受阻',resume:'恢复',propose_change:'提议变更',withdraw:'退出/转交',cancel:'取消',revoke_access:'撤权',upload:'上传附件',acknowledge_impacts:'复核影响',claim: '认领', decide: '回应邀请', start: '开始', submit: '提交成果', review: '验收', invite: '邀请成员',
};

export function taskCard(task: VisibleTask, memberName: (id: string) => string): string {
  const summary = 'projection' in task;
  const status = summary ? (task.visibleStatus ? labels[task.visibleStatus] + ' · 承接前摘要' : '承接前摘要') : labels[task.status];
  const actions = task.allowedActions.map(action => actionLabels[action] ?? action).join('、');
  return `<article class="task-card"><span class="tag">${e(status)}</span><h2><a href="#/tasks/${e(task.id)}">${e(task.title)}</a></h2><p>版本 ${task.version} · 发起 ${e(memberName(task.initiatorId))} · 验收 ${e(memberName(task.reviewerId))}</p><p>${e(summary ? task.summary : task.goal)}</p>${summary && task.pendingInvitation ? '<p class="fine">待回应邀请 · 尚未承诺</p>' : ''}<div class="card-note green">${actions ? '可处理：' + e(actions) : '查看详情与当前安排'}</div></article>`;
}

export function taskColumn(task: VisibleTask) {
  const status = 'projection' in task ? task.visibleStatus : task.status;
  return status ? taskColumns[status] : undefined;
}

export function availabilityText(member: MemberModel): string {
  const value = member.availability;
  if (!value) return '未知 · 尚未自报可用时间';
  const status = member.availabilityStatus;
  const freshness = status === 'expired' ? '待更新 · 当前可用情况未知' : status === 'upcoming' ? '未来区间 · 当前可用情况未知' : status === 'current' ? ({available:'可承接',limited:'有限可用',unavailable:'暂不可用'})[value.level] : '当前可用情况未知';
  return `${freshness}；自报区间 ${value.from} 至 ${value.to}（${value.timezone}）；区间内自报 ${value.hours === null ? '时数未知' : value.hours + ' 小时'}；更新 ${value.updatedAt}`;
}

export function planCard(plan: Pick<PlanModel, 'id' | 'goal' | 'version' | 'createdAt' | 'status'>): string {
  const action = plan.status === 'confirmed' ? '查看已确认方案' : plan.status === 'superseded' ? '查看已替代方案' : '继续编辑与确认方案';
  return `<article class="panel saved-plan"><h3><a href="#/plans/${e(plan.id)}">${e(plan.goal)}</a></h3><p class="fine">已保存版本 ${plan.version} · 创建于 <time datetime="${e(plan.createdAt)}">${e(plan.createdAt)}</time></p><p class="fine">${action}</p></article>`;
}
