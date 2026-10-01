import { backup, restore } from '../src/recovery.js'
import { processGuard } from '../src/process-guard.js'
import { ExecutionWorker } from '../src/execution-worker.js'
import type { ModelResult } from '../src/execution-worker.js'
import { readConfig } from '../src/config.js'
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
import { openDatabase, migrate } from '../src/database.js'

const origin = 'https://127.0.0.1:4443'
const schedule = { suggested: null, hardDeadline: null, committed: null, estimatedHumanHours: null, checkpoint: null }
type Client = { cookie: string; csrf: string }
const accounts = ['A', 'B', 'C'].map(letter => ({ memberId: `member_${letter}`, username: `synthetic_${letter.toLowerCase()}`, password: randomBytes(24).toString('hex') }))
let directory: string, databasePath: string, address: string, secondAddress: string
let db: ReturnType<typeof openDatabase>
let clients: Record<'A' | 'B' | 'C', Client>
const children = new Set<ChildProcess>()
let counter = 0
const key = () => `b5a_synthetic_command_${++counter}`

async function startServer(path = databasePath, blobs = join(directory, 'blobs')) {
  const child = spawn(process.execPath, [resolve('apps/api/dist/main.js')], { env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0', APP_ORIGIN: origin, DATABASE_PATH: path, BLOB_ROOT: blobs, B3_AI_ENABLED:'1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
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
  expect(login.response.headers.get('set-cookie')).toContain('Secure')
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


const config=()=>readConfig({NODE_ENV:'production',DATABASE_PATH:databasePath,BLOB_ROOT:join(directory,'blobs'),APP_ORIGIN:origin,B3_AI_ENABLED:'1'})
function operate(input:unknown){
 const r=spawnSync(process.execPath,[resolve('apps/api/dist/operate.js')],{env:{...process.env,NODE_ENV:'production',DATABASE_PATH:databasePath,BLOB_ROOT:join(directory,'blobs'),APP_ORIGIN:origin,OPERATOR_ID:'synthetic_operator'},input:JSON.stringify(input),encoding:'utf8',windowsHide:true})
 for(const a of accounts){expect(r.stdout).not.toContain(a.password);expect(r.stderr).not.toContain(a.password)}
 return {status:r.status,out:r.stdout,error:r.stderr}
}
const admin=(action:string,fields:Record<string,unknown>={})=>operate({action,requestId:key(),labId:'lab_synthetic',...fields})
beforeAll(async()=>{
 directory=mkdtempSync(join(tmpdir(),'rap-b5a-'));databasePath=join(directory,'platform.sqlite');mkdirSync(join(directory,'blobs'))
 db=openDatabase(databasePath,true);migrate(db);migrate(db)
 expect(admin('create-lab',{name:'Synthetic pilot'}).status).toBe(0)
 for(const a of accounts)expect(admin('create-account',{...a,displayName:'Synthetic pilot member'}).status).toBe(0)
 expect(db.prepare('SELECT count(*) n FROM members WHERE is_synthetic=0').get()!.n).toBe(3)
 address=(await startServer()).url;secondAddress=(await startServer()).url
 clients={A:await loginAs('A'),B:await loginAs('B'),C:await loginAs('C')}
},30000)
afterAll(async()=>{await stopServers();db?.close();if(directory)rmSync(directory,{recursive:true,force:true})})
async function command<K extends RouteName>(name:K,id:string,client:Client,body:Record<string,unknown>={}){return request(name,{params:{id},client,body:{expectedVersion:(await detail(id,client)).task.version,...body}})}
const budget={maxTokens:100000,maxSeconds:30}
const planJob=()=>request('planRequest',{client:clients.A,body:{labId:'lab_synthetic',intent:'draft',prompt:'Synthetic planning only',inputArtifactIds:[],conclusionRefs:[],budget}})
const goodPlan=():ModelResult=>({text:JSON.stringify({intent:'draft',plan:planInput([item('self')])}),failure:null,inputTokens:100,outputTokens:100,elapsedMs:10})
const delay=()=>new Promise<void>(resolve=>setTimeout(resolve,30))

describe('B5a R1–R3/R5 real production API, host maintenance and isolated restore',()=>{
 it('creates independent non-seed identities, rejects duplicate/conflicting/wrong-lab commands without secrets',async()=>{
  const input={action:'create-lab',requestId:key(),labId:'other_lab',name:'Synthetic other lab'}
  const first=operate(input);expect(first.status).toBe(0);expect(operate(input).out).toBe(first.out)
  expect(operate({...input,name:'changed'}).error).toContain('REQUEST_CONFLICT')
  expect(operate({...input,requestId:key()}).error).toContain('LAB_EXISTS')
  expect(operate({action:'reset-password',requestId:key(),labId:'other_lab',memberId:'member_A',expectedVersion:1,password:accounts[0]!.password}).error).toContain('ACCOUNT_NOT_FOUND')
  expect(admin('create-account',{...accounts[0],displayName:'Duplicate'}).error).toContain('ACCOUNT_EXISTS')
  const separate={memberId:'outside',username:'outside',password:randomBytes(24).toString('hex')}
  expect(operate({action:'create-account',requestId:key(),labId:'other_lab',...separate,displayName:'Synthetic outside'}).status).toBe(0)
  const t=(await createConfirmed()).taskIds[0]!
  expect((await request('task',{client:clients.C,params:{id:t}})).status).toBe(404)
  expect((await request('members',{client:clients.A,query:{labId:'other_lab'}})).status).not.toBe(200)
  expect(db.prepare('SELECT result_json,request_hash FROM maintenance_audit').all().map(x=>JSON.stringify(x)).join('')).not.toContain(accounts[0]!.password)
  for(const cmd of ['seed']){const r=spawnSync(process.execPath,[resolve('apps/api/dist/manage.js'),cmd],{env:{...process.env,NODE_ENV:'production',DATABASE_PATH:databasePath,BLOB_ROOT:join(directory,'blobs'),APP_ORIGIN:origin},encoding:'utf8'});expect(r.status).not.toBe(0)}
 },30000)
 it('reset revokes both-process sessions, cancels queued and late running results; old commitments stay intact',async()=>{
  const id=(await createConfirmed([item('self')])).taskIds[0]!
  const commitments=db.prepare('SELECT * FROM assignments WHERE task_id=?').all(id)
  const running=await planJob();expect(running.status).toBe(202)
  let finish!:(value:ModelResult)=>void,entered=false
  const worker=new ExecutionWorker(db,config(),async()=>{entered=true;return new Promise(resolve=>{finish=resolve})})
  const tick=worker.tick();while(!entered)await delay()
  const queued=await planJob();expect(queued.status).toBe(202)
  const password=randomBytes(24).toString('hex'),input={action:'reset-password',requestId:key(),labId:'lab_synthetic',memberId:'member_A',expectedVersion:1,password}
  const response=operate(input);expect(response.status).toBe(0);expect(response.out).not.toContain(password)
  expect(operate(input).out).toBe(response.out)
  expect(operate({...input,requestId:key()}).error).toContain('VERSION_CONFLICT')
  expect((await request('session',{client:clients.A})).status).toBe(401)
  expect((await request('session',{client:clients.A,target:secondAddress})).status).toBe(401)
  expect((await request('login',{body:{username:accounts[0]!.username,password:accounts[0]!.password}})).status).toBe(401)
  accounts[0]!.password=password;clients.A=await loginAs('A')
  finish(goodPlan());await tick
  for(const job of [running,queued]){const row=db.prepare('SELECT status,document FROM execution_jobs WHERE id=?').get(job.value.data.id)!;expect(row.status).toBe('cancelled');expect(JSON.parse(String(row.document)).failure).toBe('CREDENTIAL_RESET')}
  expect(db.prepare('SELECT * FROM assignments WHERE task_id=?').all(id)).toEqual(commitments)
  expect(db.prepare('SELECT count(*) n FROM plans WHERE id=?').get(running.value.data.id)!.n).toBe(0)
 },30000)
 it('disable fences owner execution and capability, keeps commitments, and blocks relogin without erasing history',async()=>{
  const id=(await createConfirmed([item('invitation')])).taskIds[0]!;await accept(id)
  const before=db.prepare('SELECT * FROM assignments WHERE task_id=?').all(id)
  const r=await request('planRequest',{client:clients.B,body:{labId:'lab_synthetic',intent:'draft',prompt:'Synthetic B draft',inputArtifactIds:[],budget}});expect(r.status).toBe(202)
  let finish!:(v:ModelResult)=>void,entered=false
  const tick=new ExecutionWorker(db,config(),async()=>{entered=true;return new Promise(resolve=>{finish=resolve})}).tick();while(!entered)await delay()
  const queued=await request('planRequest',{client:clients.B,body:{labId:'lab_synthetic',intent:'draft',prompt:'Another B draft',inputArtifactIds:[],budget}});expect(queued.status).toBe(202)
  db.prepare("INSERT INTO public_capabilities VALUES ('lab_synthetic','text-evidence-checklist',1,1,'member_B')").run()
  const input={action:'disable-account',requestId:key(),labId:'lab_synthetic',memberId:'member_B',expectedVersion:1}
  expect(operate(input).status).toBe(0);expect(operate(input).status).toBe(0)
  finish(goodPlan());await tick
  expect((await request('session',{client:clients.B})).status).toBe(401)
  expect((await request('login',{body:{username:accounts[1]!.username,password:accounts[1]!.password}})).status).toBe(401)
  expect(db.prepare('SELECT * FROM assignments WHERE task_id=?').all(id)).toEqual(before)
  for(const job of [r,queued])expect(db.prepare('SELECT status FROM execution_jobs WHERE id=?').get(job.value.data.id)!.status).toBe('cancelled')
  expect(db.prepare('SELECT enabled FROM public_capabilities').get()!.enabled).toBe(0)
  expect(admin('reset-password',{memberId:'member_B',expectedVersion:2,password:randomBytes(24).toString('hex')}).error).toContain('ACCOUNT_DISABLED')
 },30000)
 it('backup refuses running processes; full restore checks task/commitment/delivery/blob bytes and revoked authorization, invalidates sessions and queues',async()=>{
  const id=(await createConfirmed([item('self')])).taskIds[0]!
  const bytes=Buffer.from('Synthetic pilot attachment: verified twelve samples.')
  const uploaded=await request('upload',{client:clients.A,body:{taskId:id,expectedVersion:(await detail(id)).task.version,filename:'synthetic.txt',mediaType:'text/plain',contentBase64:bytes.toString('base64')}});expect(uploaded.status).toBe(201)
  const secret=await request('upload',{client:clients.A,body:{taskId:id,expectedVersion:(await detail(id)).task.version,filename:'withdrawn.txt',mediaType:'text/plain',contentBase64:Buffer.from('withdrawn synthetic bytes').toString('base64')}});expect(secret.status).toBe(201)
  expect((await request('revokeArtifact',{client:clients.A,params:{id:secret.value.data.id},body:{expectedVersion:secret.value.data.version,reason:'Synthetic withdrawal'}})).status).toBe(200)
  await command('start',id,clients.A)
  const submitted=await command('submit',id,clients.A,{summary:'Synthetic retained result',artifactRefs:[uploaded.value.data.id],sources:[]});expect(submitted.status).toBe(201)
  const d=submitted.value.data as {id:string;version:number;revision:number}
  expect((await request('review',{client:clients.A,params:{id:d.id},body:{expectedVersion:d.version,expectedTaskVersion:(await detail(id)).task.version,revision:d.revision,decision:'accepted',comment:'Synthetic acceptance'}})).status).toBe(200)
  const before=await detail(id),queued=await planJob();expect(queued.status).toBe(202)
  const sourceTables=['tasks','assignments','deliverables','reviews','task_access','artifacts','artifact_revocations']
  const rows=Object.fromEntries(sourceTables.map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]))
  const backupPath=join(directory,'backup'),restored=join(directory,'restored')
  expect(()=>backup(config(),backupPath,'operator','a'.repeat(40),'synthetic-v1')).toThrow('STOP_API')
  await stopServers()
  const completed=backup(config(),backupPath,'operator','a'.repeat(40),'synthetic-v1');expect(completed.artifacts).toBe(2)
  expect(()=>backup(config(),backupPath,'operator','a'.repeat(40),'synthetic-v1')).toThrow('DESTINATION_EXISTS')
  expect(restore(backupPath,restored,'operator').completed).toBe(true)
  expect(()=>restore(backupPath,restored,'operator')).toThrow('DESTINATION_EXISTS')
  const restoredDb=openDatabase(join(restored,'platform.sqlite'))
  try{
   migrate(restoredDb);migrate(restoredDb)
   for(const t of sourceTables)expect(restoredDb.prepare(`SELECT * FROM ${t}`).all()).toEqual(rows[t])
   expect(restoredDb.prepare('SELECT status FROM execution_jobs WHERE id=?').get(queued.value.data.id)!.status).toBe('interrupted')
   expect(restoredDb.prepare("SELECT count(*) n FROM sessions WHERE revoked_at IS NULL").get()!.n).toBe(0)
   expect(db.prepare('SELECT status FROM execution_jobs WHERE id=?').get(queued.value.data.id)!.status).toBe('queued')
  }finally{restoredDb.close()}
  const oldCookie=clients.A
  address=(await startServer(join(restored,'platform.sqlite'),join(restored,'blobs'))).url
  expect((await request('session',{client:oldCookie})).status).toBe(401)
  clients.A=await loginAs('A');clients.C=await loginAs('C')
  expect((await detail(id)).task).toEqual(before.task)
  expect((await request('task',{client:clients.C,params:{id}})).status).toBe(404)
  const response=await fetch(address+routes.content.path.replace('{id}',uploaded.value.data.id),{headers:{cookie:clients.A.cookie}})
  expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
  expect((await fetch(address+routes.content.path.replace('{id}',secret.value.data.id),{headers:{cookie:clients.A.cookie}})).status).toBe(404)
  expect((await request('login',{body:{username:accounts[1]!.username,password:accounts[1]!.password}})).status).toBe(401)
  await stopServers();address=(await startServer()).url;clients.A=await loginAs('A');clients.C=await loginAs('C')
  expect((await detail(id)).task).toEqual(before.task)
  const blob=JSON.parse(readFileSync(join(backupPath,'manifest.json'),'utf8')).files[0].key as string
  writeFileSync(join(backupPath,'blobs',blob),'corrupt')
  expect(()=>restore(backupPath,join(directory,'corrupt-restore'),'operator')).toThrow('BACKUP_INTEGRITY_FAILED')
 },30000)
 it('upgrades a populated G4a 007 database twice without changing accounts, grants or history; pre-upgrade backup remains restorable',()=>{
  const legacyPath=join(directory,'legacy.sqlite'),legacyBlobs=join(directory,'legacy-blobs');mkdirSync(legacyBlobs)
  const legacy=openDatabase(legacyPath,true)
  try{
   legacy.exec('PRAGMA journal_mode=WAL; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT')
   const names=readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>/^00[1-7]-/.test(n)).sort()
   for(const [i,name] of names.entries()){const sql=readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8');legacy.exec(sql);legacy.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(i+1,createHash('sha256').update(sql).digest('hex'),'2026-09-30T00:00:00Z')}
   legacy.prepare('INSERT INTO labs VALUES(?,?)').run('legacy','Synthetic legacy')
   legacy.prepare('INSERT INTO members(id,lab_id,display_name) VALUES(?,?,?)').run('legacy_member','legacy','Synthetic legacy')
   legacy.prepare('INSERT INTO auth_accounts VALUES(?,?,?,0)').run('legacy_member','legacy_user',String(db.prepare('SELECT password_hash FROM auth_accounts WHERE member_id=?').get('member_A')!.password_hash))
   legacy.prepare("INSERT INTO runtime_meta VALUES('signing_key',?)").run(randomBytes(32).toString('hex'))
   const rows=legacy.prepare('SELECT * FROM auth_accounts').all()
   const saved=join(directory,'legacy-backup');backup({...config(),databasePath:legacyPath,blobRoot:legacyBlobs},saved,'operator','b'.repeat(40),'g4a-v1')
   migrate(legacy);migrate(legacy)
   expect(legacy.prepare('SELECT * FROM auth_accounts').all()).toEqual(rows)
   expect(legacy.prepare('SELECT version FROM account_controls').get()!.version).toBe(1)
   expect(restore(saved,join(directory,'legacy-restored'),'operator').completed).toBe(true)
  }finally{legacy.close()}
 },30000)
 it('process guard prevents startup under maintenance and releases after failure',()=>{
  const isolated=join(directory,'guard.sqlite'),release=processGuard(isolated,true)
  expect(()=>processGuard(isolated)).toThrow('MAINTENANCE_LOCKED');release()
  const shared=processGuard(isolated);expect(()=>processGuard(isolated,true)).toThrow('STOP_API');shared()
  processGuard(isolated,true)()
 },30000)
})
