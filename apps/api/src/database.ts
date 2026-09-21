import { DatabaseSync } from 'node:sqlite'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'

const migration = readFileSync(new URL('../migrations/001-foundation.sql', import.meta.url), 'utf8')
const checksum = createHash('sha256').update(migration).digest('hex')
export function openDatabase(path: string, create = false) {
  if (create) mkdirSync(dirname(path), { recursive: true })
  // Startup must not silently create a missing database or apply migrations.
  const db = new DatabaseSync(path, { open: false })
  db.open()
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=2000; PRAGMA synchronous=FULL;')
  return db
}
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try { const result = fn(); db.exec('COMMIT'); return result } catch (error) { db.exec('ROLLBACK'); throw error }
}
export function migrate(db: DatabaseSync) {
  db.exec('PRAGMA journal_mode=WAL')
  transaction(db, () => {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT')
    const rows = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all()
    if (rows.some(row => row.version !== 1 || row.checksum !== checksum)) throw new Error('Unknown migration or checksum mismatch')
    if (rows.length === 0) {
      db.exec(migration)
      db.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)').run(checksum, new Date().toISOString())
    }
  })
}
export function checkDatabase(db: DatabaseSync) {
  const rows = db.prepare('SELECT version, checksum FROM schema_migrations').all()
  if (rows.length !== 1 || rows[0]?.version !== 1 || rows[0]?.checksum !== checksum) throw new Error('Migration required')
  if (db.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'wal') throw new Error('WAL required')
  transaction(db, () => {
    db.prepare('INSERT INTO health_probe VALUES (?, ?)').run('readiness', new Date().toISOString())
    if (!db.prepare('SELECT id FROM health_probe WHERE id = ?').get('readiness')) throw new Error('Read failed')
    db.prepare('DELETE FROM health_probe WHERE id = ?').run('readiness')
  })
}
export function seed(db: DatabaseSync, mode: string) {
  if (!['development', 'test'].includes(mode)) throw new Error('Seed forbidden outside development/test')
  transaction(db, () => {
    db.prepare('INSERT INTO labs VALUES (?, ?) ON CONFLICT(id) DO NOTHING').run('lab_synthetic', 'Synthetic lab')
    for (const actor of ['A', 'B', 'C']) db.prepare('INSERT INTO members (id,lab_id,display_name,is_synthetic) VALUES (?,?,?,1) ON CONFLICT(id) DO NOTHING').run(`member_${actor}`, 'lab_synthetic', `Synthetic ${actor}`)
  })
  // No password, login bypass or session is generated.
}
