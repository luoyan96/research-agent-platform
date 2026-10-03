import { processGuard } from './process-guard.js'
import { readConfig } from './config.js'
import { openDatabase,checkDatabase,transaction } from './database.js'
import { capabilityId } from './ai.js'
import { reconcile } from './execution-worker.js'
import { labAiRuntime } from './lab-ai-settings.js'
const config=readConfig(),[action,labId,ownerId]=process.argv.slice(2)
if(!['enable','disable'].includes(action??'')||!labId)throw new Error('Use enable|disable LAB_ID OWNER_MEMBER_ID (owner required on first configuration)')
const releaseProcess=processGuard(config.databasePath);process.once('exit',releaseProcess)
const db=openDatabase(config.databasePath)
try{checkDatabase(db);transaction(db,()=>{
  if(!db.prepare('SELECT 1 FROM labs WHERE id=?').get(labId))throw new Error('Unknown lab')
  if(action==='enable' && !labAiRuntime(db,labId!,config).enabled)throw new Error('Enable requires active lab AI settings and an encrypted lab API key')
  const current=db.prepare('SELECT enabled,owner_id FROM public_capabilities WHERE lab_id=? AND id=?').get(labId,capabilityId)
  const enabled=action==='enable'?1:0
  if(enabled && !db.prepare('SELECT 1 FROM auth_accounts a JOIN members m ON m.id=a.member_id WHERE a.member_id=? AND m.lab_id=? AND a.disabled=0').get(current?.owner_id??ownerId??'',labId))throw new Error('Active owner account required')
  if(!current){if(!ownerId||!db.prepare('SELECT 1 FROM members WHERE id=? AND lab_id=?').get(ownerId,labId))throw new Error('Explicit public capability owner must be a member of this lab');db.prepare('INSERT INTO public_capabilities VALUES (?,?,1,?,?)').run(labId,capabilityId,enabled,ownerId)}
  else if(current.enabled!==enabled)db.prepare('UPDATE public_capabilities SET version=version+1,enabled=? WHERE lab_id=? AND id=?').run(enabled,labId,capabilityId)
  reconcile(db,config)
});console.log('Public text capability configuration saved. This is not a successful model-call verification.')}finally{db.close()}
