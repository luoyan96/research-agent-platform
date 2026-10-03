import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readConfig } from '../src/config.js'
import { openDatabase, migrate, seed } from '../src/database.js'
import { provisionTestAccounts } from '../src/auth.js'
import { createServer } from '../src/server.js'
import { labApiKey } from '../src/lab-ai-settings.js'
import { ExecutionWorker, reconcile } from '../src/execution-worker.js'

const cleanup: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'rap-lab-ai-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const keyFile = join(dir, 'master.key')
  writeFileSync(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 })
  const config = readConfig({ NODE_ENV: 'test', DATABASE_PATH: join(dir, 'platform.sqlite'), BLOB_ROOT: join(dir, 'blobs'), APP_ORIGIN: 'http://127.0.0.1:4173', B3_AI_ENABLED: '1', LAB_CREDENTIAL_KEY_FILE: keyFile })
  mkdirSync(config.blobRoot)
  const db = openDatabase(config.databasePath, true)
  cleanup.push(() => db.close())
  migrate(db); seed(db, 'test')
  const accounts = ['A', 'B'].map(letter => ({ memberId: `member_${letter}`, username: `ai_${letter.toLowerCase()}`, password: randomBytes(24).toString('hex') }))
  await provisionTestAccounts(db, 'test', accounts)
  db.prepare('INSERT INTO lab_managers(lab_id,member_id,granted_at) VALUES (?,?,?)').run('lab_synthetic', 'member_A', new Date().toISOString())
  const app = createServer(config)
  cleanup.push(() => app.close())
  async function login(index: 0 | 1) {
    const account = accounts[index]!
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: config.origin }, payload: { username: account.username, password: account.password } })
    expect(response.statusCode).toBe(200)
    const cookie = String(response.headers['set-cookie']).split(';')[0]!
    const session = await app.inject({ url: '/api/v1/auth/session', headers: { cookie } })
    return { cookie, csrf: String(session.json().data.csrfToken) }
  }
  const manager = await login(0), member = await login(1)
  const url = '/api/v1/labs/lab_synthetic/ai-settings'
  const save = (body: Record<string, unknown>, key = randomUUID(), auth = manager) => app.inject({ method: 'PATCH', url, headers: { origin: config.origin, cookie: auth.cookie, 'x-csrf-token': auth.csrf, 'idempotency-key': key }, payload: body })
  return { dir, db, config, app, manager, member, url, save }
}

describe('lab-scoped AI settings', () => {
  it('requires manager and CSRF, encrypts and isolates keys, and safely replays the same request', async () => {
    const s = await setup(), secret = 'sk-synthetic-lab-only-credential'
    const initial = await s.app.inject({ url: s.url, headers: { cookie: s.manager.cookie } })
    expect(initial.json().data).toMatchObject({ enabled: false, hasApiKey: false, version: 0 })
    expect((await s.app.inject({ url: s.url, headers: { cookie: s.member.cookie } })).statusCode).toBe(403)
    expect((await s.app.inject({ url: '/api/v1/labs/other_lab/ai-settings', headers: { cookie: s.manager.cookie } })).statusCode).toBe(404)
    expect((await s.save({ expectedVersion: 0, enabled: true, model: 'deepseek-flash', apiKey: secret }, randomUUID(), s.member)).statusCode).toBe(403)
    const missingCsrf = await s.app.inject({ method: 'PATCH', url: s.url, headers: { origin: s.config.origin, cookie: s.manager.cookie, 'idempotency-key': randomUUID() }, payload: { expectedVersion: 0, enabled: true, model: 'deepseek-flash', apiKey: secret } })
    expect(missingCsrf.statusCode).toBe(403)
    const body = { expectedVersion: 0, enabled: true, model: 'deepseek-flash', apiKey: secret }, key = randomUUID()
    const first = await s.save(body, key)
    expect(first.statusCode).toBe(200)
    expect(first.json().data).toMatchObject({ enabled: true, hasApiKey: true, version: 1 })
    expect(first.body).not.toContain(secret)
    expect((await s.save(body, key)).body).toBe(first.body)
    expect((await s.save({ ...body, model: 'deepseek-v4-pro' }, key)).json().error.code).toBe('IDEMPOTENCY_CONFLICT')
    expect((await s.save(body)).json().error.code).toBe('VERSION_CONFLICT')
    expect(labApiKey(s.db, 'lab_synthetic', s.config)).toBe(secret)
    expect(() => labApiKey(s.db, 'other_lab', s.config)).toThrow('MODEL_UNAVAILABLE')
    const persisted = JSON.stringify({ settings: s.db.prepare('SELECT * FROM lab_ai_settings').all(), receipts: s.db.prepare('SELECT * FROM lab_ai_setting_receipts').all() })
    expect(persisted).not.toContain(secret)
    expect(readFileSync(s.config.databasePath).toString('utf8')).not.toContain(secret)
  })

  it('disables queued model work without losing the encrypted key and allows a deliberate key rotation', async () => {
    const s = await setup()
    await s.save({ expectedVersion: 0, enabled: true, model: 'deepseek-flash', apiKey: 'sk-first-synthetic-credential' })
    const queued = await s.app.inject({ method: 'POST', url: '/api/v1/planning-requests', headers: { origin: s.config.origin, cookie: s.manager.cookie, 'x-csrf-token': s.manager.csrf, 'idempotency-key': randomUUID() }, payload: { labId: 'lab_synthetic', intent: 'draft', prompt: 'Synthetic planning', inputArtifactIds: [], budget: { maxTokens: 10000, maxSeconds: 20 } } })
    expect(queued.statusCode).toBe(202)
    const disabled = await s.save({ expectedVersion: 1, enabled: false, model: 'deepseek-v4-pro' })
    expect(disabled.json().data).toMatchObject({ enabled: false, hasApiKey: true, model: 'deepseek-v4-pro', version: 2 })
    reconcile(s.db, s.config)
    expect(s.db.prepare('SELECT status FROM execution_jobs WHERE id=?').get(queued.json().data.id)!.status).toBe('cancelled')
    await s.save({ expectedVersion: 2, enabled: true, model: 'deepseek-flash', apiKey: 'sk-second-synthetic-credential' })
    expect(labApiKey(s.db, 'lab_synthetic', s.config)).toBe('sk-second-synthetic-credential')
    const removed = await s.save({ expectedVersion: 3, enabled: false, model: 'deepseek-flash', removeApiKey: true })
    expect(removed.json().data).toMatchObject({ enabled: false, hasApiKey: false, version: 4 })
    expect(() => labApiKey(s.db, 'lab_synthetic', s.config)).toThrow('MODEL_UNAVAILABLE')
  })

  it('passes the lab key only to the trusted model call and keeps it out of queued and attempt records', async () => {
    const s = await setup(), secret = 'sk-private-synthetic-credential'
    await s.save({ expectedVersion: 0, enabled: true, model: 'deepseek-flash', apiKey: secret })
    const queued = await s.app.inject({ method: 'POST', url: '/api/v1/planning-requests', headers: { origin: s.config.origin, cookie: s.manager.cookie, 'x-csrf-token': s.manager.csrf, 'idempotency-key': randomUUID() }, payload: { labId: 'lab_synthetic', intent: 'draft', prompt: 'Synthetic planning', inputArtifactIds: [], budget: { maxTokens: 10000, maxSeconds: 20 } } })
    expect(queued.statusCode).toBe(202)
    let received = ''
    await new ExecutionWorker(s.db, s.config, async (input, _signal, credential) => {
      received = credential.apiKey
      expect(JSON.stringify(input)).not.toContain(secret)
      return { text: '', failure: 'SYNTHETIC_FAILURE', inputTokens: 10, outputTokens: 0, elapsedMs: 1 }
    }).tick()
    expect(received).toBe(secret)
    const persisted = JSON.stringify({ jobs: s.db.prepare('SELECT request_json,document FROM execution_jobs').all(), attempts: s.db.prepare('SELECT request_json,result_json FROM execution_attempts').all() })
    expect(persisted).not.toContain(secret)
  })
})
