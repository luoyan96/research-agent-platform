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
async function call(name, body, resourceId, key) {
  const route = routes[name]
  const response = await fetch(new URL(route.path.replace('{id}', resourceId ?? ''), address), { method: route.method, headers: { origin, 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(`Synthetic seed ${name}: HTTP ${response.status}, code ${result.error?.code ?? 'unknown'}`)
  if (name === 'login') cookie = response.headers.get('set-cookie').split(';')[0]
  return route.response.parse(result).data
}
const schedule = { suggested: null, hardDeadline: null, committed: null, estimatedHumanHours: null, checkpoint: null }
const input = (goal, items = []) => ({ labId: 'lab_synthetic', goal, proposedItems: items, unresolvedQuestions: ['Dates and availability unknown unless explicitly reported'] })
const item = (id, allocation) => ({ id, title: `Synthetic B2b ${id}`, goal: 'Restricted synthetic task context', deliverable: 'Synthetic checklist', acceptanceCriteria: 'Explicit missing evidence', allocation, dependencies: [], schedule, inputArtifactIds: [], budget: null })
async function as(letter, fn) {
  const account = accounts.find(a => a.memberId === `member_${letter}`)
  if (!account) throw new Error(`Synthetic ${letter} credential missing`)
  await call('login', { username: account.username, password: account.password })
  try { csrf = (await call('session')).csrfToken; return await fn() }
  finally { if (csrf) await call('logout', {}); cookie = ''; csrf = '' }
}
const setup=await as('A',async()=>{
  const up=item('upstream',{kind:'self'}),down=item('downstream',{kind:'invitation',memberId:'member_B'});down.dependencies=['upstream']
  const plan=await call('createPlan',input('Synthetic B2b coordination',[up,down,item('negotiation',{kind:'invitation',memberId:'member_B'}),item('transfer',{kind:'invitation',memberId:'member_B'})]),null,'b2b_seed_plan_01')
  const result=await call('confirmPlan',{expectedVersion:1},plan.id,'b2b_seed_confirm_01')
  const transfer=await call('task',undefined,result.taskIds[3])
  return {...result,alreadyWithdrawn:transfer.assignments.some(a=>a.memberId==='member_B' && ['withdrawn','transferred','cancelled'].includes(a.status))}
})
await as('B',async()=>{
  for(const index of [1,2,3]) {
    if(index===3 && setup.alreadyWithdrawn)continue
    const taskId=setup.taskIds[index],value=await call('task',undefined,taskId)
    const invitation=value.pendingInvitation??value.assignments.find(a=>a.memberId==='member_B')
    await call('invitationDecision',{expectedVersion:1,expectedTaskVersion:1,decision:'accepted',comment:null},invitation.id,`b2b_seed_accept_0${index}`)
  }
  if(!setup.alreadyWithdrawn) {
    const taskId=setup.taskIds[3]
    const file=await call('upload',{taskId,expectedVersion:2,filename:'synthetic-transfer.txt',mediaType:'text/plain',contentBase64:Buffer.from('Synthetic preserved transfer evidence').toString('base64')},null,'b2b_seed_upload_01')
    await call('start',{expectedVersion:3},taskId,'b2b_seed_start_01')
    await call('submit',{expectedVersion:4,summary:'Synthetic work before transfer',artifactRefs:[file.id],sources:[]},taskId,'b2b_seed_submit_01')
    await call('withdraw',{expectedVersion:5,reason:'Synthetic availability changed',remainingScope:'Remaining synthetic checks',transferToMemberId:'member_C'},taskId,'b2b_seed_withdraw_01')
  }
})
await as('A',async()=>{
  await call('block',{expectedVersion:1,reason:'Synthetic missing input',requestedMemberId:'member_A',requestedAction:'Provide approved synthetic evidence'},setup.taskIds[0],'b2b_seed_block_01')
  await call('proposeChange',{expectedVersion:2,scope:'Expanded synthetic checklist',goal:'Negotiated synthetic goal',acceptanceCriteria:'List missing evidence',schedule,dependencies:[],proposedLeadId:'member_B',reason:'Synthetic scope negotiation'},setup.taskIds[2],'b2b_seed_change_01')
})
console.log('Synthetic B2b seed complete: blocked dependency, pending change response, preserved attachment delivery and fresh C transfer invitation. Repeat preserves progress; no AI or external dispatch.')
