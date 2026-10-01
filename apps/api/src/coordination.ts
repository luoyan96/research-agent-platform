import { randomUUID, createHash } from 'node:crypto'
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { Artifact, Assignment, ChangeProposal, DependencyImpact, Task, TaskEvent } from '@research-agent-platform/contracts'
import type { ArtifactModel, ChangeProposalModel, DependencyImpactModel, RequestFor, TaskModel, ScheduleModel } from '@research-agent-platform/contracts'
import type { Collaboration } from './collaboration.js'
import { fail } from './errors.js'

export const coordinationCommands = ['block', 'resume', 'proposeChange', 'decideChange', 'withdraw', 'cancelTask', 'revokeAccess', 'acknowledgeImpacts', 'upload', 'artifact', 'content', 'revokeArtifact', 'events'] as const
export type CoordinationCommand = typeof coordinationCommands[number]
const now = () => new Date().toISOString()
const encode = JSON.stringify
export class Coordination {
  constructor(readonly c: Collaboration) {}
  get db() { return this.c.db }
  active(task: TaskModel) { if (task.status === 'cancelled') fail('INVALID_STATE') }
  proposal(id: string) {
    const row = this.db.prepare('SELECT task_id FROM change_proposals WHERE id=?').get(id)
    if (!row) fail('NOT_FOUND')
    this.c.task(String(row.task_id))
    return ChangeProposal.parse(JSON.parse(String(this.db.prepare('SELECT document FROM change_proposals WHERE id=?').get(id)!.document)))
  }
  artifact(id: string, allowRevoked = false) {
    const row = this.db.prepare('SELECT task_id FROM artifacts WHERE id=?').get(id)
    if (!row) fail('NOT_FOUND')
    if(this.c.access(String(row.task_id))!=='full') fail('NOT_FOUND')
    const task = this.c.task(String(row.task_id))
    if (task.status === 'cancelled') fail('NOT_FOUND')
    const file = this.db.prepare('SELECT * FROM artifacts WHERE id=?').get(id)!
    if (!allowRevoked && file.status !== 'available') fail('NOT_FOUND')
    return { model: Artifact.parse(JSON.parse(String(file.document))), key: String(file.blob_key), task }
  }
  attachments(taskId: string, refs: string[]) {
    if (new Set(refs).size !== refs.length) fail('VALIDATION_ERROR')
    for (const ref of refs) if (this.artifact(ref).model.taskId !== taskId) fail('NOT_FOUND')
  }
  authorize(name: CoordinationCommand, resource: string, body: unknown) {
    if (name === 'artifact' || name === 'content' || name === 'revokeArtifact') {
      const f = this.artifact(resource, name !== 'content')
      if (name === 'revokeArtifact' && f.task.initiatorId !== this.c.actor.id) fail('FORBIDDEN')
      return
    }
    if (name === 'decideChange') {
      const p = this.proposal(resource)
      if (!p.requiredMemberIds.includes(this.c.actor.id)) fail('FORBIDDEN')
      this.active(this.c.task(p.taskId)); return
    }
    const task = this.c.task(name === 'upload' ? (body as RequestFor<'upload'>['body']).taskId : resource)
    if (name === 'events') return
    if (name !== 'cancelTask' && name !== 'revokeAccess') this.active(task)
    const actor = this.c.actor.id
    if (['block','resume','withdraw'].includes(name) && task.leadId !== actor) fail('FORBIDDEN')
    if (['cancelTask','revokeAccess'].includes(name) && task.initiatorId !== actor) fail('FORBIDDEN')
    if (['proposeChange','upload'].includes(name) && task.leadId !== actor && task.initiatorId !== actor) fail('FORBIDDEN')
    if (name === 'acknowledgeImpacts' && task.leadId !== actor && task.reviewerId !== actor) fail('FORBIDDEN')
  }
  saveProposal(p: ChangeProposalModel) {
    ChangeProposal.parse(p)
    this.db.prepare('UPDATE change_proposals SET status=?,version=?,document=? WHERE id=?').run(p.status,p.version,encode(p),p.id)
    if(p.status!=='pending') this.db.prepare("UPDATE outbox SET status='cancelled' WHERE aggregate_id=? AND aggregate_version=? AND kind='change_proposed' AND status IN ('pending','leased')").run(p.taskId,p.expectedTaskVersion)
  }
  supersede(task: TaskModel) {
    for (const row of this.db.prepare("SELECT document FROM change_proposals WHERE task_id=? AND status='pending'").all(task.id)) {
      const p = ChangeProposal.parse(JSON.parse(String(row.document)))
      if (p.expectedTaskVersion !== task.version) { p.status='superseded'; p.version++; this.saveProposal(p) }
    }
  }
  touch(task: TaskModel, kind: string, summary?: string) {
    task.version++; task.updatedAt=now(); this.c.saveTask(task); this.c.event(task,kind,summary)
  }
  edges(task: TaskModel) {
    this.db.prepare('DELETE FROM task_dependencies WHERE task_id=?').run(task.id)
    this.db.prepare('DELETE FROM dependency_bindings WHERE task_id=?').run(task.id)
    for (const edge of task.dependencies) this.db.prepare('INSERT INTO task_dependencies VALUES (?,?,?)').run(task.id,edge.taskId,edge.requiredRevision)
  }
  validateDependencies(task: TaskModel, dependencies: TaskModel['dependencies'], authorId = this.c.actor.id) {
    if (new Set(dependencies.map(d=>d.taskId)).size !== dependencies.length) fail('VALIDATION_ERROR')
    for (const d of dependencies) {
      if (d.kind !== 'accepted_deliverable') fail('NOT_IMPLEMENTED')
      if (d.taskId === task.id) fail('VALIDATION_ERROR')
      if(!this.db.prepare("SELECT 1 FROM tasks t JOIN task_access a ON a.task_id=t.id AND a.member_id=? AND a.access='full' WHERE t.id=? AND t.lab_id=?").get(authorId,d.taskId,this.c.actor.labId)) fail('NOT_FOUND')
      const cycle = this.db.prepare(`WITH RECURSIVE chain(id) AS (SELECT ? UNION SELECT e.upstream_id FROM task_dependencies e JOIN chain c ON e.task_id=c.id) SELECT 1 FROM chain WHERE id=?`).get(d.taskId,task.id)
      if (cycle) fail('VALIDATION_ERROR')
    }
  }
  dependenciesReady(task: TaskModel, bind = false) {
    for (const d of task.dependencies) {
      if (d.kind !== 'accepted_deliverable') fail('NOT_IMPLEMENTED')
      const latest = this.db.prepare(`SELECT d.revision,r.document,d.document delivery FROM tasks t JOIN deliverables d ON d.task_id=t.id JOIN reviews r ON r.deliverable_id=d.id
        WHERE t.id=? AND t.status='completed' AND d.revision=(SELECT MAX(revision) FROM deliverables WHERE task_id=t.id)`).get(d.taskId)
      const bound = this.db.prepare('SELECT revision FROM dependency_bindings WHERE task_id=? AND upstream_id=?').get(task.id,d.taskId)
      const revision = d.requiredRevision ?? (bound ? Number(bound.revision) : null)
      if (!latest || JSON.parse(String(latest.document)).decision !== 'accepted' || (revision !== null && Number(latest.revision) !== revision)) fail('DEPENDENCY_BLOCKED')
      for(const artifactId of JSON.parse(String(latest.delivery)).artifactRefs as string[]) if(!this.db.prepare("SELECT 1 FROM artifacts WHERE id=? AND task_id=? AND status='available'").get(artifactId,d.taskId)) fail('DEPENDENCY_BLOCKED')
      if (bind && !bound) this.db.prepare('INSERT INTO dependency_bindings VALUES (?,?,?)').run(task.id,d.taskId,Number(latest.revision))
    }
  }
  runnable(task: TaskModel, bind = false) {
    this.dependenciesReady(task,bind)
    if (this.db.prepare('SELECT 1 FROM dependency_impacts WHERE task_id=? AND acknowledged=0').get(task.id)) fail('DEPENDENCY_BLOCKED')
  }
  impact(upstream: TaskModel, kind: DependencyImpactModel['kind']) {
    const rows = this.db.prepare(`WITH RECURSIVE downstream(id) AS (SELECT task_id FROM task_dependencies WHERE upstream_id=? UNION SELECT e.task_id FROM task_dependencies e JOIN downstream d ON e.upstream_id=d.id)
      SELECT t.document FROM tasks t JOIN downstream d ON d.id=t.id WHERE t.status!='cancelled'`).all(upstream.id)
    for (const row of rows) {
      const task = Task.parse(JSON.parse(String(row.document)))
      const impact = DependencyImpact.parse({ id:randomUUID(),taskId:task.id,upstreamTaskId:upstream.id,upstreamVersion:upstream.version,kind,
        affectedRevisions:this.db.prepare('SELECT revision FROM deliverables WHERE task_id=? ORDER BY revision').all(task.id).map(r=>Number(r.revision)),createdAt:now(),acknowledgedBy:null,acknowledgedAt:null,comment:null })
      this.db.prepare('INSERT INTO dependency_impacts VALUES (?,?,?,0,?)').run(impact.id,task.id,upstream.id,encode(impact))
      if (['ready','in_progress','changes_requested','in_review'].includes(task.status)) {
        task.blocker={ reason:'Dependency changed; reassess preserved work.',requestedMemberId:task.leadId,requestedAction:'Verify dependencies and acknowledge impacts before resuming.',resumeStatus:task.status as 'ready'|'in_progress'|'changes_requested'|'in_review' };task.status='blocked'
      }
      this.touch(task,'dependency_impacted')
      this.stopDispatch(task.id)
    }
  }
  stopDispatch(taskId: string) { this.db.prepare("UPDATE outbox SET status='cancelled' WHERE aggregate_id=? AND status IN ('pending','leased')").run(taskId) }
  endMember(task: TaskModel, memberId: string, status: 'withdrawn'|'cancelled', transferTo: string|null = null) {
    for (const row of this.db.prepare("SELECT document FROM assignments WHERE task_id=? AND member_id=? AND status IN ('accepted','pending')").all(task.id,memberId)) {
      const a = Assignment.parse(JSON.parse(String(row.document)));a.status=status;a.transferToMemberId=transferTo;a.version++;this.c.saveAssignment(a)
    }
    if (task.leadId === memberId) { task.leadId=null;if(task.status!=='completed') task.status='unassigned';task.blocker=null;task.schedule={...task.schedule,committed:null} }
    if (!task.leadId && task.status === 'awaiting_acceptance' && !this.db.prepare("SELECT 1 FROM assignments WHERE task_id=? AND status IN ('pending','accepted')").get(task.id)) {
      task.status='unassigned';task.blocker=null
    }
    task.participantIds=task.participantIds.filter(id=>id!==memberId)
    this.db.prepare("INSERT INTO task_access VALUES (?,?,'revoked') ON CONFLICT(task_id,member_id) DO UPDATE SET access='revoked'").run(task.id,memberId)
    this.db.prepare('UPDATE tasks SET claimable=0 WHERE id=?').run(task.id)
    this.stopDispatch(task.id)
  }
  readonly handlers: { [K in CoordinationCommand]: (r: RequestFor<K>)=>unknown } = {
    block: ({params,body}) => {
      const t=this.c.task(params.id);this.c.checkVersion(t.version,body.expectedVersion)
      if (!['ready','in_progress','changes_requested'].includes(t.status)) fail('INVALID_STATE')
      if (body.requestedMemberId) {
        this.c.member(body.requestedMemberId)
        if (!this.db.prepare("SELECT 1 FROM task_access WHERE task_id=? AND member_id=? AND access='full'").get(t.id,body.requestedMemberId)) fail('NOT_FOUND')
      }
      t.blocker={reason:body.reason,requestedMemberId:body.requestedMemberId,requestedAction:body.requestedAction,resumeStatus:t.status as 'ready'|'in_progress'|'changes_requested'};t.status='blocked'
      this.touch(t,'blocked');this.stopDispatch(t.id);this.impact(t,'blocked');return {data:this.c.actions(t)}
    },
    resume: ({params,body}) => {
      const t=this.c.task(params.id);this.c.checkVersion(t.version,body.expectedVersion)
      if (t.status!=='blocked' || !t.blocker) fail('INVALID_STATE')
      this.runnable(t,true);t.status=t.blocker.resumeStatus;t.blocker=null;this.touch(t,'resumed');return {data:this.c.actions(t)}
    },
    proposeChange: ({params,body}) => {
      const t=this.c.task(params.id);this.c.checkVersion(t.version,body.expectedVersion)
      if (!t.leadId || this.db.prepare("SELECT 1 FROM change_proposals WHERE task_id=? AND status='pending'").get(t.id)) fail('INVALID_STATE')
      if (body.proposedLeadId && body.proposedLeadId!==t.leadId) fail('NOT_IMPLEMENTED')
      if (Number(this.db.prepare('SELECT count(*) n FROM change_proposals WHERE task_id=?').get(t.id)!.n)>=100) fail('VALIDATION_ERROR')
      this.c.validateSchedule(body.schedule,true);this.validateDependencies(t,body.dependencies)
      const {expectedVersion: _expectedVersion,...terms}=body
      const p=ChangeProposal.parse({ ...terms,id:randomUUID(),taskId:t.id,expectedTaskVersion:t.version+1,proposedLeadId:t.leadId,createdBy:this.c.actor.id,createdAt:now(),requiredMemberIds:[...new Set([t.initiatorId,t.reviewerId,t.leadId])],decisions:[{memberId:this.c.actor.id,decision:'accepted',at:now()}],status:'pending',version:1 })
      // Request's expectedVersion is not part of persisted proposal shape.
      this.db.prepare('INSERT INTO change_proposals VALUES (?,?,?,?,?)').run(p.id,t.id,p.status,p.version,encode(p))
      this.db.prepare('INSERT INTO change_decisions VALUES (?,?,?)').run(p.id,this.c.actor.id,encode(p.decisions[0]))
      this.touch(t,'change_proposed');this.c.outbox(t,'change_proposed')
      if (p.requiredMemberIds.length===1) this.apply(p,t)
      return {data:p}
    },
    decideChange: ({params,body}) => {
      const p=this.proposal(params.id),t=this.c.task(p.taskId);this.c.checkVersion(p.version,body.expectedVersion)
      if (p.status==='superseded') fail('VERSION_CONFLICT')
      if (p.status!=='pending' || p.decisions.some(d=>d.memberId===this.c.actor.id)) fail('INVALID_STATE')
      this.c.checkVersion(t.version,p.expectedTaskVersion)
      const d={memberId:this.c.actor.id,decision:body.decision,at:now()};p.decisions.push(d);p.version++
      this.db.prepare('INSERT INTO change_decisions VALUES (?,?,?)').run(p.id,this.c.actor.id,encode(d))
      if (body.decision==='declined') {p.status='declined';this.saveProposal(p);this.touch(t,'change_decided')}
      else if (p.requiredMemberIds.every(id=>p.decisions.some(d=>d.memberId===id && d.decision==='accepted'))) this.apply(p,t)
      else this.saveProposal(p)
      return {data:p}
    },
    acknowledgeImpacts: ({params,body}) => {
      const t=this.c.task(params.id);this.c.checkVersion(t.version,body.expectedVersion);this.dependenciesReady(t)
      if (new Set(body.impactIds).size!==body.impactIds.length) fail('VALIDATION_ERROR')
      for (const id of body.impactIds) {
        const row=this.db.prepare('SELECT document FROM dependency_impacts WHERE id=? AND task_id=? AND acknowledged=0').get(id,t.id);if(!row) fail('NOT_FOUND')
        const impact=DependencyImpact.parse(JSON.parse(String(row.document)));impact.acknowledgedBy=this.c.actor.id;impact.acknowledgedAt=now();impact.comment=body.comment
        this.db.prepare('UPDATE dependency_impacts SET acknowledged=1,document=? WHERE id=?').run(encode(impact),id)
      }
      this.touch(t,'impacts_acknowledged');return {data:this.c.actions(t)}
    },
    withdraw: ({params,body}) => {
      const t=this.c.task(params.id);this.c.checkVersion(t.version,body.expectedVersion)
      if (t.status==='completed') fail('INVALID_STATE')
      if (body.transferToMemberId) {
        this.c.member(body.transferToMemberId)
        if (body.transferToMemberId===this.c.actor.id || this.db.prepare("SELECT 1 FROM task_access WHERE task_id=? AND member_id=? AND access='revoked'").get(t.id,body.transferToMemberId)) fail('FORBIDDEN')
        if (Number(this.db.prepare('SELECT count(*) n FROM assignments WHERE task_id=?').get(t.id)!.n)>=100) fail('VALIDATION_ERROR')
      }
      this.endMember(t,this.c.actor.id,'withdrawn',body.transferToMemberId)
      if ([t.initiatorId,t.reviewerId].includes(this.c.actor.id)) this.c.grant(t.id,this.c.actor.id,'full')
      if (body.transferToMemberId) {
        const schedule={...t.schedule,committed:null};this.c.createAssignment(t,'invitation',body.transferToMemberId,body.remainingScope,schedule);t.status='awaiting_acceptance'
        this.db.prepare("UPDATE tasks SET summary_document=json_set(summary_document,'$.deliverable',?,'$.summary',?,'$.schedule',json(?)) WHERE id=?").run(body.remainingScope,body.remainingScope,encode(schedule),t.id)
      }
      this.touch(t,'withdrawn',body.reason);this.c.event(t,'withdrawn',body.remainingScope);this.impact(t,'withdrawn')
      if (body.transferToMemberId) this.c.outbox(t,'transfer_invitation_created')
      return {data:{taskId:t.id,taskVersion:t.version,status:'withdrawn'}}
    },
    revokeAccess: ({params,body}) => {
      const t=this.c.task(params.id);this.c.checkVersion(t.version,body.expectedVersion)
      if ([t.initiatorId,t.reviewerId].includes(body.memberId)) fail('FORBIDDEN')
      this.c.member(body.memberId)
      if (t.status==='cancelled') fail('INVALID_STATE')
      this.endMember(t,body.memberId,'cancelled');this.touch(t,'access_revoked',body.reason);this.impact(t,'access_revoked');return {data:this.c.actions(t)}
    },
    cancelTask: ({params,body}) => {
      const t=this.c.task(params.id);this.c.checkVersion(t.version,body.expectedVersion);this.active(t)
      if(t.status==='completed') fail('INVALID_STATE')
      for (const row of this.db.prepare("SELECT document FROM assignments WHERE task_id=? AND status IN ('pending','accepted')").all(t.id)) {const a=Assignment.parse(JSON.parse(String(row.document)));a.status='cancelled';a.version++;this.c.saveAssignment(a)}
      this.db.prepare("UPDATE task_access SET access='revoked' WHERE task_id=? AND member_id!=?").run(t.id,t.initiatorId)
      this.db.prepare('UPDATE tasks SET claimable=0 WHERE id=?').run(t.id)
      t.status='cancelled';t.blocker=null;this.touch(t,'cancelled',body.reason);this.stopDispatch(t.id);this.impact(t,'cancelled');return {data:this.c.actions(t)}
    },
    upload: ({body}) => {
      const t=this.c.task(body.taskId);this.c.checkVersion(t.version,body.expectedVersion)
      if (t.status==='completed') fail('INVALID_STATE')
      if (Number(this.db.prepare('SELECT count(*) n FROM artifacts WHERE task_id=?').get(t.id)!.n)>=100) fail('VALIDATION_ERROR')
      const bytes=Buffer.from(body.contentBase64,'base64')
      if (bytes.length<1 || bytes.length>10485760) fail('PAYLOAD_TOO_LARGE')
      if (bytes.toString('base64')!==body.contentBase64 || /[\\/\x00-\x1f\x7f]/.test(body.filename)) fail('VALIDATION_ERROR')
      if (body.mediaType==='application/pdf' && !bytes.subarray(0,5).equals(Buffer.from('%PDF-'))) fail('VALIDATION_ERROR')
      if (body.mediaType==='image/png' && !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail('VALIDATION_ERROR')
      if (body.mediaType==='text/plain') {try{new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{fail('VALIDATION_ERROR')} if(bytes.includes(0)) fail('VALIDATION_ERROR')}
      const id=randomUUID(),key=`${id}.blob`
      if (!this.c.blobRoot) fail('SERVICE_UNAVAILABLE')
      const path=join(this.c.blobRoot,key)
      try{writeFileSync(path,bytes,{flag:'wx',mode:0o600});this.c.createdBlobs.push(path)}catch{fail('SERVICE_UNAVAILABLE')}
      const artifact=Artifact.parse({id,taskId:t.id,filename:body.filename,mediaType:body.mediaType,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),version:1,createdAt:now(),accessStatus:'available'})
      this.db.prepare('INSERT INTO artifacts VALUES (?,?,?,?,?,?,?)').run(id,t.id,this.c.actor.id,'available',1,key,encode(artifact));this.touch(t,'artifact_uploaded');return {data:artifact}
    },
    artifact: ({params})=>({data:this.artifact(params.id,true).model}),
    content: ({params})=>{
      const file=this.artifact(params.id)
      if (!this.c.blobRoot) fail('SERVICE_UNAVAILABLE')
      try { const bytes=readFileSync(join(this.c.blobRoot,file.key));if(bytes.length!==file.model.size || createHash('sha256').update(bytes).digest('hex')!==file.model.sha256) fail('SERVICE_UNAVAILABLE');return bytes }catch{fail('SERVICE_UNAVAILABLE')}
    },
    revokeArtifact: ({params,body})=>{
      const file=this.artifact(params.id,true);this.c.checkVersion(file.model.version,body.expectedVersion)
      if(file.model.accessStatus==='revoked') fail('INVALID_STATE')
      file.model.version++;file.model.accessStatus='revoked'
      this.db.prepare("UPDATE artifacts SET status='revoked',version=?,document=? WHERE id=?").run(file.model.version,encode(file.model),file.model.id)
      this.db.prepare('INSERT INTO artifact_revocations VALUES (?,?,?,?)').run(file.model.id,this.c.actor.id,body.reason,now())
      this.touch(file.task,'artifact_revoked');this.stopDispatch(file.task.id);this.impact(file.task,'artifact_revoked');return {data:file.model}
    },
    events: ({params,query})=>{
      this.c.task(params.id);const base={kind:'events',taskId:params.id,limit:query.limit??30};const cursor=this.c.cursor(base,query.cursor)
      const rows=this.db.prepare('SELECT sequence,document FROM task_events WHERE task_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(params.id,Number(cursor?.last??0),base.limit+1)
      return {data:rows.slice(0,base.limit).map(r=>TaskEvent.parse(JSON.parse(String(r.document)))),nextCursor:rows.length>base.limit?this.c.nextCursor(base,String(rows[base.limit-1]!.sequence)):null}
    },
  }
  apply(p: ChangeProposalModel,t: TaskModel) {
    this.validateDependencies(t,p.dependencies,p.createdBy);this.c.validateSchedule(p.schedule,true)
    const changedDependencies=encode(t.dependencies)!==encode(p.dependencies)
    t.goal=p.goal;t.acceptanceCriteria=p.acceptanceCriteria;t.schedule=p.schedule;t.dependencies=p.dependencies
    for(const row of this.db.prepare("SELECT document FROM assignments WHERE task_id=? AND status='accepted'").all(t.id)) {const a=Assignment.parse(JSON.parse(String(row.document)));a.commitment={scope:p.scope,schedule:p.schedule,acceptedAt:now()};a.version++;this.c.saveAssignment(a)}
    if (['completed','in_review'].includes(t.status)) {t.status='changes_requested';t.blocker=null}
    p.status='accepted';this.saveProposal(p);if(changedDependencies)this.edges(t);this.touch(t,'change_decided')
    this.db.prepare("UPDATE tasks SET summary_document=json_set(summary_document,'$.deliverable',?,'$.acceptanceCriteria',?,'$.schedule',json(?)) WHERE id=?").run(p.scope,p.acceptanceCriteria,encode(p.schedule),t.id)
    this.stopDispatch(t.id);this.impact(t,'changed')
  }
}
export function cleanBlobs(paths: string[]) { for(const path of paths) { try{unlinkSync(path)}catch{/* inaccessible orphan; no public file route */} } }
