import { describe, it, expect } from 'vitest'
import { fixtures, endpointExamples, unknownSchedule } from '../src/fixtures.js'
import { routes, Task, Plan, Assignment, DateValue, Member, ErrorResponse, errorStatus, taskColumns } from '../src/index.js'

describe('B0 executable contract', () => {
  for (const [name, fixture] of Object.entries(fixtures)) it(`validates semantic fixture ${name}`, () => { expect(fixture.schema.safeParse(fixture.value).success).toBe(true) })
  for (const [name, route] of Object.entries(routes)) it(`validates request/response for ${route.method} ${route.path}`, () => {
    const example = endpointExamples[name]!
    expect(route.request.safeParse(example.request).success).toBe(true)
    expect(route.response.safeParse(example.response).success).toBe(true)
    expect(route.implemented).toBe(route.stage === 'B0')
    if (route.method !== 'GET' && !['login', 'logout'].includes(name)) expect(route.idempotent).toBe(true)
  })
  it('rejects actor spoofing and arbitrary status update', () => {
    const req = endpointExamples.claim!.request as Record<string, unknown>
    expect(routes.claim.request.safeParse({ ...req, body: { expectedVersion: 1, actorId: 'member_A' } }).success).toBe(false)
    expect(routes.start.request.safeParse({ ...req, body: { expectedVersion: 1, status: 'completed' } }).success).toBe(false)
    expect(routes.claim.request.safeParse({ ...req, headers: {} }).success).toBe(false)
  })
  it('rejects private capability references in shared plans and methods in summaries', () => {
    const plan = structuredClone(fixtures.invitationPlan.value.data)
    const item = plan.proposedItems[0]!
    expect(Plan.safeParse({ ...plan, proposedItems: [{ ...item, allocation: { kind: 'public_agent', humanLeadId: 'member_A', missingReason: null, capability: { id: 'private_B', version: 1, visibility: 'private' } } }] }).success).toBe(false)
    expect(fixtures.claimSummary.schema.safeParse({ data: { ...fixtures.claimSummary.value.data, inputArtifactIds: ['secret'] } }).success).toBe(false)
    expect(Task.safeParse({ ...fixtures.blockedTask.value.data, privateCapabilityId: 'secret' }).success).toBe(false)
  })
  it('keeps unknown time and real commitment distinct', () => {
    expect(fixtures.missingDeadlineDraft.value.data.proposedItems[0]!.schedule.hardDeadline).toBeNull()
    expect(DateValue.safeParse({ kind: 'date', date: '2026-02-30', timezone: 'Asia/Shanghai' }).success).toBe(false)
    expect(DateValue.safeParse({ kind: 'date', date: '2026-09-21', timezone: 'MadeUp' }).success).toBe(false)
    expect(Assignment.safeParse({ id: 'a', taskId: 't', kind: 'invitation', memberId: 'b', capability: null, status: 'pending', commitment: { scope: 'x', schedule: unknownSchedule, acceptedAt: '2026-09-21T00:00:00Z' }, transferToMemberId: null, version: 1 }).success).toBe(false)
    expect(Member.safeParse({ ...fixtures.unknownAvailability.value.data, availability: { from: '2026-09-22', to: '2026-09-21', timezone: 'UTC', level: 'available', hours: null, updatedAt: '2026-09-21T00:00:00Z' } }).success).toBe(false)
  })
  it('requires blocker and keeps cancelled out of completed column', () => {
    expect(Task.safeParse({ ...fixtures.blockedTask.value.data, blocker: null }).success).toBe(false)
    expect(taskColumns.cancelled).toBeNull()
    expect(Object.keys(taskColumns)).toHaveLength(9)
  })
  it('bounds inputs, pagination and public errors', () => {
    const request = endpointExamples.tasks!.request as Record<string, unknown>
    expect(routes.tasks.request.safeParse({ ...request, query: { labId: 'l', scope: 'lab', limit: 101 } }).success).toBe(false)
    expect(routes.createPlan.request.safeParse({ ...endpointExamples.createPlan!.request as object, body: { labId: 'l', goal: 'x'.repeat(8001), proposedItems: [], unresolvedQuestions: [] } }).success).toBe(false)
    expect(ErrorResponse.safeParse({ ...fixtures.versionConflict.value, stack: 'private' }).success).toBe(false)
    expect(errorStatus.VERSION_CONFLICT).toBe(409)
    expect(errorStatus.MODEL_UNAVAILABLE).toBe(503)
  })
})
