import { readConfig } from './config.js'
import { openDatabase, checkDatabase } from './database.js'
import { maintain } from './maintenance.js'
import { processGuard } from './process-guard.js'

// Passwords are accepted only through stdin, never argv or echoed diagnostics.
try {
 if(process.argv.length!==2) throw new Error('STDIN_ONLY')
 const config=readConfig(), release=processGuard(config.databasePath)
 try {
  let text=''
  for await(const chunk of process.stdin){text+=String(chunk);if(Buffer.byteLength(text)>16384)throw new Error('INPUT_TOO_LARGE')}
  const db=openDatabase(config.databasePath)
  try {checkDatabase(db);console.log(JSON.stringify(await maintain(db,config,process.env.OPERATOR_ID??'',JSON.parse(text))))} finally {db.close()}
 } finally {release()}
} catch(error) {
 const message=error instanceof Error && /^[A-Z_]+$/.test(error.message)?error.message:'INVALID_INPUT_OR_OPERATION_FAILED'
 console.error(message);process.exitCode=1
}
