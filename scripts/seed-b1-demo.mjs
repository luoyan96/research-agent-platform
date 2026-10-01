import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { routes } from '../packages/contracts/dist/index.js'

if (!['development', 'test'].includes(process.env.NODE_ENV ?? 'development')) throw new Error('Synthetic task seed forbidden in production')
const address = process.env.API_URL ?? 'http://127.0.0.1:3100'
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(address).hostname)) throw new Error('Synthetic seed only supports a local API')
const origin = process.env.APP_ORIGIN ?? address
let accounts
try { accounts = JSON.parse(await readFile(resolve(process.env.TEST_CREDENTIALS_FILE ?? '.runtime/test-credentials.json'), 'utf8')) } catch { throw new Error('Cannot read local test credentials; run db:credentials first') }
const account = accounts.find(value => value.memberId === 'member_A')
if (!account) throw new Error('Synthetic A credential missing')
let cookie = '', csrf = ''
async function call(name, body, resourceId, key) {
  const route = routes[name]
  const response = await fetch(new URL(route.path.replace('{id}', resourceId ?? ''), address), { method: route.method, headers: { origin, 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(`Synthetic seed ${name}: HTTP ${response.status}, code ${result.error?.code ?? 'unknown'}`)
  if (name === 'login') cookie = response.headers.get('set-cookie').split(';')[0]
  return route.response.parse(result).data
}
await call('login', { username: account.username, password: account.password })
try {
  csrf = (await call('session')).csrfToken
  const schedule = { suggested: null, hardDeadline: null, committed: null, estimatedHumanHours: null, checkpoint: null }
  const allocations = [{ kind: 'self' }, { kind: 'invitation', memberId: 'member_B' }, { kind: 'claim', audience: 'lab_members', summary: 'Synthetic public checklist; no restricted materials' }]
  const plan = await call('createPlan', { labId: 'lab_synthetic', goal: 'Synthetic B1 collaboration demonstration', unresolvedQuestions: ['Deadline unknown'], proposedItems: allocations.map((allocation, index) => ({ id: `demo_item_${index}`, title: ['A self task', 'Invite B', 'Open B/C claim'][index], goal: 'Review synthetic input; no real research data', deliverable: 'Plain-text synthetic checklist', acceptanceCriteria: 'Identify missing evidence and sources', allocation, dependencies: [], schedule, inputArtifactIds: [], budget: null })) }, null, 'synthetic_demo_plan_v1')
  await call('confirmPlan', { expectedVersion: 1 }, plan.id, 'synthetic_demo_confirm_v1')
  console.log('Synthetic task seed complete through authenticated HTTP: self, invitation, and open claim. Repeating does not duplicate tasks; existing progress is preserved.')
} finally { if (csrf) await call('logout', {}) }
