import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { routes } from '../packages/contracts/dist/index.js'

if (!['development', 'test'].includes(process.env.NODE_ENV ?? 'development')) throw new Error('Synthetic task seed forbidden in production')
const address = process.env.API_URL ?? 'http://127.0.0.1:3100'
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(address).hostname)) throw new Error('Synthetic seed only supports a local API')
const origin = process.env.APP_ORIGIN ?? address
let accounts
try { accounts = JSON.parse(await readFile(resolve(process.env.TEST_CREDENTIALS_FILE ?? '.runtime/test-credentials.json'), 'utf8')) } catch { throw new Error('Cannot read local test credentials; run db:credentials first') }
let cookie = '', csrf = ''
async function call(name, body, resourceId, key = randomUUID()) {
  const route = routes[name]
  const response = await fetch(new URL(route.path.replace('{id}', resourceId ?? ''), address), { method: route.method, headers: { origin, 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(`Synthetic seed ${name}: HTTP ${response.status}, code ${result.error?.code ?? 'unknown'}`)
  if (name === 'login') cookie = response.headers.get('set-cookie').split(';')[0]
  return route.response.parse(result).data
}
const schedule = { suggested: null, hardDeadline: null, committed: null, estimatedHumanHours: null, checkpoint: null }
const input = (goal, items = []) => ({ labId: 'lab_synthetic', goal, proposedItems: items, unresolvedQuestions: ['Dates and availability unknown unless explicitly reported'] })
const item = (id, allocation) => ({ id, title: `Synthetic B4a ${id}`, goal: 'Restricted synthetic task context', deliverable: 'Synthetic checklist', acceptanceCriteria: 'Explicit missing evidence', allocation, dependencies: [], schedule, inputArtifactIds: [], budget: null })
async function as(letter, fn) {
  const account = accounts.find(a => a.memberId === `member_${letter}`)
  if (!account) throw new Error(`Synthetic ${letter} credential missing`)
  await call('login', { username: account.username, password: account.password })
  try { csrf = (await call('session')).csrfToken; return await fn() }
  finally { if (csrf) await call('logout', {}); cookie = ''; csrf = '' }
}

export {call,as,input,item}
export async function seed(){return as('A',async()=>{
 const p=await call('createPlan',input('Synthetic B4a confirmed source',[item('source',{kind:'self'})]),null,'b4a_seed_plan_0001')
 const sourceTaskId=(await call('confirmPlan',{expectedVersion:1},p.id,'b4a_seed_confirm_0001')).taskIds[0]
 await call('start',{expectedVersion:1},sourceTaskId,'b4a_seed_start_0001')
 const delivery=await call('submit',{expectedVersion:2,summary:'Synthetic cohort A measured twelve samples. Cohort B measurement remains unknown.',artifactRefs:[],sources:[]},sourceTaskId,'b4a_seed_submit_0001')
 const reviewed=await call('review',{expectedVersion:1,expectedTaskVersion:3,revision:1,decision:'accepted',comment:'Synthetic human review; no feedback sharing required'},delivery.id,'b4a_seed_review_0001')
 const conclusion=await call('retainConclusion',{expectedVersion:4,deliverable:{id:reviewed.id,version:reviewed.version},artifactRefs:[],conclusion:'Synthetic cohort A measured twelve samples.',applicability:'Only synthetic cohort A; do not infer cohort B measurements.',scope:'source_readers'},sourceTaskId,'b4a_seed_retain_0001')
 const target=await call('createPlan',input('Synthetic B4a follow-up',[item('target',{kind:'self'})]),null,'b4a_seed_target_plan_0001')
 const targetTaskId=(await call('confirmPlan',{expectedVersion:1},target.id,'b4a_seed_target_confirm_0001')).taskIds[0]
 return {synthetic:true,sourceTaskId,delivery:{id:reviewed.id,version:reviewed.version},conclusion:{id:conclusion.id,version:conclusion.version},targetTaskId}
})}
