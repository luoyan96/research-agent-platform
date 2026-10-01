import type { ScheduleModel } from '@research-agent-platform/contracts';
import { escapeHtml as e } from './view-model';

export const emptySchedule = (): ScheduleModel => ({suggested:null,hardDeadline:null,committed:null,estimatedHumanHours:null,checkpoint:null});
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const valueText = (v: NonNullable<ScheduleModel['checkpoint']>|null) => !v?'':v.kind==='date'?v.date:v.at;
export function datedFields(prefix:string,label:string,value:ScheduleModel['suggested'],member=false) {
  return `<fieldset class="time-field"><legend>${label}</legend><label>日期或带时区时间（未知留空）<input name="${prefix}-value" value="${e(valueText(value?.value??null))}" placeholder="2026-10-20 或 2026-10-20T12:00:00+08:00"></label><label>日期时区<input name="${prefix}-zone" value="${e(value?.value.kind==='date'?value.value.timezone:timezone())}"></label>${member?'<p class="fine">本人承接确认或必要成员接受变更后，承诺时间才生效。</p>':`<label>来源<select name="${prefix}-source">${Object.entries({user:'本人填写',authorized_material:'授权材料',suggestion:'建议',member:'成员承诺'}).map(([v,l])=>`<option value="${v}" ${value?.source===v?'selected':''}>${l}</option>`).join('')}</select></label><label>确认状态<select name="${prefix}-confirmed"><option value="false" ${!value?.confirmed?'selected':''}>待确认</option><option value="true" ${value?.confirmed?'selected':''}>已确认</option></select></label>`}</fieldset>`;
}
export function readDated(data:FormData,prefix:string,member=false):ScheduleModel['suggested'] {
  const text=String(data.get(prefix+'-value')??'').trim();if(!text)return null;
  return {value:text.includes('T')?{kind:'instant',at:text}:{kind:'date',date:text,timezone:String(data.get(prefix+'-zone')??timezone())},source:member?'member':String(data.get(prefix+'-source')??'user') as NonNullable<ScheduleModel['suggested']>['source'],confirmed:member||data.get(prefix+'-confirmed')==='true'};
}
export function scheduleFields(prefix:string,s:ScheduleModel,commit=true) {
  return `<details class="schedule-editor"><summary>填写时间安排 · 未知可留空</summary><p class="fine">建议不等于硬性截止或成员承诺；硬性截止必须明确确认，草案不生成成员承诺，邀请不能替成员承诺。</p><div class="form-grid">${datedFields(prefix+'-suggested','建议时间',s.suggested)}${datedFields(prefix+'-hard','硬性截止',s.hardDeadline)}${commit?datedFields(prefix+'-committed','提议的承诺时间',s.committed,true):''}<label>预计投入小时<input type="number" min="0" max="10000" step="0.5" name="${prefix}-hours" value="${s.estimatedHumanHours??''}"></label><label>检查节点（日期或带时区时间）<input name="${prefix}-checkpoint" value="${e(valueText(s.checkpoint))}"></label><label>节点日期时区<input name="${prefix}-checkpoint-zone" value="${e(s.checkpoint?.kind==='date'?s.checkpoint.timezone:timezone())}"></label></div></details>`;
}
export function readSchedule(data:FormData,prefix:string,_original:ScheduleModel,commit=true):ScheduleModel {
 const checkpoint=String(data.get(prefix+'-checkpoint')??'');const hours=String(data.get(prefix+'-hours')??'');
 return {suggested:readDated(data,prefix+'-suggested'),hardDeadline:readDated(data,prefix+'-hard'),committed:commit?readDated(data,prefix+'-committed',true):null,estimatedHumanHours:hours===''?null:Number(hours),checkpoint:checkpoint?(checkpoint.includes('T')?{kind:'instant',at:checkpoint}:{kind:'date',date:checkpoint,timezone:String(data.get(prefix+'-checkpoint-zone'))}):null};
}
