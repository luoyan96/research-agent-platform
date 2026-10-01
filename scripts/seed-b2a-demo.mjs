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
const item = (id, allocation) => ({ id, title: `Synthetic B2a ${id}`, goal: 'Restricted synthetic task context', deliverable: 'Synthetic checklist', acceptanceCriteria: 'Explicit missing evidence', allocation, dependencies: [], schedule, inputArtifactIds: [], budget: null })
async function as(letter, fn) {
  const account = accounts.find(a => a.memberId === `member_${letter}`)
  if (!account) throw new Error(`Synthetic ${letter} credential missing`)
  await call('login', { username: account.username, password: account.password })
  try { csrf = (await call('session')).csrfToken; return await fn() }
  finally { if (csrf) await call('logout', {}); cookie = ''; csrf = '' }
}
const confirmed = await as('A', async () => {
  await call('createPlan', input('Synthetic A saved draft; only A can find this'), null, 'b2a_seed_A_draft_01')
  const plan = await call('createPlan', input('Synthetic B2a four columns', [
    item('ready', { kind: 'self' }), item('active', { kind: 'self' }),
    item('pending', { kind: 'invitation', memberId: 'member_B' }),
    item('review', { kind: 'invitation', memberId: 'member_B' }),
    item('completed', { kind: 'invitation', memberId: 'member_B' }),
    item('claim', { kind: 'claim', audience: 'lab_members', summary: 'Synthetic public offer only' }),
  ]), null, 'b2a_seed_plan_01')
  const confirmed = await call('confirmPlan', { expectedVersion: 1 }, plan.id, 'b2a_seed_confirm_01')
  await call('start', { expectedVersion: 1 }, confirmed.taskIds[1], 'b2a_seed_active_01')
  return confirmed
})
const deliveries = await as('B', async () => {
  await call('createPlan', input('Synthetic B saved draft; hidden from A and C'), null, 'b2a_seed_B_draft_01')
  const results = []
  for (const index of [3, 4]) {
    const taskId = confirmed.taskIds[index]
    // Replays read the historical assignment after acceptance; no current state is reset.
    const detail = await call('task', undefined, taskId)
    const invitation = detail.pendingInvitation ?? detail.assignments.find(a => a.memberId === 'member_B')
    await call('invitationDecision', { expectedVersion: 1, expectedTaskVersion: 1, decision: 'accepted', comment: null }, invitation.id, `b2a_seed_accept_0${index}`)
    await call('start', { expectedVersion: 2 }, taskId, `b2a_seed_start_0${index}`)
    results.push(await call('submit', { expectedVersion: 3, summary: 'Synthetic submitted checklist', artifactRefs: [], sources: [] }, taskId, `b2a_seed_submit_0${index}`))
  }
  return results
})
await as('A', async () => {
  await call('review', { expectedVersion: 1, expectedTaskVersion: 4, revision: 1, decision: 'accepted', comment: 'Synthetic explicit acceptance' }, deliveries[1].id, 'b2a_seed_review_04')
})
console.log('Synthetic B2a HTTP seed complete: A/B private drafts; four columns; pending invitation, review, open claim; unknown availability. Replays preserve existing progress; no real research data or AI.')
