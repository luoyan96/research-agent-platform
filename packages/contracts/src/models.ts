import { z } from 'zod'

export const contractVersion = '0.9.1' as const
export const Id = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/)
export const Text = z.string().min(1).max(8000)
export const Title = z.string().min(1).max(200)
export const Version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
export const ConclusionBinding = z.strictObject({ id: Id, version: Version, status: z.enum(['current','needs_review']) })
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
export const Plan = PlanInput.extend({ conclusionRefs: z.array(ConclusionBinding).max(100).optional(), id: Id, ownerId: Id, version: Version, status: z.enum(['draft', 'confirmed', 'superseded']), createdAt: Instant })
export const TaskStatus = z.enum(['unassigned', 'awaiting_acceptance', 'ready', 'in_progress', 'blocked', 'in_review', 'changes_requested', 'completed', 'cancelled'])
export const taskColumns = { unassigned: 'unassigned', awaiting_acceptance: 'unassigned', ready: 'unassigned', in_progress: 'active', blocked: 'active', changes_requested: 'active', in_review: 'review', completed: 'completed', cancelled: null } as const satisfies Record<z.infer<typeof TaskStatus>, string | null>
export const Action = z.enum(['confirm', 'invite', 'decide', 'claim', 'start', 'block', 'resume', 'submit', 'review', 'propose_change', 'withdraw', 'cancel', 'run', 'publish', 'disable', 'revoke_access', 'upload', 'acknowledge_impacts', 'retain_conclusion', 'share_feedback', 'decline_feedback'])
export const Blocker = z.strictObject({ reason: Text, requestedMemberId: Id.nullable(), requestedAction: Text, resumeStatus: z.enum(['ready', 'in_progress', 'changes_requested', 'in_review']) })
export const Access = z.strictObject({ visibility: z.enum(['participants', 'lab_summary']), summary: Text.nullable() })
export const Task = z.strictObject({ conclusionRefs: z.array(ConclusionBinding).max(100).optional(), id: Id, labId: Id, parentTaskId: Id.nullable(), planId: Id, planVersion: Version, title: Title, taskType: z.enum(['paper', 'grant', 'ip', 'experiment', 'training', 'report', 'other']), goal: Text, acceptanceCriteria: Text, initiatorId: Id, leadId: Id.nullable(), reviewerId: Id, participantIds: z.array(Id).max(100), status: TaskStatus, blocker: Blocker.nullable(), dependencies: z.array(Dependency).max(100), schedule: Schedule, access: Access, version: Version, createdAt: Instant, updatedAt: Instant, allowedActions: z.array(Action).max(20) }).superRefine((v, ctx) => { if ((v.status === 'blocked') !== (v.blocker !== null)) ctx.addIssue({ code: 'custom', message: 'blocked requires blocker; other states forbid it' }) })
export const TaskSummary = z.strictObject({ projection: z.literal('claim_summary'), visibleStatus: TaskStatus.optional(), id: Id, labId: Id, title: Title, summary: Text, deliverable: Text, acceptanceCriteria: Text, schedule: Schedule, initiatorId: Id, reviewerId: Id, version: Version, allowedActions: z.array(z.enum(['claim', 'decide'])).max(2), pendingInvitation: z.strictObject({ id: Id, version: Version, scope: Text, schedule: Schedule }).nullable() })
export const Commitment = z.strictObject({ scope: Text, schedule: Schedule, acceptedAt: Instant })
export const Assignment = z.strictObject({ id: Id, taskId: Id, kind: z.enum(['self', 'invitation', 'claim', 'public_agent']), memberId: Id.nullable(), capability: PublicCapabilityRef.nullable(), status: z.enum(['pending', 'accepted', 'declined', 'withdrawn', 'transfer_pending', 'transferred', 'cancelled']), commitment: Commitment.nullable(), transferToMemberId: Id.nullable(), version: Version }).superRefine((v, c) => { if (v.status === 'accepted' && !v.commitment) c.addIssue({ code: 'custom', message: 'accepted commitment required' }); if (['pending', 'declined'].includes(v.status) && v.commitment) c.addIssue({ code: 'custom', message: 'unaccepted invitation is not commitment' }) })
export const Availability = z.strictObject({ from: z.iso.date(), to: z.iso.date(), timezone: Timezone, level: z.enum(['available', 'limited', 'unavailable']), hours: z.number().min(0).max(168).nullable(), updatedAt: Instant }).refine(v => v.from <= v.to, 'invalid interval')
export const Member = z.strictObject({ id: Id, labId: Id, displayName: Title, publicExpertise: z.array(Title).max(20), availability: Availability.nullable(), availabilityStatus: z.enum(['unknown', 'upcoming', 'current', 'expired']).optional(), visibleCommitmentsTruncated: z.boolean().optional(), visibleCommitments: z.array(z.strictObject({ taskId: Id, scope: Text, schedule: Schedule })).max(100), version: Version })
export const Source = z.strictObject({ kind: z.enum(['artifact', 'url', 'note']), locator: z.string().min(1).max(2000), label: Title })
export const Review = z.strictObject({ decision: z.enum(['accepted', 'changes_requested']), reviewerId: Id, revision: Version, comment: Text, at: Instant })
export const Deliverable = z.strictObject({ id: Id, taskId: Id, revision: Version, submittedBy: Id, artifactRefs: z.array(Id).max(100), summary: Text, sources: z.array(Source).max(100), submittedAt: Instant, review: Review.nullable(), version: Version })
export const Capability = z.strictObject({ allowedActions: z.array(z.literal('manage_methods')).max(1).optional(), id: Id, labId: Id, ownerId: Id, maintainerIds: z.array(Id).max(20), visibility: z.enum(['private', 'lab_public']), version: Version, name: Title, inputContract: Text, outputContract: Text, status: z.enum(['draft', 'unavailable', 'available', 'disabled']), validationResultIds: z.array(Id).max(100) })
export const ExecutionStatus = z.enum(['queued', 'running', 'waiting_input', 'failed', 'interrupted', 'cancelled', 'succeeded'])
export const Execution = z.strictObject({ id: Id, taskId: Id, capability: PublicCapabilityRef, status: ExecutionStatus, attempt: z.number().int().min(0).max(10), usage: z.strictObject({ inputTokens: z.number().int().min(0).nullable(), outputTokens: z.number().int().min(0).nullable(), elapsedMs: z.number().min(0) }).nullable(), failure: Text.nullable(), resultRefs: z.array(Id).max(100), createdAt: Instant, startedAt: Instant.nullable(), endedAt: Instant.nullable(), version: Version })
export const TaskEvent = z.strictObject({ id: Id, taskId: Id, actor: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('member'), memberId: Id }), z.strictObject({ kind: z.literal('system') })]), kind: z.enum(['confirmed', 'invited', 'accepted', 'declined', 'claimed', 'started', 'blocked', 'resumed', 'submitted', 'reviewed', 'change_proposed', 'change_decided', 'withdrawn', 'cancelled', 'execution_updated', 'access_revoked', 'dependency_impacted', 'impacts_acknowledged', 'artifact_uploaded', 'artifact_revoked']), resourceVersion: Version, timestamp: Instant, summary: Text })
export const ChangeProposal = z.strictObject({ id: Id, taskId: Id, expectedTaskVersion: Version, scope: Text, dependencies: z.array(Dependency).max(100), createdBy: Id, createdAt: Instant, goal: Text, acceptanceCriteria: Text, schedule: Schedule, proposedLeadId: Id.nullable(), reason: Text, requiredMemberIds: z.array(Id).min(1).max(100), decisions: z.array(z.strictObject({ memberId: Id, decision: z.enum(['accepted', 'declined']), at: Instant })).max(100), status: z.enum(['pending', 'accepted', 'declined', 'superseded']), version: Version })
export const Artifact = z.strictObject({ accessStatus: z.enum(['available', 'revoked']).optional(), id: Id, taskId: Id, filename: Title, mediaType: z.enum(['text/plain', 'application/pdf', 'image/png']), size: z.number().int().min(1).max(10485760), sha256: z.string().regex(/^[a-f0-9]{64}$/), version: Version, createdAt: Instant })
export const ModelUsage = z.strictObject({ inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(), elapsedMs: z.number().nonnegative(), cost: z.number().nonnegative().nullable(), currency: z.string().max(10).nullable() })
export const ObjectRef = z.strictObject({ id: Id, version: Version })
export const InputRef = ObjectRef.extend({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })
export const EntryIntent = z.enum(['draft', 'progress', 'find_work'])
export const AdaptiveReply = z.strictObject({ replyVersion: z.literal('1.0.0'), intent: EntryIntent, readAt: Instant, origin: z.enum(['model_suggestion', 'service_facts']), plan: Plan.nullable(), tasks: z.array(z.union([Task, TaskSummary])).max(20), truncated: z.boolean(), gaps: z.array(Text).max(30), actions: z.array(z.strictObject({ object: z.enum(['plan','task']), ref: ObjectRef, action: Action })).max(100) })
export const EvidenceChecklist = z.strictObject({ title: Title, items: z.array(z.strictObject({ requirement: Text, assessment: z.enum(['supported_by_input','gap']), citations: z.array(z.strictObject({ artifactId: Id, quote: Text })).max(20), gap: Text.nullable() })).min(1).max(50), limitations: z.array(Text).max(20) })
export const RunRecord = Execution.extend({ methodVersion: Version.optional(), configurationGeneration: Version.optional(), methodTrial: z.boolean().optional(), conclusionRefs: z.array(ObjectRef).max(10).optional(), requestedBy: Id, taskVersion: Version, plan: ObjectRef, permissionVersion: Version, inputs: z.array(InputRef).max(10), budget: Budget, maxAttempts: z.number().int().min(1).max(3), nextAttemptAt: Instant.nullable(), candidate: EvidenceChecklist.nullable(), candidateDeliverableId: Id.nullable(), allowedActions: z.array(z.enum(['cancel','retry','submit_candidate'])).max(3), provider: Title, model: Title, harnessVersion: Title, updatedAt: Instant, usageDetail: ModelUsage.nullable() })
export const PlanningRequest = z.strictObject({ id: Id, status: z.enum(['queued', 'running', 'draft', 'ready', 'waiting_input', 'interrupted', 'failed', 'cancelled']), planId: Id.nullable(), failure: Text.nullable(), version: Version, reply: AdaptiveReply.nullable(), usage: ModelUsage.nullable(), createdAt: Instant, updatedAt: Instant })
export const Knowledge = z.strictObject({ id: Id, taskId: Id, conclusion: Text, sources: z.array(Source).max(100), confirmedBy: Id, version: Version })
export const Sharing = z.strictObject({ id: Id, taskId: Id, deliverableId: Id, revision: Version, decision: z.enum(['share_selected', 'decline', 'revoke']), selectedText: Text.nullable(), purpose: z.literal('public_capability_improvement'), version: Version })
export const Health = z.strictObject({ status: z.enum(['ok', 'unavailable']), contractVersion: z.literal(contractVersion), checks: z.strictObject({ database: z.enum(['ok', 'unavailable', 'not_checked']), storage: z.enum(['ok', 'unavailable', 'not_checked']), authentication: z.enum(['ok', 'unavailable', 'not_checked']), harness: z.literal('not_verified') }) })
export const RegistrationInvite = z.strictObject({ id: Id, labId: Id, expiresAt: Instant, maxUses: z.number().int().min(1).max(50), usedCount: z.number().int().min(0), createdAt: Instant, revokedAt: Instant.nullable(), createdBy: Id.nullable() })
export const LabAiSettings = z.strictObject({ labId: Id, labName: z.string().min(1).max(200), enabled: z.boolean(), platformEnabled: z.boolean(), hasApiKey: z.boolean(), model: z.enum(['deepseek-flash','deepseek-v4-pro']), version: z.number().int().min(0), updatedAt: Instant.nullable() })
export const ErrorCode = z.enum(['UNAUTHENTICATED', 'NOT_FOUND', 'FORBIDDEN', 'VALIDATION_ERROR', 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'ALREADY_CLAIMED', 'DEPENDENCY_BLOCKED', 'CAPABILITY_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'CURSOR_EXPIRED', 'SERVICE_UNAVAILABLE', 'NOT_IMPLEMENTED', 'PAYLOAD_TOO_LARGE', 'RATE_LIMITED', 'INVALID_STATE', 'INTERNAL_ERROR', 'INVITE_UNAVAILABLE', 'USERNAME_TAKEN'])
export const errorStatus = { INVITE_UNAVAILABLE: 400, USERNAME_TAKEN: 409, UNAUTHENTICATED: 401, NOT_FOUND: 404, FORBIDDEN: 403, VALIDATION_ERROR: 400, VERSION_CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409, ALREADY_CLAIMED: 409, DEPENDENCY_BLOCKED: 409, CAPABILITY_UNAVAILABLE: 503, MODEL_UNAVAILABLE: 503, CURSOR_EXPIRED: 410, SERVICE_UNAVAILABLE: 503, NOT_IMPLEMENTED: 501, PAYLOAD_TOO_LARGE: 413, RATE_LIMITED: 429, INVALID_STATE: 409, INTERNAL_ERROR: 500 } as const
export const ErrorResponse = z.strictObject({ error: z.strictObject({ code: ErrorCode, message: Title, requestId: Id }) })
export const data = <T extends z.ZodType>(schema: T) => z.strictObject({ data: schema })
export const page = <T extends z.ZodType>(schema: T) => z.strictObject({ data: z.array(schema).max(100), nextCursor: z.string().max(2048).nullable() })
export type TaskModel = z.infer<typeof Task>
export type PlanModel = z.infer<typeof Plan>
export type MemberModel = z.infer<typeof Member>
export type AssignmentModel = z.infer<typeof Assignment>
export type ExecutionModel = z.infer<typeof Execution>

export type DeliverableModel = z.infer<typeof Deliverable>
export type ScheduleModel = z.infer<typeof Schedule>
export type TaskSummaryModel = z.infer<typeof TaskSummary>

export const Snapshot = z.strictObject({ token: z.string().min(1).max(2048), at: Instant, expiresAt: Instant })
export const PlanSummary = Plan.pick({ id: true, ownerId: true, labId: true, goal: true, version: true, status: true, createdAt: true })
export const ActionItem = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('execution_attention'), task: Task, run: RunRecord }),
  z.strictObject({ kind: z.literal('invitation_response'), task: TaskSummary }),
  z.strictObject({ kind: z.literal('change_response'), task: Task, proposal: ChangeProposal }),
  z.strictObject({ kind: z.literal('deliverable_review'), task: Task, deliverableId: Id, revision: Version, deliverableVersion: Version }),
])

export const DependencyImpact = z.strictObject({ id: Id, taskId: Id, upstreamTaskId: Id.nullable(), upstreamVersion: Version.nullable(), kind: z.enum(['blocked', 'changed', 'cancelled', 'withdrawn', 'review_returned', 'artifact_revoked', 'access_revoked']), affectedRevisions: z.array(Version).max(100), createdAt: Instant, acknowledgedBy: Id.nullable(), acknowledgedAt: Instant.nullable(), comment: Text.nullable() })
export type ChangeProposalModel = z.infer<typeof ChangeProposal>
export type ArtifactModel = z.infer<typeof Artifact>
export type DependencyImpactModel = z.infer<typeof DependencyImpact>

// B4a uses explicit, immutable selections. Configuration generations are not method releases.
export const ConclusionInput = z.strictObject({ deliverable: ObjectRef, artifactRefs: z.array(InputRef).max(10), conclusion: Text, applicability: Text, scope: z.enum(['owner_only','source_readers']) })
export const RetainedConclusion = ConclusionInput.extend({ allowedActions: z.array(z.enum(['revise','revoke'])).max(2).default([]), id: Id, taskId: Id, sourceTaskVersion: Version, confirmedBy: Id, version: Version, status: z.enum(['current','needs_review','revoked']), createdAt: Instant })
export const ConclusionHistory = z.strictObject({ data: z.array(RetainedConclusion).max(100) })
export const FeedbackSample = z.strictObject({ allowedActions: z.array(z.literal('revoke')).max(1).default([]), id: Id, taskId: Id, deliverable: ObjectRef, sourceTaskVersion: Version, grantedBy: Id, selectedText: Text.nullable(), decision: z.enum(['share_selected','decline','revoke']), status: z.enum(['available','needs_review','revoked','declined']), version: Version, createdAt: Instant })
export const MethodConfig = z.strictObject({ emphasis: z.enum(['metrics','evidence_gaps']), detail: z.enum(['concise','detailed']), citations: z.literal('exact_quote') })
export const PublicMethod = z.strictObject({ allowedActions: z.array(z.enum(['trial','activate'])).max(2).default([]), validationRunIds: z.array(Id).max(100).default([]), version: Version, capabilityId: Id, labId: Id, config: MethodConfig, sampleIds: z.array(Id).max(10), createdBy: Id.nullable(), createdAt: Instant, origin: z.enum(['legacy_b3','candidate']), usable: z.boolean() })
export const MethodState = z.strictObject({ allowedActions: z.array(z.enum(['create_method','disable'])).max(2).default([]), capabilityId: Id, generation: Version, activeMethodVersion: Version, enabled: z.boolean(), ownerId: Id, methods: z.array(PublicMethod).max(100) })
export const MethodEvent = z.strictObject({ sequence: Version, methodVersion: Version, generation: Version, action: z.enum(['legacy_import','created','trial','activated','disabled','sample_revoked']), actorId: Id.nullable(), at: Instant, runId: Id.nullable() })
export const PlanningSummary = PlanningRequest.pick({id:true,status:true,planId:true,failure:true,version:true,createdAt:true,updatedAt:true})
