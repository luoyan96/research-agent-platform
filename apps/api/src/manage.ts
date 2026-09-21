import { mkdirSync } from 'node:fs'
import { readConfig } from './config.js'
import { migrate, openDatabase, seed } from './database.js'

const config = readConfig()
const command = process.argv[2]
if (!['migrate', 'seed'].includes(command ?? '')) throw new Error('Expected migrate or seed')
if (command === 'seed' && config.mode === 'production') throw new Error('Seed forbidden in production')
const db = openDatabase(config.databasePath, true)
try {
  if (command === 'migrate') { migrate(db); mkdirSync(config.blobRoot, { recursive: true, mode: 0o700 }) }
  else seed(db, config.mode)
  console.log(`${command} completed (no credentials or sessions created)`)
} finally { db.close() }
