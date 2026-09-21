import { z } from 'zod'
import * as m from './models.js'
import { routes } from './routes.js'

const at = '2026-09-21T08:00:00+08:00'
export const unknownSchedule = { suggested: null, hardDeadline: null, committed: null, estimatedHumanHours: null, checkpoint: null }
const member = m.Member.parse({ id: 'member_B', labId: 'lab_synthetic', displayName: 'Synthetic B', publicExpertise: [], availability: null, visibleCommitments: [], version: 1 })
const plan = m.Plan.parse({ id: 'plan_synthetic', ownerId: 'member_A', labId: 'lab_synthetic', version: 1, status: 'draft', goal: '整理合成申请材料', proposedItems: [{ id: 'item_1', title: '核对材料', goal: '标明缺项', deliverable: '合成材料清单', acceptanceCriteria: '每项可追溯，缺项明确', allocation: { kind: 'invitation', memberId: member.id }, dependencies: [], schedule: unknownSchedule, inputArtifactIds: [], budget: null }], unresolvedQuestions: ['交付日期待确认'], createdAt: at })
const task = { id: 'task_synthetic', labId: 'lab_synthetic', parentTaskId: null, planId: plan.id, planVersion: 1, title: '核对合成材料', taskType: 'grant', goal: '列出缺项', acceptanceCriteria: '缺项明确', initiatorId: 'member_A', leadId: 'member_B', reviewerId: 'member_A', participantIds: [], status: 'blocked', blocker: { reason: '合成材料缺失', requestedMemberId: 'member_A', requestedAction: '提供获准材料', resumeStatus: 'in_progress' }, dependencies: [], schedule: unknownSchedule, access: { visibility: 'participants', summary: null }, version: 3, createdAt: at, updatedAt: at, allowedActions: ['resume', 'cancel'] }
const deliverable = m.Deliverable.parse({ id: 'delivery_synthetic', taskId: task.id, revision: 1, submittedBy: member.id, artifactRefs: [], summary: '合成清单：两项资料待补充', sources: [{ kind: 'note', locator: 'synthetic-input-1', label: '合成材料' }], submittedAt: at, review: null, version: 1 })
const privateCapability = m.Capability.parse({ id: 'private_B_1', labId: 'lab_synthetic', ownerId: member.id, maintainerIds: [], visibility: 'private', version: 1, name: '合成私人方法', inputContract: '合成文本', outputContract: '合成清单', status: 'draft', validationResultIds: [] })
const error = (code: z.infer<typeof m.ErrorCode>) => ({ error: { code, message: '合成错误，未执行真实业务', requestId: 'request_synthetic' } })
export const fixtures = {
  missingDeadlineDraft: { schema: m.data(m.Plan), value: { data: plan } },
  invitationPlan: { schema: m.data(m.Plan), value: { data: plan } },
  claimSummary: { schema: m.data(m.TaskSummary), value: { data: { projection: 'claim_summary', id: 'task_claim', labId: 'lab_synthetic', title: '合成认领事项', summary: '仅公开的必要摘要', deliverable: '清单', acceptanceCriteria: '缺项明确', schedule: unknownSchedule, initiatorId: 'member_A', reviewerId: 'member_A', version: 1, allowedActions: ['claim'] } } },
  blockedTask: { schema: m.data(m.Task), value: { data: m.Task.parse(task) } },
  pendingReview: { schema: m.data(m.Deliverable), value: { data: deliverable } },
  cancelledTask: { schema: m.data(m.Task), value: { data: m.Task.parse({ ...task, status: 'cancelled', blocker: null, allowedActions: [], version: 4 }) } },
  unknownAvailability: { schema: m.data(m.Member), value: { data: member } },
  versionConflict: { schema: m.ErrorResponse, value: error('VERSION_CONFLICT') },
  concurrentClaimFailure: { schema: m.ErrorResponse, value: error('ALREADY_CLAIMED') },
  modelUnavailable: { schema: m.ErrorResponse, value: error('MODEL_UNAVAILABLE') },
  privateCapabilityOwner: { schema: m.page(m.Capability), value: { data: [privateCapability], nextCursor: null } },
  privateCapabilityOther: { schema: m.page(m.Capability), value: { data: [], nextCursor: null } },
} as const

// Generate structural examples for every endpoint, separate from authored semantic
// scenarios above. They are synthetic schema examples, never a service fallback.
type JsonShape = { const?: unknown; enum?: unknown[]; anyOf?: JsonShape[]; oneOf?: JsonShape[]; type?: string; properties?: Record<string, JsonShape>; required?: string[]; minItems?: number; items?: JsonShape; minimum?: number; exclusiveMinimum?: number; minLength?: number; format?: string; pattern?: string; default?: unknown }
function sample(s: JsonShape, key = ''): unknown {
  if ('const' in s) return s.const
  if (s.enum) return s.enum[0]
  const choices = s.anyOf ?? s.oneOf
  if (choices) return sample(choices.find(v => v.type === 'null') ?? choices[0]!, key)
  if (s.default !== undefined) return s.default
  if (s.type === 'null') return null
  if (s.type === 'object') return Object.fromEntries(Object.entries(s.properties ?? {}).filter(([name]) => s.required?.includes(name)).map(([name, shape]) => [name, sample(shape, name)]))
  if (s.type === 'array') return Array.from({ length: s.minItems ?? 0 }, () => sample(s.items!))
  if (s.type === 'boolean') return false
  if (s.type === 'integer' || s.type === 'number') return s.minimum ?? ((s.exclusiveMinimum ?? 0) + 1)
  if (key === 'timezone') return 'Asia/Shanghai'
  if (s.format === 'date') return '2026-09-21'
  if (s.format === 'date-time') return at
  if (key === 'sha256') return 'a'.repeat(64)
  if (key === 'contentBase64') return 'eA=='
  if (key === 'Idempotency-Key') return 'synthetic_command_0001'
  return 'synthetic'.padEnd(s.minLength ?? 1, 'x')
}
export const endpointExamples = Object.fromEntries(Object.entries(routes).map(([name, route]) => {
  const request = sample(z.toJSONSchema(route.request, { unrepresentable: 'any' }) as JsonShape)
  const response = name === 'content' ? new Uint8Array([120]) : sample(z.toJSONSchema(route.response, { unrepresentable: 'any' }) as JsonShape)
  return [name, { contractVersion: m.contractVersion, synthetic: true, method: route.method, path: route.path, stage: route.stage, status: route.status, request: route.request.parse(request), response: route.response.parse(response) }]
}))
