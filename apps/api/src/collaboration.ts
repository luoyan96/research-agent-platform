import { ReuseService } from './reuse.js'
import { AiService } from './ai.js'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { Assignment, Availability, Artifact, ChangeProposal, DependencyImpact, Deliverable, Member, Plan, PlanSummary, Task, TaskEvent, TaskSummary, taskColumns, routes } from '@research-agent-platform/contracts'
import type { AssignmentModel, DeliverableModel, PlanModel, RequestFor, RouteName, ScheduleModel, TaskModel } from '@research-agent-platform/contracts'
import { hash, signingKey } from './auth.js'
import type { Actor } from './auth.js'
import { Coordination, coordinationCommands } from './coordination.js'
import type { CoordinationCommand } from './coordination.js'
import { fail } from './errors.js'

export const authorizedPlanSources=`NOT EXISTS(SELECT 1 FROM reuse_denials rd WHERE rd.target_kind='plan' AND rd.target_id=plans.id AND rd.member_id=plans.owner_id) AND NOT EXISTS (SELECT 1 FROM execution_jobs j,json_each(j.request_json,'$.inputs') ref
 LEFT JOIN artifacts f ON f.id=json_extract(ref.value,'$.id') LEFT JOIN tasks source ON source.id=f.task_id
 LEFT JOIN task_access access ON access.task_id=source.id AND access.member_id=plans.owner_id
 WHERE j.kind='planning' AND json_extract(j.document,'$.planId')=plans.id
 AND (f.id IS NULL OR f.status!='available' OR f.version!=json_extract(ref.value,'$.version') OR source.status='cancelled' OR COALESCE(access.access,'')!='full'))
 AND NOT EXISTS (SELECT 1 FROM execution_jobs j,json_each(j.request_json,'$.taskIds') ref
 LEFT JOIN tasks source ON source.id=ref.value LEFT JOIN task_access access ON access.task_id=source.id AND access.member_id=plans.owner_id
 WHERE j.kind='planning' AND json_extract(j.document,'$.planId')=plans.id
 AND (source.id IS NULL OR access.access='revoked' OR NOT (COALESCE(access.access,'')='full' OR source.claimable=1 OR EXISTS(SELECT 1 FROM assignments a WHERE a.task_id=source.id AND a.member_id=plans.owner_id AND a.status='pending')))) AND NOT EXISTS (SELECT 1 FROM execution_jobs j,json_each(j.request_json,'$.contextTasks') ref
 LEFT JOIN tasks source ON source.id=json_extract(ref.value,'$.id') LEFT JOIN task_access access ON access.task_id=source.id AND access.member_id=plans.owner_id
 WHERE j.kind='planning' AND json_extract(j.document,'$.planId')=plans.id
 AND (source.id IS NULL OR access.access='revoked' OR (json_extract(ref.value,'$.access')='full' AND COALESCE(access.access,'')!='full') OR NOT (COALESCE(access.access,'')='full' OR source.claimable=1 OR EXISTS(SELECT 1 FROM assignments a WHERE a.task_id=source.id AND a.member_id=plans.owner_id AND a.status='pending'))))`
const attentionRun=`r.rowid=(SELECT MAX(latest.rowid) FROM execution_jobs latest WHERE latest.task_id=r.task_id) AND (r.status IN ('failed','interrupted','waiting_input') OR (r.status='succeeded' AND json_extract(r.document,'$.candidateDeliverableId') IS NULL))`
const now = () => new Date().toISOString()
const id = () => randomUUID()
const encode = (value: unknown) => JSON.stringify(value)
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}
export const collaborationCommands = [...coordinationCommands, 'overview', 'plans', 'actionItems', 'availability', 'me', 'members', 'createPlan', 'getPlan', 'editPlan', 'confirmPlan', 'tasks', 'task', 'invite', 'invitationDecision', 'claim', 'start', 'submit', 'review'] as const satisfies readonly RouteName[]
export type CollaborationCommand = typeof collaborationCommands[number]
type Handlers = { [K in Exclude<CollaborationCommand,CoordinationCommand>]: (request: RequestFor<K>) => unknown }

export class Collaboration {
  readSnapshot?: { token: string; at: string; expiresAt: string }
  readonly createdBlobs: string[] = []
  readonly coordination = new Coordination(this)
  constructor(readonly db: DatabaseSync, readonly actor: Actor, readonly blobRoot?: string, readonly execution?: {enabled:boolean;model:string}) {}
  sameLab(labId: string) { if (this.actor.labId !== labId) fail('NOT_FOUND') }
  checkVersion(actual: number, expected: number) { if (actual !== expected) fail('VERSION_CONFLICT') }
  revision() { return createHmac('sha256', signingKey(this.db)).update(String(this.db.prepare("SELECT value FROM runtime_meta WHERE key='revision'").get()!.value)).digest('hex') }
  changed() { this.db.exec("UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'") }
  plan(planId: string): PlanModel {
    const row = this.db.prepare(`SELECT document FROM plans WHERE id=? AND owner_id=? AND lab_id=? AND ${authorizedPlanSources}`).get(planId, this.actor.id, this.actor.labId)
    if (!row) fail('NOT_FOUND')
    return Plan.parse({...JSON.parse(String(row.document)),conclusionRefs:new ReuseService(this).bindings('plan',planId)})
  }
  // One relational visibility predicate for detail, lists, counts and action items.
  visible(scope: 'lab' | 'mine' = 'lab') {
    return { sql: `FROM tasks t LEFT JOIN task_access acl ON acl.task_id=t.id AND acl.member_id=?
      WHERE t.lab_id=? AND COALESCE(acl.access,'')!='revoked' AND NOT EXISTS(SELECT 1 FROM reuse_denials rd WHERE rd.target_kind='task' AND rd.target_id=t.id AND rd.member_id=?)
      AND (acl.access='full' OR t.claimable=1 OR EXISTS(SELECT 1 FROM assignments a WHERE a.task_id=t.id AND a.member_id=? AND a.status='pending'))
      AND (?='lab' OR t.initiator_id=? OR t.lead_id=? OR t.reviewer_id=? OR (acl.access='full' AND EXISTS(SELECT 1 FROM json_each(t.document,'$.participantIds') p WHERE p.value=?)) OR EXISTS(SELECT 1 FROM assignments a WHERE a.task_id=t.id AND a.member_id=? AND a.status='pending'))`,
      values: [this.actor.id, this.actor.labId, this.actor.id, this.actor.id, scope, this.actor.id, this.actor.id, this.actor.id, this.actor.id, this.actor.id] }
  }
  taskRow(taskId: string) {
    const v = this.visible()
    const row = this.db.prepare(`SELECT t.id,t.lab_id,t.initiator_id,t.lead_id,t.reviewer_id,t.status,t.claimable,t.version,t.created_at,acl.access ${v.sql} AND t.id=?`).get(...v.values, taskId)
    if (!row) fail('NOT_FOUND')
    return row
  }
  access(taskId: string): 'full' | 'summary' {
    const row = this.taskRow(taskId)
    if (row.access === 'full') return 'full'
    if (row.claimable === 1 || this.db.prepare("SELECT id FROM assignments WHERE task_id=? AND member_id=? AND status='pending'").get(taskId, this.actor.id)) return 'summary'
    fail('NOT_FOUND')
  }
  task(taskId: string): TaskModel {
    if (this.access(taskId) !== 'full') fail('FORBIDDEN')
    return Task.parse({...JSON.parse(String(this.db.prepare('SELECT document FROM tasks WHERE id=?').get(taskId)!.document)),conclusionRefs:new ReuseService(this).bindings('task',taskId)})
  }
  assignment(assignmentId: string) {
    const metadata = this.db.prepare('SELECT task_id,member_id FROM assignments WHERE id=?').get(assignmentId)
    if (!metadata) fail('NOT_FOUND')
    // Own decision history remains replayable after declining, but explicit revocation wins.
    const allowed = this.db.prepare("SELECT t.id FROM tasks t LEFT JOIN task_access acl ON acl.task_id=t.id AND acl.member_id=? WHERE t.id=? AND t.lab_id=? AND COALESCE(acl.access,'')!='revoked' AND NOT EXISTS(SELECT 1 FROM reuse_denials rd WHERE rd.target_kind='task' AND rd.target_id=t.id AND rd.member_id=acl.member_id)").get(this.actor.id, metadata.task_id!, this.actor.labId)
    if (!allowed) fail('NOT_FOUND')
    if (metadata.member_id !== this.actor.id && this.access(String(metadata.task_id)) !== 'full') fail('NOT_FOUND')
    const row = this.db.prepare('SELECT document,offer_scope,offer_schedule FROM assignments WHERE id=?').get(assignmentId)!
    return { model: Assignment.parse(JSON.parse(String(row.document))), scope: String(row.offer_scope), schedule: JSON.parse(String(row.offer_schedule)) as ScheduleModel }
  }
  deliverable(deliverableId: string): DeliverableModel {
    const metadata = this.db.prepare('SELECT task_id FROM deliverables WHERE id=?').get(deliverableId)
    if (!metadata) fail('NOT_FOUND')
    this.task(String(metadata.task_id))
    const row = this.db.prepare('SELECT document FROM deliverables WHERE id=?').get(deliverableId)!
    return Deliverable.parse(JSON.parse(String(row.document)))
  }
  member(memberId: string) {
    const row = this.db.prepare('SELECT id,lab_id,display_name,version FROM members WHERE id=? AND lab_id=?').get(memberId, this.actor.labId)
    if (!row) fail('NOT_FOUND')
    const commitments = this.db.prepare(`SELECT a.document FROM assignments a JOIN tasks t ON t.id=a.task_id
      JOIN task_access acl ON acl.task_id=t.id AND acl.member_id=? AND acl.access='full'
      WHERE NOT EXISTS(SELECT 1 FROM reuse_denials rd WHERE rd.target_kind='task' AND rd.target_id=t.id AND rd.member_id=acl.member_id) AND a.member_id=? AND a.status='accepted' AND t.lab_id=? AND t.status NOT IN ('completed','cancelled') ORDER BY t.id LIMIT 101`).all(this.actor.id, memberId, this.actor.labId)
      .map(r => Assignment.parse(JSON.parse(String(r.document)))).map(a => ({ taskId: a.taskId, scope: a.commitment!.scope, schedule: a.commitment!.schedule }))
    const saved = this.db.prepare('SELECT document FROM member_availability WHERE member_id=?').get(memberId)
    const availability = saved ? Availability.parse(JSON.parse(String(saved.document))) : null
    const date = availability ? new Intl.DateTimeFormat('en-CA', { timeZone: availability.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.readSnapshot?.at ?? now())) : ''
    const availabilityStatus = !availability ? 'unknown' : date < availability.from ? 'upcoming' : date > availability.to ? 'expired' : 'current'
    return Member.parse({ id: row.id, labId: row.lab_id, displayName: row.display_name, version: row.version, publicExpertise: [], availability, availabilityStatus, visibleCommitmentsTruncated: commitments.length > 100, visibleCommitments: commitments.slice(0, 100) })
  }
  actions(task: TaskModel): TaskModel {
    const allowedActions: TaskModel['allowedActions'] = []
    if (!task.leadId && task.status === 'awaiting_acceptance' && this.taskRow(task.id).claimable === 1) allowedActions.push('claim')
    if (task.initiatorId === this.actor.id && ['unassigned', 'awaiting_acceptance'].includes(task.status) && !this.db.prepare("SELECT id FROM assignments WHERE task_id=? AND status IN ('pending','accepted')").get(task.id)) allowedActions.push('invite')
    if (task.leadId === this.actor.id) {
      if (['ready', 'changes_requested'].includes(task.status)) allowedActions.push('start')
      if (['in_progress', 'changes_requested'].includes(task.status)) allowedActions.push('submit')
      if(this.execution?.enabled && ['ready','in_progress','changes_requested'].includes(task.status) && !this.db.prepare("SELECT 1 FROM execution_jobs WHERE task_id=? AND status IN ('queued','running','waiting_input')").get(task.id)){try{if(new AiService(this,true,this.execution.model).capability()?.status==='available'){this.coordination.runnable(task);allowedActions.push('run')}}catch{/* dependency or impact blocks execution */}}
    }
    if (task.reviewerId === this.actor.id && task.status === 'in_review') allowedActions.push('review')
    if(task.status!=='cancelled') {
      if(task.leadId && [task.leadId,task.initiatorId].includes(this.actor.id)) allowedActions.push('propose_change')
      if(task.initiatorId===this.actor.id) {allowedActions.push('revoke_access');if(task.status!=='completed')allowedActions.push('cancel')}
      if(task.status!=='completed' && [task.leadId,task.initiatorId].includes(this.actor.id)) allowedActions.push('upload')
      if(task.leadId===this.actor.id && task.status!=='completed') {allowedActions.push('withdraw');if(task.status==='blocked') allowedActions.push('resume');else if(['ready','in_progress','changes_requested'].includes(task.status)) allowedActions.push('block')}
      if([task.leadId,task.reviewerId].includes(this.actor.id) && this.db.prepare('SELECT 1 FROM dependency_impacts WHERE task_id=? AND acknowledged=0').get(task.id)) allowedActions.push('acknowledge_impacts')
    }
    const accepted=this.db.prepare("SELECT document FROM deliverables WHERE task_id=? AND json_extract(document,'$.review.decision')='accepted' ORDER BY revision DESC LIMIT 1").get(task.id)
    if(accepted){allowedActions.push('decline_feedback');if(task.status==='completed'&&task.reviewerId===this.actor.id)allowedActions.push('retain_conclusion');const delivery=Deliverable.parse(JSON.parse(String(accepted.document)));if(task.status==='completed'&&task.reviewerId===this.actor.id&&delivery.submittedBy===this.actor.id&&!this.db.prepare("SELECT 1 FROM reuse_edges WHERE target_kind='task' AND target_id=?").get(task.id))allowedActions.push('share_feedback')}
    return { ...task, allowedActions }
  }
  summary(taskId: string) {
    const row = this.db.prepare('SELECT summary_document,version,lead_id,status,claimable FROM tasks WHERE id=?').get(taskId)!
    const invitation = this.db.prepare("SELECT id,version,offer_scope,offer_schedule FROM assignments WHERE task_id=? AND member_id=? AND status='pending'").get(taskId, this.actor.id)
    return TaskSummary.parse({ ...JSON.parse(String(row.summary_document)), version: row.version, visibleStatus: row.status,
      allowedActions: invitation ? ['decide'] : row.claimable === 1 && row.lead_id === null && row.status === 'awaiting_acceptance' ? ['claim'] : [],
      pendingInvitation: invitation ? { id: invitation.id, version: invitation.version, scope: invitation.offer_scope, schedule: JSON.parse(String(invitation.offer_schedule)) } : null })
  }
  projection(taskId: string, detail: boolean): unknown {
    if (this.access(taskId) === 'summary') return this.summary(taskId)
    const task = this.actions(this.task(taskId))
    if (!detail) return task
    return { task, assignments: this.db.prepare('SELECT document FROM assignments WHERE task_id=? ORDER BY id').all(taskId).map(r => Assignment.parse(JSON.parse(String(r.document)))),
      deliverables: this.db.prepare('SELECT document FROM deliverables WHERE task_id=? ORDER BY revision').all(taskId).map(r => Deliverable.parse(JSON.parse(String(r.document)))), executions: this.db.prepare("SELECT id FROM execution_jobs WHERE task_id=? AND kind='capability' ORDER BY created_at DESC LIMIT 100").all(taskId).map(r=>new AiService(this,this.execution?.enabled??false,this.execution?.model??'deepseek-v4-flash').projectedRun(String(r.id))), changes: this.db.prepare('SELECT document FROM change_proposals WHERE task_id=? ORDER BY rowid').all(taskId).map(r=>ChangeProposal.parse(JSON.parse(String(r.document)))), dependencyImpacts: this.db.prepare('SELECT document FROM dependency_impacts WHERE task_id=? ORDER BY acknowledged,rowid DESC LIMIT 100').all(taskId).map(r=>{const impact=DependencyImpact.parse(JSON.parse(String(r.document)));const v=this.visible();const visible=this.db.prepare(`SELECT t.id ${v.sql} AND t.id=?`).get(...v.values,impact.upstreamTaskId);return visible?impact:{...impact,upstreamTaskId:null,upstreamVersion:null}}), dependencyImpactsTruncated: Number(this.db.prepare('SELECT count(*) n FROM dependency_impacts WHERE task_id=?').get(taskId)!.n)>100, artifacts: this.db.prepare('SELECT document FROM artifacts WHERE task_id=? ORDER BY rowid').all(taskId).map(r=>Artifact.parse(JSON.parse(String(r.document)))) }
  }
  savePlan(plan: PlanModel) {
    Plan.parse(plan)
    this.db.prepare('INSERT INTO plans VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,document=excluded.document').run(plan.id, plan.labId, plan.ownerId, plan.version, encode(plan))
    this.db.prepare('INSERT INTO plan_versions VALUES (?,?,?)').run(plan.id, plan.version, encode(plan))
  }
  saveTask(task: TaskModel) {
    task.allowedActions = []
    Task.parse(task)
    this.db.prepare('UPDATE tasks SET lead_id=?,status=?,version=?,document=? WHERE id=?').run(task.leadId, task.status, task.version, encode(task), task.id)
    this.db.prepare('INSERT INTO task_versions VALUES (?,?,?)').run(task.id,task.version,encode(task))
    this.coordination.supersede(task)
  }
  saveAssignment(a: AssignmentModel) {
    Assignment.parse(a)
    this.db.prepare('UPDATE assignments SET status=?,version=?,document=? WHERE id=?').run(a.status, a.version, encode(a), a.id)
    this.db.prepare('INSERT INTO assignment_versions VALUES (?,?,?)').run(a.id,a.version,encode(a))
  }
  event(task: TaskModel, kind: string, summary?: string) {
    const event = TaskEvent.parse({ id: id(), taskId: task.id, actor: { kind: 'member', memberId: this.actor.id }, kind, resourceVersion: task.version, timestamp: now(), summary: summary ?? `Task ${kind}` })
    this.db.prepare('INSERT INTO task_events(id,task_id,document) VALUES (?,?,?)').run(event.id, task.id, encode(event))
  }
  outbox(task: TaskModel, kind: string) {
    this.coordination.active(task)
    this.db.prepare('INSERT INTO outbox(id,dedup_key,aggregate_id,aggregate_version,kind,payload_json,available_at,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id(), `${task.id}:${task.version}:${kind}`, task.id, task.version, kind, encode({ taskId: task.id }), now(), now())
  }
  grant(taskId: string, memberId: string, access: 'full' | 'summary') {
    this.db.prepare('INSERT INTO task_access VALUES (?,?,?) ON CONFLICT(task_id,member_id) DO UPDATE SET access=excluded.access').run(taskId, memberId, access)
  }
  validateSchedule(schedule: ScheduleModel, allowCommitment = false) {
    if (schedule.committed !== null && (!allowCommitment || schedule.committed.source !== 'member' || !schedule.committed.confirmed)) fail('VALIDATION_ERROR')
    if (schedule.hardDeadline && (!schedule.hardDeadline.confirmed || !['user', 'authorized_material'].includes(schedule.hardDeadline.source))) fail('VALIDATION_ERROR')
  }
  validatePlan(plan: RequestFor<'createPlan'>['body']) {
    this.sameLab(plan.labId)
    const ids = new Set(plan.proposedItems.map(item => item.id))
    if (ids.size !== plan.proposedItems.length) fail('VALIDATION_ERROR')
    for (const item of plan.proposedItems) {
      this.validateSchedule(item.schedule)
      if (item.inputArtifactIds.length) fail('NOT_IMPLEMENTED')
      if (item.allocation.kind === 'invitation') {
        this.member(item.allocation.memberId)
        if (item.allocation.memberId === this.actor.id) fail('VALIDATION_ERROR')
      }
      if (item.dependencies.some(dependency => !ids.has(dependency))) fail('VALIDATION_ERROR')
    }
    const visiting = new Set<string>(), visited = new Set<string>()
    const visit = (itemId: string) => {
      if (visiting.has(itemId)) fail('VALIDATION_ERROR')
      if (visited.has(itemId)) return
      visiting.add(itemId)
      for (const next of plan.proposedItems.find(i => i.id === itemId)!.dependencies) visit(next)
      visiting.delete(itemId); visited.add(itemId)
    }
    for (const itemId of ids) visit(itemId)
  }
  authorize(name: CollaborationCommand, resourceId: string, body: unknown) {
    if ((coordinationCommands as readonly string[]).includes(name)) {this.coordination.authorize(name as CoordinationCommand,resourceId,body);return}
    if (name === 'createPlan') { this.sameLab((body as RequestFor<'createPlan'>['body']).labId); return }
    if (['editPlan', 'confirmPlan', 'getPlan'].includes(name)) { this.plan(resourceId); return }
    if (name === 'invitationDecision') {
      const { model } = this.assignment(resourceId)
      const state=this.db.prepare('SELECT status FROM tasks WHERE id=?').get(model.taskId)!
      if(state.status==='cancelled') fail('INVALID_STATE')
      if (model.memberId !== this.actor.id) fail('NOT_FOUND')
      return
    }
    if (name === 'review') {
      const delivery = this.deliverable(resourceId)
      this.coordination.active(this.task(delivery.taskId));this.coordination.attachments(delivery.taskId,delivery.artifactRefs)
      if (this.task(delivery.taskId).reviewerId !== this.actor.id) fail('FORBIDDEN')
      return
    }
    if (name === 'claim') { const row = this.taskRow(resourceId); if (row.claimable !== 1) fail('NOT_FOUND'); return }
    if (['invite', 'start', 'submit'].includes(name)) {
      const task = this.task(resourceId)
      this.coordination.active(task)
      if (name==='submit') {const b=body as RequestFor<'submit'>['body'];this.coordination.attachments(task.id,[...new Set([...b.artifactRefs,...b.sources.filter(s=>s.kind==='artifact').map(s=>s.locator)])])}
      if (name === 'invite' ? task.initiatorId !== this.actor.id : task.leadId !== this.actor.id) fail('FORBIDDEN')
    }
  }
  run<K extends CollaborationCommand>(name: K, request: RequestFor<K>): unknown {
    const route = routes[name]
    const params = request.params as { id?: string }
    const resource = params.id ?? this.actor.labId
    // Must run inside caller's transaction, after authenticating the current session.
    this.authorize(name, resource, request.body)
    if(['invite','withdraw'].includes(name)){const b=request.body as {memberId?:string;transferToMemberId?:string};const member=b.memberId??b.transferToMemberId;if(member){const refs=this.db.prepare("SELECT conclusion_id,revision FROM reuse_closure WHERE target_kind='task' AND target_id=?").all(resource).map(r=>new ReuseService(this).conclusion(String(r.conclusion_id),Number(r.revision)));new ReuseService(this).range(refs,[member])}}
    const key = (request.headers as { 'Idempotency-Key'?: string })['Idempotency-Key']
    const requestHash = hash(canonical(request))
    if (route.idempotent) {
      const cached = this.db.prepare('SELECT request_hash,response_json FROM idempotency_results WHERE actor_id=? AND command=? AND resource_id=? AND key=?').get(this.actor.id, name, resource, key!)
      if (cached) {
        if (cached.request_hash !== requestHash) fail('IDEMPOTENCY_CONFLICT')
        const value=JSON.parse(String(cached.response_json))
        if(name==='upload') this.coordination.artifact(value.data.id)
        if(name==='submit' || name==='review') this.coordination.attachments(value.data.taskId,value.data.artifactRefs)
        return route.response.parse(value)
      }
    }
    if (route.method === 'GET') this.readSnapshot = this.snapshot((request.query as { snapshot?: string; cursor?: string }).snapshot, (request.query as { cursor?: string }).cursor)
    const handler = (coordinationCommands as readonly string[]).includes(name) ? this.coordination.handlers[name as CoordinationCommand] : this.handlers[name as keyof typeof this.handlers]
    const response = (handler as (r: RequestFor<K>) => unknown)(request)
    // Validate before commit so an invalid response cannot leave committed effects.
    const validated = route.response.parse(route.method === 'GET' && name !== 'content' ? { ...response as object, snapshot: this.readSnapshot } : response)
    if (route.idempotent) {
      this.db.prepare('INSERT INTO idempotency_results VALUES (?,?,?,?,?,?,?,?)').run(this.actor.id, name, resource, key!, requestHash, encode(validated), route.status, now())
      this.changed()
    }
    return validated
  }
  snapshot(token?: string, cursor?: string) {
    if (!token && cursor) {
      try {
        const [payload, signature, extra] = cursor.split('.')
        if (!payload || extra || signature !== createHmac('sha256', signingKey(this.db)).update(`cursor:${payload}`).digest('hex')) fail('CURSOR_EXPIRED')
        token = JSON.parse(Buffer.from(payload, 'base64url').toString()).snapshot
        if (!token) fail('CURSOR_EXPIRED')
      } catch { fail('CURSOR_EXPIRED') }
    }
    if (token) {
      try {
        const [payload, signature, extra] = token.split('.')
        if (!payload || extra || signature !== createHmac('sha256', signingKey(this.db)).update(`snapshot:${payload}`).digest('hex')) fail('CURSOR_EXPIRED')
        const v = JSON.parse(Buffer.from(payload, 'base64url').toString())
        if (v.actor !== this.actor.id || v.lab !== this.actor.labId || v.revision !== this.revision() || v.expires <= Date.now()) fail('CURSOR_EXPIRED')
        return { token, at: v.at as string, expiresAt: new Date(v.expires).toISOString() }
      } catch { fail('CURSOR_EXPIRED') }
    }
    const at = now(), expires = Date.now() + 900000
    const payload = Buffer.from(encode({ actor: this.actor.id, lab: this.actor.labId, revision: this.revision(), at, expires })).toString('base64url')
    return { token: `${payload}.${createHmac('sha256', signingKey(this.db)).update(`snapshot:${payload}`).digest('hex')}`, at, expiresAt: new Date(expires).toISOString() }
  }
  cursor(query: unknown, cursor: string | undefined): { last: string; created: string } | null {
    if (!cursor) return null
    try {
      const [payload, signature, extra] = cursor.split('.')
      if (!payload || extra || !signature || !/^[a-f0-9]{64}$/.test(signature)) fail('CURSOR_EXPIRED')
      const expected = createHmac('sha256', signingKey(this.db)).update(`cursor:${payload}`).digest()
      if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) fail('CURSOR_EXPIRED')
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { actor: string; query: string; revision: string; expires: number; last: string; created: string; snapshot?: string }
      if (data.snapshot !== this.readSnapshot?.token) fail('CURSOR_EXPIRED')
      if (data.actor !== this.actor.id || data.query !== canonical(query) || data.revision !== this.revision() || data.expires < Date.now() || typeof data.last !== 'string' || typeof data.created !== 'string') fail('CURSOR_EXPIRED')
      return data
    } catch { fail('CURSOR_EXPIRED') }
  }
  nextCursor(query: unknown, last: string, created = '') {
    const payload = Buffer.from(encode({ snapshot: this.readSnapshot?.token, actor: this.actor.id, query: canonical(query), revision: this.revision(), expires: Date.now() + 900000, last, created })).toString('base64url')
    return `${payload}.${createHmac('sha256', signingKey(this.db)).update(`cursor:${payload}`).digest('hex')}`
  }
  createAssignment(task: TaskModel, kind: 'self' | 'invitation' | 'claim', memberId: string, scope: string, schedule: ScheduleModel) {
    const accepted = kind !== 'invitation'
    const assignment = Assignment.parse({ id: id(), taskId: task.id, kind, memberId, capability: null, status: accepted ? 'accepted' : 'pending', commitment: accepted ? { scope, schedule, acceptedAt: now() } : null, transferToMemberId: null, version: 1 })
    this.db.prepare('INSERT INTO assignments VALUES (?,?,?,?,?,?,?,?,?)').run(assignment.id, task.id, memberId, kind, assignment.status, 1, encode(assignment), scope, encode(schedule))
    this.db.prepare('INSERT INTO assignment_versions VALUES (?,?,?)').run(assignment.id,assignment.version,encode(assignment))
    this.grant(task.id, memberId, accepted ? 'full' : 'summary')
    return assignment
  }
  readonly handlers: Handlers = {
    availability: ({ body }) => {
      const member = this.member(this.actor.id)
      this.checkVersion(member.version, body.expectedVersion)
      if (body.availability) {
        const availability = Availability.parse({ ...body.availability, updatedAt: now() })
        this.db.prepare('INSERT INTO member_availability VALUES (?,?) ON CONFLICT(member_id) DO UPDATE SET document=excluded.document').run(this.actor.id, encode(availability))
      } else this.db.prepare('DELETE FROM member_availability WHERE member_id=?').run(this.actor.id)
      this.db.prepare('UPDATE members SET version=version+1 WHERE id=?').run(this.actor.id)
      return { data: this.member(this.actor.id) }
    },
    plans: ({ query }) => {
      const base = { kind: 'plans', status: query.status ?? 'draft', limit: query.limit ?? 30 }
      const cursor = this.cursor(base, query.cursor)
      const rows = this.db.prepare(`SELECT document,id,json_extract(document,'$.createdAt') created FROM plans
        WHERE owner_id=? AND lab_id=? AND ${authorizedPlanSources} AND (?='all' OR json_extract(document,'$.status')=?)
        AND (? IS NULL OR json_extract(document,'$.createdAt')<? OR (json_extract(document,'$.createdAt')=? AND id<?))
        ORDER BY created DESC,id DESC LIMIT ?`).all(this.actor.id, this.actor.labId, base.status, base.status, cursor?.last ?? null, cursor?.created ?? '', cursor?.created ?? '', cursor?.last ?? '', base.limit + 1)
      const last = rows[base.limit - 1]
      return { data: rows.slice(0, base.limit).map(r => { const p = Plan.parse(JSON.parse(String(r.document))); return PlanSummary.parse({ id: p.id, ownerId: p.ownerId, labId: p.labId, goal: p.goal, version: p.version, status: p.status, createdAt: p.createdAt }) }), nextCursor: rows.length > base.limit ? this.nextCursor(base, String(last!.id), String(last!.created)) : null }
    },
    overview: ({ params, query }) => {
      this.sameLab(params.id)
      const v = this.visible(query.scope)
      const counts = { unassigned: 0, active: 0, review: 0, completed: 0 }
      for (const row of this.db.prepare(`SELECT t.status,COUNT(*) n ${v.sql} GROUP BY t.status`).all(...v.values)) {
        const column = taskColumns[row.status as TaskModel['status']]
        if (column) counts[column] += Number(row.n)
      }
      // Summary readers may see task state, but never another person's deliveries or commitments.
      const deliveries = this.db.prepare(`SELECT COUNT(*) submitted,SUM(CASE WHEN r.deliverable_id IS NOT NULL AND json_extract(r.document,'$.decision')='accepted' THEN 1 ELSE 0 END) accepted
        FROM deliverables d LEFT JOIN reviews r ON r.deliverable_id=d.id WHERE d.task_id IN (SELECT t.id ${v.sql} AND acl.access='full')`).get(...v.values)!
      const blocked = this.db.prepare(`SELECT t.id ${v.sql} AND acl.access='full' AND t.status='blocked' ORDER BY t.id LIMIT 101`).all(...v.values)
      const actions = this.db.prepare(`SELECT
        SUM(CASE WHEN EXISTS(SELECT 1 FROM assignments a WHERE a.task_id=t.id AND a.member_id=? AND a.status='pending') AND t.status='awaiting_acceptance' THEN 1 ELSE 0 END) invitations,
        SUM(CASE WHEN acl.access='full' AND t.reviewer_id=? AND t.status='in_review' THEN 1 ELSE 0 END) reviews
        ${v.sql}`).get(this.actor.id, this.actor.id, ...v.values)!
      const changeCount=this.db.prepare(`SELECT count(*) n FROM change_proposals p WHERE p.status='pending' AND p.task_id IN (SELECT t.id ${v.sql} AND acl.access='full') AND EXISTS(SELECT 1 FROM json_each(p.document,'$.requiredMemberIds') WHERE value=?) AND NOT EXISTS(SELECT 1 FROM change_decisions d WHERE d.proposal_id=p.id AND d.member_id=?)`).get(...v.values,this.actor.id,this.actor.id)!
      const executionCount=this.db.prepare(`SELECT count(*) n FROM execution_jobs r WHERE ${attentionRun} AND r.task_id IN (SELECT t.id ${v.sql} AND acl.access='full' AND t.status NOT IN ('completed','cancelled') AND (t.lead_id=? OR t.initiator_id=?))`).get(...v.values,this.actor.id,this.actor.id)!
      return { data: { counts, submittedDeliverables: Number(deliveries.submitted), acceptedDeliverables: Number(deliveries.accepted ?? 0), blockedTaskIds: blocked.slice(0, 100).map(r => String(r.id)), blockedTaskIdsTruncated: blocked.length > 100, pendingActions: { executionAttention:Number(executionCount.n), changeResponses: Number(changeCount.n), invitationResponses: Number(actions.invitations ?? 0), deliverableReviews: Number(actions.reviews ?? 0) }, updatedAt: this.readSnapshot!.at } }
    },
    actionItems: ({ params, query }) => {
      this.sameLab(params.id)
      const base={kind:'actionItems',filter:query.kind??'all',limit:query.limit??30},cursor=this.cursor(base,query.cursor),v=this.visible('mine')
      const rows=this.db.prepare(`WITH visible AS (SELECT t.id,t.created_at,t.status,t.reviewer_id,t.lead_id,t.initiator_id,acl.access ${v.sql}), items AS (
        SELECT v.id,v.created_at,'invitation_response' kind,NULL proposal_id FROM visible v WHERE v.status='awaiting_acceptance' AND EXISTS(SELECT 1 FROM assignments a WHERE a.task_id=v.id AND a.member_id=? AND a.status='pending')
        UNION ALL SELECT v.id,v.created_at,'deliverable_review',NULL FROM visible v WHERE v.status='in_review' AND v.reviewer_id=? AND v.access='full'
        UNION ALL SELECT v.id,v.created_at,'change_response',p.id FROM visible v JOIN change_proposals p ON p.task_id=v.id AND p.status='pending' WHERE v.access='full' AND EXISTS(SELECT 1 FROM json_each(p.document,'$.requiredMemberIds') WHERE value=?) AND NOT EXISTS(SELECT 1 FROM change_decisions d WHERE d.proposal_id=p.id AND d.member_id=?)
        UNION ALL SELECT v.id,v.created_at,'execution_attention',r.id FROM visible v JOIN execution_jobs r ON r.task_id=v.id WHERE v.access='full' AND v.status NOT IN ('completed','cancelled') AND (v.lead_id=? OR v.initiator_id=?) AND ${attentionRun}
      ) SELECT *,id||':'||kind item_key FROM items WHERE (?='all' OR kind=?) AND (? IS NULL OR created_at<? OR (created_at=? AND id||':'||kind<?)) ORDER BY created_at DESC,item_key DESC LIMIT ?`).all(...v.values,this.actor.id,this.actor.id,this.actor.id,this.actor.id,this.actor.id,this.actor.id,base.filter,base.filter,cursor?.last??null,cursor?.created??'',cursor?.created??'',cursor?.last??'',base.limit+1)
      const last=rows[base.limit-1]
      return {data:rows.slice(0,base.limit).map(row=>{
        if(row.kind==='execution_attention')return {kind:row.kind,task:this.actions(this.task(String(row.id))),run:new AiService(this,this.execution?.enabled??false,this.execution?.model??'deepseek-v4-flash').projectedRun(String(row.proposal_id))}
        if(row.kind==='invitation_response') return {kind:row.kind,task:this.summary(String(row.id))}
        if(row.kind==='change_response') return {kind:row.kind,task:this.actions(this.task(String(row.id))),proposal:this.coordination.proposal(String(row.proposal_id))}
        const d=this.db.prepare('SELECT id,revision,version FROM deliverables WHERE task_id=? ORDER BY revision DESC LIMIT 1').get(row.id!)!
        return {kind:row.kind,task:this.actions(this.task(String(row.id))),deliverableId:d.id,revision:d.revision,deliverableVersion:d.version}
      }),nextCursor:rows.length>base.limit?this.nextCursor(base,String(last!.item_key),String(last!.created_at)):null}
    },
    me: () => ({ data: this.member(this.actor.id) }),
    members: ({ params, query }) => {
      this.sameLab(params.id)
      const base = { kind: 'members', labId: params.id, limit: query.limit ?? 30 }
      const cursor = this.cursor(base, query.cursor)
      const rows = this.db.prepare('SELECT id FROM members WHERE lab_id=? AND id>? ORDER BY id LIMIT ?').all(params.id, cursor?.last ?? '', base.limit + 1)
      return { data: rows.slice(0, base.limit).map(r => this.member(String(r.id))), nextCursor: rows.length > base.limit ? this.nextCursor(base, String(rows[base.limit - 1]!.id)) : null }
    },
    createPlan: ({ body }) => {
      this.validatePlan(body)
      const plan = Plan.parse({ ...body, id: id(), ownerId: this.actor.id, version: 1, status: 'draft', createdAt: now() })
      this.savePlan(plan); return { data: plan }
    },
    getPlan: ({ params }) => ({ data: this.plan(params.id) }),
    editPlan: ({ params, body }) => {
      const plan = this.plan(params.id); this.checkVersion(plan.version, body.expectedVersion)
      if (plan.status !== 'draft') fail('INVALID_STATE')
      this.validatePlan(body)
      new ReuseService(this).validatePlanRange(params.id,body)
      if (body.labId !== plan.labId) fail('VALIDATION_ERROR')
      const { expectedVersion: _, ...input } = body
      const updated = { ...plan, ...input, version: plan.version + 1 }
      this.savePlan(updated); return { data: updated }
    },
    confirmPlan: ({ params, body }) => {
      const plan = this.plan(params.id); this.checkVersion(plan.version, body.expectedVersion)
      if (plan.status !== 'draft') fail('INVALID_STATE')
      this.validatePlan(plan)
      new ReuseService(this).validatePlanRange(params.id,plan)
      if (!plan.proposedItems.length) fail('VALIDATION_ERROR')
      for(const item of plan.proposedItems) if(item.allocation.kind==='public_agent'){if(item.allocation.humanLeadId!==this.actor.id)fail('FORBIDDEN');if(!item.allocation.capability||!item.budget)fail('CAPABILITY_UNAVAILABLE');new AiService(this,this.execution?.enabled??false,this.execution?.model??'deepseek-v4-flash').available(item.allocation.capability)}
      const mapping = new Map(plan.proposedItems.map(item => [item.id, id()]))
      for (const item of plan.proposedItems) {
        const own = item.allocation.kind === 'self' || item.allocation.kind === 'public_agent'
        const task = Task.parse({ id: mapping.get(item.id), labId: plan.labId, parentTaskId: null, planId: plan.id, planVersion: plan.version, title: item.title, taskType: 'other', goal: item.goal, acceptanceCriteria: item.acceptanceCriteria, initiatorId: this.actor.id, leadId: own ? this.actor.id : null, reviewerId: this.actor.id, participantIds: [], status: own ? 'ready' : 'awaiting_acceptance', blocker: null, dependencies: item.dependencies.map(dependency => ({ taskId: mapping.get(dependency), kind: 'accepted_deliverable', requiredRevision: null })), schedule: item.schedule, access: { visibility: item.allocation.kind === 'claim' ? 'lab_summary' : 'participants', summary: item.allocation.kind === 'claim' ? item.allocation.summary : null }, version: 1, createdAt: now(), updatedAt: now(), allowedActions: [] })
        const summary = TaskSummary.parse({ projection: 'claim_summary', id: task.id, labId: task.labId, title: item.title, summary: item.allocation.kind === 'claim' ? item.allocation.summary : item.deliverable, deliverable: item.deliverable, acceptanceCriteria: item.acceptanceCriteria, schedule: item.schedule, initiatorId: task.initiatorId, reviewerId: task.reviewerId, version: 1, allowedActions: [], pendingInvitation: null })
        this.db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(task.id, task.labId, plan.id, item.id, task.initiatorId, task.leadId, task.reviewerId, task.status, item.allocation.kind === 'claim' ? 1 : 0, 1, task.createdAt, encode(task), encode(summary))
        this.db.prepare('INSERT INTO task_versions VALUES (?,?,?)').run(task.id,task.version,encode(task))
        this.grant(task.id, this.actor.id, 'full')
        new ReuseService(this).copy('plan',task.planId,'task',task.id)
        if (own) this.createAssignment(task, 'self', this.actor.id, item.deliverable, item.schedule)
        if (item.allocation.kind === 'invitation') { this.createAssignment(task, 'invitation', item.allocation.memberId, item.deliverable, item.schedule); this.outbox(task, 'invitation_created') }
        this.event(task, 'confirmed')
      }
      for(const taskId of mapping.values()) this.coordination.edges(this.task(taskId))
      plan.status = 'confirmed'; plan.version++; this.savePlan(plan)
      for(const item of plan.proposedItems) if(item.allocation.kind==='public_agent' && item.allocation.capability && item.budget){
        const taskId=mapping.get(item.id)!
        const a=this.db.prepare('SELECT document FROM assignments WHERE task_id=?').get(taskId)!
        const assignment=Assignment.parse(JSON.parse(String(a.document)));assignment.kind='public_agent';assignment.capability=item.allocation.capability;assignment.version++;this.saveAssignment(assignment)
        new AiService(this,this.execution?.enabled??false,this.execution?.model??'deepseek-v4-flash').handle('run',{params:{id:taskId},query:{},headers:{},body:{expectedVersion:1,capability:item.allocation.capability,budget:item.budget,inputArtifactIds:[],conclusionRefs:new ReuseService(this).bindings('plan',plan.id).map(({id,version})=>({id,version}))}})
      }
      return { data: { plan, taskIds: [...mapping.values()] } }
    },
    tasks: ({ query }) => {
      this.sameLab(query.labId)
      const { cursor: cursorString, snapshot: _snapshot, ...filter } = query
      const base = { kind: 'tasks', ...filter, limit: query.limit ?? 30 }
      const cursor = this.cursor(base, cursorString)
      const v = this.visible(query.scope)
      const rows = this.db.prepare(`SELECT t.id,t.created_at ${v.sql}
        AND (? IS NULL OR t.status=?) AND (? IS NULL OR t.created_at<? OR (t.created_at=? AND t.id<?))
        ORDER BY t.created_at DESC,t.id DESC LIMIT ?`).all(...v.values, query.status ?? null, query.status ?? null, cursor?.last ?? null, cursor?.created ?? '', cursor?.created ?? '', cursor?.last ?? '', base.limit + 1)
      const last = rows[base.limit - 1]
      return { data: rows.slice(0, base.limit).map(row => this.projection(String(row.id), false)), nextCursor: rows.length > base.limit ? this.nextCursor(base, String(last!.id), String(last!.created_at)) : null }
    },
    task: ({ params }) => ({ data: this.projection(params.id, true) }),
    invite: ({ params, body }) => {
      const task = this.task(params.id); this.checkVersion(task.version, body.expectedVersion)
      if (!['unassigned', 'awaiting_acceptance'].includes(task.status) || task.leadId || this.db.prepare("SELECT id FROM assignments WHERE task_id=? AND status IN ('pending','accepted')").get(task.id)) fail('INVALID_STATE')
      if (Number(this.db.prepare('SELECT count(*) n FROM assignments WHERE task_id=?').get(task.id)?.n) >= 100) fail('VALIDATION_ERROR')
      this.member(body.memberId); this.validateSchedule(body.schedule)
      if (body.memberId === this.actor.id) fail('VALIDATION_ERROR')
      if (this.db.prepare("SELECT 1 FROM task_access WHERE task_id=? AND member_id=? AND access='revoked'").get(task.id, body.memberId)) fail('FORBIDDEN')
      const assignment = this.createAssignment(task, 'invitation', body.memberId, body.scope, body.schedule)
      task.status = 'awaiting_acceptance'; task.version++; task.updatedAt = now(); this.saveTask(task)
      // Switch off open claims while a specific invitation is pending.
      this.db.prepare('UPDATE tasks SET claimable=0 WHERE id=?').run(task.id)
      this.event(task, 'invited'); this.outbox(task, 'invitation_created')
      return { data: assignment }
    },
    invitationDecision: ({ params, body }) => {
      const offer = this.assignment(params.id), assignment = offer.model
      this.checkVersion(assignment.version, body.expectedVersion)
      const row = this.taskRow(assignment.taskId); this.checkVersion(Number(row.version), body.expectedTaskVersion)
      if (assignment.status !== 'pending' || row.status !== 'awaiting_acceptance' || row.lead_id) fail('INVALID_STATE')
      const task = Task.parse(JSON.parse(String(this.db.prepare('SELECT document FROM tasks WHERE id=?').get(assignment.taskId)!.document)))
      this.db.prepare('INSERT INTO invitation_decisions VALUES (?,?,?,?,?,?,?)').run(assignment.id, this.actor.id, assignment.version, task.version, body.decision, body.comment, now())
      assignment.status = body.decision; assignment.version++
      if (body.decision === 'accepted') {
        const schedule={...offer.schedule,committed:body.committed??offer.schedule.committed};this.validateSchedule(schedule,true)
        assignment.commitment = { scope: offer.scope, schedule, acceptedAt: now() }
        task.leadId = this.actor.id; task.status = 'ready'; task.schedule = assignment.commitment.schedule; this.grant(task.id, this.actor.id, 'full')
        new ReuseService(this).copy('plan',task.planId,'task',task.id)
        for(const row of this.db.prepare("SELECT document FROM assignments WHERE task_id=? AND status='withdrawn' AND json_extract(document,'$.transferToMemberId')=?").all(task.id,this.actor.id)) {const old=Assignment.parse(JSON.parse(String(row.document)));old.status='transferred';old.version++;this.saveAssignment(old)}
      } else { if(body.committed) fail('VALIDATION_ERROR');task.status = 'unassigned'; this.db.prepare("DELETE FROM task_access WHERE task_id=? AND member_id=? AND access='summary'").run(task.id, this.actor.id) }
      this.saveAssignment(assignment); task.version++; task.updatedAt = now(); this.saveTask(task); this.event(task, body.decision)
      return { data: assignment }
    },
    claim: ({ params, body }) => {
      const row = this.taskRow(params.id)
      if (row.lead_id || this.db.prepare("SELECT id FROM assignments WHERE task_id=? AND status='accepted'").get(params.id)) fail('ALREADY_CLAIMED')
      this.checkVersion(Number(row.version), body.expectedVersion)
      if (row.status !== 'awaiting_acceptance' || this.db.prepare("SELECT id FROM assignments WHERE task_id=? AND status='pending'").get(params.id)) fail('INVALID_STATE')
      const task = Task.parse(JSON.parse(String(this.db.prepare('SELECT document FROM tasks WHERE id=?').get(params.id)!.document)))
      const summary = TaskSummary.parse(JSON.parse(String(this.db.prepare('SELECT summary_document FROM tasks WHERE id=?').get(task.id)!.summary_document)))
      const schedule={...summary.schedule,committed:body.committed??null};this.validateSchedule(schedule,true)
      const assignment = this.createAssignment(task, 'claim', this.actor.id, summary.deliverable, schedule)
      task.schedule=schedule
      task.leadId = this.actor.id; task.status = 'ready'; task.version++; task.updatedAt = now(); this.saveTask(task); this.event(task, 'claimed')
      return { data: assignment }
    },
    start: ({ params, body }) => {
      const task = this.task(params.id); this.checkVersion(task.version, body.expectedVersion)
      if (!['ready', 'changes_requested'].includes(task.status)) fail('INVALID_STATE')
      this.coordination.runnable(task,true)
      task.status = 'in_progress'; task.version++; task.updatedAt = now(); this.saveTask(task); this.event(task, 'started')
      return { data: this.actions(task) }
    },
    submit: ({ params, body }) => {
      const task = this.task(params.id); this.checkVersion(task.version, body.expectedVersion)
      if (!['in_progress', 'changes_requested'].includes(task.status)) fail('INVALID_STATE')
      this.coordination.runnable(task,true)
      this.coordination.attachments(task.id,body.artifactRefs)
      for(const source of body.sources.filter(s=>s.kind==='artifact')) if(!body.artifactRefs.includes(source.locator)) fail('VALIDATION_ERROR')
      const revision = Number(this.db.prepare('SELECT COALESCE(MAX(revision),0)+1 n FROM deliverables WHERE task_id=?').get(task.id)!.n)
      if (revision > 100) fail('VALIDATION_ERROR')
      const delivery = Deliverable.parse({ id: id(), taskId: task.id, revision, submittedBy: this.actor.id, artifactRefs: body.artifactRefs, summary: body.summary, sources: body.sources, submittedAt: now(), review: null, version: 1 })
      this.db.prepare('INSERT INTO deliverables VALUES (?,?,?,?,?)').run(delivery.id, task.id, revision, 1, encode(delivery))
      for(const artifactId of delivery.artifactRefs) this.db.prepare('INSERT INTO deliverable_artifacts VALUES (?,?,?)').run(delivery.id,artifactId,this.coordination.artifact(artifactId).model.version)
      task.status = 'in_review'; task.version++; task.updatedAt = now(); this.saveTask(task); this.event(task, 'submitted')
      return { data: delivery }
    },
    review: ({ params, body }) => {
      const delivery = this.deliverable(params.id), task = this.task(delivery.taskId)
      this.checkVersion(delivery.version, body.expectedVersion); this.checkVersion(task.version, body.expectedTaskVersion)
      this.checkVersion(delivery.revision, body.revision)
      const latest = Number(this.db.prepare('SELECT MAX(revision) n FROM deliverables WHERE task_id=?').get(task.id)!.n)
      if (delivery.revision !== latest || task.status !== 'in_review' || delivery.review) fail('INVALID_STATE')
      this.coordination.runnable(task)
      delivery.review = { decision: body.decision, reviewerId: this.actor.id, revision: body.revision, comment: body.comment, at: now() }; delivery.version++
      this.db.prepare('INSERT INTO reviews VALUES (?,?,?,?)').run(delivery.id, delivery.revision, this.actor.id, encode(delivery.review))
      this.db.prepare('UPDATE deliverables SET version=?,document=? WHERE id=?').run(delivery.version, encode(delivery), delivery.id)
      task.status = body.decision === 'accepted' ? 'completed' : 'changes_requested'; task.version++; task.updatedAt = now(); this.saveTask(task); this.event(task, 'reviewed')
      if(body.decision==='changes_requested') this.coordination.impact(task,'review_returned')
      return { data: delivery }
    },
  }
}

