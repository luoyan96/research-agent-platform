import { createHmac, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { RequestFor, ResponseFor } from '@research-agent-platform/contracts'
import type { Actor } from './auth.js'
import { hash, signingKey } from './auth.js'
import { fail } from './errors.js'

export function isLabManager(db: DatabaseSync, actor: Actor) {
 return !!db.prepare('SELECT 1 FROM lab_managers WHERE lab_id=? AND member_id=?').get(actor.labId,actor.id)
}

function requireManager(db: DatabaseSync, actor: Actor, labId: string) {
 if (actor.labId !== labId) fail('NOT_FOUND')
 if (!isLabManager(db,actor)) fail('FORBIDDEN')
}

function inviteModel(row: Record<string, unknown>) {
 return {
  id:String(row.id), labId:String(row.lab_id), expiresAt:String(row.expires_at),
  maxUses:Number(row.max_uses), usedCount:Number(row.used_count), createdAt:String(row.created_at),
  revokedAt:row.revoked_at === null ? null : String(row.revoked_at),
  createdBy:row.created_by === null ? null : String(row.created_by),
 }
}

export function managerInvites(db: DatabaseSync, actor: Actor, input: RequestFor<'managerInvites'>): ResponseFor<'managerInvites'> {
 requireManager(db,actor,input.params.id)
 const rows=db.prepare('SELECT * FROM registration_invites WHERE lab_id=? ORDER BY created_at DESC,id DESC LIMIT 51').all(actor.labId)
 return {data:{invites:rows.slice(0,50).map(inviteModel),truncated:rows.length>50}}
}

export function createManagerInvite(db: DatabaseSync, actor: Actor, input: RequestFor<'createManagerInvite'>): ResponseFor<'createManagerInvite'> {
 requireManager(db,actor,input.params.id)
 const key=input.headers['Idempotency-Key']!, {expiresAt,maxUses}=input.body
 const requestHash=createHmac('sha256',signingKey(db)).update(JSON.stringify({actorId:actor.id,labId:actor.labId,expiresAt,maxUses})).digest('hex')
 const code='RAP-'+createHmac('sha256',signingKey(db)).update(`manager-invite:v1:${actor.labId}:${actor.id}:${key}`).digest('base64url')
 const prior=db.prepare('SELECT * FROM registration_invites WHERE request_key=?').get(key)
 if (prior) {
  if (prior.lab_id!==actor.labId || prior.created_by!==actor.id || prior.request_hash!==requestHash) fail('IDEMPOTENCY_CONFLICT')
  if (prior.code_hash!==hash(code)) fail('INVITE_UNAVAILABLE')
  return {data:{invite:inviteModel(prior),code}}
 }
 const expiry=Date.parse(expiresAt), now=Date.now()
 if (expiry<=now || expiry>now+30*86400000) fail('VALIDATION_ERROR')
 const id=randomUUID(),createdAt=new Date(now).toISOString()
 db.prepare('INSERT INTO registration_invites(id,lab_id,code_hash,expires_at,max_uses,created_at,created_by,request_key,request_hash) VALUES (?,?,?,?,?,?,?,?,?)').run(id,actor.labId,hash(code),new Date(expiry).toISOString(),maxUses,createdAt,actor.id,key,requestHash)
 const row=db.prepare('SELECT * FROM registration_invites WHERE id=?').get(id)!
 return {data:{invite:inviteModel(row),code}}
}

export function revokeManagerInvite(db: DatabaseSync, actor: Actor, input: RequestFor<'revokeManagerInvite'>): ResponseFor<'revokeManagerInvite'> {
 requireManager(db,actor,input.params.id)
 const row=db.prepare('SELECT id FROM registration_invites WHERE id=? AND lab_id=?').get(input.params.inviteId,actor.labId)
 if (!row) fail('NOT_FOUND')
 db.prepare('UPDATE registration_invites SET revoked_at=?,revoked_by=? WHERE id=? AND lab_id=? AND revoked_at IS NULL').run(new Date().toISOString(),actor.id,input.params.inviteId,actor.labId)
 return {data:inviteModel(db.prepare('SELECT * FROM registration_invites WHERE id=?').get(input.params.inviteId)!)}
}
