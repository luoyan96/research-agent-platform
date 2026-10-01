import { ReuseService } from './reuse.js'
import { renderChecklist } from '@research-agent-platform/research-core'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AdaptiveReply, Capability, EvidenceChecklist, PlanningRequest, RunRecord, PlanInput, routes } from '@research-agent-platform/contracts'
import type { RequestFor, RouteName } from '@research-agent-platform/contracts'
import type { Collaboration } from './collaboration.js'
import { hash } from './auth.js'
import { fail } from './errors.js'

export const aiCommands = ['planRequest','getPlanRequest','cancelPlanning','publicCapabilities','run','getRun','cancelRun','retryRun','submitCandidate'] as const satisfies readonly RouteName[]
export type AiCommand = typeof aiCommands[number]
export type Run = z.infer<typeof RunRecord>
export type Planning = z.infer<typeof PlanningRequest>
export const capabilityId='text-evidence-checklist'
export const capabilityVersion=1
export const instant=()=>new Date().toISOString()
export const terminal=['failed','interrupted','cancelled','succeeded','draft','ready']
const encode=JSON.stringify
export function canonical(value:unknown):string {
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if(value && typeof value==='object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}
export class AiService {
  constructor(readonly c:Collaboration,readonly enabled:boolean,readonly model:string){}
  get db(){return this.c.db}
  permission(taskId:string){return Number(this.db.prepare('SELECT version FROM task_permissions WHERE task_id=?').get(taskId)!.version)}
  capability(){
    const row=this.db.prepare('SELECT version,enabled,owner_id FROM public_capabilities WHERE lab_id=? AND id=?').get(this.c.actor.labId,capabilityId)
    if(!row)return null
    return Capability.parse({allowedActions:row.owner_id===this.c.actor.id?['manage_methods']:[],id:capabilityId,labId:this.c.actor.labId,ownerId:String(row.owner_id),maintainerIds:[],visibility:'lab_public',version:row?.version??1,name:'Text evidence checklist',inputContract:'Authorized same-task UTF-8 text, at most 20000 bytes; no OCR or web.',outputContract:'Checklist with exact source quotations and explicit gaps; human review required.',status:this.enabled && row?.enabled===1?'available':'unavailable',validationResultIds:[]})
  }
  available(ref:{id:string;version:number}){const cap=this.capability();if(!cap||cap.status!=='available'||ref.id!==cap.id||ref.version!==cap.version)fail('CAPABILITY_UNAVAILABLE')}
  row(id:string){const row=this.db.prepare('SELECT * FROM execution_jobs WHERE id=? AND lab_id=?').get(id,this.c.actor.labId);if(!row)fail('NOT_FOUND');return row}
  inputRefs(ids:string[],taskId?:string){
    if(new Set(ids).size!==ids.length)fail('VALIDATION_ERROR')
    let bytes=0
    return ids.map(id=>{const {model:f}=this.c.coordination.artifact(id);if(taskId && f.taskId!==taskId)fail('NOT_FOUND');if(f.mediaType!=='text/plain')fail('VALIDATION_ERROR');bytes+=f.size;if(bytes>20000)fail('PAYLOAD_TOO_LARGE');return {id:f.id,version:f.version,sha256:f.sha256}})
  }
  checkInputs(refs:Run['inputs']){for(const ref of refs){const f=this.c.coordination.artifact(ref.id).model;if(f.version!==ref.version||f.sha256!==ref.sha256)fail('VERSION_CONFLICT')}}
  readTexts(refs:Run['inputs']){this.checkInputs(refs);return refs.map(ref=>({artifactId:ref.id,text:Buffer.from(this.c.coordination.handlers.content({params:{id:ref.id},query:{},headers:{},body:null}) as Uint8Array).toString('utf8')}))}
  planningAccess(row:ReturnType<AiService['row']>){
    if(row.owner_id!==this.c.actor.id||row.kind!=='planning')fail('NOT_FOUND')
    new ReuseService(this.c).allowed('job',String(row.id))
    const req=JSON.parse(String(row.request_json)) as PlanningInput
    if(req.plan)this.c.plan(req.plan.id)
    for(const id of req.taskIds)this.c.taskRow(id)
    for(const ref of req.contextTasks??[]){if(ref.access==='full')this.c.task(ref.id);else this.c.taskRow(ref.id)}
    this.checkInputs(req.inputs)
    return req
  }
  runAccess(id:string,write=false){
    const row=this.row(id);if(row.kind!=='capability')fail('NOT_FOUND')
    const r=RunRecord.parse(JSON.parse(String(row.document))),t=this.c.task(r.taskId)
    if(write && ![t.leadId,t.initiatorId].includes(this.c.actor.id))fail('FORBIDDEN')
    return {row,r,t}
  }
  save(id:string,document:Run|Planning,bump=true){
    if(bump)document.version++
    if('updatedAt' in document)document.updatedAt=instant()
    this.db.prepare('UPDATE execution_jobs SET status=?,version=?,document=? WHERE id=?').run(document.status,document.version,encode(document),id)
  }
  insert(kind:'planning'|'capability',doc:Run|Planning,request:unknown){
    this.db.prepare('INSERT INTO execution_jobs(id,kind,owner_id,lab_id,task_id,status,version,available_at,request_json,document,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(doc.id,kind,this.c.actor.id,this.c.actor.labId,'taskId' in doc?doc.taskId:null,doc.status,doc.version,Date.now(),encode(request),encode(doc),instant())
  }
  facts(intent:'progress'|'find_work',taskIds:string[]){
    const v=this.c.visible(intent==='progress'?'mine':'lab')
    const extra=intent==='find_work'?" AND t.claimable=1 AND t.lead_id IS NULL AND t.status='awaiting_acceptance'":''
    const selected=taskIds.length?' AND t.id IN ('+taskIds.map(()=>'?').join(',')+')':''
    const rows=this.db.prepare(`SELECT t.id ${v.sql}${extra}${selected} ORDER BY t.created_at DESC,t.id DESC LIMIT 21`).all(...v.values,...taskIds)
    const tasks=rows.slice(0,20).map(r=>this.c.projection(String(r.id),false))
    const actions=tasks.flatMap(value=>{const t=value as {id:string;version:number;allowedActions:RunAction[]};return t.allowedActions.map(action=>({object:'task' as const,ref:{id:t.id,version:t.version},action}))})
    return AdaptiveReply.parse({replyVersion:'1.0.0',intent,readAt:instant(),origin:'service_facts',plan:null,tasks,truncated:rows.length>20,gaps:[tasks.length?'Skill fit and effort are not inferred. Verify requirements and your voluntary availability before accepting.':'No authorized matching task. Clarify scope or request an explicit invitation.','Unknown dates, skills and availability remain unknown.'],actions:actions.slice(0,100)})
  }
  getPlanning(id:string){
    const row=this.row(id),req=this.planningAccess(row),p=PlanningRequest.parse(JSON.parse(String(row.document)))
    if(p.reply){if(p.reply.intent==='draft'){p.reply.plan=p.planId?this.c.plan(p.planId):null;p.reply.readAt=instant();p.reply.actions=p.reply.plan?.status==='draft'?[{object:'plan',ref:{id:p.reply.plan.id,version:p.reply.plan.version},action:'confirm'}]:[]}
      else p.reply=this.facts(p.reply.intent,req.taskIds)}
    return p
  }
  projectedRun(id:string){const {r,t}=this.runAccess(id);r.allowedActions=[]
    new ReuseService(this.c).allowed('job',id)
    try{this.checkInputs(r.inputs)}catch{r.candidate=null;r.resultRefs=[]}
    if(t.leadId===this.c.actor.id||t.initiatorId===this.c.actor.id){if(['queued','running','waiting_input'].includes(r.status))r.allowedActions.push('cancel');if(t.leadId===this.c.actor.id&&['failed','interrupted','waiting_input'].includes(r.status)&&r.attempt<r.maxAttempts&&t.status!=='cancelled'&&(r.attempt===0||(r.usageDetail?.inputTokens!=null&&r.usageDetail.outputTokens!=null)))r.allowedActions.push('retry')}
    if(!r.methodTrial&&r.status==='succeeded'&&r.candidate&&t.leadId===this.c.actor.id&&t.version===r.taskVersion&&this.permission(t.id)===r.permissionVersion&&!r.candidateDeliverableId){try{this.available(r.capability);this.c.coordination.runnable(t);r.allowedActions.push('submit_candidate')}catch{/* no permitted candidate submission */}}
    return r
  }
  dispatchValid(r:Run){
    const t=this.c.task(r.taskId)
    if(t.leadId!==r.requestedBy||!['ready','in_progress','changes_requested'].includes(t.status))fail('INVALID_STATE')
    this.c.checkVersion(t.version,r.taskVersion);this.c.checkVersion(this.permission(t.id),r.permissionVersion)
    this.available(r.capability);const reuse=new ReuseService(this.c);reuse.methodForRun(r);reuse.allowed('job',r.id);reuse.selected(r.conclusionRefs??[],{kind:'task',id:t.id});this.checkInputs(r.inputs);this.c.coordination.runnable(t,true)
    const account=this.db.prepare('SELECT disabled FROM auth_accounts WHERE member_id=?').get(r.requestedBy)
    if(!account||account.disabled!==0)fail('FORBIDDEN')
    return t
  }
  run(name:AiCommand,req:RequestFor<AiCommand>):unknown{
    const resource=(req.params as {id?:string}).id??this.c.actor.labId
    // Authorization is performed before looking up any successful response.
    if(['getPlanRequest','cancelPlanning'].includes(name))this.planningAccess(this.row(resource))
    if(['getRun','cancelRun','retryRun','submitCandidate'].includes(name))this.runAccess(resource,name!=='getRun')
    if(name==='run'){const t=this.c.task(resource);if(t.leadId!==this.c.actor.id)fail('FORBIDDEN');this.inputRefs((req.body as RequestFor<'run'>['body']).inputArtifactIds,t.id);this.c.coordination.active(t)}
    if(name==='planRequest'){const b=req.body as RequestFor<'planRequest'>['body'];this.c.sameLab(b.labId);if(b.plan)this.c.plan(b.plan.id);for(const id of b.taskIds??[])this.c.taskRow(id);this.inputRefs(b.inputArtifactIds)}
    const route=routes[name],key=(req.headers as {'Idempotency-Key'?:string})['Idempotency-Key'],fingerprint=hash(canonical(req))
    const cached=route.idempotent?this.db.prepare('SELECT request_hash,response_json FROM idempotency_results WHERE actor_id=? AND command=? AND resource_id=? AND key=?').get(this.c.actor.id,name,resource,key!):null
    if(cached){if(cached.request_hash!==fingerprint)fail('IDEMPOTENCY_CONFLICT');const previous=JSON.parse(String(cached.response_json));if(name==='planRequest')return {data:this.getPlanning(previous.data.id)};if(name==='run'||name==='retryRun'||name==='cancelRun')return {data:this.projectedRun(previous.data.id)};if(name==='submitCandidate')this.c.coordination.attachments(previous.data.taskId,previous.data.artifactRefs);return route.response.parse(previous)}
    const response=this.handle(name,req)
    const valid=route.response.parse(response)
    if(route.idempotent)this.db.prepare('INSERT INTO idempotency_results VALUES (?,?,?,?,?,?,?,?)').run(this.c.actor.id,name,resource,key!,fingerprint,encode(valid),route.status,instant())
    return valid
  }
  handle(name:AiCommand,req:RequestFor<AiCommand>):unknown {
    const id=(req.params as {id:string}).id
    if(name==='publicCapabilities'){const cap=this.capability();return {data:cap?[cap]:[],nextCursor:null}}
    if(name==='getPlanRequest')return {data:this.getPlanning(id)}
    if(name==='getRun')return {data:this.projectedRun(id)}
    if(name==='planRequest'){
      const b=req.body as RequestFor<'planRequest'>['body']
      if(b.plan){const p=this.c.plan(b.plan.id);this.c.checkVersion(p.version,b.plan.version);if(p.status!=='draft')fail('INVALID_STATE')}
      const reuse=new ReuseService(this.c);reuse.selected(b.conclusionRefs??[],b.plan?{kind:'plan',id:b.plan.id}:undefined);
      for(const taskId of b.taskIds??[])reuse.explicit('task',taskId,b.conclusionRefs??[]);
      const intent=b.intent??'auto';if(['auto','draft'].includes(intent)&&!this.enabled)fail('MODEL_UNAVAILABLE')
      const p:Planning={id:randomUUID(),status:['progress','find_work'].includes(intent)?'ready':'queued',planId:b.plan?.id??null,failure:null,version:1,reply:intent==='progress'||intent==='find_work'?this.facts(intent,b.taskIds??[]):null,usage:null,createdAt:instant(),updatedAt:instant()}
      const input:PlanningInput={...b,intent,plan:b.plan??null,taskIds:b.taskIds??[],inputs:this.inputRefs(b.inputArtifactIds)}
      this.insert('planning',p,input);reuse.bind('job',p.id,b.conclusionRefs??[]);return {data:p}
    }
    if(name==='cancelPlanning'){
      const p=this.getPlanning(id),b=req.body as RequestFor<'cancelPlanning'>['body'];this.c.checkVersion(p.version,b.expectedVersion)
      if(!['queued','running','waiting_input','interrupted'].includes(p.status))fail('INVALID_STATE')
      p.status='cancelled';p.reply=null;p.failure='Cancelled by owner.';this.fence(id);this.save(id,p);return {data:p}
    }
    if(name==='run'){
      const b=req.body as RequestFor<'run'>['body'],t=this.c.task(id);this.c.checkVersion(t.version,b.expectedVersion);this.available(b.capability)
      if(!['ready','in_progress','changes_requested'].includes(t.status))fail('INVALID_STATE')
      if(this.db.prepare("SELECT 1 FROM execution_jobs WHERE task_id=? AND status IN ('queued','running','waiting_input')").get(id))fail('INVALID_STATE')
      if(Number(this.db.prepare('SELECT count(*) n FROM execution_jobs WHERE task_id=?').get(id)!.n)>=100)fail('INVALID_STATE')
      const reuse=new ReuseService(this.c);reuse.selected(b.conclusionRefs??[],{kind:'task',id});
      if(b.inputArtifactIds.length||(b.conclusionRefs??[]).length)this.c.coordination.runnable(t,true)
      const r:Run={methodVersion:Number(this.db.prepare('SELECT active_version FROM public_method_state WHERE lab_id=?').get(this.c.actor.labId)!.active_version),configurationGeneration:b.capability.version,methodTrial:false,conclusionRefs:b.conclusionRefs??[],id:randomUUID(),taskId:id,capability:b.capability,status:b.inputArtifactIds.length||(b.conclusionRefs??[]).length?'queued':'waiting_input',attempt:0,usage:null,failure:b.inputArtifactIds.length||(b.conclusionRefs??[]).length?null:'Authorized text input required.',resultRefs:[],createdAt:instant(),startedAt:null,endedAt:null,version:1,requestedBy:this.c.actor.id,taskVersion:t.version,plan:{id:t.planId,version:t.planVersion},permissionVersion:this.permission(t.id),inputs:this.inputRefs(b.inputArtifactIds,id),budget:b.budget,maxAttempts:3,nextAttemptAt:null,candidate:null,candidateDeliverableId:null,allowedActions:[],provider:'deepseek-official',model:this.model,harnessVersion:'0.2.0-rc.1',updatedAt:instant(),usageDetail:null}
      this.insert('capability',r,b);reuse.bind('job',r.id,r.conclusionRefs??[]);reuse.bind('task',id,r.conclusionRefs??[]);this.c.event(t,'execution_updated','Public capability execution authorized.');return {data:this.projectedRun(r.id)}
    }
    const {r,t}=this.runAccess(id,true),b=req.body as RequestFor<'retryRun'>['body'];this.c.checkVersion(r.version,b.expectedVersion)
    if(name==='cancelRun'){
      if(!['queued','running','waiting_input','interrupted'].includes(r.status))fail('INVALID_STATE')
      r.status='cancelled';r.failure='Cancelled by authorized member.';r.endedAt=instant();this.fence(id);this.save(id,r);this.c.event(t,'execution_updated',r.failure);return {data:this.projectedRun(id)}
    }
    if(t.leadId!==this.c.actor.id)fail('FORBIDDEN')
    this.c.checkVersion(t.version,b.expectedTaskVersion)
    if(name==='retryRun'){
      if(!['failed','interrupted','waiting_input'].includes(r.status)||r.attempt>=r.maxAttempts)fail('INVALID_STATE')
      // Unknown billed usage reserves the whole remaining budget; a new explicit run is required.
      if(r.attempt>0&&(!r.usageDetail||r.usageDetail.inputTokens===null||r.usageDetail.outputTokens===null))fail('INVALID_STATE')
      r.inputs=this.inputRefs(b.inputArtifactIds,t.id);r.taskVersion=t.version;r.permissionVersion=this.permission(t.id);this.dispatchValid(r)
      r.status=r.inputs.length||(r.conclusionRefs??[]).length||r.methodTrial?'queued':'waiting_input';r.failure=r.inputs.length||(r.conclusionRefs??[]).length||r.methodTrial?null:'Authorized text input required.';r.endedAt=null;this.fence(id);this.save(id,r);this.db.prepare('UPDATE execution_jobs SET available_at=? WHERE id=?').run(Date.now(),id);return {data:this.projectedRun(id)}
    }
    if(name==='submitCandidate'){
      if(r.methodTrial||r.status!=='succeeded'||!r.candidate||r.candidateDeliverableId)fail('INVALID_STATE')
      this.dispatchValid(r)
      const summary=renderChecklist(r.candidate)
      const sources:z.infer<typeof import('@research-agent-platform/contracts').Source>[]=r.inputs.map(ref=>({kind:'artifact' as const,locator:ref.id,label:'Authorized text evidence'}))
      sources.push(...(r.conclusionRefs??[]).map(ref=>({kind:'note' as const,locator:`conclusion:${ref.id}:${ref.version}`,label:'Explicit retained conclusion'})))
      const result=this.c.handlers.submit({params:{id:t.id},query:{},headers:{},body:{expectedVersion:t.version,summary,artifactRefs:r.inputs.map(ref=>ref.id),sources}}) as {data:{id:string}}
      r.candidateDeliverableId=result.data.id;r.resultRefs=[result.data.id];this.save(id,r);return result
    }
    fail('NOT_IMPLEMENTED')
  }
  fence(id:string){this.db.prepare('UPDATE execution_jobs SET fence=fence+1,lease_owner=NULL,lease_until=NULL WHERE id=?').run(id)}
}
type RunAction=z.infer<typeof import('@research-agent-platform/contracts').Action>
export type PlanningInput=RequestFor<'planRequest'>['body'] & {intent:'auto'|'draft'|'progress'|'find_work';plan:{id:string;version:number}|null;taskIds:string[];inputs:Run['inputs'];contextTasks?:{id:string;version:number;access:'full'|'summary'}[]}
