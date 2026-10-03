import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync, openSync, fsyncSync, closeSync, realpathSync } from 'node:fs'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { contractVersion } from '@research-agent-platform/contracts'
import { openDatabase, checkDatabase, checkMigrationHistory, migrate, transaction } from './database.js'
import { processGuard } from './process-guard.js'
import type { Config } from './config.js'
const sha=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex')
const digest=z.string().regex(/^[a-f0-9]{64}$/)
const Manifest=z.object({format:z.literal(1),at:z.string(),operator:z.string(),releaseSha:z.string().regex(/^[a-f0-9]{40}$/),configRevision:z.string(),contractVersion:z.string(),config:z.object({origin:z.string(),mode:z.string(),model:z.string(),aiEnabled:z.boolean()}),databaseSha256:digest,files:z.array(z.object({key:z.string().regex(/^[a-f0-9-]+\.blob$/),sha256:digest,size:z.number().int().nonnegative()})),migrations:z.array(z.object({version:z.number(),checksum:z.string(),applied_at:z.string()}))})
function flush(path:string){const fd=openSync(path,'r+');try{fsyncSync(fd)}finally{closeSync(fd)}}
function regular(path:string){if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())throw new Error('REGULAR_FILE_REQUIRED')}
function separate(parent:string,child:string){const r=relative(parent,child);if(!r||(!r.startsWith('..')&&!isAbsolute(r)))throw new Error('PATHS_MUST_BE_SEPARATE')}
function validateBlobs(db:ReturnType<typeof openDatabase>,root:string){
 return db.prepare('SELECT blob_key,document FROM artifacts ORDER BY blob_key').all().map(row=>{
  const key=String(row.blob_key);if(!/^[a-f0-9-]+\.blob$/.test(key))throw new Error('INVALID_BLOB_KEY')
  const doc=JSON.parse(String(row.document)) as {sha256:string;size:number},path=join(root,key);regular(path)
  if(sha(path)!==doc.sha256||lstatSync(path).size!==doc.size)throw new Error('ARTIFACT_INTEGRITY_FAILED')
  return {key,sha256:doc.sha256,size:doc.size}
 })
}
export function backup(config:Config,destination:string,operator:string,releaseSha:string,configRevision:string){
 if(!/^[a-f0-9]{40}$/.test(releaseSha)||!configRevision||!operator)throw new Error('BACKUP_METADATA_REQUIRED')
 const target=resolve(destination);separate(realpathSync(config.blobRoot),target);separate(target,resolve(config.databasePath))
 if(existsSync(target))throw new Error('DESTINATION_EXISTS')
 const release=processGuard(config.databasePath,true)
 try{
  const db=openDatabase(config.databasePath)
  try{
   const history=checkMigrationHistory(db,false)
   if(history.length<7)throw new Error('BACKUP_REQUIRES_B4A_OR_LATER')
   const files=validateBlobs(db,config.blobRoot)
   mkdirSync(target,{recursive:false,mode:0o700});mkdirSync(join(target,'blobs'),{mode:0o700})
   // SQLite takes a logical snapshot including WAL; never copy only the live main file.
   db.prepare('VACUUM INTO ?').run(join(target,'database.sqlite'))
   for(const file of files){copyFileSync(join(config.blobRoot,file.key),join(target,'blobs',file.key));flush(join(target,'blobs',file.key))}
   const manifest=Manifest.parse({format:1,at:new Date().toISOString(),operator,releaseSha,configRevision,contractVersion,config:{origin:config.origin,mode:config.mode,model:config.model,aiEnabled:config.aiEnabled},databaseSha256:sha(join(target,'database.sqlite')),files,migrations:db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()})
   writeFileSync(join(target,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});flush(join(target,'manifest.json'))
   return {completed:true,artifacts:files.length,contractVersion}
  } finally {db.close()}
 } finally {release()}
}
export function restore(source:string,destination:string,operator:string){
 const from=realpathSync(source),target=resolve(destination)
 separate(from,target);separate(target,from)
 if(existsSync(target))throw new Error('DESTINATION_EXISTS')
 regular(join(from,'manifest.json'));regular(join(from,'database.sqlite'))
 const m=Manifest.parse(JSON.parse(readFileSync(join(from,'manifest.json'),'utf8')))
 if(m.contractVersion!==contractVersion)throw new Error('RESTORE_MATCHING_RELEASE_FIRST')
 if(sha(join(from,'database.sqlite'))!==m.databaseSha256)throw new Error('BACKUP_INTEGRITY_FAILED')
 for(const file of m.files){const path=join(from,'blobs',file.key);regular(path);if(sha(path)!==file.sha256||lstatSync(path).size!==file.size)throw new Error('BACKUP_INTEGRITY_FAILED')}
 // New isolated root only. A failure keeps evidence and requires another fresh destination.
 mkdirSync(target,{recursive:false,mode:0o700});mkdirSync(join(target,'blobs'),{mode:0o700})
 copyFileSync(join(from,'database.sqlite'),join(target,'platform.sqlite'))
 for(const file of m.files)copyFileSync(join(from,'blobs',file.key),join(target,'blobs',file.key))
 const release=processGuard(join(target,'platform.sqlite'),true)
 try{
  const db=openDatabase(join(target,'platform.sqlite'))
  db.exec('PRAGMA journal_mode=WAL')
  try{
   migrate(db);checkDatabase(db)
   if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('DATABASE_INTEGRITY_FAILED')
   const checked=validateBlobs(db,join(target,'blobs'))
   if(JSON.stringify(checked)!==JSON.stringify(m.files))throw new Error('ARTIFACT_MANIFEST_MISMATCH')
   transaction(db,()=>{
    const now=new Date().toISOString()
    db.prepare('UPDATE sessions SET revoked_at=? WHERE revoked_at IS NULL').run(now)
    // A restored copy must not reopen a previously revoked or consumed invitation.
    db.prepare('UPDATE registration_invites SET revoked_at=? WHERE revoked_at IS NULL').run(now)
    // A restored copy must never resume model calls. The external master key is restored separately.
    db.prepare('UPDATE lab_ai_settings SET enabled=0,version=version+1,updated_at=? WHERE enabled=1').run(now)
    db.exec('DELETE FROM registration_work')
    db.prepare("UPDATE runtime_meta SET value=? WHERE key='signing_key'").run(randomBytes(32).toString('hex'))
    for(const row of db.prepare("SELECT id,document FROM execution_jobs WHERE status IN ('queued','running','waiting_input')").all()){
     const doc=JSON.parse(String(row.document)) as Record<string,unknown>
     doc.status='interrupted';doc.failure='RESTORED_REQUIRES_REVIEW';doc.version=Number(doc.version)+1;doc.updatedAt=now;if('endedAt' in doc)doc.endedAt=now
     db.prepare("UPDATE execution_jobs SET status='interrupted',version=?,fence=fence+1,lease_owner=NULL,lease_until=NULL,document=? WHERE id=?").run(Number(doc.version),JSON.stringify(doc),row.id!)
    }
    // Notification evidence is retained, but no old pending intent can auto-dispatch.
    db.exec("UPDATE outbox SET status='uncertain',lease_owner=NULL,lease_until=NULL WHERE status IN ('pending','leased')")
    db.prepare('INSERT INTO maintenance_audit(request_id,operator,action,lab_id,request_hash,result_json,at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),operator,'restore','_system','restored','{}',now)
    db.prepare("UPDATE runtime_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run()
   })
   db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
   const receipt={completed:true,restoredAt:new Date().toISOString(),operator,releaseSha:m.releaseSha,configRevision:m.configRevision,artifacts:checked.length,sessions:'revoked',activeRuns:'interrupted',notifications:'uncertain'}
   writeFileSync(join(target,'restore-receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600})
   return receipt
  }finally{db.close()}
 }finally{release()}
}
