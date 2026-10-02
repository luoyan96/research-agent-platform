import { DatabaseSync } from 'node:sqlite'
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

const migrations = ['001-foundation.sql', '002-collaboration.sql', '003-invitation-decisions.sql', '004-discovery.sql', '005-coordination.sql', '006-execution.sql', '007-authorized-reuse.sql', '008-pilot-operations.sql', '009-invite-registration.sql', '010-lab-invite-management.sql'].map((name, index) => {
  const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
  return { version: index + 1, sql, checksum: createHash('sha256').update(sql).digest('hex') }
})
export function openDatabase(path: string, create = false) {
  if (create) mkdirSync(dirname(path), { recursive: true })
  if (!create && !existsSync(path)) throw new Error('Database missing')
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
    if (rows.some((row, index) => row.version !== migrations[index]?.version || row.checksum !== migrations[index]?.checksum)) throw new Error('Unknown migration or checksum mismatch')
    for (const migration of migrations.slice(rows.length)) {
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(migration.version, migration.checksum, new Date().toISOString())
    }
    db.prepare("INSERT INTO runtime_meta VALUES ('signing_key',?) ON CONFLICT(key) DO NOTHING").run(randomBytes(32).toString('hex'))
  })
}
export function checkMigrationHistory(db: DatabaseSync, current = true) {
  const rows = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all()
  if (!rows.length || (current && rows.length !== migrations.length) || rows.some((row, index) => row.version !== migrations[index]?.version || row.checksum !== migrations[index]?.checksum)) throw new Error('Migration required')
  return rows
}
export function checkDatabase(db: DatabaseSync) {
  checkMigrationHistory(db)
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
