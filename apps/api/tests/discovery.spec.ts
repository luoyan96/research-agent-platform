import { createHash, createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { routes, taskColumns } from '@research-agent-platform/contracts'
import type { PlanModel, RequestFor, ResponseFor, RouteName } from '@research-agent-platform/contracts'
import { openDatabase, migrate, seed, transaction } from '../src/database.js'
import { provisionTestAccounts, signingKey } from '../src/auth.js'

const origin = 'http://127.0.0.1:4173'
const schedule = { suggested: null, hardDeadline: null, committed: null, estimatedHumanHours: null, checkpoint: null }
type Client = { cookie: string; csrf: string }
const accounts = ['A', 'B', 'C'].map(letter => ({ memberId: `member_${letter}`, username: `synthetic_${letter.toLowerCase()}`, password: randomBytes(24).toString('hex') }))
let directory: string, databasePath: string, address: string, secondAddress: string
let db: ReturnType<typeof openDatabase>
let clients: Record<'A' | 'B' | 'C', Client>
const children = new Set<ChildProcess>()
let counter = 0
const key = () => `b2a_synthetic_command_${++counter}`

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
  directory = mkdtempSync(join(tmpdir(), 'rap-b2a-http-')); databasePath = join(directory, 'platform.sqlite'); mkdirSync(join(directory, 'blobs'))
  db = openDatabase(databasePath, true); migrate(db); seed(db, 'test'); seed(db, 'test')
  await provisionTestAccounts(db, 'test', accounts); await provisionTestAccounts(db, 'test', accounts)
  address = (await startServer()).url; secondAddress = (await startServer()).url
  clients = { A: await loginAs('A'), B: await loginAs('B'), C: await loginAs('C') }
}, 30000)
afterAll(async () => { await stopServers(); db?.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })

describe('B2a A9a: real HTTP and persistent SQLite discovery', () => {
  it('owner-only draft pages survive logout/login; confirmation leaves default drafts and remains explicit history', async () => {
    const bodies = [planInput(), planInput(), planInput()]
    const ids: string[] = []
    for (const body of bodies) { const r = await request('createPlan', { client: clients.A, body }); expect(r.status).toBe(201); ids.push(r.value.data.id) }
    // Tie timestamps deliberately: secondary stable ID ordering must prevent repeats.
    db.prepare("UPDATE plans SET document=json_set(document,'$.createdAt','2026-09-29T00:00:00Z') WHERE owner_id='member_A'").run()
    const first = await request('plans', { client: clients.A, query: { limit: 1 } })
    expect(first.status).toBe(200); expect(first.value.data).toHaveLength(1)
    expect(JSON.stringify(first.value)).not.toContain('RESTRICTED_INPUT_SENTINEL')
    const seen = first.value.data.map(p => p.id)
    let cursor = first.value.nextCursor
    while (cursor) {
      const next = await request('plans', { client: clients.A, query: { limit: 1, cursor }, target: secondAddress })
      expect(next.status).toBe(200); expect(next.value.snapshot).toEqual(first.value.snapshot)
      seen.push(...next.value.data.map(p => p.id)); cursor = next.value.nextCursor
    }
    expect(seen).toEqual([...ids].sort().reverse())
    expect((await request('plans', { client: clients.B, query: { status: 'all' } })).value.data).toEqual([])
    expect((await request('getPlan', { client: clients.B, params: { id: ids[0]! } })).status).toBe(404)
    expect((await request('plans', { client: clients.B, query: { limit: 1, cursor: first.value.nextCursor } })).status).toBe(410)
    expect((await request('plans', { client: clients.A, query: { ownerId: 'member_B' } })).status).toBe(400)
    await request('logout', { client: clients.A }); clients.A = await loginAs('A')
    expect((await request('plans', { client: clients.A })).value.data).toHaveLength(3)
    const confirmation = await request('confirmPlan', { client: clients.A, params: { id: ids[0]! }, body: { expectedVersion: 1 } })
    expect(confirmation.status).toBe(200)
    expect((await request('plans', { client: clients.A })).value.data.map(p => p.id)).not.toContain(ids[0])
    expect((await request('plans', { client: clients.A, query: { status: 'confirmed' } })).value.data.map(p => p.id)).toContain(ids[0])
    expect((await request('plans', { client: clients.A, query: { limit: 1, cursor: first.value.nextCursor } })).status).toBe(410)
  })

  it('lab/mine columns, status pages and details share ACL and snapshot; C cannot count restricted work', async () => {
    await createConfirmed([item('self', 'private'), item('claim', 'open'), item('invitation', 'offer')])
    for (const letter of ['A', 'B', 'C'] as const) for (const scope of ['lab', 'mine'] as const) {
      const overview = await request('overview', { client: clients[letter], params: { id: 'lab_synthetic' }, query: { scope } })
      expect(overview.status).toBe(200)
      const snapshot = overview.value.snapshot.token
      const counts = { unassigned: 0, active: 0, review: 0, completed: 0 }
      const ids: string[] = []; let cursor: string | null = null
      do {
        const page: { status: number; value: ResponseFor<'tasks'> } = await request('tasks', { client: clients[letter], query: { labId: 'lab_synthetic', scope, limit: 1, snapshot, ...(cursor ? { cursor } : {}) }, target: secondAddress })
        expect(page.status).toBe(200); expect(page.value.snapshot).toEqual(overview.value.snapshot)
        for (const task of page.value.data) {
          const state = 'status' in task ? task.status : task.visibleStatus
          expect(state).toBeDefined()
          const column = taskColumns[state!]; if (column) counts[column]++
          ids.push(task.id)
          const detail = await request('task', { client: clients[letter], params: { id: task.id }, query: { snapshot } })
          expect(detail.status).toBe(200)
          expect('task' in detail.value.data ? detail.value.data.task : detail.value.data).toEqual(task)
        }
        cursor = page.value.nextCursor
      } while (cursor)
      expect(new Set(ids).size).toBe(ids.length); expect(counts).toEqual(overview.value.data.counts)
      if (letter === 'C') { expect(ids).toHaveLength(scope === 'lab' ? 1 : 0); expect(overview.value.data.submittedDeliverables).toBe(0) }
      const status = await request('tasks', { client: clients[letter], query: { labId: 'lab_synthetic', scope, status: 'awaiting_acceptance', snapshot } })
      expect(status.value.data.every(t => ('status' in t ? t.status : t.visibleStatus) === 'awaiting_acceptance')).toBe(true)
    }
    expect((await request('overview', { client: clients.C, params: { id: 'other_lab' }, query: { scope: 'lab' } })).status).toBe(404)
    expect((await request('overview', { params: { id: 'lab_synthetic' }, query: { scope: 'lab' } })).status).toBe(401)
  })

  it('actionable invitations are not commitments; current review version changes after return/resubmit and disappears on acceptance', async () => {
    const { taskIds } = await createConfirmed([item('invitation', 'response'), item('invitation', 'decline')])
    const taskId = taskIds[0]!, declineId = taskIds[1]!
    const pending = await request('actionItems', { client: clients.B, params: { id: 'lab_synthetic' }, query: { kind: 'invitation_response', limit: 100 } })
    expect(pending.status).toBe(200); expect(pending.value.data.some(i => i.task.id === taskId)).toBe(true)
    expect(JSON.stringify(pending.value)).not.toContain('RESTRICTED_INPUT_SENTINEL')
    expect((await request('me', { client: clients.B })).value.data.visibleCommitments.some(c => c.taskId === taskId)).toBe(false)
    const d = pending.value.data.find(i => i.task.id === declineId)!
    if (d.kind !== 'invitation_response') throw new Error('invitation expected')
    const decline = await request('invitationDecision', { client: clients.B, params: { id: d.task.pendingInvitation!.id }, body: { expectedVersion: 1, expectedTaskVersion: 1, decision: 'declined', comment: null } }); expect(decline.status).toBe(200)
    await accept(taskId)
    expect((await request('me', { client: clients.B })).value.data.visibleCommitments.some(c => c.taskId === taskId)).toBe(true)
    const membersC = await request('members', { client: clients.C, params: { id: 'lab_synthetic' } })
    expect(JSON.stringify(membersC.value)).not.toContain(taskId)
    let t = (await detail(taskId, clients.B)).task
    const started = await request('start', { client: clients.B, params: { id: taskId }, body: { expectedVersion: t.version } }); expect(started.status).toBe(200)
    const submit = async (version: number) => request('submit', { client: clients.B, params: { id: taskId }, body: { expectedVersion: version, summary: 'Synthetic version', artifactRefs: [], sources: [] } })
    const v1 = await submit(started.value.data.version); expect(v1.status).toBe(201)
    for (const decision of ['changes_requested', 'accepted'] as const) {
      const actions = await request('actionItems', { client: clients.A, params: { id: 'lab_synthetic' }, query: { kind: 'deliverable_review' } })
      const review = actions.value.data.find(i => i.task.id === taskId)!
      expect(review.kind).toBe('deliverable_review')
      if (review.kind !== 'deliverable_review') throw new Error('review expected')
      expect(review.revision).toBe(decision === 'accepted' ? 2 : 1)
      const overview = await request('overview', { client: clients.A, params: { id: 'lab_synthetic' }, query: { scope: 'mine', snapshot: actions.value.snapshot.token } })
      expect(overview.value.data.pendingActions.deliverableReviews).toBe(actions.value.data.length)
      const result = await request('review', { client: clients.A, params: { id: review.deliverableId }, body: { expectedVersion: review.deliverableVersion, expectedTaskVersion: review.task.version, revision: review.revision, decision, comment: 'Synthetic decision' } }); expect(result.status).toBe(200)
      if (decision === 'changes_requested') { t = (await detail(taskId, clients.B)).task; expect((await submit(t.version)).status).toBe(201) }
    }
    expect((await request('actionItems', { client: clients.A, params: { id: 'lab_synthetic' } })).value.data.some(i => i.task.id === taskId)).toBe(false)
    expect((await request('me', { client: clients.B })).value.data.visibleCommitments.some(c => c.taskId === taskId)).toBe(false)
    const total = await request('overview', { client: clients.A, params: { id: 'lab_synthetic' }, query: { scope: 'lab' } })
    expect(total.value.data.counts.completed).toBe(1); expect(total.value.data.acceptedDeliverables).toBe(1); expect(total.value.data.submittedDeliverables).toBe(2)
  })

  it('self availability is versioned/idempotent, unknown/upcoming/expired explicit and never inferred from task counts', async () => {
    const before = await request('me', { client: clients.B }); expect(before.value.data.availabilityStatus).toBe('unknown')
    const availability = { from: '2000-01-01', to: '2000-01-02', timezone: 'Pacific/Kiritimati', level: 'available', hours: null, updatedAt: '2000-01-01T00:00:00Z' }
    const input = { client: clients.B, body: { expectedVersion: before.value.data.version, availability }, key: key() }
    const saved = await request('availability', input); expect(saved.status).toBe(200)
    expect(saved.value.data.availabilityStatus).toBe('expired'); expect(saved.value.data.availability!.hours).toBeNull()
    expect(saved.value.data.availability!.updatedAt).not.toBe(availability.updatedAt)
    expect((await request('availability', { ...input, target: secondAddress })).value).toEqual(saved.value)
    expect((await request('availability', { ...input, key: key() })).value.error?.code).toBe('VERSION_CONFLICT')
    expect((await request('availability', { ...input, body: { ...input.body, actorId: 'member_A' } })).status).toBe(400)
    expect((await request('me', { client: clients.A })).value.data.availability).toBeNull()
    const members = await request('members', { client: clients.A, params: { id: 'lab_synthetic' }, target: secondAddress })
    expect(members.value.data.find(m => m.id === 'member_B')!.availability).toEqual(saved.value.data.availability)
    const future = await request('availability', { client: clients.B, body: { expectedVersion: saved.value.data.version, availability: { ...availability, from: '2999-01-01', to: '2999-01-02' } } })
    expect(future.value.data.availabilityStatus).toBe('upcoming')
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const current = await request('availability', { client: clients.B, body: { expectedVersion: future.value.data.version, availability: { ...availability, from: today, to: today, hours: 0, level: 'unavailable' } } })
    expect(current.value.data.availabilityStatus).toBe('current'); expect(current.value.data.availability!.hours).toBe(0)
    const cleared = await request('availability', { client: clients.B, body: { expectedVersion: current.value.data.version, availability: null } })
    expect(cleared.value.data.availabilityStatus).toBe('unknown'); expect(cleared.value.data.availability).toBeNull()
    expect(cleared.value.data.visibleCommitments).toEqual(before.value.data.visibleCommitments)
  })

  it('snapshot tokens are actor-bound and expire on edits, permissions, timeout; pagination binds filters and explicit snapshot', async () => {
    const o = await request('overview', { client: clients.A, params: { id: 'lab_synthetic' }, query: { scope: 'lab' } })
    const snapshot = o.value.snapshot.token
    expect((await request('me', { client: clients.B, query: { snapshot } })).status).toBe(410)
    expect((await request('me', { client: clients.A, query: { snapshot: snapshot + 'bad' } })).status).toBe(410)
    const [payload] = snapshot.split('.')
    const v = JSON.parse(Buffer.from(payload!, 'base64url').toString()); v.expires = Date.now() - 1
    const expiredPayload = Buffer.from(JSON.stringify(v)).toString('base64url')
    const expired = `${expiredPayload}.${createHmac('sha256', signingKey(db)).update(`snapshot:${expiredPayload}`).digest('hex')}`
    expect((await request('me', { client: clients.A, query: { snapshot: expired } })).status).toBe(410)
    const first = await request('tasks', { client: clients.A, query: { labId: 'lab_synthetic', scope: 'lab', limit: 1 } })
    expect((await request('tasks', { client: clients.A, query: { labId: 'lab_synthetic', scope: 'mine', limit: 1, cursor: first.value.nextCursor } })).status).toBe(410)
    const draft = (await request('plans', { client: clients.A })).value.data[0]!
    const original = (await request('getPlan', { client: clients.A, params: { id: draft.id } })).value.data
    expect((await request('editPlan', { client: clients.A, params: { id: draft.id }, body: { ...planInput(original.proposedItems), goal: 'Changed synthetic draft', expectedVersion: original.version } })).status).toBe(200)
    expect((await request('overview', { client: clients.A, params: { id: 'lab_synthetic' }, query: { scope: 'lab', snapshot } })).status).toBe(410)
    const fresh = await request('tasks', { client: clients.B, query: { labId: 'lab_synthetic', scope: 'mine' } })
    const id = fresh.value.data[0]!.id
    db.prepare("INSERT INTO task_access VALUES (?,?,'revoked') ON CONFLICT(task_id,member_id) DO UPDATE SET access='revoked'").run(id, 'member_B')
    expect((await request('task', { client: clients.B, params: { id } })).status).toBe(404)
    expect((await request('members', { client: clients.B, params: { id: 'lab_synthetic' }, query: { snapshot: fresh.value.snapshot!.token } })).status).toBe(410)
    expect((await request('tasks', { client: clients.B, query: { labId: 'lab_synthetic', scope: 'mine' } })).value.data.map(t => t.id)).not.toContain(id)
  })

  it('service restart and repeat migration retain plans, sessions, availability, commands and snapshot signature', async () => {
    const me = (await request('me', { client: clients.B })).value.data
    await request('availability', { client: clients.B, body: { expectedVersion: me.version, availability: { from: '2000-01-01', to: '2000-01-02', timezone: 'UTC', hours: null, level: 'limited', updatedAt: '2000-01-01T00:00:00Z' } } })
    const plans = await request('plans', { client: clients.A, query: { status: 'all', limit: 1 } })
    const members = await request('members', { client: clients.A, params: { id: 'lab_synthetic' }, query: { snapshot: plans.value.snapshot.token } })
    const before = db.prepare('SELECT COUNT(*) n FROM idempotency_results').get()!.n
    await stopServers(); migrate(db); migrate(db)
    address = (await startServer()).url; secondAddress = (await startServer()).url
    expect((await request('members', { client: clients.A, params: { id: 'lab_synthetic' }, query: { snapshot: plans.value.snapshot.token } })).value).toEqual(members.value)
    expect((await request('plans', { client: clients.A, query: { status: 'all', limit: 1, cursor: plans.value.nextCursor } })).status).toBe(200)
    expect(db.prepare('SELECT COUNT(*) n FROM idempotency_results').get()!.n).toBe(before)
    expect((await request('me', { client: clients.B })).value.data.availabilityStatus).toBe('expired')
  })

  it('action/member pagination is snapshot-stable, summary status never reveals restricted body, seed replays preserve rows', async () => {
    const first = await request('actionItems', { client: clients.B, params: { id: 'lab_synthetic' }, query: { limit: 1 } })
    expect(first.status).toBe(200)
    const ids = first.value.data.map(i => i.task.id); let cursor = first.value.nextCursor
    while (cursor) {
      const next = await request('actionItems', { client: clients.B, params: { id: 'lab_synthetic' }, query: { limit: 1, cursor }, target: secondAddress })
      expect(next.status).toBe(200); expect(next.value.snapshot).toEqual(first.value.snapshot)
      expect(JSON.stringify(next.value)).not.toContain('RESTRICTED_INPUT_SENTINEL')
      ids.push(...next.value.data.map(i => i.task.id)); cursor = next.value.nextCursor
    }
    expect(ids.length).toBeGreaterThan(1); expect(new Set(ids).size).toBe(ids.length)
    const o = await request('overview', { client: clients.B, params: { id: 'lab_synthetic' }, query: { scope: 'mine', snapshot: first.value.snapshot.token } })
    expect(o.value.data.pendingActions.invitationResponses).toBe(ids.length)
    const members = await request('members', { client: clients.B, params: { id: 'lab_synthetic' }, query: { limit: 1, snapshot: first.value.snapshot.token } })
    const second = await request('members', { client: clients.B, params: { id: 'lab_synthetic' }, query: { limit: 1, cursor: members.value.nextCursor } })
    expect(second.status).toBe(200); expect(second.value.data[0]!.id).not.toBe(members.value.data[0]!.id)
    // Run the published seed twice against the actual HTTP service. Never print credentials.
    const credentialPath = join(directory, 'seed-credentials.json'); writeFileSync(credentialPath, JSON.stringify(accounts), { mode: 0o600 })
    const runSeed = () => spawnSync(process.execPath, [resolve('scripts/seed-b2a-demo.mjs')], { env: { ...process.env, NODE_ENV: 'test', API_URL: address, APP_ORIGIN: origin, TEST_CREDENTIALS_FILE: credentialPath }, windowsHide: true, encoding: 'utf8', timeout: 30000 })
    const seed1 = runSeed(); expect(seed1.status, seed1.stderr).toBe(0)
    const tables = ['plans','tasks','assignments','deliverables','reviews','idempotency_results']
    const before = tables.map(t => db.prepare(`SELECT count(*) n FROM ${t}`).get()!.n)
    const seed2 = runSeed(); expect(seed2.status, seed2.stderr).toBe(0)
    expect(tables.map(t => db.prepare(`SELECT count(*) n FROM ${t}`).get()!.n)).toEqual(before)
    expect(seed2.stdout).not.toContain(accounts[0]!.password)
    clients.A = await loginAs('A'); clients.B = await loginAs('B')
    const current = await request('overview', { client: clients.A, params: { id: 'lab_synthetic' }, query: { scope: 'lab' } })
    expect(Object.values(current.value.data.counts).every(n => n > 0)).toBe(true)
  })

  it('aggregates count beyond one page; current commitment truncation is explicit and full invitees still receive safe action items', async () => {
    const before = await request('overview', { client: clients.A, params: { id: 'lab_synthetic' }, query: { scope: 'mine' } })
    await createConfirmed(Array.from({ length: 100 }, (_, i) => item('self', `bulk_${i}`)))
    await createConfirmed([item('self', 'bulk_last')])
    const overview = await request('overview', { client: clients.A, params: { id: 'lab_synthetic' }, query: { scope: 'mine' } })
    expect(overview.value.data.counts.unassigned).toBe(before.value.data.counts.unassigned + 101)
    const me = await request('me', { client: clients.A, query: { snapshot: overview.value.snapshot.token } })
    expect(me.value.data.visibleCommitments).toHaveLength(100); expect(me.value.data.visibleCommitmentsTruncated).toBe(true)
    const page = await request('tasks', { client: clients.A, query: { labId: 'lab_synthetic', scope: 'mine', limit: 100, snapshot: overview.value.snapshot.token } })
    expect(page.value.data).toHaveLength(100); expect(page.value.nextCursor).not.toBeNull()
    const remaining = await request('tasks', { client: clients.A, query: { labId: 'lab_synthetic', scope: 'mine', limit: 100, cursor: page.value.nextCursor } })
    expect(remaining.status).toBe(200); expect(remaining.value.data.length).toBeGreaterThan(0)
    const { taskIds } = await createConfirmed()
    db.prepare("UPDATE task_access SET access='full' WHERE task_id=? AND member_id='member_B'").run(taskIds[0]!)
    const actions = await request('actionItems', { client: clients.B, params: { id: 'lab_synthetic' } })
    expect(actions.status).toBe(200)
    expect(actions.value.data.find(i => i.task.id === taskIds[0])!.kind).toBe('invitation_response')
    expect(JSON.stringify(actions.value)).not.toContain('RESTRICTED_INPUT_SENTINEL')
  })

  it('upgrades an actual populated B1 database twice without changing historical rows or migration checksums', () => {
    const legacy = openDatabase(join(directory, 'legacy.sqlite'), true)
    try {
      // Commit legacy schema setup together; every DDL otherwise triggers FULL fsync.
      // The actual repeated upgrade below remains outside this fixture transaction.
      transaction(legacy, () => {
        legacy.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT')
        for (const [i, name] of ['001-foundation.sql', '002-collaboration.sql', '003-invitation-decisions.sql'].entries()) {
          const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'); legacy.exec(sql)
          legacy.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(i + 1, createHash('sha256').update(sql).digest('hex'), '2026-09-21T00:00:00Z')
        }
      })
      // Copy only synthetic rows in FK order into the pre-upgrade schema.
      const tables = ['labs','members','auth_accounts','sessions','plans','plan_versions','tasks','task_access','assignments','deliverables','reviews','invitation_decisions','idempotency_results','outbox','task_events','runtime_meta']
      // Commit fixture setup once; per-row FULL fsync exceeds CI timeouts on Windows.
      // The migration and before/after checks still run against committed B1 data.
      transaction(legacy, () => {
        for (const table of tables) for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
          const columns = Object.keys(row); legacy.prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row))
        }
      })
      const before = tables.map(t => JSON.stringify(legacy.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))
      migrate(legacy); migrate(legacy)
      expect(tables.map(t => JSON.stringify(legacy.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))).toEqual(before)
      expect(legacy.prepare('SELECT count(*) n FROM schema_migrations').get()!.n).toBe(8)
      expect(legacy.prepare('SELECT count(*) n FROM member_availability').get()!.n).toBe(0)
      expect(legacy.prepare('SELECT applied_at FROM schema_migrations WHERE version=3').get()!.applied_at).toBe('2026-09-21T00:00:00Z')
    } finally { legacy.close() }
  })
})
