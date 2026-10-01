import type { ResponseFor, TaskModel, MemberModel, RouteName } from '@research-agent-platform/contracts';
import { ApiClient, ApiError, Intent } from './api';
import { labels } from './contract-projection';
import { escapeHtml as e } from './view-model';
import { scheduleFields, readSchedule } from './schedule-editor';
type Detail=Extract<ResponseFor<'task'>['data'],{task:TaskModel}>;
type Hooks={api:ApiClient;signal:AbortSignal;memberId:string;members:MemberModel[];name:(id:string|null)=>string;schedule:(s:TaskModel['schedule'])=>string;form:(key:string,fn:(data:FormData,submitter:HTMLElement|null)=>Promise<void>)=>void;action:(key:string,fn:()=>unknown)=>void;mutate:<K extends RouteName>(intent:Intent<K>,success:(value:ResponseFor<K>)=>void|Promise<void>)=>Promise<void>;reload:()=>Promise<void>;clear:(prefix?:string)=>boolean;withdrawn:()=>void;discard:()=>void};
const text=(label:string,key:string,value='')=>`<label>${label}<textarea name="${key}" required maxlength="8000" rows="2">${e(value)}</textarea></label>`;
const button=(action:string,label:string)=>`<button type="button" data-action="${action}">${label}</button>`;
const fold=(label:string,body:string)=>`<details class="panel coordination"><summary>${label}</summary>${body}</details>`;
const dependencies=(task:Pick<TaskModel,'dependencies'>)=>task.dependencies.map(d=>`${d.taskId} ${d.requiredRevision??''}`).join('\n');
export function parseDependencies(input:string):TaskModel['dependencies'] {
 return input.split('\n').map(s=>s.trim()).filter(Boolean).map(line=>{const [taskId,rev,...extra]=line.split(/\s+/);if(extra.length || (rev && (!/^\d+$/.test(rev)||Number(rev)<1)))throw new ApiError('VALIDATION_ERROR','依赖每行填写任务 ID 和可选正整数交付版本。');return {taskId:taskId!,kind:'accepted_deliverable',requiredRevision:rev?Number(rev):null};});
}
export class CoordinationContext {
 private bases=new Map<string,TaskModel>();
 clear(){this.bases.clear();}
 base(task:TaskModel){return this.bases.get(task.id)??task;}
 retain(task:TaskModel){if(!this.bases.has(task.id))this.bases.set(task.id,structuredClone(task));}
 reset(id:string){this.bases.delete(id);}
 render(value:Detail,h:Hooks):string {
  const t=value.task,b=this.base(t),allowed=(s:TaskModel['allowedActions'][number])=>t.allowedActions.includes(s);
  const person=(key:string,ids:string[],empty:string)=>`<label>${empty}<select name="${key}"><option value="">不指定</option>${ids.map(id=>`<option value="${e(id)}">${e(h.name(id))}</option>`).join('')}</select></label>`;
  const state:Record<string,string>={pending:'待接受 · 原承诺仍有效',accepted:'已接受并生效',declined:'已拒绝 · 未应用此安排',superseded:'已过期 · 未应用此安排'};
  const changeHtml=(value.changes??[]).map(p=>`<details class="panel change" data-proposal="${e(p.id)}" ${p.status==='pending'?'open':''}><summary>${state[p.status]}</summary><p>提议版本 ${p.version} · 基于任务版本 ${p.expectedTaskVersion} · ${e(p.reason)}</p><div class="comparison"><section><h4>当前有效安排 · 任务 v${t.version}</h4><p>${e(t.goal)}</p><p>${e(t.acceptanceCriteria)}</p>${h.schedule(t.schedule)}<pre>${e(dependencies(t)||'无前置依赖')}</pre></section><section><h4>提议安排</h4><p>承接范围：${e(p.scope)}</p><p>${e(p.goal)}</p><p>${e(p.acceptanceCriteria)}</p>${h.schedule(p.schedule)}<pre>${e(dependencies(p)||'无前置依赖')}</pre></section></div><p>必要回应：${p.requiredMemberIds.map(id=>`${e(h.name(id))} · ${p.decisions.find(d=>d.memberId===id)?.decision==='accepted'?'已接受':p.decisions.find(d=>d.memberId===id)?.decision==='declined'?'已拒绝':'待回应'}`).join('；')}</p>${p.status==='pending'&&p.requiredMemberIds.includes(h.memberId)&&!p.decisions.some(d=>d.memberId===h.memberId)?`<form data-form="change-decision-${e(p.id)}"><button class="primary" value="accepted">接受这项变更</button><button value="declined">拒绝这项变更</button></form>`:''}</details>`).join('');
  const impacts=value.dependencyImpacts??[];
  return `<section id="coordination"><h2>变化与异常</h2>${b.version!==t.version?`<section class="panel" role="status"><h3>任务版本发生变化</h3><p>未提交输入基于 v${b.version}；当前 v${t.version}。先比较，再明确重新确认。</p><div class="comparison"><section><h4>编辑基准</h4><p>${e(b.goal)}</p><p>${e(b.acceptanceCriteria)}</p>${h.schedule(b.schedule)}</section><section><h4>最新状态</h4><p>${e(t.goal)}</p><p>${e(t.acceptanceCriteria)}</p>${h.schedule(t.schedule)}</section></div>${button('coord-rebase','保留输入并重新确认当前版本')}</section>`:''}
  ${t.blocker?`<section class="alert"><div><h3>当前受阻</h3><p>${e(t.blocker.reason)}</p><p>需要 ${e(h.name(t.blocker.requestedMemberId))}：${e(t.blocker.requestedAction)}</p><p>恢复目标：${labels[t.blocker.resumeStatus]}；依赖有效且影响复核后才能恢复。</p>${allowed('resume')?button('resume','确认恢复任务'):''}</div></section>`:''}
  ${fold('前置依赖与影响',`<p class="fine">需指定交付已验收；未知版本在开始时由服务绑定，不随新版本自动漂移。</p><pre>${e(dependencies(t)||'无前置依赖')}</pre>${impacts.map(i=>`<article><p>${({blocked:'上游受阻',changed:'上游变更',cancelled:'上游取消',withdrawn:'上游退出',review_returned:'上游退回修改',artifact_revoked:'附件撤回',access_revoked:'访问撤销'})[i.kind]} · 上游 ${e(i.upstreamTaskId??'无权查看来源')} · 受影响交付 ${i.affectedRevisions.join(', ')||'暂无'}</p><p>${i.acknowledgedAt?'已复核 '+e(i.comment??''):'尚未复核，原交付与验收历史保留'}</p></article>`).join('')}${value.dependencyImpactsTruncated?'<p>仅显示最近 100 项影响，复核后继续读取剩余项。</p>':''}${allowed('acknowledge_impacts')?`<form data-form="impacts">${text('复核说明','impact-comment')}<p>明确复核本页未处理影响，不会自动恢复任务。</p><button>确认复核本页影响</button></form>`:''}`)}
  ${allowed('block')?fold('报告受阻',`<form data-form="block">${text('受阻原因','block-reason')}${person('block-member',[...new Set([t.initiatorId,t.reviewerId,t.leadId,...t.participantIds].filter((id):id is string=>!!id))],'需要哪位当前成员回应')}${text('需要怎样恢复','block-action')}<button>记录受阻</button></form>`):''}
  ${changeHtml?fold('变更记录与回应',changeHtml):''}
  ${allowed('propose_change')?fold('提议范围、时间或依赖变更',`<form data-form="change">${text('变更原因','change-reason')}${text('承接范围','change-scope',b.goal)}${text('提议目标','change-goal',b.goal)}${text('提议验收标准','change-criteria',b.acceptanceCriteria)}${scheduleFields('change',b.schedule)}<label>前置任务（每行任务 ID，可空格加交付版本；留空表示无依赖）<textarea name="change-dependencies" rows="3">${e(dependencies(b))}</textarea></label><p>必须获得所有必要成员接受才生效；提交即表示本人接受。更换负责人请用退出与转交。</p><button>提交变更提议</button></form>`):''}
  ${allowed('withdraw')?fold('退出或转交',`<form data-form="withdraw">${text('退出原因','withdraw-reason')}${text('尚未交付的范围','withdraw-remaining')}${person('withdraw-member',h.members.filter(m=>m.id!==h.memberId).map(m=>m.id),'邀请下一位承接（可不指定）')}<p>保留历史成果；候选人必须另行接受。退出可能立即失去资料访问。</p><button>确认退出当前承诺</button></form>`):''}
  ${allowed('cancel')?fold('取消任务',`<form data-form="cancel">${text('取消原因','cancel-reason')}<p>停止后续安排，撤销其他成员访问与全部附件下载；已发生的外部结果无法追回。</p><button>确认取消任务</button></form>`):''}
  ${allowed('revoke_access')?fold('撤销成员访问',`<form data-form="revoke-access">${person('revoke-member',[...new Set(value.assignments.map(a=>a.memberId).filter((id):id is string=>!!id&&id!==t.initiatorId&&id!==t.reviewerId))],'撤权成员')}${text('撤权原因','revoke-reason')}<p>结束相关承诺与邀请，旧链接、下载和旧请求均重新鉴权。</p><button>确认撤销访问</button></form>`):''}
  <h2>附件</h2><p class="fine">仅成功上传并重新读取的附件可加入交付。文本、PDF、PNG，最大 10 MiB；每次下载重新鉴权，不保存公开链接。</p>${(value.artifacts??[]).map(a=>`<article class="panel"><h3>${e(a.filename)}</h3><p>附件版本 ${a.version} · ${a.size} bytes · ${a.accessStatus==='revoked'?'已撤回':'可用'} · ID ${e(a.id)}</p>${a.accessStatus==='available'&&t.status!=='cancelled'?button('download-'+a.id,'下载 '+e(a.filename)):''}${allowed('revoke_access')&&a.accessStatus==='available'?`<form data-form="revoke-file-${e(a.id)}">${text('撤回此附件的原因','file-reason-'+a.id)}<button>撤回此附件下载权</button></form>`:''}</article>`).join('')||'<p>暂无已上传附件。</p>'}${allowed('upload')?fold('上传新附件',`<form data-form="upload"><label>选择文件<input type="file" name="upload-file" accept="text/plain,application/pdf,image/png" required></label><button>上传附件</button></form>`):''}
  <details class="panel"><summary>任务事件历史</summary><div id="task-events"></div></details></section>`;
 }
 bind(value:Detail,h:Hooks) {
  const t=value.task,id=t.id,base=this.base(t),version=()=>({expectedVersion:base.version});
  const done=(prefix:string)=>async()=>{if(!h.clear(prefix))this.reset(id);await h.reload();};
  document.querySelector('#coordination')?.addEventListener('input',()=>this.retain(t));
  document.querySelector('#coordination')?.addEventListener('change',()=>this.retain(t));
  h.action('coord-rebase',()=>{this.reset(id);h.discard();void h.reload();});
  h.action('resume',()=>h.mutate(new Intent('resume',version(),{id}),done('')));
  h.form('block',async d=>h.mutate(new Intent('block',{...version(),reason:String(d.get('block-reason')),requestedMemberId:String(d.get('block-member'))||null,requestedAction:String(d.get('block-action'))},{id}),done('block-')));
  h.form('change',async d=>h.mutate(new Intent('proposeChange',{...version(),reason:String(d.get('change-reason')),scope:String(d.get('change-scope')),goal:String(d.get('change-goal')),acceptanceCriteria:String(d.get('change-criteria')),schedule:readSchedule(d,'change',base.schedule),dependencies:parseDependencies(String(d.get('change-dependencies'))),proposedLeadId:base.leadId},{id}),done('change-')));
  for(const p of value.changes??[])h.form('change-decision-'+p.id,async(_,submitter)=>h.mutate(new Intent('decideChange',{expectedVersion:p.version,decision:(submitter as HTMLButtonElement).value as 'accepted'|'declined'},{id:p.id}),done('change-')));
  h.form('impacts',async d=>h.mutate(new Intent('acknowledgeImpacts',{...version(),impactIds:(value.dependencyImpacts??[]).filter(i=>!i.acknowledgedAt).map(i=>i.id),comment:String(d.get('impact-comment'))},{id}),done('impact-')));
  h.form('withdraw',async d=>h.mutate(new Intent('withdraw',{...version(),reason:String(d.get('withdraw-reason')),remainingScope:String(d.get('withdraw-remaining')),transferToMemberId:String(d.get('withdraw-member'))||null},{id}),async()=>{this.reset(id);h.clear();h.withdrawn();}));
  h.form('cancel',async d=>h.mutate(new Intent('cancelTask',{...version(),reason:String(d.get('cancel-reason'))},{id}),done('cancel-')));
  h.form('revoke-access',async d=>h.mutate(new Intent('revokeAccess',{...version(),reason:String(d.get('revoke-reason')),memberId:String(d.get('revoke-member'))},{id}),done('revoke-')));
  for(const a of value.artifacts??[]) {
   h.action('download-'+a.id,async()=>{
    const bytes=await h.api.read('content',{id:a.id},{},h.signal);if(h.signal.aborted)return;
    const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:a.mediaType}));const link=document.createElement('a');link.href=url;link.download=a.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
   });
   h.form('revoke-file-'+a.id,async d=>h.mutate(new Intent('revokeArtifact',{expectedVersion:a.version,reason:String(d.get('file-reason-'+a.id))},{id:a.id}),done('file-reason-'+a.id)));
  }
  h.form('upload',async d=>{
   const file=d.get('upload-file');if(!(file instanceof File)||!file.size||file.size>10485760)throw new ApiError('VALIDATION_ERROR','请选择 1 byte 至 10 MiB 的文件。');
   if(!['text/plain','application/pdf','image/png'].includes(file.type))throw new ApiError('VALIDATION_ERROR','仅支持纯文本、PDF、PNG。');
   const bytes=new Uint8Array(await file.arrayBuffer());if(h.signal.aborted)throw new ApiError('NETWORK_ERROR','页面已失效，请重新读取后选择文件。');
   let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   await h.mutate(new Intent('upload',{taskId:id,expectedVersion:base.version,filename:file.name,mediaType:file.type as 'text/plain'|'application/pdf'|'image/png',contentBase64:btoa(binary)},{}),done('upload-'));
  });
 }
}
