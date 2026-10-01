import { randomBytes } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { routes } from '@research-agent-platform/contracts'
import type { PlanModel, RequestFor, ResponseFor, RouteName } from '@research-agent-platform/contracts'
import { openDatabase, migrate, seed } from '../src/database.js'
import { provisionTestAccounts, passwordHash } from '../src/auth.js'

const origin = 'http://127.0.0.1:4173'
const schedule = { suggested: null, hardDeadline: null, committed: null, estimatedHumanHours: null, checkpoint: null }
type Client = { cookie: string; csrf: string }
const accounts = ['A', 'B', 'C'].map(letter => ({ memberId: `member_${letter}`, username: `synthetic_${letter.toLowerCase()}`, password: randomBytes(24).toString('hex') }))
let directory: string, databasePath: string, address: string, secondAddress: string
let db: ReturnType<typeof openDatabase>
let clients: Record<'A' | 'B' | 'C', Client>
const children = new Set<ChildProcess>()
let counter = 0
const key = () => `b1_synthetic_command_${++counter}`

async function startServer() {
  const child = spawn(process.execPath, [resolve('apps/api/dist/main.js')], { env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', APP_ORIGIN: origin, DATABASE_PATH: databasePath, BLOB_ROOT: join(directory, 'blobs') }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  children.add(child)
  const url = await new Promise<string>((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('server startup timeout')), 10000)
    child.stdout!.on('data', chunk => { output += chunk; const match = /listening (http:\/\/127\.0\.0\.1:\d+);/.exec(output); if (match) { clearTimeout(timer); resolve(match[1]!) } })
    child.once('error', err => { clearTimeout(timer); reject(err) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`server startup failed ${code}`)) })
  })
  return { child, url }
}
async function stopServers() {
  for (const child of children) {
    if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped }
  }
  children.clear()
}
type Options = { body?: unknown; params?: { id: string }; query?: Record<string, unknown>; client?: Client; key?: string; target?: string; headers?: Record<string, string> }
async function request<K extends RouteName>(name: K, options: Options = {}) {
  const route = routes[name]
  const path = route.path.replace('{id}', options.params?.id ?? 'synthetic')
  const url = new URL(path, options.target ?? address)
  for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, String(v))
  const response = await fetch(url, { method: route.method, headers: { ...(route.method === 'GET' ? {} : { 'content-type': 'application/json', origin }), ...(options.client ? { cookie: options.client.cookie, 'x-csrf-token': options.client.csrf } : {}), ...(route.idempotent ? { 'Idempotency-Key': options.key ?? key() } : {}), ...options.headers }, ...(route.method === 'GET' ? {} : { body: JSON.stringify(options.body ?? {}) }) })
  const raw: unknown = await response.json()
  if (response.ok) route.response.parse(raw)
  else if (name !== 'ready') route.errors.parse(raw)
  return { status: response.status, response, value: raw as ResponseFor<K> & { error?: { code: string } } }
}
async function loginAs(letter: 'A' | 'B' | 'C', prior?: Client) {
  const account = accounts.find(a => a.memberId === `member_${letter}`)!
  const login = await request('login', { body: { username: account.username, password: account.password }, client: prior })
  expect(login.status).toBe(200)
  const cookie = login.response.headers.get('set-cookie')!.split(';')[0]!
  expect(login.response.headers.get('set-cookie')).toContain('HttpOnly')
  expect(login.response.headers.get('set-cookie')).toContain('SameSite=Lax')
  const client = { cookie, csrf: '' }
  const session = await request('session', { client })
  expect(session.status).toBe(200)
  client.csrf = session.value.data.csrfToken
  return client
}
function item(kind: 'invitation' | 'claim' | 'self', itemId = 'item_one'): PlanModel['proposedItems'][number] {
  return { id: itemId, title: 'Synthetic collaboration', goal: 'RESTRICTED_INPUT_SENTINEL', deliverable: 'Public offered text checklist', acceptanceCriteria: 'List missing items explicitly', allocation: kind === 'invitation' ? { kind, memberId: 'member_B' } : kind === 'claim' ? { kind, audience: 'lab_members', summary: 'Safe claim summary' } : { kind }, dependencies: [], schedule, inputArtifactIds: [], budget: null }
}
function planInput(items = [item('invitation')]): RequestFor<'createPlan'>['body'] { return { labId: 'lab_synthetic', goal: 'Owner-only planning notes', proposedItems: items, unresolvedQuestions: [] } }
async function createConfirmed(items = [item('invitation')]) {
  const created = await request('createPlan', { client: clients.A, body: planInput(items) }); expect(created.status).toBe(201)
  const confirmation = await request('confirmPlan', { client: clients.A, params: { id: created.value.data.id }, body: { expectedVersion: created.value.data.version } }); expect(confirmation.status).toBe(200)
  return confirmation.value.data
}
async function detail(taskId: string, client = clients.A) {
  const result = await request('task', { client, params: { id: taskId } }); expect(result.status).toBe(200)
  if (!('task' in result.value.data)) throw new Error('Expected authorized task detail')
  return result.value.data
}
async function accept(taskId: string) {
  const summary = await request('task', { client: clients.B, params: { id: taskId } })
  if (!('pendingInvitation' in summary.value.data) || !summary.value.data.pendingInvitation) throw new Error('Expected invitation summary')
  const offer = summary.value.data.pendingInvitation
  const result = await request('invitationDecision', { client: clients.B, params: { id: offer.id }, body: { expectedVersion: offer.version, expectedTaskVersion: summary.value.data.version, decision: 'accepted', comment: null } })
  expect(result.status).toBe(200)
  return result
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'rap-b1-http-')); databasePath = join(directory, 'platform.sqlite'); mkdirSync(join(directory, 'blobs'))
  db = openDatabase(databasePath, true); migrate(db); seed(db, 'test'); seed(db, 'test')
  await provisionTestAccounts(db, 'test', accounts); await provisionTestAccounts(db, 'test', accounts)
  address = (await startServer()).url; secondAddress = (await startServer()).url
  clients = { A: await loginAs('A'), B: await loginAs('B'), C: await loginAs('C') }
}, 30000)
afterAll(async () => { await stopServers(); db?.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })

describe('B1 A1–A5: two real HTTP processes, file SQLite, real passwords', () => {
  it('A1 drafts create no assignments; old version conflicts; confirmation and creation are idempotent', async () => {
    const assignmentsBefore = Number(db.prepare('SELECT count(*) n FROM assignments').get()!.n)
    const createKey = key(), body = planInput()
    const created = await request('createPlan', { body, client: clients.A, key: createKey })
    expect(created.status).toBe(201)
    expect((await request('createPlan', { body, client: clients.A, key: createKey })).value).toEqual(created.value)
    expect(db.prepare('SELECT count(*) n FROM assignments').get()!.n).toBe(assignmentsBefore)
    const planId = created.value.data.id
    const edited = await request('editPlan', { params: { id: planId }, client: clients.A, body: { ...body, goal: 'Revised owner-only goal', expectedVersion: 1 } })
    expect(edited.status).toBe(200); expect(edited.value.data.version).toBe(2)
    expect((await request('confirmPlan', { params: { id: planId }, client: clients.A, body: { expectedVersion: 1 } })).value.error?.code).toBe('VERSION_CONFLICT')
    const confirmationKey = key(), input = { params: { id: planId }, client: clients.A, body: { expectedVersion: 2 }, key: confirmationKey }
    const [a, b] = await Promise.all([request('confirmPlan', input), request('confirmPlan', { ...input, target: secondAddress })])
    expect(a.status).toBe(200); expect(b.value).toEqual(a.value)
    expect(db.prepare('SELECT count(*) n FROM tasks WHERE plan_id=?').get(planId)!.n).toBe(1)
    expect(db.prepare('SELECT count(*) n FROM plan_versions WHERE plan_id=?').get(planId)!.n).toBe(3)
    expect((await request('confirmPlan', { ...input, body: { expectedVersion: 3 } })).value.error?.code).toBe('IDEMPOTENCY_CONFLICT')
    expect((await request('editPlan', { params: { id: planId }, client: clients.A, body: { ...body, expectedVersion: 3 } })).value.error?.code).toBe('INVALID_STATE')
  })
  it('A2 pending invite is summary only, accept makes commitment, decline preserves history and permits reinvite', async () => {
    const { taskIds } = await createConfirmed([item('invitation', 'accept'), item('invitation', 'decline')])
    const taskId = taskIds[0]!, declinedId = taskIds[1]!
    const pending = await request('task', { client: clients.B, params: { id: taskId } })
    expect(JSON.stringify(pending.value)).not.toContain('RESTRICTED_INPUT_SENTINEL')
    expect(JSON.stringify(pending.value)).not.toContain('planId')
    expect((await detail(taskId)).assignments[0]!.commitment).toBeNull()
    expect((await request('start', { client: clients.B, params: { id: taskId }, body: { expectedVersion: 1 } })).status).toBe(403)
    const accepted = await accept(taskId)
    expect(accepted.value.data.commitment?.scope).toBe('Public offered text checklist')
    expect((await detail(taskId, clients.B)).task.goal).toBe('RESTRICTED_INPUT_SENTINEL')
    const pendingDecline = await request('task', { client: clients.B, params: { id: declinedId } })
    if (!('pendingInvitation' in pendingDecline.value.data)) throw new Error('summary required')
    const offer = pendingDecline.value.data.pendingInvitation!
    const input = { client: clients.B, params: { id: offer.id }, body: { expectedVersion: offer.version, expectedTaskVersion: 1, decision: 'declined', comment: 'Synthetic decline' }, key: key() }
    const declined = await request('invitationDecision', input)
    expect(declined.status).toBe(200); expect(declined.value.data.commitment).toBeNull()
    expect((await request('invitationDecision', input)).value).toEqual(declined.value)
    expect(db.prepare('SELECT comment FROM invitation_decisions WHERE assignment_id=?').get(offer.id)!.comment).toBe('Synthetic decline')
    expect((await request('task', { client: clients.B, params: { id: declinedId } })).status).toBe(404)
    const after = await detail(declinedId)
    expect(after.task.status).toBe('unassigned'); expect(after.task.leadId).toBeNull()
    const reinvite = await request('invite', { client: clients.A, params: { id: declinedId }, body: { memberId: 'member_C', scope: 'New explicit offer', schedule, expectedVersion: after.task.version } })
    expect(reinvite.status).toBe(201); expect(reinvite.value.data.status).toBe('pending'); expect(reinvite.value.data.commitment).toBeNull()
    expect((await detail(declinedId)).assignments).toHaveLength(2)
    expect((await detail(declinedId)).task.id).toBe(declinedId)
  })
  it('A1 failed confirmation rolls back tasks, assignments, events, outbox and idempotency together', async () => {
    const draft = await request('createPlan', { client: clients.A, body: planInput() }); expect(draft.status).toBe(201)
    const planId = draft.value.data.id, confirmationKey = key()
    db.exec("CREATE TRIGGER synthetic_fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'synthetic database failure'); END")
    try {
      const failure = await request('confirmPlan', { client: clients.A, params: { id: planId }, body: { expectedVersion: 1 }, key: confirmationKey })
      expect(failure.status).toBe(500); expect(JSON.stringify(failure.value)).not.toContain('database failure')
      expect(db.prepare('SELECT count(*) n FROM tasks WHERE plan_id=?').get(planId)!.n).toBe(0)
      expect(db.prepare('SELECT count(*) n FROM idempotency_results WHERE key=?').get(confirmationKey)!.n).toBe(0)
      expect((await request('getPlan', { client: clients.A, params: { id: planId } })).value.data.status).toBe('draft')
    } finally { db.exec('DROP TRIGGER synthetic_fail_outbox') }
    expect((await request('confirmPlan', { client: clients.A, params: { id: planId }, body: { expectedVersion: 1 }, key: confirmationKey })).status).toBe(200)
  })
  it('A3 simultaneous B/C claims across separate processes produce one leader and a real conflict', async () => {
    const { taskIds } = await createConfirmed([item('claim')]); const taskId = taskIds[0]!
    const body = { expectedVersion: 1 }, bKey = key(), cKey = key()
    const [b, c] = await Promise.all([request('claim', { client: clients.B, params: { id: taskId }, body, key: bKey }), request('claim', { client: clients.C, params: { id: taskId }, body, key: cKey, target: secondAddress })])
    expect([b.status, c.status].sort()).toEqual([200, 409])
    expect((b.status === 409 ? b : c).value.error?.code).toBe('ALREADY_CLAIMED')
    const winner = b.status === 200 ? b : c, client = b.status === 200 ? clients.B : clients.C
    const retry = await request('claim', { client, params: { id: taskId }, body, key: b.status === 200 ? bKey : cKey })
    expect(retry.value).toEqual(winner.value)
    expect(db.prepare("SELECT count(*) n FROM assignments WHERE task_id=? AND status='accepted'").get(taskId)!.n).toBe(1)
    expect((await detail(taskId)).task.leadId).toBe(winner.value.data.memberId)
  })
  it('A4 text revision, return, resubmit, exact revision review; retries never duplicate effects', async () => {
    const { taskIds } = await createConfirmed(); const taskId = taskIds[0]!; await accept(taskId)
    const started = await request('start', { client: clients.B, params: { id: taskId }, body: { expectedVersion: 2 } }); expect(started.status).toBe(200)
    const input = { client: clients.B, params: { id: taskId }, body: { expectedVersion: 3, summary: 'Synthetic text v1; no private method identifiers', artifactRefs: [], sources: [] }, key: key() }
    const first = await request('submit', input); expect(first.status).toBe(201)
    expect((await request('submit', input)).value).toEqual(first.value)
    expect((await request('submit', { ...input, body: { ...input.body, summary: 'Changed payload with reused key' } })).value.error?.code).toBe('IDEMPOTENCY_CONFLICT')
    expect((await detail(taskId)).task.status).toBe('in_review')
    const reviewInput = { client: clients.A, params: { id: first.value.data.id }, body: { expectedVersion: 1, expectedTaskVersion: 4, revision: 1, decision: 'changes_requested', comment: 'Add missing evidence' }, key: key() }
    expect((await request('review', { ...reviewInput, client: clients.C, key: key() })).status).toBe(404)
    const returned = await request('review', reviewInput); expect(returned.status).toBe(200)
    expect((await request('review', reviewInput)).value).toEqual(returned.value)
    expect((await detail(taskId)).task.status).toBe('changes_requested')
    const second = await request('submit', { client: clients.B, params: { id: taskId }, body: { ...input.body, summary: 'Synthetic text v2 with requested evidence', expectedVersion: 5 } })
    expect(second.status).toBe(201); expect(second.value.data.revision).toBe(2)
    const finalInput = { client: clients.A, params: { id: second.value.data.id }, body: { expectedVersion: 1, expectedTaskVersion: 6, revision: 2, decision: 'accepted', comment: 'Meets synthetic criteria' }, key: key() }
    expect((await request('review', { ...finalInput, body: { ...finalInput.body, revision: 1 }, key: key() })).value.error?.code).toBe('VERSION_CONFLICT')
    expect((await request('review', { client: clients.A, params: { id: first.value.data.id }, body: { ...finalInput.body, expectedVersion: 2, revision: 1 } })).value.error?.code).toBe('INVALID_STATE')
    const accepted = await request('review', finalInput); expect(accepted.status).toBe(200)
    expect((await request('review', finalInput)).value).toEqual(accepted.value)
    expect((await detail(taskId)).task.status).toBe('completed')
    expect(db.prepare('SELECT count(*) n FROM deliverables WHERE task_id=?').get(taskId)!.n).toBe(2)
    expect(db.prepare('SELECT count(*) n FROM reviews r JOIN deliverables d ON d.id=r.deliverable_id WHERE d.task_id=?').get(taskId)!.n).toBe(2)
    // Refresh from another process, restart both, and replay original committed commands.
    const before = await request('task', { client: clients.B, params: { id: taskId }, target: secondAddress })
    await stopServers(); address = (await startServer()).url; secondAddress = (await startServer()).url
    expect((await request('task', { client: clients.B, params: { id: taskId }, query: { snapshot: before.value.snapshot!.token } })).value).toEqual(before.value)
    expect((await request('review', finalInput)).value).toEqual(accepted.value)
    expect((await request('submit', input)).value).toEqual(first.value)
  })
  it('A5 direct access, actor spoofing, foreign lab, csrf, logout, expiry and revocation cannot bypass authorization', async () => {
    const { taskIds, plan } = await createConfirmed(); const taskId = taskIds[0]!
    expect((await request('task', { client: clients.C, params: { id: taskId } })).status).toBe(404)
    expect((await request('getPlan', { client: clients.B, params: { id: plan.id } })).status).toBe(404)
    expect((await request('task', { params: { id: taskId } })).status).toBe(401)
    expect((await request('createPlan', { client: clients.A, body: { ...planInput(), actorId: 'member_C' } })).status).toBe(400)
    expect((await request('createPlan', { client: clients.A, body: { ...planInput(), labId: 'other_lab' } })).status).toBe(404)
    expect((await request('tasks', { client: clients.C, query: { labId: 'other_lab', scope: 'lab' } })).status).toBe(404)
    expect((await request('createPlan', { client: clients.A, body: planInput(), headers: { origin: 'https://untrusted.example' } })).status).toBe(403)
    expect((await request('createPlan', { client: clients.A, body: planInput(), headers: { 'x-csrf-token': '0'.repeat(64) } })).status).toBe(403)
    const accepted = await accept(taskId)
    const submitInput = { client: clients.B, params: { id: taskId }, body: { expectedVersion: 2 }, key: key() }
    const started = await request('start', submitInput); expect(started.status).toBe(200)
    db.prepare("UPDATE task_access SET access='revoked' WHERE task_id=? AND member_id='member_B'").run(taskId)
    expect((await request('start', submitInput)).status).toBe(404)
    expect((await request('task', { client: clients.B, params: { id: taskId } })).status).toBe(404)
    expect((await request('invitationDecision', { client: clients.C, params: { id: accepted.value.data.id }, body: { expectedVersion: 2, expectedTaskVersion: 3, decision: 'accepted', comment: null } })).status).toBe(404)
    const temporary = await loginAs('C')
    expect((await request('logout', { client: temporary })).status).toBe(200)
    expect((await request('me', { client: temporary })).status).toBe(401)
    const expired = await loginAs('C')
    db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00Z' WHERE member_id='member_C'").run()
    expect((await request('me', { client: expired })).status).toBe(401)
    clients.C = await loginAs('C')
    const old = clients.C; clients.C = await loginAs('C', old)
    expect((await request('me', { client: old })).status).toBe(401)
    db.prepare("UPDATE auth_accounts SET disabled=1 WHERE member_id='member_C'").run()
    expect((await request('me', { client: clients.C })).status).toBe(401)
    db.prepare("UPDATE auth_accounts SET disabled=0 WHERE member_id='member_C'").run()
  })
  it('permission-filtered paging and member commitments never disclose restricted tasks; cursors are scoped', async () => {
    // C may legitimately own a claim from an earlier concurrent test.
    const owned = await createConfirmed([item('claim', 'owned_by_c')])
    expect((await request('claim', { client: clients.C, params: { id: owned.taskIds[0]! }, body: { expectedVersion: 1 } })).status).toBe(200)
    const privateGoal = 'PAGING_PRIVATE_INPUT_SENTINEL', unclaimedGoal = 'PAGING_UNCLAIMED_INPUT_SENTINEL'
    const { taskIds } = await createConfirmed([
      { ...item('invitation', 'private'), goal: privateGoal },
      { ...item('claim', 'unclaimed'), goal: unclaimedGoal },
    ])
    const privateId = taskIds[0]!, unclaimedId = taskIds[1]!
    const result = await request('tasks', { client: clients.C, query: { labId: 'lab_synthetic', scope: 'lab', limit: 100 } })
    expect(result.status).toBe(200); expect(JSON.stringify(result.value)).not.toContain(privateId)
    expect(JSON.stringify(result.value)).not.toContain(privateGoal)
    expect(JSON.stringify(result.value)).not.toContain(unclaimedGoal)
    expect(result.value.data.find(task => task.id === owned.taskIds[0])).toMatchObject({ leadId: 'member_C', goal: 'RESTRICTED_INPUT_SENTINEL' })
    expect(result.value.data.find(task => task.id === unclaimedId)).toMatchObject({ projection: 'claim_summary', summary: 'Safe claim summary' })
    expect((await request('task', { client: clients.C, params: { id: privateId } })).status).toBe(404)
    const members = await request('members', { client: clients.C, params: { id: 'lab_synthetic' } })
    expect(JSON.stringify(members.value)).not.toContain(privateId)
    expect(JSON.stringify(members.value)).not.toContain(privateGoal)
    expect(JSON.stringify(members.value)).not.toContain(unclaimedGoal)
    const first = await request('tasks', { client: clients.A, query: { labId: 'lab_synthetic', scope: 'mine', limit: 1 } })
    expect(first.value.nextCursor).toBeTruthy()
    const next = await request('tasks', { client: clients.A, query: { labId: 'lab_synthetic', scope: 'mine', limit: 1, cursor: first.value.nextCursor! } })
    expect(next.status).toBe(200); expect(next.value.data[0]!.id).not.toBe(first.value.data[0]!.id)
    expect((await request('tasks', { client: clients.C, query: { labId: 'lab_synthetic', scope: 'mine', limit: 1, cursor: first.value.nextCursor! } })).status).toBe(410)
    await createConfirmed([item('self')])
    expect((await request('tasks', { client: clients.A, query: { labId: 'lab_synthetic', scope: 'mine', limit: 1, cursor: first.value.nextCursor! } })).status).toBe(410)
  })
  it('unsupported AI and invalid input are unavailable; invalid dependency drafts cannot dispatch', async () => {
    expect((await request('planRequest', { client: clients.A, body: { labId: 'lab_synthetic', prompt: 'Synthetic prompt', inputArtifactIds: [], budget: { maxTokens: 10, maxSeconds: 10 } } })).value.error?.code).toBe('MODEL_UNAVAILABLE')
    const ai = item('self'); ai.allocation = { kind: 'public_agent', capability: null, humanLeadId: 'member_A', missingReason: 'No public runtime' }
    const draft = await request('createPlan', { client: clients.A, body: planInput([ai]) }); expect(draft.status).toBe(201)
    expect((await request('confirmPlan', { client: clients.A, params: { id: draft.value.data.id }, body: { expectedVersion: 1 } })).value.error?.code).toBe('CAPABILITY_UNAVAILABLE')
    expect(db.prepare('SELECT count(*) n FROM tasks WHERE plan_id=?').get(draft.value.data.id)!.n).toBe(0)
    const cyclic = item('self'); cyclic.dependencies = [cyclic.id]
    expect((await request('createPlan', { client: clients.A, body: planInput([cyclic]) })).status).toBe(400)
    const upstream = item('self', 'upstream'), downstream = item('self', 'downstream'); downstream.dependencies = [upstream.id]
    const { taskIds } = await createConfirmed([upstream, downstream])
    expect((await request('start', { client: clients.A, params: { id: taskIds[1]! }, body: { expectedVersion: 1 } })).value.error?.code).toBe('DEPENDENCY_BLOCKED')
    expect((await request('upload', { client: clients.A, body: {} })).status).toBe(400)
  })
  it('password hashes only, login failure indistinguishable and shared persistent throttling', async () => {
    expect(db.prepare('SELECT count(*) n FROM auth_accounts').get()!.n).toBe(3)
    for (const account of accounts) expect(String(db.prepare('SELECT password_hash FROM auth_accounts WHERE member_id=?').get(account.memberId)!.password_hash)).not.toContain(account.password)
    const wrong = await request('login', { body: { username: accounts[0]!.username, password: randomBytes(16).toString('hex') } })
    const absent = await request('login', { body: { username: 'synthetic_unknown', password: randomBytes(16).toString('hex') } })
    expect(wrong.status).toBe(401); expect(absent.status).toBe(401); expect(wrong.value.error?.code).toBe(absent.value.error?.code)
    // Exercise threshold with real KDF attempts on both workers.
    for (let i = 0; i < 9; i++) await request('login', { target: i % 2 ? address : secondAddress, body: { username: 'synthetic_unknown', password: randomBytes(16).toString('hex') } })
    const limited = await request('login', { target: secondAddress, body: { username: 'synthetic_unknown', password: randomBytes(16).toString('hex') } })
    expect(limited.status).toBe(429); expect(limited.response.headers.get('retry-after')).toBe('900')
    await expect(provisionTestAccounts(db, 'production', accounts)).rejects.toThrow()
    const encoded = await passwordHash('synthetic-noncommitted-test-password')
    expect(encoded.startsWith('scrypt-v1$')).toBe(true)
  }, 20000)
  it('local credential CLI and authenticated demo seed repeat without resetting identities or progress', async () => {
    const credentialsPath = join(directory, 'credentials.json')
    writeFileSync(credentialsPath, JSON.stringify(accounts), { mode: 0o600 })
    const env = { ...process.env, NODE_ENV: 'test', APP_ORIGIN: origin, DATABASE_PATH: databasePath, BLOB_ROOT: join(directory, 'blobs'), TEST_CREDENTIALS_FILE: credentialsPath, API_URL: address }
    for (let n = 0; n < 2; n++) {
      const result = spawnSync(process.execPath, [resolve('apps/api/dist/credentials.js')], { env, encoding: 'utf8', windowsHide: true })
      expect(result.status).toBe(0)
      for (const account of accounts) expect(result.stdout + result.stderr).not.toContain(account.password)
    }
    expect((await request('me', { client: clients.A })).status).toBe(200)
    const before = Number(db.prepare('SELECT count(*) n FROM tasks').get()!.n)
    for (let n = 0; n < 2; n++) {
      const result = spawnSync(process.execPath, [resolve('scripts/seed-b1-demo.mjs')], { env, encoding: 'utf8', windowsHide: true })
      expect(result.status, result.stderr).toBe(0)
      expect(db.prepare('SELECT count(*) n FROM tasks').get()!.n).toBe(before + 3)
    }
    const denied = spawnSync(process.execPath, [resolve('apps/api/dist/credentials.js')], { env: { ...env, NODE_ENV: 'production', APP_ORIGIN: 'https://synthetic.example' }, encoding: 'utf8', windowsHide: true })
    expect(denied.status).not.toBe(0)
    for (const account of accounts) expect(denied.stdout + denied.stderr).not.toContain(account.password)
  }, 20000)
})
