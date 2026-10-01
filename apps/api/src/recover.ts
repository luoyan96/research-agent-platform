import { readConfig } from './config.js'
import { backup, restore } from './recovery.js'
try {
 const [action]=process.argv.slice(2),operator=process.env.OPERATOR_ID??''
 if(process.argv.length!==3||!operator||!process.env.BACKUP_PATH)throw new Error('CONFIG_REQUIRED')
 if(action==='backup')console.log(JSON.stringify(backup(readConfig(),process.env.BACKUP_PATH,operator,process.env.RELEASE_SHA??'',process.env.CONFIG_REVISION??'')))
 else if(action==='restore'&&process.env.RESTORE_ROOT)console.log(JSON.stringify(restore(process.env.BACKUP_PATH,process.env.RESTORE_ROOT,operator)))
 else throw new Error('EXPECTED_BACKUP_OR_RESTORE')
}catch(error){console.error(error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'RECOVERY_FAILED_NO_COMPLETED_RECEIPT');process.exitCode=1}
