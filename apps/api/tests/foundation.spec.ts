import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { readConfig } from '../src/config.js'
import { openDatabase, migrate, seed, transaction, checkDatabase } from '../src/database.js'
import { createServer } from '../src/server.js'
import { routes, Health, data } from '@research-agent-platform/contracts'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'rap-b0-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const config = readConfig({ NODE_ENV: 'test', DATABASE_PATH: join(dir, 'platform.sqlite'), BLOB_ROOT: join(dir, 'blobs'), PORT: '0' })
  return { dir, config }
}
describe('B0 real service and persistence', () => {
  it('migration/seed are repeatable; reopening preserves rows; no usable dev credentials', () => {
    const { config } = setup()
    let db = openDatabase(config.databasePath, true)
    migrate(db); migrate(db); seed(db, 'test'); seed(db, 'development')
    expect(db.prepare('SELECT count(*) n FROM members').get()?.n).toBe(3)
    expect(db.prepare('SELECT count(*) n FROM sessions').get()?.n).toBe(0)
    expect(db.prepare('SELECT count(*) n FROM auth_accounts').get()?.n).toBe(0)
    db.close(); db = openDatabase(config.databasePath)
    cleanups.push(() => db.close())
    expect(db.prepare('SELECT count(*) n FROM members').get()?.n).toBe(3)
    expect(() => seed(db, 'production')).toThrow()
    checkDatabase(db)
    expect(db.prepare('SELECT count(*) n FROM health_probe').get()?.n).toBe(0)
  })
  it('rolls back failed writes and enforces foreign keys and unique outbox intent', () => {
    const { config } = setup(); const db = openDatabase(config.databasePath, true); cleanups.push(() => db.close()); migrate(db)
    expect(() => transaction(db, () => { db.exec("INSERT INTO labs VALUES ('rollback','synthetic')"); throw new Error('fail') })).toThrow()
    expect(db.prepare('SELECT count(*) n FROM labs').get()?.n).toBe(0)
    expect(() => db.exec("INSERT INTO members(id,lab_id,display_name) VALUES ('x','missing','x')")).toThrow()
    const insert = db.prepare("INSERT INTO outbox(id,dedup_key,aggregate_id,aggregate_version,kind,payload_json,available_at,created_at) VALUES (?,?, 'x',1,'synthetic','{}','2026-09-21','2026-09-21')")
    insert.run('event_1', 'same_intent'); expect(() => insert.run('event_2', 'same_intent')).toThrow()
  })
  it('serializes a second process writer and releases lock after rollback', () => {
    const { config } = setup(); const db = openDatabase(config.databasePath, true); cleanups.push(() => db.close()); migrate(db)
    db.exec('BEGIN IMMEDIATE')
    const child = "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA busy_timeout=30');try{db.exec('BEGIN IMMEDIATE');db.exec('ROLLBACK');process.exitCode=0}catch{process.exitCode=23}finally{db.close()}"
    expect(spawnSync(process.execPath, ['-e', child, config.databasePath]).status).toBe(23)
    db.exec('ROLLBACK')
    expect(spawnSync(process.execPath, ['-e', child, config.databasePath]).status).toBe(0)
  })
  it('rejects changed migration checksum', () => {
    const { config } = setup(); const db = openDatabase(config.databasePath, true); cleanups.push(() => db.close()); migrate(db)
    db.exec("UPDATE schema_migrations SET checksum='changed'")
    expect(() => migrate(db)).toThrow('checksum')
    expect(() => checkDatabase(db)).toThrow('Migration')
  })
  it('serves real HTTP: liveness is not readiness; recovers after explicit migrate; closed DB fails', async () => {
    const { config } = setup(); const app = createServer(config); cleanups.push(() => app.close())
    const url = await app.listen({ port: 0, host: '127.0.0.1' })
    expect((await fetch(`${url}/api/v1/health/live`)).status).toBe(200)
    let response = await fetch(`${url}/api/v1/health/ready`)
    expect(response.status).toBe(503)
    expect(data(Health).parse(await response.json()).data.checks.database).toBe('unavailable')
    const db = openDatabase(config.databasePath, true); migrate(db); db.close(); mkdirSync(config.blobRoot)
    response = await fetch(`${url}/api/v1/health/ready`); expect(response.status).toBe(200)
    expect(data(Health).parse(await response.json()).data.checks.harness).toBe('not_verified')
    rmSync(config.blobRoot, { recursive: true })
    response = await fetch(`${url}/api/v1/health/ready`); expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain(config.blobRoot)
  })
  it('missing schema and read-only database cannot pass readiness', async () => {
    const { config } = setup(); mkdirSync(config.blobRoot)
    const db = openDatabase(config.databasePath, true)
    expect(() => checkDatabase(db)).toThrow()
    migrate(db); db.exec('PRAGMA query_only=ON'); expect(() => checkDatabase(db)).toThrow(); db.close()
  })
  it('all future routes are explicit 501, unknown is 404, errors redact request body', async () => {
    const { config } = setup(); const app = createServer(config); cleanups.push(() => app.close())
    for (const route of Object.values(routes).filter(r => !r.implemented)) {
      const res = await app.inject({ method: route.method, url: route.path.replace('{id}', 'synthetic'), ...(route.method === 'GET' ? {} : { payload: { actorId: 'fake', private: 'sentinel' } }) })
      expect(res.statusCode).toBe(501); expect(res.json().error.code).toBe('NOT_IMPLEMENTED'); expect(res.body).not.toContain('sentinel')
    }
    expect((await app.inject('/api/v1/unknown')).statusCode).toBe(404)
    const malformed = await app.inject({ method: 'POST', url: '/api/v1/plans', headers: { 'content-type': 'application/json' }, payload: '{privateSentinel' })
    expect(malformed.statusCode).toBe(400); expect(malformed.body).not.toContain('privateSentinel')
    expect((await app.inject('/api/v1/health/live')).headers['access-control-allow-origin']).toBeUndefined()
  })
  it('forbids identity bypass/fixtures and requires explicit production data paths', () => {
    for (const flag of ['DEV_AUTH_MEMBER', 'FIXTURE_MODE', 'AUTH_BYPASS']) expect(() => readConfig({ NODE_ENV: 'production', [flag]: 'true' })).toThrow()
    expect(() => readConfig({ NODE_ENV: 'production' })).toThrow()
    expect(() => readConfig({ NODE_ENV: 'production', DATABASE_PATH: 'relative', BLOB_ROOT: 'relative' })).toThrow()
    expect(() => readConfig({ PORT: 'no' })).toThrow()
  })
  it('root CI explicitly discovers API and contracts', () => {
    const workspace = readFileSync(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8')
    const tests = readFileSync(new URL('../../../vitest.config.ts', import.meta.url), 'utf8')
    expect(workspace).toContain('apps/*'); expect(workspace).toContain('packages/*')
    expect(tests).toContain('apps/*/tests/**/*.spec.ts'); expect(tests).toContain('packages/*/tests/**/*.spec.ts')
  })
})
