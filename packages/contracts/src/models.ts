import { z } from 'zod'

export const contractVersion = '0.1.0' as const
export const Id = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/)
export const Text = z.string().min(1).max(8000)
export const Title = z.string().min(1).max(200)
export const Version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
export const Instant = z.iso.datetime({ offset: true })
export const Timezone = z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }, 'IANA timezone required')
export const DateValue = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('date'), date: z.iso.date(), timezone: Timezone }),
  z.strictObject({ kind: z.literal('instant'), at: Instant }),
])
export const Dated = z.strictObject({ value: DateValue, source: z.enum(['user', 'authorized_material', 'suggestion', 'member']), confirmed: z.boolean() })
export const Schedule = z.strictObject({ suggested: Dated.nullable(), hardDeadline: Dated.nullable(), committed: Dated.nullable(), estimatedHumanHours: z.number().min(0).max(10000).nullable(), checkpoint: DateValue.nullable() })
export const Budget = z.strictObject({ maxTokens: z.number().int().positive().max(1000000), maxSeconds: z.number().int().positive().max(86400) })
export const PublicCapabilityRef = z.strictObject({ id: Id, version: Version, visibility: z.literal('lab_public') })
export const Allocation = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('self') }),
  z.strictObject({ kind: z.literal('invitation'), memberId: Id }),
  z.strictObject({ kind: z.literal('claim'), audience: z.literal('lab_members'), summary: Text }),
  z.strictObject({ kind: z.literal('public_agent'), capability: PublicCapabilityRef.nullable(), humanLeadId: Id, missingReason: Text.nullable() }),
])
export const Dependency = z.strictObject({ taskId: Id, kind: z.enum(['accepted_deliverable', 'confirmed_decision']), requiredRevision: Version.nullable() })
export const ProposedItem = z.strictObject({ id: Id, title: Title, goal: Text, deliverable: Text, acceptanceCriteria: Text, allocation: Allocation, dependencies: z.array(Id).max(100), schedule: Schedule, inputArtifactIds: z.array(Id).max(100), budget: Budget.nullable() })
export const PlanInput = z.strictObject({ labId: Id, goal: Text, proposedItems: z.array(ProposedItem).max(100), unresolvedQuestions: z.array(Text).max(50) })
export const Plan = PlanInput.extend({ id: Id, ownerId: Id, version: Version, status: z.enum(['draft', 'confirmed', 'superseded']), createdAt: Instant })
export const TaskStatus = z.enum(['unassigned', 'awaiting_acceptance', 'ready', 'in_progress', 'blocked', 'in_review', 'changes_requested', 'completed', 'cancelled'])
export const taskColumns = { unassigned: 'unassigned', awaiting_acceptance: 'unassigned', ready: 'unassigned', in_progress: 'active', blocked: 'active', changes_requested: 'active', in_review: 'review', completed: 'completed', cancelled: null } as const satisfies Record<z.infer<typeof TaskStatus>, string | null>
export const Action = z.enum(['confirm', 'invite', 'decide', 'claim', 'start', 'block', 'resume', 'submit', 'review', 'propose_change', 'withdraw', 'cancel', 'run', 'publish', 'disable'])
export const Blocker = z.strictObject({ reason: Text, requestedMemberId: Id.nullable(), requestedAction: Text, resumeStatus: z.enum(['ready', 'in_progress', 'changes_requested']) })
export const Access = z.strictObject({ visibility: z.enum(['participants', 'lab_summary']), summary: Text.nullable() })
export const Task = z.strictObject({ id: Id, labId: Id, parentTaskId: Id.nullable(), planId: Id, planVersion: Version, title: Title, taskType: z.enum(['paper', 'grant', 'ip', 'experiment', 'training', 'report', 'other']), goal: Text, acceptanceCriteria: Text, initiatorId: Id, leadId: Id.nullable(), reviewerId: Id, participantIds: z.array(Id).max(100), status: TaskStatus, blocker: Blocker.nullable(), dependencies: z.array(Dependency).max(100), schedule: Schedule, access: Access, version: Version, createdAt: Instant, updatedAt: Instant, allowedActions: z.array(Action).max(20) }).superRefine((v, ctx) => { if ((v.status === 'blocked') !== (v.blocker !== null)) ctx.addIssue({ code: 'custom', message: 'blocked requires blocker; other states forbid it' }) })
export const TaskSummary = z.strictObject({ projection: z.literal('claim_summary'), id: Id, labId: Id, title: Title, summary: Text, deliverable: Text, acceptanceCriteria: Text, schedule: Schedule, initiatorId: Id, reviewerId: Id, version: Version, allowedActions: z.array(z.literal('claim')).max(1) })
export const Commitment = z.strictObject({ scope: Text, schedule: Schedule, acceptedAt: Instant })
export const Assignment = z.strictObject({ id: Id, taskId: Id, kind: z.enum(['self', 'invitation', 'claim', 'public_agent']), memberId: Id.nullable(), capability: PublicCapabilityRef.nullable(), status: z.enum(['pending', 'accepted', 'declined', 'withdrawn', 'transfer_pending', 'transferred', 'cancelled']), commitment: Commitment.nullable(), transferToMemberId: Id.nullable(), version: Version }).superRefine((v, c) => { if (v.status === 'accepted' && !v.commitment) c.addIssue({ code: 'custom', message: 'accepted commitment required' }); if (['pending', 'declined'].includes(v.status) && v.commitment) c.addIssue({ code: 'custom', message: 'unaccepted invitation is not commitment' }) })
export const Availability = z.strictObject({ from: z.iso.date(), to: z.iso.date(), timezone: Timezone, level: z.enum(['available', 'limited', 'unavailable']), hours: z.number().min(0).max(168).nullable(), updatedAt: Instant }).refine(v => v.from <= v.to, 'invalid interval')
export const Member = z.strictObject({ id: Id, labId: Id, displayName: Title, publicExpertise: z.array(Title).max(20), availability: Availability.nullable(), visibleCommitments: z.array(z.strictObject({ taskId: Id, scope: Text, schedule: Schedule })).max(100), version: Version })
export const Source = z.strictObject({ kind: z.enum(['artifact', 'url', 'note']), locator: z.string().min(1).max(2000), label: Title })
export const Review = z.strictObject({ decision: z.enum(['accepted', 'changes_requested']), reviewerId: Id, revision: Version, comment: Text, at: Instant })
export const Deliverable = z.strictObject({ id: Id, taskId: Id, revision: Version, submittedBy: Id, artifactRefs: z.array(Id).max(100), summary: Text, sources: z.array(Source).max(100), submittedAt: Instant, review: Review.nullable(), version: Version })
export const Capability = z.strictObject({ id: Id, labId: Id, ownerId: Id, maintainerIds: z.array(Id).max(20), visibility: z.enum(['private', 'lab_public']), version: Version, name: Title, inputContract: Text, outputContract: Text, status: z.enum(['draft', 'unavailable', 'available', 'disabled']), validationResultIds: z.array(Id).max(100) })
export const ExecutionStatus = z.enum(['queued', 'running', 'waiting_input', 'failed', 'interrupted', 'cancelled', 'succeeded'])
export const Execution = z.strictObject({ id: Id, taskId: Id, capability: PublicCapabilityRef, status: ExecutionStatus, attempt: z.number().int().min(0).max(10), usage: z.strictObject({ inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0), elapsedMs: z.number().min(0) }).nullable(), failure: Text.nullable(), resultRefs: z.array(Id).max(100), createdAt: Instant, startedAt: Instant.nullable(), endedAt: Instant.nullable(), version: Version })
export const TaskEvent = z.strictObject({ id: Id, taskId: Id, actor: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('member'), memberId: Id }), z.strictObject({ kind: z.literal('system') })]), kind: z.enum(['confirmed', 'invited', 'accepted', 'declined', 'claimed', 'started', 'blocked', 'resumed', 'submitted', 'reviewed', 'change_proposed', 'change_decided', 'withdrawn', 'cancelled', 'execution_updated', 'access_revoked']), resourceVersion: Version, timestamp: Instant, summary: Text })
export const ChangeProposal = z.strictObject({ id: Id, taskId: Id, expectedTaskVersion: Version, goal: Text, acceptanceCriteria: Text, schedule: Schedule, proposedLeadId: Id.nullable(), reason: Text, requiredMemberIds: z.array(Id).min(1).max(100), decisions: z.array(z.strictObject({ memberId: Id, decision: z.enum(['accepted', 'declined']), at: Instant })).max(100), status: z.enum(['pending', 'accepted', 'declined', 'superseded']), version: Version })
export const Artifact = z.strictObject({ id: Id, taskId: Id, filename: Title, mediaType: z.enum(['text/plain', 'application/pdf', 'image/png']), size: z.number().int().min(1).max(10485760), sha256: z.string().regex(/^[a-f0-9]{64}$/), version: Version, createdAt: Instant })
export const PlanningRequest = z.strictObject({ id: Id, status: z.enum(['queued', 'running', 'draft', 'failed', 'cancelled']), planId: Id.nullable(), failure: Text.nullable(), version: Version })
export const Knowledge = z.strictObject({ id: Id, taskId: Id, conclusion: Text, sources: z.array(Source).max(100), confirmedBy: Id, version: Version })
export const Sharing = z.strictObject({ id: Id, taskId: Id, deliverableId: Id, revision: Version, decision: z.enum(['share_selected', 'decline', 'revoke']), selectedText: Text.nullable(), purpose: z.literal('public_capability_improvement'), version: Version })
export const Health = z.strictObject({ status: z.enum(['ok', 'unavailable']), contractVersion: z.literal(contractVersion), checks: z.strictObject({ database: z.enum(['ok', 'unavailable', 'not_checked']), storage: z.enum(['ok', 'unavailable', 'not_checked']), authentication: z.literal('not_implemented'), harness: z.literal('not_verified') }) })
export const ErrorCode = z.enum(['UNAUTHENTICATED', 'NOT_FOUND', 'FORBIDDEN', 'VALIDATION_ERROR', 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'ALREADY_CLAIMED', 'DEPENDENCY_BLOCKED', 'CAPABILITY_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'CURSOR_EXPIRED', 'SERVICE_UNAVAILABLE', 'NOT_IMPLEMENTED', 'PAYLOAD_TOO_LARGE', 'RATE_LIMITED', 'INTERNAL_ERROR'])
export const errorStatus = { UNAUTHENTICATED: 401, NOT_FOUND: 404, FORBIDDEN: 403, VALIDATION_ERROR: 400, VERSION_CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409, ALREADY_CLAIMED: 409, DEPENDENCY_BLOCKED: 409, CAPABILITY_UNAVAILABLE: 503, MODEL_UNAVAILABLE: 503, CURSOR_EXPIRED: 410, SERVICE_UNAVAILABLE: 503, NOT_IMPLEMENTED: 501, PAYLOAD_TOO_LARGE: 413, RATE_LIMITED: 429, INTERNAL_ERROR: 500 } as const
export const ErrorResponse = z.strictObject({ error: z.strictObject({ code: ErrorCode, message: Title, requestId: Id }) })
export const data = <T extends z.ZodType>(schema: T) => z.strictObject({ data: schema })
export const page = <T extends z.ZodType>(schema: T) => z.strictObject({ data: z.array(schema).max(100), nextCursor: z.string().max(2048).nullable() })
export type TaskModel = z.infer<typeof Task>
export type PlanModel = z.infer<typeof Plan>
export type MemberModel = z.infer<typeof Member>
export type AssignmentModel = z.infer<typeof Assignment>
export type ExecutionModel = z.infer<typeof Execution>
