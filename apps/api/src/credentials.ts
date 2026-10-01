import { processGuard } from './process-guard.js'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { provisionTestAccounts } from './auth.js'
import { openDatabase } from './database.js'
import { readConfig } from './config.js'

const config = readConfig()
const releaseProcess = processGuard(config.databasePath)
process.once('exit', releaseProcess)
if (!['development', 'test'].includes(config.mode)) throw new Error('Test credentials forbidden in production')
const path = resolve(process.env.TEST_CREDENTIALS_FILE ?? '.runtime/test-credentials.json')
if (!existsSync(path)) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, JSON.stringify(['A', 'B', 'C'].map(letter => ({ memberId: `member_${letter}`, username: `synthetic_${letter.toLowerCase()}`, password: randomBytes(24).toString('base64url') })), null, 2), { flag: 'wx', mode: 0o600 })
}
let content: unknown
try { content = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error('Cannot parse test credentials file; values withheld') }
if (!Array.isArray(content) || content.length !== 3 || content.some(a => !a || typeof a.memberId !== 'string' || typeof a.username !== 'string' || typeof a.password !== 'string') || new Set(content.map(a => a.memberId)).size !== 3) throw new Error('Invalid test credentials file')
const db = openDatabase(config.databasePath)
try { await provisionTestAccounts(db, config.mode, content) } finally { db.close() }
console.log('Synthetic credentials prepared in TEST_CREDENTIALS_FILE (default .runtime/test-credentials.json). Values are not printed. Keep this file local and private.')
