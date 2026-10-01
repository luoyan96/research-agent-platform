import { writeFile } from 'node:fs/promises'
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
const item = (id, allocation) => ({ id, title: `Synthetic B3 ${id}`, goal: 'Restricted synthetic task context', deliverable: 'Synthetic checklist', acceptanceCriteria: 'Explicit missing evidence', allocation, dependencies: [], schedule, inputArtifactIds: [], budget: null })
async function as(letter, fn) {
  const account = accounts.find(a => a.memberId === `member_${letter}`)
  if (!account) throw new Error(`Synthetic ${letter} credential missing`)
  await call('login', { username: account.username, password: account.password })
  try { csrf = (await call('session')).csrfToken; return await fn() }
  finally { if (csrf) await call('logout', {}); cookie = ''; csrf = '' }
}
if(!process.env.DEEPSEEK_API_KEY)throw new Error('Missing DEEPSEEK_API_KEY in the live check environment; real validation remains unverified')
const stamp=randomUUID(),budget={maxTokens:100000,maxSeconds:120}
async function wait(name,id,done){for(let i=0;i<150;i++){const value=await call(name,undefined,id);if(done.includes(value.status))return value;if(['failed','cancelled','interrupted'].includes(value.status))throw new Error(`Live ${name} ended ${value.status}: ${value.failure}`);await new Promise(resolve=>setTimeout(resolve,1000))}throw new Error('Live wait timed out; inspect persisted request, do not blindly resubmit')}
const evidence=await as('A',async()=>{
 const sourcePlan=await call('createPlan',input('Synthetic planning input source',[item('source',{kind:'self'})]))
 const sourceTask=(await call('confirmPlan',{expectedVersion:1},sourcePlan.id)).taskIds[0]
 const material='Metric A target: 12 samples. Metric A observed: 10 samples. Metric B measurement is missing.'
 const sourceFile=await call('upload',{taskId:sourceTask,expectedVersion:1,filename:'synthetic-source.txt',mediaType:'text/plain',contentBase64:Buffer.from(material).toString('base64')})
 const planning=await call('planRequest',{labId:'lab_synthetic',intent:'draft',prompt:'Create one self-owned synthetic task to check the supplied project metrics. Unknown dates remain null.',inputArtifactIds:[sourceFile.id],budget},null,`live_plan_${stamp}`)
 const generated=await wait('getPlanRequest',planning.id,['draft'])
 const edit=await call('planRequest',{labId:'lab_synthetic',intent:'draft',prompt:'Edit this same draft to explicitly list missing evidence. Keep its item identities and unknown dates; keep self allocation.',plan:{id:generated.planId,version:generated.reply.plan.version},inputArtifactIds:[sourceFile.id],budget},null,`live_edit_${stamp}`)
 const edited=await wait('getPlanRequest',edit.id,['draft'])
 if(edited.planId!==generated.planId)throw new Error('Draft identity changed')
 const confirmedDraft=await call('confirmPlan',{expectedVersion:edited.reply.plan.version},edited.planId,`live_draft_confirm_${stamp}`)
 const capabilities=await call('publicCapabilities');const cap=capabilities.find(c=>c.status==='available')
 if(!cap)throw new Error('No enabled public capability')
 const publicItem={...item('live',{kind:'public_agent',capability:{id:cap.id,version:cap.version,visibility:'lab_public'},humanLeadId:'member_A',missingReason:null}),budget}
 const p=await call('createPlan',input('Synthetic live text capability',[publicItem]),null,`live_setup_${stamp}`)
 const confirmed=await call('confirmPlan',{expectedVersion:1},p.id,`live_confirm_${stamp}`)
 const taskId=confirmed.taskIds[0]
 const waiting=(await call('task',null,taskId)).executions
 if(!waiting.some(r=>r.status==='waiting_input'))throw new Error('Public confirmation must wait for authorized task input')
 const file=await call('upload',{taskId,expectedVersion:1,filename:'synthetic-live.txt',mediaType:'text/plain',contentBase64:Buffer.from(material).toString('base64')},null,`live_upload_${stamp}`)
 const run=await call('run',{expectedVersion:2,capability:{id:cap.id,version:cap.version,visibility:'lab_public'},budget,inputArtifactIds:[file.id]},taskId,`live_run_${stamp}`)
 return {sourceArtifactId:sourceFile.id,confirmedDraftTaskIds:confirmedDraft.taskIds,publicConfirmationWaitingRunIds:waiting.map(r=>r.id),planningRequestId:planning.id,editRequestId:edit.id,planId:edited.planId,planningUsage:generated.usage,editUsage:edited.usage,taskId,runId:run.id}
})
// All API sessions from the initiating client are now logged out. Worker owns execution.
await new Promise(resolve=>setTimeout(resolve,2000))
evidence.run=await as('A',()=>wait('getRun',evidence.runId,['succeeded']))
if(!evidence.run.candidate)throw new Error('No validated candidate')
const output=resolve(process.env.B3_LIVE_EVIDENCE_FILE??'.runtime/b3-live-evidence.json')
await writeFile(output,JSON.stringify({synthetic:true,at:new Date().toISOString(),...evidence,acceptance:'not_accepted',browser:'No browser used; initiating session logged out while worker continues',g3:'Pending failure/cancel/restart live scenarios and joint frontend verification'},null,2))
console.log(JSON.stringify({status:'candidate_ready',planningRequestId:evidence.planningRequestId,runId:evidence.runId,usage:evidence.run.usageDetail,acceptance:'not_accepted'}))
