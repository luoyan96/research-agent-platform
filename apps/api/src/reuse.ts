import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { RetainedConclusion, FeedbackSample, PublicMethod, MethodState, routes } from '@research-agent-platform/contracts'
import type { RequestFor, PlanModel } from '@research-agent-platform/contracts'
import { authorizedPlanSources } from './collaboration.js'
import type { Collaboration } from './collaboration.js'
import { AiService, canonical, instant } from './ai.js'
import { hash } from './auth.js'
import { fail } from './errors.js'

export const reuseCommands=['planningRequests','conclusions','retainConclusion','conclusion','conclusionHistory','reviseConclusion','revokeConclusion','createSample','samples','taskSamples','revokeSample','publicMethods','createMethod','trialMethod','activateMethod','disableMethod','methodEvents'] as const
export type ReuseCommand=typeof reuseCommands[number]
type Ref={id:string;version:number}
type Conclusion=z.infer<typeof RetainedConclusion>
const encode=JSON.stringify
export class ReuseService {
 constructor(readonly c:Collaboration){}
 get db(){return this.c.db}
 bindings(kind:string,id:string){return this.db.prepare("SELECT e.conclusion_id id,e.revision version,CASE WHEN c.head_version=e.revision AND t.version=json_extract(v.document,'$.sourceTaskVersion') AND d.version=json_extract(v.document,'$.deliverable.version') AND json_extract(d.document,'$.review.decision')='accepted' THEN 'current' ELSE 'needs_review' END status FROM reuse_edges e JOIN conclusions c ON c.id=e.conclusion_id JOIN conclusion_versions v ON v.conclusion_id=c.id AND v.version=e.revision JOIN tasks t ON t.id=c.task_id JOIN deliverables d ON d.id=json_extract(v.document,'$.deliverable.id') WHERE e.target_kind=? AND e.target_id=? AND e.revision=(SELECT MAX(prior.revision) FROM reuse_edges prior WHERE prior.target_kind=e.target_kind AND prior.target_id=e.target_id AND prior.conclusion_id=e.conclusion_id) ORDER BY c.id,e.revision").all(kind,id).map(r=>({id:String(r.id),version:Number(r.version),status:r.status as 'current'|'needs_review'}))}
 allowed(kind:string,id:string){if(this.db.prepare('SELECT 1 FROM reuse_denials WHERE target_kind=? AND target_id=? AND member_id=?').get(kind,id,this.c.actor.id))fail('NOT_FOUND')}
 head(id:string){const row=this.db.prepare('SELECT * FROM conclusions WHERE id=?').get(id);if(!row)fail('NOT_FOUND');this.c.task(String(row.task_id));return row}
 conclusion(id:string,revision?:number):Conclusion{
  const h=this.head(id),v=revision??Number(h.head_version)
  if(this.db.prepare('SELECT 1 FROM conclusion_denials WHERE conclusion_id=? AND revision=? AND member_id=?').get(id,v,this.c.actor.id))fail('NOT_FOUND')
  const row=this.db.prepare('SELECT document FROM conclusion_versions WHERE conclusion_id=? AND version=?').get(id,v);if(!row)fail('NOT_FOUND')
  const k=RetainedConclusion.parse(JSON.parse(String(row.document))),t=this.c.task(k.taskId),d=this.c.deliverable(k.deliverable.id)
  k.status=h.revoked===1?'revoked':(h.head_version!==v||t.version!==k.sourceTaskVersion||d.version!==k.deliverable.version||d.review?.decision!=='accepted')?'needs_review':'current'
  k.allowedActions=[];if(h.owner_id===this.c.actor.id&&t.status==='completed'&&t.reviewerId===this.c.actor.id)k.allowedActions.push('revise');if(h.owner_id===this.c.actor.id||t.reviewerId===this.c.actor.id)k.allowedActions.push('revoke')
  return k
 }
 selected(refs:Ref[],target?:{kind:'task'|'plan';id:string}){
  if(new Set(refs.map(r=>r.id)).size!==refs.length)fail('VALIDATION_ERROR')
  const values=refs.map(r=>{const k=this.conclusion(r.id,r.version);if(k.status!=='current')fail('INVALID_STATE');return k})
  if(target){this.explicit(target.kind,target.id,refs);this.range(values,target.kind==='task'?this.taskReaders(target.id):this.planReaders(this.c.plan(target.id)))}
  return values
 }
 taskReaders(id:string){const t=this.c.task(id);if(this.db.prepare('SELECT claimable FROM tasks WHERE id=?').get(id)?.claimable===1)fail('FORBIDDEN');return this.db.prepare("SELECT member_id FROM task_access WHERE task_id=? AND access!='revoked'").all(id).map(r=>String(r.member_id))}
 planReaders(p:Pick<PlanModel,'proposedItems'>){const members=[this.c.actor.id];for(const i of p.proposedItems){if(i.allocation.kind==='claim')fail('FORBIDDEN');if(i.allocation.kind==='invitation')members.push(i.allocation.memberId);if(i.allocation.kind==='public_agent')members.push(i.allocation.humanLeadId)}return [...new Set(members)]}
 range(values:Conclusion[],readers:string[]){for(const k of values)for(const member of readers){if(this.db.prepare('SELECT 1 FROM conclusion_denials WHERE conclusion_id=? AND revision=? AND member_id=?').get(k.id,k.version,member)||this.db.prepare('SELECT 1 FROM reuse_denials WHERE target_kind=\'task\' AND target_id=? AND member_id=?').get(k.taskId,member))fail('FORBIDDEN')}}
 explicit(kind:string,id:string,refs:Ref[]){for(const r of this.db.prepare('SELECT conclusion_id FROM reuse_edges WHERE target_kind=? AND target_id=?').all(kind,id))if(!refs.some(v=>v.id===r.conclusion_id))fail('INVALID_STATE')}
 bind(kind:'task'|'plan'|'job',id:string,refs:Ref[]){for(const r of refs){const k=this.conclusion(r.id,r.version);if(kind==='task'&&(k.taskId===id||this.db.prepare('SELECT 1 FROM reuse_closure p JOIN conclusions c ON c.id=p.conclusion_id WHERE p.target_kind=\'task\' AND p.target_id=? AND c.task_id=?').get(k.taskId,id)))fail('INVALID_STATE');this.db.prepare('INSERT OR IGNORE INTO reuse_edges VALUES(?,?,?,?)').run(kind,id,r.id,r.version)}}
 copy(fromKind:string,fromId:string,toKind:string,toId:string){this.db.prepare('INSERT OR IGNORE INTO reuse_edges SELECT ?,?,conclusion_id,revision FROM reuse_edges WHERE target_kind=? AND target_id=?').run(toKind,toId,fromKind,fromId);this.db.prepare('INSERT OR IGNORE INTO sample_edges SELECT ?,?,sample_id FROM sample_edges WHERE target_kind=? AND target_id=?').run(toKind,toId,fromKind,fromId)}
 texts(refs:Ref[]){return this.selected(refs).map(k=>({artifactId:`conclusion_${k.id}_v${k.version}`,text:`Confirmed conclusion: ${k.conclusion}\nApplicability: ${k.applicability}`}))}
 validatePlanRange(id:string,p:Pick<PlanModel,'proposedItems'>){const refs=this.db.prepare('SELECT DISTINCT conclusion_id id,revision version FROM reuse_edges WHERE target_kind=\'plan\' AND target_id=?').all(id).map(r=>this.conclusion(String(r.id),Number(r.version)));if(refs.length)this.range(refs,this.planReaders(p))}
 owner(){const cap=this.db.prepare('SELECT * FROM public_capabilities WHERE lab_id=?').get(this.c.actor.labId);if(!cap||cap.owner_id!==this.c.actor.id)fail('FORBIDDEN');return cap}
 ownSample(row:Record<string,unknown>){
  const sample=FeedbackSample.parse(JSON.parse(String(row.document)))
  const active=row.status==='available',invalid=!!this.db.prepare('SELECT 1 FROM invalid_samples WHERE id=?').get(sample.id)
  sample.allowedActions=active?['revoke']:[]
  if(invalid){sample.selectedText=null;if(active)sample.status='needs_review'}
  return sample
 }
 sample(id:string,ownerOnly=false){const row=this.db.prepare('SELECT * FROM public_samples WHERE id=? AND lab_id=?').get(id,this.c.actor.labId);if(!row)fail('NOT_FOUND');if(ownerOnly){if(row.owner_id!==this.c.actor.id)fail('FORBIDDEN');this.c.task(String(row.task_id))}else this.owner();if(this.db.prepare('SELECT 1 FROM invalid_samples WHERE id=?').get(id))fail('NOT_FOUND');const sample=FeedbackSample.parse(JSON.parse(String(row.document)));sample.allowedActions=row.owner_id===this.c.actor.id?['revoke']:[];return sample}
 method(version:number){const row=this.db.prepare('SELECT document FROM public_methods WHERE lab_id=? AND version=?').get(this.c.actor.labId,version);if(!row)fail('CAPABILITY_UNAVAILABLE');const m=PublicMethod.parse(JSON.parse(String(row.document)));m.usable=!m.sampleIds.some(id=>!!this.db.prepare('SELECT 1 FROM invalid_samples WHERE id=?').get(id));m.validationRunIds=this.db.prepare("SELECT j.id FROM execution_jobs j WHERE j.lab_id=? AND j.owner_id=? AND j.status='succeeded' AND json_extract(j.document,'$.methodTrial')=1 AND json_extract(j.document,'$.methodVersion')=? AND NOT EXISTS(SELECT 1 FROM reuse_denials d WHERE d.target_kind='job' AND d.target_id=j.id AND d.member_id=?) AND EXISTS(SELECT 1 FROM execution_attempts a WHERE a.job_id=j.id AND json_extract(a.result_json,'$.provenance')='official_harness' AND json_extract(a.result_json,'$.failure') IS NULL) LIMIT 100").all(this.c.actor.labId,this.c.actor.id,version,this.c.actor.id).map(r=>String(r.id));m.allowedActions=[];const cap=this.db.prepare('SELECT owner_id,enabled FROM public_capabilities WHERE lab_id=?').get(this.c.actor.labId);if(cap?.owner_id===this.c.actor.id&&m.usable&&m.origin==='candidate'){if(cap.enabled===1&&this.c.execution?.enabled)m.allowedActions.push('trial');if(m.validationRunIds.length)m.allowedActions.push('activate')}return m}
 state(){const cap=this.owner(),state=this.db.prepare('SELECT active_version FROM public_method_state WHERE lab_id=?').get(this.c.actor.labId)!;return MethodState.parse({allowedActions:cap.enabled===1?['create_method','disable']:['create_method'],capabilityId:cap.id,generation:cap.version,activeMethodVersion:state.active_version,enabled:cap.enabled===1,ownerId:cap.owner_id,methods:this.db.prepare('SELECT version FROM public_methods WHERE lab_id=? ORDER BY version').all(this.c.actor.labId).map(r=>this.method(Number(r.version)))})}
 methodForRun(run:{methodVersion?:number;configurationGeneration?:number;capability:{version:number};methodTrial?:boolean}){
  const state=this.db.prepare('SELECT active_version FROM public_method_state WHERE lab_id=?').get(this.c.actor.labId)
  const m=this.method(run.methodVersion??1);if(!m.usable)fail('CAPABILITY_UNAVAILABLE')
  if(!run.methodTrial&&state?.active_version!==m.version)fail('CAPABILITY_UNAVAILABLE')
  if(run.methodTrial)this.owner()
  return m
 }
 event(action:string,version:number,runId:string|null=null){const cap=this.owner();this.db.prepare('INSERT INTO method_events(lab_id,method_version,generation,action,actor_id,run_id,at) VALUES(?,?,?,?,?,?,?)').run(this.c.actor.labId,version,cap.version!,action,this.c.actor.id,runId,instant())}
 trialTexts(version:number){const m=this.method(version);if(!m.usable)fail('CAPABILITY_UNAVAILABLE');return m.sampleIds.map(id=>{const row=this.db.prepare('SELECT document FROM public_samples WHERE id=?').get(id)!;const s=FeedbackSample.parse(JSON.parse(String(row.document)));return {artifactId:`sample_${s.id}`,text:s.selectedText!}})}
 run(name:ReuseCommand,req:RequestFor<ReuseCommand>):unknown{
  const id=(req.params as {id?:string}).id??this.c.actor.labId,route=routes[name]
  if(['publicMethods','createMethod','trialMethod','activateMethod','disableMethod','methodEvents','samples'].includes(name))this.owner()
  if(['retainConclusion','createSample','taskSamples'].includes(name))this.c.task(id)
  if(['conclusion','conclusionHistory','reviseConclusion'].includes(name))this.conclusion(id)
  if(name==='revokeConclusion'){const h=this.head(id),t=this.c.task(String(h.task_id));if(h.owner_id!==this.c.actor.id&&t.reviewerId!==this.c.actor.id)fail('FORBIDDEN')}
  if(name==='revokeSample'){const h=this.db.prepare('SELECT owner_id,task_id FROM public_samples WHERE id=?').get(id);if(!h)fail('NOT_FOUND');if(h.owner_id!==this.c.actor.id)fail('FORBIDDEN');this.c.task(String(h.task_id))}
  const key=(req.headers as {'Idempotency-Key'?:string})['Idempotency-Key'],fingerprint=hash(canonical(req))
  const cached=route.idempotent?this.db.prepare('SELECT request_hash,response_json FROM idempotency_results WHERE actor_id=? AND command=? AND resource_id=? AND key=?').get(this.c.actor.id,name,id,key!):null
  if(cached){if(cached.request_hash!==fingerprint)fail('IDEMPOTENCY_CONFLICT');const v=JSON.parse(String(cached.response_json));if(['retainConclusion','reviseConclusion'].includes(name))return {data:this.conclusion(v.data.id,v.data.version)};if(name==='createSample'){const row=this.db.prepare('SELECT status FROM public_samples WHERE id=?').get(v.data.id);if(row?.status==='revoked'||(v.data.decision==='share_selected'&&this.db.prepare('SELECT 1 FROM invalid_samples WHERE id=?').get(v.data.id)))fail('NOT_FOUND')};if(name==='trialMethod')return {data:new AiService(this.c,this.c.execution?.enabled??false,this.c.execution?.model??'deepseek-v4-flash').projectedRun(v.data.id)};if(['activateMethod','disableMethod'].includes(name))return {data:this.state()};return route.response.parse(v)}
  if(route.method==='GET')this.c.readSnapshot=this.c.snapshot((req.query as {snapshot?:string;cursor?:string}).snapshot,(req.query as {cursor?:string}).cursor)
  const result=route.response.parse(this.handle(name,req))
  if(route.idempotent){this.db.prepare('INSERT INTO idempotency_results VALUES(?,?,?,?,?,?,?,?)').run(this.c.actor.id,name,id,key!,fingerprint,encode(result),route.status,instant());this.c.changed()}
  return result
 }
 handle(name:ReuseCommand,req:RequestFor<ReuseCommand>):unknown{
  const id=(req.params as {id:string}).id
  if(name==='conclusion')return {data:this.conclusion(id)}
  if(name==='conclusionHistory'){this.conclusion(id);return {data:this.db.prepare('SELECT version FROM conclusion_versions v WHERE conclusion_id=? AND NOT EXISTS(SELECT 1 FROM conclusion_denials d WHERE d.conclusion_id=v.conclusion_id AND d.revision=v.version AND d.member_id=?) ORDER BY version').all(id,this.c.actor.id).map(r=>this.conclusion(id,Number(r.version)))}}
  if(name==='retainConclusion'||name==='reviseConclusion'){
   const b=req.body as RequestFor<'reviseConclusion'>['body'],head=name==='reviseConclusion'?this.head(id):null,t=this.c.task(head?String(head.task_id):id)
   if(head){if(head.owner_id!==this.c.actor.id)fail('FORBIDDEN');this.c.checkVersion(Number(head.head_version),b.expectedVersion);this.c.checkVersion(t.version,b.expectedTaskVersion)}else this.c.checkVersion(t.version,b.expectedVersion)
   if(t.reviewerId!==this.c.actor.id)fail('FORBIDDEN');const d=this.c.deliverable(b.deliverable.id);this.c.checkVersion(d.version,b.deliverable.version)
   if(d.taskId!==t.id||d.review?.decision!=='accepted'||t.status!=='completed')fail('INVALID_STATE')
   if(b.artifactRefs.length!==d.artifactRefs.length||new Set(b.artifactRefs.map(r=>r.id)).size!==b.artifactRefs.length)fail('VALIDATION_ERROR')
   for(const ref of b.artifactRefs){if(!d.artifactRefs.includes(ref.id))fail('VALIDATION_ERROR');const f=this.c.coordination.artifact(ref.id).model;if(f.version!==ref.version||f.sha256!==ref.sha256)fail('VERSION_CONFLICT')}
   const revision=head?Number(head.head_version)+1:1;if(revision>100)fail('INVALID_STATE')
   const k=RetainedConclusion.parse({id:head?id:randomUUID(),taskId:t.id,sourceTaskVersion:t.version,confirmedBy:this.c.actor.id,version:revision,status:'current',createdAt:instant(),deliverable:b.deliverable,artifactRefs:b.artifactRefs,conclusion:b.conclusion,applicability:b.applicability,scope:b.scope})
   if(head)this.db.prepare('UPDATE conclusions SET head_version=? WHERE id=?').run(revision,id);else this.db.prepare('INSERT INTO conclusions VALUES(?,?,?,?,0,?)').run(k.id,t.id,this.c.actor.id,revision,k.createdAt)
   this.db.prepare('INSERT INTO conclusion_versions VALUES(?,?,?)').run(k.id,k.version,encode(k));return {data:this.conclusion(k.id,k.version)}
  }
  if(name==='revokeConclusion'){const b=req.body as RequestFor<'revokeConclusion'>['body'],h=this.head(id);this.c.checkVersion(Number(h.head_version),b.expectedVersion);if(h.revoked===1)fail('INVALID_STATE');this.db.prepare('UPDATE conclusions SET revoked=1,head_version=head_version+1 WHERE id=?').run(id);return {data:{id,version:Number(h.head_version)+1,status:'revoked'}}}
  if(name==='createSample'){
   const b=req.body as RequestFor<'createSample'>['body'],t=this.c.task(id),d=this.c.deliverable(b.deliverable.id);this.c.checkVersion(t.version,b.expectedVersion);this.c.checkVersion(d.version,b.deliverable.version);if(d.taskId!==t.id)fail('NOT_FOUND')
   if(b.decision==='share_selected'){if(t.reviewerId!==this.c.actor.id||d.submittedBy!==this.c.actor.id)fail('FORBIDDEN');if(t.status!=='completed'||d.review?.decision!=='accepted'||!b.authorizeLabUse||!b.selectedText||!d.summary.includes(b.selectedText))fail('VALIDATION_ERROR');if(this.db.prepare('SELECT 1 FROM reuse_edges WHERE target_kind=\'task\' AND target_id=?').get(t.id))fail('FORBIDDEN');this.c.coordination.attachments(t.id,d.artifactRefs)}else if(b.selectedText!==null||b.authorizeLabUse)fail('VALIDATION_ERROR')
   const sample=FeedbackSample.parse({id:randomUUID(),taskId:t.id,deliverable:b.deliverable,sourceTaskVersion:t.version,grantedBy:this.c.actor.id,selectedText:b.selectedText,decision:b.decision,status:b.decision==='decline'?'declined':'available',version:1,createdAt:instant()})
   this.db.prepare('INSERT INTO public_samples VALUES(?,?,?,?,?,?,?,?)').run(sample.id,this.c.actor.labId,this.c.actor.id,t.id,sample.status,1,encode(sample),sample.createdAt);sample.allowedActions=sample.status==='available'?['revoke']:[];return {data:sample}
  }
  if(name==='revokeSample'){const b=req.body as RequestFor<'revokeSample'>['body'],row=this.db.prepare('SELECT version,document FROM public_samples WHERE id=?').get(id)!;this.c.checkVersion(Number(row.version),b.expectedVersion);const s=FeedbackSample.parse(JSON.parse(String(row.document)));if(s.status!=='available')fail('INVALID_STATE');s.version++;s.status='revoked';s.decision='revoke';this.db.prepare('UPDATE public_samples SET status=?,version=?,document=? WHERE id=?').run(s.status,s.version,encode(s),id);return {data:{id,version:s.version,status:'revoked'}}}
  if(name==='publicMethods')return {data:this.state()}
  if(name==='createMethod'){
   const b=req.body as RequestFor<'createMethod'>['body'],state=this.state();this.c.checkVersion(state.generation,b.expectedVersion);if(state.methods.length>=100)fail('INVALID_STATE');for(const id of b.sampleIds)this.sample(id)
   const m=PublicMethod.parse({version:state.methods.length+1,capabilityId:state.capabilityId,labId:this.c.actor.labId,config:b.config,sampleIds:[...new Set(b.sampleIds)],createdBy:this.c.actor.id,createdAt:instant(),origin:'candidate',usable:true});this.db.prepare('INSERT INTO public_methods VALUES(?,?,?)').run(m.labId,m.version,encode(m));this.db.prepare('UPDATE public_capabilities SET version=version+1 WHERE lab_id=?').run(m.labId);this.event('created',m.version);return {data:this.method(m.version)}
  }
  if(name==='trialMethod'){
   const b=req.body as RequestFor<'trialMethod'>['body'],state=this.state();this.c.checkVersion(state.generation,b.expectedVersion);const m=this.method(b.methodVersion);if(m.origin!=='candidate'||!m.usable)fail('INVALID_STATE');const t=this.c.task(b.taskId);this.c.checkVersion(t.version,b.expectedTaskVersion);if(t.leadId!==this.c.actor.id)fail('FORBIDDEN');if(this.db.prepare('SELECT 1 FROM reuse_edges WHERE target_kind=\'task\' AND target_id=?').get(t.id))fail('FORBIDDEN')
   const ai=new AiService(this.c,this.c.execution?.enabled??false,this.c.execution?.model??'deepseek-v4-flash')
   const response=ai.handle('run',{params:{id:t.id},query:{},headers:{},body:{expectedVersion:t.version,capability:{id:state.capabilityId,version:state.generation,visibility:'lab_public'},budget:b.budget,inputArtifactIds:[],conclusionRefs:[]}}) as {data:import('./ai.js').Run}
   const run=response.data;run.methodTrial=true;run.methodVersion=m.version;run.configurationGeneration=state.generation;run.status='queued';run.failure=null;ai.save(run.id,run)
   for(const sampleId of m.sampleIds)for(const [kind,target] of [['task',t.id],['job',run.id]])this.db.prepare('INSERT OR IGNORE INTO sample_edges VALUES(?,?,?)').run(kind!,target!,sampleId)
   this.event('trial',m.version,run.id);return {data:ai.projectedRun(run.id)}
  }
  if(name==='activateMethod'||name==='disableMethod'){
   const b=req.body as RequestFor<'activateMethod'>['body'],state=this.state();this.c.checkVersion(state.generation,b.expectedVersion)
   if(name==='activateMethod'){const m=this.method(b.methodVersion);if(!m.usable||m.origin!=='candidate')fail('INVALID_STATE');const ai=new AiService(this.c,this.c.execution?.enabled??false,this.c.execution?.model??'deepseek-v4-flash'),r=ai.projectedRun(b.runId);if(!r.methodTrial||r.methodVersion!==m.version||r.status!=='succeeded'||!r.candidate||r.requestedBy!==this.c.actor.id)fail('INVALID_STATE');if(!this.db.prepare("SELECT 1 FROM execution_attempts WHERE job_id=? AND json_extract(result_json,'$.provenance')='official_harness' AND json_extract(result_json,'$.failure') IS NULL").get(r.id))fail('INVALID_STATE');this.db.prepare('UPDATE public_method_state SET active_version=? WHERE lab_id=?').run(m.version,this.c.actor.labId)}
   this.db.prepare('UPDATE public_capabilities SET version=version+1,enabled=? WHERE lab_id=?').run(name==='activateMethod'?1:0,this.c.actor.labId);this.event(name==='activateMethod'?'activated':'disabled',name==='activateMethod'?b.methodVersion:state.activeMethodVersion,name==='activateMethod'?b.runId:null);return {data:this.state()}
  }
  return this.list(name,req)
 }
 list(name:ReuseCommand,req:RequestFor<ReuseCommand>){
  const q=req.query as {limit?:number;cursor?:string;taskId?:string},limit=q.limit??30,taskId=name==='taskSamples'?(req.params as {id:string}).id:q.taskId,base={kind:name,taskId:taskId??null,limit},cursor=this.c.cursor(base,q.cursor)
  let from:string,values:(string|number)[],select:string,sort:string,project:(row:Record<string,unknown>)=>unknown
  if(name==='conclusions'){
   from=`FROM conclusions c JOIN conclusion_versions v ON v.conclusion_id=c.id AND v.version=c.head_version JOIN tasks t ON t.id=c.task_id WHERE t.lab_id=? AND NOT EXISTS(SELECT 1 FROM conclusion_denials d WHERE d.conclusion_id=c.id AND d.revision=v.version AND d.member_id=?) AND NOT EXISTS(SELECT 1 FROM reuse_denials d WHERE d.target_kind='task' AND d.target_id=c.task_id AND d.member_id=?)${q.taskId?' AND c.task_id=?':''}`;values=[this.c.actor.labId,this.c.actor.id,this.c.actor.id,...(q.taskId?[q.taskId]:[])];select='c.id,c.created_at';sort='c.id';project=r=>this.conclusion(String(r.id))
  }else if(name==='samples'){from='FROM public_samples s WHERE lab_id=? AND status=\'available\' AND NOT EXISTS(SELECT 1 FROM invalid_samples i WHERE i.id=s.id)';values=[this.c.actor.labId];select='s.id,s.created_at';sort='s.id';project=r=>this.sample(String(r.id))
  }else if(name==='taskSamples'){from='FROM public_samples s WHERE s.lab_id=? AND s.task_id=? AND s.owner_id=?';values=[this.c.actor.labId,taskId!,this.c.actor.id];select='s.*';sort='s.id';project=r=>this.ownSample(r)
  }else if(name==='methodEvents'){from='FROM method_events e WHERE lab_id=?';values=[this.c.actor.labId];select='e.*';sort='e.sequence';project=r=>({sequence:r.sequence,methodVersion:r.method_version,generation:r.generation,action:r.action,actorId:r.actor_id,at:r.at,runId:r.run_id})
  }else{
   from=`FROM execution_jobs j WHERE j.kind='planning' AND j.owner_id=? AND j.lab_id=? AND NOT EXISTS(SELECT 1 FROM reuse_denials d WHERE d.target_kind='job' AND d.target_id=j.id AND d.member_id=?)
    AND NOT EXISTS(SELECT 1 FROM json_each(j.request_json,'$.inputs') ref LEFT JOIN artifacts f ON f.id=json_extract(ref.value,'$.id') LEFT JOIN task_access a ON a.task_id=f.task_id AND a.member_id=j.owner_id LEFT JOIN tasks source ON source.id=f.task_id WHERE source.status='cancelled' OR f.id IS NULL OR f.status!='available' OR f.version!=json_extract(ref.value,'$.version') OR COALESCE(a.access,'')!='full' OR EXISTS(SELECT 1 FROM reuse_denials d WHERE d.target_kind='task' AND d.target_id=f.task_id AND d.member_id=j.owner_id))
    AND NOT EXISTS(SELECT 1 FROM json_each(j.request_json,'$.contextTasks') ref LEFT JOIN tasks t ON t.id=json_extract(ref.value,'$.id') LEFT JOIN task_access a ON a.task_id=t.id AND a.member_id=j.owner_id WHERE t.id IS NULL OR COALESCE(a.access,'')='revoked' OR (json_extract(ref.value,'$.access')='full' AND COALESCE(a.access,'')!='full') OR EXISTS(SELECT 1 FROM reuse_denials d WHERE d.target_kind='task' AND d.target_id=t.id AND d.member_id=j.owner_id))
    AND NOT EXISTS(SELECT 1 FROM reuse_denials d WHERE d.target_kind='plan' AND d.target_id=json_extract(j.document,'$.planId') AND d.member_id=j.owner_id)
    AND NOT EXISTS(SELECT 1 FROM json_each(j.request_json,'$.taskIds') ref LEFT JOIN tasks t ON t.id=ref.value LEFT JOIN task_access a ON a.task_id=t.id AND a.member_id=j.owner_id WHERE t.id IS NULL OR a.access='revoked' OR NOT(COALESCE(a.access,'')='full' OR t.claimable=1 OR EXISTS(SELECT 1 FROM assignments offer WHERE offer.task_id=t.id AND offer.member_id=j.owner_id AND offer.status='pending')) OR EXISTS(SELECT 1 FROM reuse_denials d WHERE d.target_kind='task' AND d.target_id=t.id AND d.member_id=j.owner_id))
    AND NOT EXISTS(SELECT 1 FROM plans WHERE (id=json_extract(j.request_json,'$.plan.id') OR id=json_extract(j.document,'$.planId')) AND NOT (${authorizedPlanSources}))`;values=[this.c.actor.id,this.c.actor.labId,this.c.actor.id];select='j.id,j.created_at';sort='j.id';project=r=>{const p=new AiService(this.c,this.c.execution?.enabled??false,this.c.execution?.model??'deepseek-v4-flash').getPlanning(String(r.id));const {reply,usage,...summary}=p;return summary}
  }
  const total=Number(this.db.prepare(`SELECT count(*) n ${from}`).get(...values)!.n)
  const rows=this.db.prepare(`SELECT ${select} ${from}${cursor?` AND ${sort}>?`:''} ORDER BY ${sort} LIMIT ?`).all(...values,...(cursor?[name==='methodEvents'?Number(cursor.last):cursor.last]:[]),limit+1)
  return {data:rows.slice(0,limit).map(project),nextCursor:rows.length>limit?this.c.nextCursor(base,String(name==='methodEvents'?rows[limit-1]!.sequence:rows[limit-1]!.id)):null,...(name==='methodEvents'?{}:{total}),snapshot:this.c.readSnapshot}
 }
}
