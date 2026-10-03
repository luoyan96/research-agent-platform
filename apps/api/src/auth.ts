import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.js'
import { fail } from './errors.js'

export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, options, (error, key) => error ? reject(error) : resolve(key)))
}
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex')
  return `scrypt-v1$${salt}$${(await derive(password, salt)).toString('hex')}`
}
async function verify(password: string, encoded: string) {
  const [, salt, expected] = encoded.split('$')
  if (!salt || !expected || !/^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(encoded)) return false
  return timingSafeEqual(await derive(password, salt), Buffer.from(expected, 'hex'))
}
export function signingKey(db: DatabaseSync) {
  const key = db.prepare("SELECT value FROM runtime_meta WHERE key='signing_key'").get()?.value
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) fail('SERVICE_UNAVAILABLE')
  return key
}
const csrfFor = (db: DatabaseSync, token: string) => createHmac('sha256', signingKey(db)).update(`csrf:${token}`).digest('hex')
export function cookieToken(cookie: string | undefined) {
  const matches = (cookie ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith('rap_session='))
  if (matches.length !== 1) return ''
  const token = matches[0]!.slice('rap_session='.length)
  return /^[a-f0-9]{64}$/.test(token) ? token : ''
}
export function authenticate(db: DatabaseSync, token: string) {
  if (!token) fail('UNAUTHENTICATED')
  const row = db.prepare(`SELECT m.id,m.lab_id,s.expires_at,s.csrf_hash FROM sessions s
    JOIN members m ON m.id=s.member_id JOIN auth_accounts a ON a.member_id=m.id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND a.disabled=0`).get(hash(token), new Date().toISOString())
  if (!row) fail('UNAUTHENTICATED')
  return { id: String(row.id), labId: String(row.lab_id), expiresAt: String(row.expires_at), csrfHash: String(row.csrf_hash) }
}
export type Actor = ReturnType<typeof authenticate>
export function csrfToken(db: DatabaseSync, token: string) { return csrfFor(db, token) }
export function requireCsrf(actor: Actor, supplied: unknown) {
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(hash(supplied), 'hex'), Buffer.from(actor.csrfHash, 'hex'))) fail('FORBIDDEN')
}
export async function login(db: DatabaseSync, username: string, password: string, ip: string, previousToken: string) {
  const now = Date.now()
  // Count attempts in shared persistent storage before running the expensive KDF.
  const limited = transaction(db, () => {
    db.prepare('DELETE FROM login_limits WHERE window_start < ?').run(now - 900000)
    let blocked = false
    for (const [key, max] of [[`user:${hash(username)}`, 10], [`ip:${hash(ip)}`, 40]] as const) {
      db.prepare('INSERT INTO login_limits VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').run(key, now)
      if (Number(db.prepare('SELECT attempts FROM login_limits WHERE key=?').get(key)?.attempts) > max) blocked = true
    }
    return blocked
  })
  if (limited) fail('RATE_LIMITED')
  const row = db.prepare('SELECT * FROM auth_accounts WHERE username=?').get(username)
  // Unknown/disabled accounts use the same KDF work and same public failure.
  const dummy = `scrypt-v1$${'0'.repeat(32)}$${'0'.repeat(64)}`
  const valid = await verify(password, typeof row?.password_hash === 'string' ? row.password_hash : dummy)
  if (!row || !valid || row.disabled !== 0) fail('UNAUTHENTICATED')
  return transaction(db, () => {
    const current = db.prepare('SELECT * FROM auth_accounts WHERE member_id=? AND disabled=0').get(row.member_id!)
    if (!current || current.password_hash !== row.password_hash) fail('UNAUTHENTICATED')
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 12 * 3600000).toISOString()
    if (previousToken) db.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').run(new Date().toISOString(), hash(previousToken))
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,NULL)').run(hash(token), row.member_id!, hash(csrfFor(db, token)), new Date().toISOString(), expiresAt)
    return { token, memberId: String(row.member_id) }
  })
}
export async function provisionTestAccounts(db: DatabaseSync, mode: string, credentials: { memberId: string; username: string; password: string }[]) {
  if (!['development', 'test'].includes(mode)) throw new Error('Test credentials forbidden in production')
  for (const account of credentials) {
    if (!['member_A', 'member_B', 'member_C'].includes(account.memberId) || account.password.length < 9 || account.password.length > 256 || !/^[a-zA-Z0-9_-]{1,100}$/.test(account.username)) throw new Error('Invalid synthetic account')
    const member = db.prepare("SELECT id FROM members WHERE id=? AND lab_id='lab_synthetic' AND is_synthetic=1").get(account.memberId)
    if (!member) throw new Error('Run synthetic seed first')
    const prior = db.prepare('SELECT * FROM auth_accounts WHERE member_id=?').get(account.memberId)
    if (prior && prior.username === account.username && await verify(account.password, String(prior.password_hash))) continue
    const encoded = await passwordHash(account.password)
    transaction(db, () => {
      db.prepare('INSERT INTO auth_accounts VALUES (?,?,?,0) ON CONFLICT(member_id) DO UPDATE SET username=excluded.username,password_hash=excluded.password_hash,disabled=0').run(account.memberId, account.username, encoded)
      db.prepare('UPDATE sessions SET revoked_at=? WHERE member_id=?').run(new Date().toISOString(), account.memberId)
    })
  }
}
