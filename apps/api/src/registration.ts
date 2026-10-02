import { createHmac, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { RequestFor, ResponseFor } from '@research-agent-platform/contracts'
import { hash, passwordHash, signingKey } from './auth.js'
import { transaction } from './database.js'
import { fail } from './errors.js'

export async function register(db: DatabaseSync, input: RequestFor<'register'>, ip: string): Promise<ResponseFor<'register'>> {
 const { body, headers } = input
 const key = headers['Idempotency-Key']!
 const digest = createHmac('sha256', signingKey(db)).update(JSON.stringify(body)).digest('hex')
 const codeHash = hash(body.inviteCode)
 const now = Date.now()
 const blocked = transaction(db, () => {
  db.prepare('DELETE FROM login_limits WHERE window_start < ?').run(now - 900000)
  const limitKey = `registration-ip:${hash(ip)}`
  db.prepare('INSERT INTO login_limits VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').run(limitKey, now)
  return Number(db.prepare('SELECT attempts FROM login_limits WHERE key=?').get(limitKey)!.attempts) > 20
 })
 if (blocked) fail('RATE_LIMITED')
 const replay = () => {
  const row = db.prepare('SELECT request_hash,response_json FROM registration_receipts WHERE request_key=?').get(key)
  if (!row) return
  if (row.request_hash !== digest) fail('IDEMPOTENCY_CONFLICT')
  return JSON.parse(String(row.response_json)) as ResponseFor<'register'>
 }
 const invitation = () => {
  const row = db.prepare('SELECT id,lab_id,bootstrap_manager FROM registration_invites WHERE code_hash=? AND revoked_at IS NULL AND expires_at>? AND used_count<max_uses').get(codeHash,new Date().toISOString())
  if (!row) fail('INVITE_UNAVAILABLE')
  if (db.prepare('SELECT 1 FROM auth_accounts WHERE username=?').get(body.username)) fail('USERNAME_TAKEN')
  return row
 }
 const workId = randomUUID()
 const prior = transaction(db, () => {
  const receipt = replay(); if (receipt) return receipt
  invitation()
  db.prepare('DELETE FROM registration_work WHERE expires_at<?').run(now)
  if (Number(db.prepare('SELECT count(*) n FROM registration_work').get()!.n) >= 2) fail('RATE_LIMITED')
  db.prepare('INSERT INTO registration_work VALUES (?,?)').run(workId,now+60000)
 })
 if (prior) return prior
 try {
  const encoded = await passwordHash(body.password)
  return transaction(db, () => {
   const receipt = replay(); if (receipt) return receipt
   // Recheck capacity, expiry and revocation after the asynchronous KDF.
   const invite = invitation()
   const memberId = randomUUID(), at = new Date().toISOString()
   db.prepare('INSERT INTO members(id,lab_id,display_name,is_synthetic) VALUES (?,?,?,0)').run(memberId,invite.lab_id!,body.displayName)
   db.prepare('INSERT INTO auth_accounts VALUES (?,?,?,0)').run(memberId,body.username,encoded)
   if(invite.bootstrap_manager===1){
    if(db.prepare('SELECT 1 FROM lab_managers WHERE lab_id=?').get(invite.lab_id!))fail('INVITE_UNAVAILABLE')
    db.prepare('INSERT INTO lab_managers VALUES (?,?,?,?)').run(invite.lab_id!,memberId,at,invite.id!)
   }
   db.prepare('UPDATE registration_invites SET used_count=used_count+1 WHERE id=?').run(invite.id!)
   const result: ResponseFor<'register'> = { data: { registered:true,username:body.username } }
   db.prepare('INSERT INTO registration_receipts VALUES (?,?,?,?,?,?)').run(key,digest,invite.id!,memberId,JSON.stringify(result),at)
   return result
  })
 } finally { db.prepare('DELETE FROM registration_work WHERE id=?').run(workId) }
}
