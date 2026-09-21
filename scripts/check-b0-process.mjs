import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

const directory = await mkdtemp(join(tmpdir(), 'rap-b0-process-'))
const env = { ...process.env, NODE_ENV: 'test', DATABASE_PATH: join(directory, 'platform.sqlite'), BLOB_ROOT: join(directory, 'blobs'), PORT: '0', HOST: '127.0.0.1' }
let child
async function start() {
  child = spawn(process.execPath, ['apps/api/dist/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API startup timeout')), 10000)
    let output = ''
    child.stdout.on('data', chunk => {
      output += chunk
      const address = output.match(/listening (http:\/\/127\.0\.0\.1:\d+);/)
      if (address) { clearTimeout(timer); resolve(address[1]) }
    })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`API exited ${code}`)) })
  })
}
async function stop() {
  if (child && child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped }
  child = undefined
}
function manage(command) {
  const result = spawnSync(process.execPath, ['apps/api/dist/manage.js', command], { env, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, `${command} exit status`)
}
try {
  let address = await start()
  assert.equal((await fetch(`${address}/api/v1/health/live`)).status, 200)
  assert.equal((await fetch(`${address}/api/v1/health/ready`)).status, 503)
  await stop()
  manage('migrate'); manage('migrate'); manage('seed'); manage('seed')
  for (let restart = 0; restart < 2; restart++) {
    address = await start()
    const response = await fetch(`${address}/api/v1/health/ready`)
    assert.equal(response.status, 200)
    const health = await response.json()
    assert.equal(health.data.checks.database, 'ok')
    assert.equal(health.data.checks.storage, 'ok')
    assert.equal(health.data.checks.authentication, 'not_implemented')
    assert.equal(health.data.checks.harness, 'not_verified')
    await stop()
  }
  const db = new DatabaseSync(env.DATABASE_PATH)
  try { assert.equal(db.prepare('SELECT count(*) n FROM members').get().n, 3); assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n, 0) } finally { db.close() }
  console.log('B0 process smoke passed: missing DB=503; migrate/seed repeatable; two real HTTP starts=200; 3 synthetic members persisted; no sessions.')
} finally { await stop(); await rm(directory, { recursive: true, force: true }) }
