import { z } from 'zod'
import { createHmac } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { passwordHash, signingKey } from './auth.js'
import { transaction } from './database.js'
import { reconcile } from './execution-worker.js'
import type { Config } from './config.js'

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)
const base = { requestId: id, labId: id }
export const MaintenanceCommand = z.discriminatedUnion('action', [
 z.object({ ...base, action: z.literal('create-lab'), name: z.string().min(1).max(200) }).strict(),
 z.object({ ...base, action: z.literal('create-account'), memberId: id, username: id, displayName: z.string().min(1).max(200), password: z.string().min(16).max(256) }).strict(),
 z.object({ ...base, action: z.literal('reset-password'), memberId: id, expectedVersion: z.number().int().positive(), password: z.string().min(16).max(256) }).strict(),
 z.object({ ...base, action: z.literal('disable-account'), memberId: id, expectedVersion: z.number().int().positive() }).strict(),
 z.object({ ...base, action: z.literal('inspect-account'), memberId: id }).strict()
])
export async function maintain(db: DatabaseSync, config: Config, operator: string, input: unknown) {
 if (!/^[a-zA-Z0-9_.@-]{1,100}$/.test(operator)) throw new Error('OPERATOR_REQUIRED')
 const command = MaintenanceCommand.parse(input)
 // Keyed digest allows exact retry checks without retaining a password or offline dictionary hash.
 const digest = createHmac('sha256', signingKey(db)).update(JSON.stringify(command)).digest('hex')
 const encoded = 'password' in command ? await passwordHash(command.password) : null
 return transaction(db, () => {
  if (command.action === 'inspect-account') {
   const row = db.prepare('SELECT a.member_id,a.username,a.disabled,c.version FROM auth_accounts a JOIN members m ON m.id=a.member_id JOIN account_controls c ON c.member_id=m.id WHERE m.lab_id=? AND m.id=?').get(command.labId,command.memberId)
   if (!row) throw new Error('ACCOUNT_NOT_FOUND')
   return row
  }
  const prior = db.prepare('SELECT request_hash,result_json,operator FROM maintenance_audit WHERE request_id=?').get(command.requestId)
  if (prior) { if (prior.request_hash !== digest || prior.operator !== operator) throw new Error('REQUEST_CONFLICT'); return JSON.parse(String(prior.result_json)) as Record<string, unknown> }
  if (command.action === 'create-lab') {
   if (db.prepare('SELECT 1 FROM labs WHERE id=?').get(command.labId)) throw new Error('LAB_EXISTS')
   db.prepare('INSERT INTO labs VALUES(?,?)').run(command.labId,command.name)
  } else {
   if (!db.prepare('SELECT 1 FROM labs WHERE id=?').get(command.labId)) throw new Error('LAB_NOT_FOUND')
   if (command.action === 'create-account') {
    if (db.prepare('SELECT 1 FROM members WHERE id=?').get(command.memberId) || db.prepare('SELECT 1 FROM auth_accounts WHERE username=?').get(command.username)) throw new Error('ACCOUNT_EXISTS')
    db.prepare('INSERT INTO members(id,lab_id,display_name,is_synthetic) VALUES(?,?,?,0)').run(command.memberId,command.labId,command.displayName)
    db.prepare('INSERT INTO auth_accounts VALUES(?,?,?,0)').run(command.memberId,command.username,encoded!)
   } else {
    const account=db.prepare('SELECT a.disabled,c.version FROM auth_accounts a JOIN members m ON m.id=a.member_id JOIN account_controls c ON c.member_id=m.id WHERE m.lab_id=? AND m.id=?').get(command.labId,command.memberId)
    if (!account) throw new Error('ACCOUNT_NOT_FOUND')
    if (account.version !== command.expectedVersion) throw new Error('VERSION_CONFLICT')
    if (account.disabled !== 0) throw new Error('ACCOUNT_DISABLED')
    if (command.action === 'reset-password') db.prepare('UPDATE auth_accounts SET password_hash=? WHERE member_id=?').run(encoded!,command.memberId)
    else db.prepare('UPDATE auth_accounts SET disabled=1 WHERE member_id=?').run(command.memberId)
    db.prepare('UPDATE account_controls SET version=version+1 WHERE member_id=?').run(command.memberId)
    db.prepare('UPDATE sessions SET revoked_at=? WHERE member_id=? AND revoked_at IS NULL').run(new Date().toISOString(),command.memberId)
    // Reset is also a security boundary: fence outstanding calls before returning.
    for (const job of db.prepare("SELECT id,document FROM execution_jobs WHERE owner_id=? AND status IN ('queued','running','waiting_input')").all(command.memberId)) {
     const doc=JSON.parse(String(job.document)) as Record<string,unknown>
     doc.status='cancelled';doc.failure=command.action==='reset-password'?'CREDENTIAL_RESET':'ACCOUNT_DISABLED';doc.version=Number(doc.version)+1;doc.updatedAt=new Date().toISOString();if('endedAt' in doc)doc.endedAt=doc.updatedAt
     db.prepare('UPDATE execution_jobs SET status=?,version=?,fence=fence+1,lease_owner=NULL,lease_until=NULL,document=? WHERE id=?').run('cancelled',Number(doc.version),JSON.stringify(doc),job.id!)
    }
    if(command.action==='disable-account') {
     for(const cap of db.prepare('SELECT lab_id,version FROM public_capabilities WHERE owner_id=? AND enabled=1').all(command.memberId)) {
      db.prepare('UPDATE public_capabilities SET enabled=0,version=version+1 WHERE lab_id=?').run(cap.lab_id!)
      db.prepare("INSERT INTO method_events(lab_id,method_version,generation,action,at) SELECT lab_id,active_version,?,'disabled',? FROM public_method_state WHERE lab_id=?").run(Number(cap.version)+1,new Date().toISOString(),cap.lab_id!)
     }
    }
    reconcile(db,config)
   }
  }
  const result={ action:command.action, labId:command.labId, ...('memberId' in command?{memberId:command.memberId,version:Number(db.prepare('SELECT version FROM account_controls WHERE member_id=?').get(command.memberId)!.version)}:{}), applied:true }
  db.prepare('INSERT INTO maintenance_audit(request_id,operator,action,lab_id,member_id,request_hash,result_json,at) VALUES(?,?,?,?,?,?,?,?)').run(command.requestId,operator,command.action,command.labId,'memberId' in command?command.memberId:null,digest,JSON.stringify(result),new Date().toISOString())
  return result
 })
}
