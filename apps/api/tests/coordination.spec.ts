import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { routes } from '@research-agent-platform/contracts'
import type { PlanModel, RequestFor, ResponseFor, RouteName } from '@research-agent-platform/contracts'
import { openDatabase, migrate, seed, transaction } from '../src/database.js'
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
const key = () => `b2b_synthetic_command_${++counter}`

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
  directory = mkdtempSync(join(tmpdir(), 'rap-b2b-http-')); databasePath = join(directory, 'platform.sqlite'); mkdirSync(join(directory, 'blobs'))
  db = openDatabase(databasePath, true); migrate(db); seed(db, 'test'); seed(db, 'test')
  await provisionTestAccounts(db, 'test', accounts); await provisionTestAccounts(db, 'test', accounts)
  address = (await startServer()).url; secondAddress = (await startServer()).url
  clients = { A: await loginAs('A'), B: await loginAs('B'), C: await loginAs('C') }
}, 30000)
afterAll(async () => { await stopServers(); db?.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })

async function command<K extends RouteName>(name: K, taskId: string, client: Client, body: Record<string,unknown> = {}) {
  const t=(await detail(taskId,client)).task
  return request(name,{client,params:{id:taskId},body:{expectedVersion:t.version,...body}})
}
async function finish(taskId:string, client=clients.A) {
  let t=(await detail(taskId,client)).task
  if(t.status==='ready') { const r=await command('start',taskId,client);expect(r.status).toBe(200) }
  const submitted=await command('submit',taskId,client,{summary:'Synthetic preserved result',artifactRefs:[],sources:[]});expect(submitted.status).toBe(201)
  t=(await detail(taskId)).task
  const review=await request('review',{client:clients.A,params:{id:submitted.value.data.id},body:{expectedVersion:1,expectedTaskVersion:t.version,revision:submitted.value.data.revision,decision:'accepted',comment:'Synthetic acceptance'}});expect(review.status).toBe(200)
  return review.value.data
}
async function propose(taskId:string, extra:Record<string,unknown>={}, client=clients.A) {
  const t=(await detail(taskId,client)).task
  return command('proposeChange',taskId,client,{scope:'Revised synthetic scope',goal:t.goal,acceptanceCriteria:t.acceptanceCriteria,schedule:t.schedule,dependencies:t.dependencies,proposedLeadId:t.leadId,reason:'Synthetic negotiated change',...extra})
}
async function decide(proposalId:string, version:number, decision:'accepted'|'declined', client=clients.B, target=address) {
  return request('decideChange',{client,params:{id:proposalId},body:{expectedVersion:version,decision},target})
}
async function upload(taskId:string, client=clients.B, text='Synthetic attachment') {
  const t=(await detail(taskId,client)).task
  const input={client,body:{taskId,expectedVersion:t.version,filename:'synthetic.txt',mediaType:'text/plain',contentBase64:Buffer.from(text).toString('base64')},key:key()}
  const r=await request('upload',input);expect(r.status).toBe(201);return {r,input}
}
async function download(id:string,client:Client) {return fetch(new URL(routes.content.path.replace('{id}',id),address),{headers:{cookie:client.cookie}})}

describe('B2b A6–A9: transaction database and two actual HTTP processes',()=>{
  it('A6 rejects self/indirect dependency cycles and gates exact accepted revisions, not mere submission',async()=>{
    const {taskIds}=await createConfirmed([item('self','up'),item('self','down')]);const [up,down]=taskIds as [string,string]
    expect((await propose(down,{dependencies:[{taskId:down,kind:'accepted_deliverable',requiredRevision:1}]})).status).toBe(400)
    const dependent=await propose(down,{dependencies:[{taskId:up,kind:'accepted_deliverable',requiredRevision:2}]});expect(dependent.status).toBe(201);expect(dependent.value.data.status).toBe('accepted')
    expect((await propose(up,{dependencies:[{taskId:down,kind:'accepted_deliverable',requiredRevision:null}]})).status).toBe(400)
    expect((await command('start',down,clients.A)).value.error?.code).toBe('DEPENDENCY_BLOCKED')
    await finish(up)
    expect((await command('start',down,clients.A)).value.error?.code).toBe('DEPENDENCY_BLOCKED')
    const bind=await propose(down,{dependencies:[{taskId:up,kind:'accepted_deliverable',requiredRevision:1}]});expect(bind.status).toBe(201)
    expect((await command('start',down,clients.A)).status).toBe(200)
    expect(db.prepare('SELECT revision FROM dependency_bindings WHERE task_id=?').get(down)!.revision).toBe(1)
    expect((await propose(down,{dependencies:[{taskId:up,kind:'confirmed_decision',requiredRevision:null}]})).status).toBe(501)
  })

  it('A6 block/resume preserves state; upstream changes pause downstream and preserve delivery/review history until reassessment',async()=>{
    const u=item('self','u'),d=item('invitation','d');d.dependencies=['u']
    const {taskIds}=await createConfirmed([u,d]);const [up,down]=taskIds as [string,string];await accept(down)
    const block=await command('block',up,clients.A,{reason:'Synthetic missing input',requestedMemberId:'member_A',requestedAction:'Supply synthetic evidence'});expect(block.status).toBe(200)
    expect((await detail(down,clients.B)).task.status).toBe('blocked')
    expect((await command('resume',down,clients.B)).value.error?.code).toBe('DEPENDENCY_BLOCKED')
    expect((await command('resume',up,clients.A)).status).toBe(200);await finish(up)
    let value=await detail(down,clients.B)
    expect((await command('acknowledgeImpacts',down,clients.B,{impactIds:value.dependencyImpacts!.filter(i=>!i.acknowledgedBy).map(i=>i.id),comment:'Checked current evidence'})).status).toBe(200)
    expect((await command('resume',down,clients.B)).value.data.status).toBe('ready')
    await command('start',down,clients.B)
    const delivery=await command('submit',down,clients.B,{summary:'Retain this downstream work',artifactRefs:[],sources:[]});expect(delivery.status).toBe(201)
    const changed=await propose(up,{goal:'Changed upstream scope'});expect(changed.status).toBe(201)
    value=await detail(down,clients.B);expect(value.task.status).toBe('blocked');expect(value.task.blocker!.resumeStatus).toBe('in_review');expect(value.deliverables[0]!.summary).toBe('Retain this downstream work')
    expect(value.dependencyImpacts!.some(i=>i.affectedRevisions.includes(1))).toBe(true)
    expect(value.dependencyImpacts!.every(i=>i.upstreamTaskId===null && i.upstreamVersion===null)).toBe(true)
    expect((await command('resume',down,clients.B)).status).toBe(409)
    await finish(up)
    expect((await command('acknowledgeImpacts',down,clients.B,{impactIds:value.dependencyImpacts!.filter(i=>!i.acknowledgedBy).map(i=>i.id),comment:'Cannot silently rebind old evidence'})).status).toBe(409)
    const repin=await propose(down,{dependencies:[{taskId:up,kind:'accepted_deliverable',requiredRevision:2}]});expect(repin.status).toBe(201)
    expect((await decide(repin.value.data.id,repin.value.data.version,'accepted')).status).toBe(200)
    value=await detail(down,clients.B)
    expect((await command('acknowledgeImpacts',down,clients.B,{impactIds:value.dependencyImpacts!.filter(i=>!i.acknowledgedBy).map(i=>i.id),comment:'Explicitly rechecked v2'})).status).toBe(200)
    expect((await command('resume',down,clients.B)).value.data.status).toBe('in_review')
    expect((await detail(down)).deliverables).toHaveLength(1)
    expect(db.prepare('SELECT count(*) n FROM reviews WHERE deliverable_id IN (SELECT id FROM deliverables WHERE task_id=?)').get(up)!.n).toBe(2)
  })

  it('A7 refusal preserves scope/time; only unanimous acceptance changes commitment; members, actions and overview share one snapshot',async()=>{
    const {taskIds}=await createConfirmed();const id=taskIds[0]!;await accept(id)
    const old=(await detail(id)).assignments[0]!.commitment
    const dated={...schedule,suggested:{value:{kind:'date',date:'2026-11-03',timezone:'Asia/Shanghai'},source:'suggestion',confirmed:false},hardDeadline:{value:{kind:'date',date:'2026-11-08',timezone:'Asia/Shanghai'},source:'user',confirmed:true},committed:{value:{kind:'date',date:'2026-11-07',timezone:'Asia/Shanghai'},source:'member',confirmed:true}}
    const p=await propose(id,{scope:'Expanded agreed scope',schedule:dated});expect(p.status).toBe(201)
    expect((await detail(id)).assignments[0]!.commitment).toEqual(old)
    const actions=await request('actionItems',{client:clients.B,params:{id:'lab_synthetic'},query:{kind:'change_response'}});expect(actions.status).toBe(200)
    expect(actions.value.data.find(x=>x.task.id===id)!.kind).toBe('change_response')
    const o=await request('overview',{client:clients.B,params:{id:'lab_synthetic'},query:{scope:'mine',snapshot:actions.value.snapshot.token}})
    expect(o.value.data.pendingActions.changeResponses).toBe(actions.value.data.length)
    expect((await decide(p.value.data.id,p.value.data.version,'declined')).value.data.status).toBe('declined')
    expect((await detail(id)).assignments[0]!.commitment).toEqual(old)
    const p2=await propose(id,{scope:'Expanded agreed scope',schedule:dated});expect(p2.status).toBe(201)
    const input={client:clients.B,params:{id:p2.value.data.id},body:{expectedVersion:p2.value.data.version,decision:'accepted'},key:key()}
    const [a,b]=await Promise.all([request('decideChange',input),request('decideChange',{...input,target:secondAddress})]);expect(a.status).toBe(200);expect(b.value).toEqual(a.value)
    const updated=await detail(id);expect(updated.task.schedule).toEqual(dated);expect(updated.assignments[0]!.commitment!.scope).toBe('Expanded agreed scope')
    expect(db.prepare('SELECT count(*) n FROM assignment_versions WHERE assignment_id=?').get(updated.assignments[0]!.id)!.n).toBe(3)
    expect(updated.changes!.map(p=>p.status)).toEqual(['declined','accepted'])
    const members=await request('members',{client:clients.A,params:{id:'lab_synthetic'}})
    expect(members.value.data.find(m=>m.id==='member_B')!.visibleCommitments.find(c=>c.taskId===id)!.schedule).toEqual(dated)
    expect((await request('actionItems',{client:clients.C,params:{id:'lab_synthetic'},query:{kind:'change_response'}})).value.data.some(x=>x.task.id===id)).toBe(false)
  })

  it('A7 concurrent stale proposals/decisions cannot overwrite facts; intervening task changes persist superseded state',async()=>{
    const {taskIds}=await createConfirmed();const id=taskIds[0]!;await accept(id)
    const t=(await detail(id)).task,body={expectedVersion:t.version,scope:'Concurrent scope',goal:t.goal,acceptanceCriteria:t.acceptanceCriteria,schedule:t.schedule,dependencies:[],proposedLeadId:t.leadId,reason:'Race'}
    const [a,b]=await Promise.all([request('proposeChange',{client:clients.A,params:{id},body}),request('proposeChange',{client:clients.A,params:{id},body,target:secondAddress})])
    expect([a.status,b.status].sort()).toEqual([201,409])
    const p=(a.status===201?a:b).value.data
    expect((await command('start',id,clients.B)).status).toBe(200)
    expect((await decide(p.id,p.version,'accepted')).value.error?.code).toBe('VERSION_CONFLICT')
    expect((await detail(id)).changes![0]!.status).toBe('superseded')
    const fresh=await propose(id)
    const [yes,no]=await Promise.all([decide(fresh.value.data.id,1,'accepted'),decide(fresh.value.data.id,1,'declined',clients.B,secondAddress)])
    expect([yes.status,no.status].sort()).toEqual([200,409])
    expect(db.prepare('SELECT count(*) n FROM change_decisions WHERE proposal_id=? AND member_id=?').get(fresh.value.data.id,'member_B')!.n).toBe(1)
  })

  it('A8 attachments are real bytes, bounded, authorized and bound to delivery revision; rollback leaves no reachable partial upload',async()=>{
    const {taskIds}=await createConfirmed();const id=taskIds[0]!
    const summary=await request('task',{client:clients.B,params:{id}})
    expect((await request('upload',{client:clients.B,body:{taskId:id,expectedVersion:1,filename:'x.txt',mediaType:'text/plain',contentBase64:'eA=='}})).status).toBe(403)
    await accept(id)
    const {r,input}=await upload(id,clients.B,'Synthetic bytes 中文')
    const downloaded=await download(r.value.data.id,clients.B);expect(downloaded.status).toBe(200);expect(await downloaded.text()).toBe('Synthetic bytes 中文')
    expect(downloaded.headers.get('cache-control')).toBe('no-store');expect(downloaded.headers.get('content-disposition')).toContain('attachment');expect(downloaded.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await download(r.value.data.id,clients.C)).status).toBe(404)
    expect((await request('upload',{...input,target:secondAddress})).value).toEqual(r.value)
    expect((await request('task',{client:clients.B,params:{id},query:{snapshot:summary.value.snapshot!.token}})).status).toBe(410)
    const version=(await detail(id)).task.version
    for(const invalid of [{filename:'../secret'},{mediaType:'image/png'},{mediaType:'application/pdf'}]) expect((await request('upload',{client:clients.B,body:{...input.body,expectedVersion:version,...invalid}})).status).toBe(400)
    const large=await upload(id,clients.B,'x'.repeat(1100000));expect(large.r.value.data.size).toBe(1100000)
    expect((await request('upload',{client:clients.B,body:{...input.body,expectedVersion:(await detail(id)).task.version,contentBase64:Buffer.alloc(10485761,120).toString('base64')}})).status).toBe(413)
    const files=readdirSync(join(directory,'blobs')).sort()
    db.exec("CREATE TRIGGER fail_artifact BEFORE INSERT ON artifacts BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
    try {expect((await request('upload',{client:clients.B,body:{...input.body,expectedVersion:(await detail(id)).task.version}})).status).toBe(500)}finally{db.exec('DROP TRIGGER fail_artifact')}
    expect(readdirSync(join(directory,'blobs')).sort()).toEqual(files)
    await command('start',id,clients.B)
    const delivered=await command('submit',id,clients.B,{summary:'With immutable attachment',artifactRefs:[r.value.data.id],sources:[{kind:'artifact',locator:r.value.data.id,label:'Synthetic text'}]});expect(delivered.status).toBe(201)
    expect(db.prepare('SELECT artifact_version FROM deliverable_artifacts WHERE deliverable_id=?').get(delivered.value.data.id)!.artifact_version).toBe(1)
  })

  it('A8 artifact revocation rejects old downloads and upload/submit/review cache replay while preserving versions',async()=>{
    const {taskIds}=await createConfirmed();const id=taskIds[0]!;await accept(id)
    const {r,input}=await upload(id);await command('start',id,clients.B)
    const submitInput={client:clients.B,params:{id},body:{expectedVersion:(await detail(id)).task.version,summary:'Immutable artifact delivery',artifactRefs:[r.value.data.id],sources:[]},key:key()}
    const submitted=await request('submit',submitInput);expect(submitted.status).toBe(201)
    const reviewInput={client:clients.A,params:{id:submitted.value.data.id},body:{expectedVersion:1,expectedTaskVersion:(await detail(id)).task.version,revision:1,decision:'accepted',comment:'Synthetic checked'},key:key()}
    expect((await request('review',reviewInput)).status).toBe(200)
    const revoked=await request('revokeArtifact',{client:clients.A,params:{id:r.value.data.id},body:{expectedVersion:1,reason:'Synthetic access withdrawn'}});expect(revoked.status).toBe(200)
    for(const client of [clients.A,clients.B,clients.C]) expect((await download(r.value.data.id,client)).status).toBe(404)
    expect((await request('upload',input)).status).toBe(404);expect((await request('submit',submitInput)).status).toBe(404);expect((await request('review',reviewInput)).status).toBe(404)
    const saved=await detail(id);expect(saved.deliverables[0]!.artifactRefs).toEqual([r.value.data.id]);expect(saved.deliverables[0]!.review!.decision).toBe('accepted')
    expect(saved.artifacts![0]!.accessStatus).toBe('revoked')
  })

  it('A8 withdrawal keeps work, removes old access, and offers successor a fresh unaccepted scope/time',async()=>{
    const {taskIds}=await createConfirmed();const id=taskIds[0]!;const accepted=await accept(id)
    const {r,input}=await upload(id);await command('start',id,clients.B)
    const submitted=await command('submit',id,clients.B,{summary:'Preserve before transfer',artifactRefs:[r.value.data.id],sources:[]});expect(submitted.status).toBe(201)
    const withdrawal=await command('withdraw',id,clients.B,{reason:'Synthetic availability changed',remainingScope:'Remaining synthetic checks',transferToMemberId:'member_C'});expect(withdrawal.status).toBe(200)
    expect((await request('task',{client:clients.B,params:{id}})).status).toBe(404);expect((await download(r.value.data.id,clients.B)).status).toBe(404);expect((await request('upload',input)).status).toBe(404)
    expect((await request('invitationDecision',{client:clients.B,params:{id:accepted.value.data.id},body:{expectedVersion:1,expectedTaskVersion:1,decision:'accepted',comment:null}})).status).toBe(404)
    const offered=await request('task',{client:clients.C,params:{id}});expect(offered.status).toBe(200)
    if(!('pendingInvitation' in offered.value.data)) throw new Error('summary expected')
    expect(offered.value.data.pendingInvitation!.scope).toBe('Remaining synthetic checks');expect(offered.value.data.pendingInvitation!.schedule.committed).toBeNull()
    expect((await request('me',{client:clients.C})).value.data.visibleCommitments.some(c=>c.taskId===id)).toBe(false)
    expect((await download(r.value.data.id,clients.C)).status).toBe(404)
    const acceptedC=await request('invitationDecision',{client:clients.C,params:{id:offered.value.data.pendingInvitation!.id},body:{expectedVersion:1,expectedTaskVersion:offered.value.data.version,decision:'accepted',comment:null}});expect(acceptedC.status).toBe(200)
    expect((await detail(id,clients.C)).deliverables[0]!.summary).toBe('Preserve before transfer');expect((await download(r.value.data.id,clients.C)).status).toBe(200)
    expect((await detail(id)).assignments.find(a=>a.memberId==='member_B')!.status).toBe('transferred')
  })

  it('A8 cancellation preserves queue evidence, revokes access and forbids new dispatch or cached success',async()=>{
    const {taskIds}=await createConfirmed();const id=taskIds[0]!;await accept(id);const {r,input}=await upload(id)
    const before=Number(db.prepare('SELECT count(*) n FROM outbox WHERE aggregate_id=?').get(id)!.n)
    const cancelInput={client:clients.A,params:{id},body:{expectedVersion:(await detail(id)).task.version,reason:'Synthetic cancellation'},key:key()}
    const cancelled=await request('cancelTask',cancelInput);expect(cancelled.status).toBe(200);expect((await request('cancelTask',cancelInput)).value).toEqual(cancelled.value)
    expect((await request('task',{client:clients.B,params:{id}})).status).toBe(404);expect((await request('upload',input)).status).toBe(404)
    expect((await download(r.value.data.id,clients.A)).status).toBe(404)
    expect((await command('invite',id,clients.A,{memberId:'member_C',scope:'No new work',schedule})).status).toBe(409)
    expect(db.prepare('SELECT count(*) n FROM outbox WHERE aggregate_id=?').get(id)!.n).toBe(before)
    expect(db.prepare("SELECT count(*) n FROM outbox WHERE aggregate_id=? AND status='pending'").get(id)!.n).toBe(0)
    expect((await detail(id)).task.status).toBe('cancelled')
  })

  it('A8 explicit task revocation invalidates snapshots and former actor requests; role spoofing cannot revoke others',async()=>{
    const {taskIds}=await createConfirmed([item('claim')]);const id=taskIds[0]!
    const claimInput={client:clients.B,params:{id},body:{expectedVersion:1},key:key()};expect((await request('claim',claimInput)).status).toBe(200)
    const {r,input}=await upload(id)
    const snapshot=(await request('tasks',{client:clients.B,query:{labId:'lab_synthetic',scope:'mine'}})).value.snapshot!.token
    expect((await command('revokeAccess',id,clients.B,{memberId:'member_A',reason:'Not authorized'})).status).toBe(403)
    expect((await command('revokeAccess',id,clients.A,{memberId:'member_B',reason:'Synthetic revocation'})).status).toBe(200)
    expect((await request('claim',claimInput)).status).toBe(404);expect((await request('upload',input)).status).toBe(404);expect((await download(r.value.data.id,clients.B)).status).toBe(404)
    expect((await request('task',{client:clients.B,params:{id},query:{snapshot}})).status).toBe(410)
    expect((await request('tasks',{client:clients.B,query:{labId:'lab_synthetic',scope:'lab'}})).value.data.some(t=>t.id===id)).toBe(false)
    expect((await request('me',{client:clients.B})).value.data.visibleCommitments.some(c=>c.taskId===id)).toBe(false)
  })

  it('A8 revoking the final pending invitation returns the task to unassigned without creating a commitment',async()=>{
    const {taskIds}=await createConfirmed();const id=taskIds[0]!
    expect((await command('revokeAccess',id,clients.A,{memberId:'member_B',reason:'Withdraw unaccepted offer'})).status).toBe(200)
    const saved=await detail(id)
    expect(saved.task.status).toBe('unassigned');expect(saved.task.leadId).toBeNull()
    expect(saved.assignments.some(a=>a.status==='pending'||a.status==='accepted')).toBe(false)
    expect((await request('task',{client:clients.B,params:{id}})).status).toBe(404)
  })

  it('A9 all persisted coordination records and sessions survive dual process restart; event paging stays authorized and complete',async()=>{
    const {taskIds}=await createConfirmed();const id=taskIds[0]!;await accept(id);const p=await propose(id)
    const {r}=await upload(id) // supersedes the pending change, preserving the proposal.
    const before=await request('task',{client:clients.A,params:{id}})
    const rows=db.prepare('SELECT * FROM change_decisions ORDER BY rowid').all()
    await stopServers();migrate(db);migrate(db);address=(await startServer()).url;secondAddress=(await startServer()).url
    expect((await request('task',{client:clients.A,params:{id},query:{snapshot:before.value.snapshot!.token}})).value).toEqual(before.value)
    expect(db.prepare('SELECT * FROM change_decisions ORDER BY rowid').all()).toEqual(rows);expect((await download(r.value.data.id,clients.B)).status).toBe(200)
    expect((await decide(p.value.data.id,1,'accepted')).status).toBe(409)
    let cursor:string|null=null;const events:string[]=[]
    do {const page: {status:number;value:ResponseFor<'events'>}=await request('events',{client:clients.B,params:{id},query:{limit:1,...(cursor?{cursor}:{})}});expect(page.status).toBe(200);events.push(...page.value.data.map(e=>e.id));cursor=page.value.nextCursor}while(cursor)
    expect(new Set(events).size).toBe(events.length);expect(events.length).toBe(Number(db.prepare('SELECT count(*) n FROM task_events WHERE task_id=?').get(id)!.n))
    expect((await request('events',{client:clients.C,params:{id}})).status).toBe(404)
  })
  it('A9 upgrades populated B2a 001–004 twice without resetting sessions, commitments, availability, deliveries or commands',async()=>{
    const {taskIds,plan}=await createConfirmed();const id=taskIds[0]!;await accept(id);await finish(id,clients.B)
    const expected=await detail(id,clients.B)
    const legacyPath=join(directory,'b2a-upgrade.sqlite'),legacy=openDatabase(legacyPath,true)
    try {
      // Batch only legacy fixture DDL, not the real repeated migration under test.
      transaction(legacy,()=>{
        legacy.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT')
        for(const [index,name] of ['001-foundation.sql','002-collaboration.sql','003-invitation-decisions.sql','004-discovery.sql'].entries()) {
          const sql=readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8');legacy.exec(sql)
          legacy.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(index+1,createHash('sha256').update(sql).digest('hex'),'2026-09-29T00:00:00Z')
        }
      })
      const selectors:Record<string,string>={labs:'1',members:'1',auth_accounts:'1',sessions:'1',plans:`id='${plan.id}'`,plan_versions:`plan_id='${plan.id}'`,tasks:`id='${id}'`,task_access:`task_id='${id}'`,assignments:`task_id='${id}'`,deliverables:`task_id='${id}'`,reviews:`deliverable_id IN (SELECT id FROM deliverables WHERE task_id='${id}')`,invitation_decisions:`assignment_id IN (SELECT id FROM assignments WHERE task_id='${id}')`,outbox:`aggregate_id='${id}'`,task_events:`task_id='${id}'`,idempotency_results:`resource_id='${id}'`,runtime_meta:'1'}
      transaction(legacy,()=>{
        for(const [table,where] of Object.entries(selectors)) for(const row of db.prepare(`SELECT * FROM ${table} WHERE ${where}`).all()) {
          const columns=Object.keys(row);legacy.prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...Object.values(row))
        }
        legacy.prepare('INSERT INTO member_availability VALUES (?,?)').run('member_B',JSON.stringify({from:'2000-01-01',to:'2000-01-02',timezone:'UTC',hours:null,level:'limited',updatedAt:'2000-01-01T00:00:00Z'}))
      })
      const tables=[...Object.keys(selectors),'member_availability'],before=tables.map(t=>JSON.stringify(legacy.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))
      migrate(legacy);migrate(legacy)
      expect(tables.map(t=>JSON.stringify(legacy.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))).toEqual(before)
      expect(legacy.prepare('SELECT count(*) n FROM schema_migrations').get()!.n).toBe(10)
      expect(legacy.prepare('SELECT document FROM task_versions WHERE task_id=?').get(id)!.document).toBe(legacy.prepare('SELECT document FROM tasks WHERE id=?').get(id)!.document)
      expect(legacy.prepare('SELECT count(*) n FROM assignment_versions').get()!.n).toBe(1)
      const original=databasePath;databasePath=legacyPath
      let upgraded:{child:ChildProcess;url:string}
      try{upgraded=await startServer()}finally{databasePath=original}
      const read=await request('task',{client:clients.B,params:{id},target:upgraded.url});expect(read.status).toBe(200)
      if(!('task' in read.value.data))throw new Error('full expected')
      expect(read.value.data.task).toEqual(expected.task);expect(read.value.data.deliverables).toEqual(expected.deliverables)
      expect((await request('me',{client:clients.B,target:upgraded.url})).value.data.availabilityStatus).toBe('expired')
    }finally{legacy.close()}
  })

  it('synthetic B2b seed is repeatable and creates genuine pending changes, blocked work and transfer invitation',async()=>{
    const path=join(directory,'b2b-test-credentials.json');writeFileSync(path,JSON.stringify(accounts),{mode:0o600})
    const run=()=>spawnSync(process.execPath,[resolve('scripts/seed-b2b-demo.mjs')],{env:{...process.env,NODE_ENV:'test',API_URL:address,APP_ORIGIN:origin,TEST_CREDENTIALS_FILE:path},windowsHide:true,encoding:'utf8',timeout:30000})
    const first=run();expect(first.status,first.stderr).toBe(0)
    const tables=['tasks','assignments','deliverables','change_proposals','dependency_impacts','artifacts','outbox']
    const before=tables.map(t=>db.prepare(`SELECT count(*) n FROM ${t}`).get()!.n)
    const second=run();expect(second.status,second.stderr).toBe(0)
    expect(tables.map(t=>db.prepare(`SELECT count(*) n FROM ${t}`).get()!.n)).toEqual(before)
    expect(second.stdout).not.toContain(accounts[0]!.password)
    const actions=await request('actionItems',{client:clients.B,params:{id:'lab_synthetic'},query:{kind:'change_response'}})
    expect(actions.value.data.some(i=>i.task.title.includes('negotiation'))).toBe(true)
    expect((await request('actionItems',{client:clients.C,params:{id:'lab_synthetic'},query:{kind:'invitation_response'}})).value.data.some(i=>i.task.title.includes('transfer'))).toBe(true)
  })

})
