import { mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

// Cooperating entrypoints only. The host operator remains trusted; no OS sandbox claim.
export function processGuard(databasePath: string, exclusive = false) {
  const directory = `${databasePath}.processes`, gate = `${databasePath}.maintenance-lock`
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 })
  try { mkdirSync(gate, { mode: 0o700 }) } catch { throw new Error('MAINTENANCE_LOCKED') }
  let keep = false
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (exclusive) {
      for (const name of readdirSync(directory)) {
        const record = JSON.parse(readFileSync(join(directory, name), 'utf8')) as { pid: number }
        if (!Number.isInteger(record.pid) || record.pid < 1) throw new Error('INVALID_PROCESS_RECORD')
        let alive = true
        try { process.kill(record.pid, 0) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false }
        if (alive) throw new Error('STOP_API_WORKER_AND_MAINTENANCE_FIRST')
        unlinkSync(join(directory, name))
      }
      keep = true
      return () => { rmdirSync(gate) }
    }
    const path = join(directory, `${process.pid}-${randomUUID()}.json`)
    writeFileSync(path, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 })
    return () => { try { unlinkSync(path) } catch { /* Exit cleanup may run twice. */ } }
  } finally { if (!keep) rmdirSync(gate) }
}
