import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import type { RequestFor, ResponseFor } from '@research-agent-platform/contracts'
import type { Actor } from './auth.js'
import { signingKey } from './auth.js'
import type { Config } from './config.js'
import { fail } from './errors.js'
import { isLabManager } from './invite-management.js'

type LabModel = 'deepseek-flash' | 'deepseek-v4-pro'
type Setting = { enabled: number; model: LabModel; encrypted_api_key: string | null; version: number; updated_at: string }

function requireManager(db: DatabaseSync, actor: Actor, labId: string) {
  if (actor.labId !== labId) fail('NOT_FOUND')
  if (!isLabManager(db, actor)) fail('FORBIDDEN')
}

function masterKey(config: Config) {
  if (!config.credentialKeyFile) fail('SERVICE_UNAVAILABLE')
  try {
    const stat = lstatSync(config.credentialKeyFile)
    if (!stat.isFile() || stat.size < 64 || stat.size > 128 || (process.platform !== 'win32' && (stat.mode & 0o007) !== 0)) fail('SERVICE_UNAVAILABLE')
    const raw = readFileSync(config.credentialKeyFile, 'utf8').trim()
    if (!/^[a-f0-9]{64}$/i.test(raw)) fail('SERVICE_UNAVAILABLE')
    return Buffer.from(raw, 'hex')
  } catch { fail('SERVICE_UNAVAILABLE') }
}

function masterAvailable(config: Config) {
  try { masterKey(config); return true } catch { return false }
}

function encrypt(config: Config, labId: string, apiKey: string) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(config), nonce)
  cipher.setAAD(Buffer.from(`lab-ai-key:v1:${labId}`))
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])
  return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':')
}

function decrypt(config: Config, labId: string, value: string) {
  try {
    const [version, nonce, tag, encrypted, extra] = value.split(':')
    if (version !== 'v1' || !nonce || !tag || !encrypted || extra) fail('SERVICE_UNAVAILABLE')
    const decipher = createDecipheriv('aes-256-gcm', masterKey(config), Buffer.from(nonce, 'base64url'))
    decipher.setAAD(Buffer.from(`lab-ai-key:v1:${labId}`))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')
  } catch { fail('SERVICE_UNAVAILABLE') }
}

function row(db: DatabaseSync, labId: string): Setting | undefined {
  return db.prepare('SELECT enabled,model,encrypted_api_key,version,updated_at FROM lab_ai_settings WHERE lab_id=?').get(labId) as Setting | undefined
}

function view(db: DatabaseSync, labId: string, setting: Setting | undefined, config: Config) {
  const labName = String(db.prepare('SELECT name FROM labs WHERE id=?').get(labId)!.name)
  return { labId, labName, enabled: setting?.enabled === 1, platformEnabled: config.aiEnabled && masterAvailable(config), hasApiKey: !!setting?.encrypted_api_key, model: setting?.model ?? 'deepseek-flash', version: setting?.version ?? 0, updatedAt: setting?.updated_at ?? null }
}

export function labAiSettings(db: DatabaseSync, actor: Actor, input: RequestFor<'labAiSettings'>, config: Config): ResponseFor<'labAiSettings'> {
  requireManager(db, actor, input.params.id)
  return { data: view(db, actor.labId, row(db, actor.labId), config) }
}

export function updateLabAiSettings(db: DatabaseSync, actor: Actor, input: RequestFor<'updateLabAiSettings'>, config: Config): ResponseFor<'updateLabAiSettings'> {
  requireManager(db, actor, input.params.id)
  const { expectedVersion, enabled, model, apiKey, removeApiKey } = input.body
  const requestKey = input.headers['Idempotency-Key']!
  const requestHash = createHmac('sha256', signingKey(db)).update(JSON.stringify({ actorId: actor.id, labId: actor.labId, expectedVersion, enabled, model, apiKey, removeApiKey })).digest('hex')
  const prior = db.prepare('SELECT request_hash,response_json FROM lab_ai_setting_receipts WHERE actor_id=? AND lab_id=? AND request_key=?').get(actor.id, actor.labId, requestKey)
  if (prior) {
    if (prior.request_hash !== requestHash) fail('IDEMPOTENCY_CONFLICT')
    return JSON.parse(String(prior.response_json)) as ResponseFor<'updateLabAiSettings'>
  }
  const current = row(db, actor.labId)
  if ((current?.version ?? 0) !== expectedVersion) fail('VERSION_CONFLICT')
  if (removeApiKey && (apiKey || enabled)) fail('VALIDATION_ERROR')
  if (apiKey && !/^sk-[\x21-\x7e]{5,509}$/.test(apiKey)) fail('VALIDATION_ERROR')
  if (enabled && !config.aiEnabled) fail('MODEL_UNAVAILABLE')
  const ciphertext = removeApiKey ? null : apiKey ? encrypt(config, actor.labId, apiKey) : current?.encrypted_api_key ?? null
  if (enabled && !ciphertext) fail('MODEL_UNAVAILABLE')
  if (enabled) decrypt(config, actor.labId, ciphertext!)
  const at = new Date().toISOString()
  db.prepare('INSERT INTO lab_ai_settings(lab_id,enabled,model,encrypted_api_key,version,updated_by,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(lab_id) DO UPDATE SET enabled=excluded.enabled,model=excluded.model,encrypted_api_key=excluded.encrypted_api_key,version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(actor.labId, enabled ? 1 : 0, model, ciphertext, expectedVersion + 1, actor.id, at)
  const response = { data: view(db, actor.labId, row(db, actor.labId), config) } as ResponseFor<'updateLabAiSettings'>
  db.prepare('INSERT INTO lab_ai_setting_receipts VALUES(?,?,?,?,?,?)').run(actor.id, actor.labId, requestKey, requestHash, JSON.stringify(response), at)
  return response
}

export function labAiRuntime(db: DatabaseSync, labId: string, config: Config) {
  const setting = row(db, labId)
  return { enabled: config.aiEnabled && setting?.enabled === 1 && !!setting.encrypted_api_key && masterAvailable(config), model: setting?.model ?? config.model }
}

export function labApiKey(db: DatabaseSync, labId: string, config: Config) {
  const setting = row(db, labId)
  if (!config.aiEnabled || setting?.enabled !== 1 || !setting.encrypted_api_key) fail('MODEL_UNAVAILABLE')
  return decrypt(config, labId, setting.encrypted_api_key)
}
