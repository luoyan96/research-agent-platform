import type {ResponseFor,TaskModel} from '@research-agent-platform/contracts';
import {escapeHtml as e} from './view-model';
export type Conclusion = ResponseFor<'conclusion'>['data'];
export type PlanningSummary = ResponseFor<'planningRequests'>['data'][number];
export type MethodState = ResponseFor<'publicMethods'>['data'];
export type PublicSample = ResponseFor<'samples'>['data'][number];
export function conclusionBindings(refs:TaskModel['conclusionRefs']):string {
 if(!refs?.length)return '';
 return `<details class="panel"><summary>已绑定结论 · ${refs.length} 项</summary><p>这些是已保存的来源绑定。新的生成或运行仍须明确重选；不会把历史绑定自动当作本次授权。</p>${refs.map(ref=>`<p><a href="#/conclusions/${e(ref.id)}">核对来源结论</a> · 绑定 v${ref.version} · ${ref.status==='current'?'来源当前有效':'来源已变化，需要复核'}</p>`).join('')}</details>`;
}
export const requestLabels:Record<PlanningSummary['status'],string>={queued:'等待生成',running:'正在生成',draft:'生成完成 · 查看方案当前状态',ready:'查询已返回',waiting_input:'需要补充输入',failed:'生成失败',interrupted:'生成中断',cancelled:'已取消生成'};
export function requestCard(p:PlanningSummary):string {
 return `<article class="panel"><h3><a href="#/planning/${e(p.id)}">${requestLabels[p.status]}</a></h3><p class="fine">发起 ${e(p.createdAt)} · 更新 ${e(p.updatedAt)}</p>${p.failure?`<p>${e(p.failure)}</p>`:''}<p>打开后按当前权限查看完整回复与方案状态。</p></article>`;
}
export function conclusionCard(c:Conclusion):string {
 if(c.status==='revoked')return '<article class="panel"><h3>结论已撤回</h3><p>此内容不可继续使用，请重新选择获准来源。</p></article>';
 return `<article class="panel retained-conclusion" data-conclusion="${e(c.id)}"><h3>${c.status==='current'?'已确认的结论':'来源有变化 · 需复核'} · v${c.version}</h3><p class="prose">${e(c.conclusion)}</p><p><strong>适用说明：</strong>${e(c.applicability)}</p><p><strong>共享范围：</strong>${c.scope==='owner_only'?'仅确认人本人，且仍须有来源访问权':'当前有来源任务完整访问权的成员；不会扩大到整个实验室'}</p><p class="fine">${c.status==='current'?'主动选择后才会用于新任务；服务仍会检查目标读者范围。':'这版保留作历史核对，不能直接用于新的模型调用。请联系确认人复核。'}</p><details class="technical-details"><summary>核对来源与确认版本</summary><p>来源任务 <a href="#/tasks/${e(c.taskId)}">查看来源任务</a> · 任务 v${c.sourceTaskVersion}</p><p>交付 ${e(c.deliverable.id)} · 记录 v${c.deliverable.version}</p><p>确认人 ${e(c.confirmedBy)} · ${e(c.createdAt)}</p>${c.artifactRefs.map(a=>`<p>材料 ${e(a.id)} · v${a.version} · SHA256 ${e(a.sha256)}</p>`).join('')}</details><a href="#/conclusions/${e(c.id)}">查看结论与修订记录</a></article>`;
}
export function conclusionChoices(items:Conclusion[],prefix:string):string {
 return `<details class="panel reuse-choices"><summary>复用已有结论 · 主动选择</summary><p>只列出当前获准读取的结论；未选内容不会加入请求。选用后服务会再次检查来源版本和目标读者，不能扩大共享范围。</p>${items.map(c=>c.status==='revoked'?conclusionCard(c):`${conclusionCard(c)}<label><input type="checkbox" name="${e(prefix)}-${e(c.id)}-v${c.version}" data-conclusion-ref="${e(c.id)}" data-version="${c.version}" ${c.status!=='current'?'disabled':''}>选用这一版结论</label>`).join('')||'<p>当前没有可读取的结论。</p>'}<p class="fine">本次按同一授权快照读取可选来源，也可到<a href="#/conclusions">获准结论列表</a>核对修订历史。来源变化或撤回时，原选择不能视作新授权。</p></details>`;
}
export function methodConfigText(config:MethodState['methods'][number]['config']):string {
 return `${config.emphasis==='metrics'?'指标核对':'证据缺口'} · ${config.detail==='concise'?'简洁输出':'详细输出'} · 精确原文引用`;
}
export function methodSummary(state:MethodState):string {
 return `<h1>公共文本能力的方法维护</h1><p>只维护已有文本核对能力。这里不上传私人方法，也不执行任意代码。</p><p class="banner">${state.enabled?'当前已启用':'当前已停用'} · 方法 v${state.activeMethodVersion} · 启用配置第 ${state.generation} 代</p><p>新候选须用获准样例真实试跑，再明确启用；方法版本与启用配置代次分别记录。旧运行保留原方法版本。</p>${state.methods.map(m=>`<article class="panel"><h2>方法 v${m.version}</h2><p>${methodConfigText(m.config)}</p><p>${m.origin==='legacy_b3'?'从 B3 原算法导入，不冒充新方法已试跑':'人工创建的候选版本'} · ${m.usable?'来源当前可用':'样例或来源不可用'}</p><p class="fine">创建于 ${e(m.createdAt)}；获准样例 ${m.sampleIds.length} 项。</p></article>`).join('')}`;
}
