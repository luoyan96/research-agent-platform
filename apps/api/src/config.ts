import { isAbsolute, resolve } from 'node:path'

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.NODE_ENV ?? 'development'
  if (!['development', 'test', 'production'].includes(mode)) throw new Error('Invalid NODE_ENV')
  // All identities require a real password-backed session, including development.
  if (env.DEV_AUTH_MEMBER || env.FIXTURE_MODE || env.AUTH_BYPASS) throw new Error('Authentication bypass and fixture mode are unsupported')
  if (mode === 'production' && (!env.DATABASE_PATH || !env.BLOB_ROOT)) throw new Error('Production requires DATABASE_PATH and BLOB_ROOT')
  const databasePath = resolve(env.DATABASE_PATH ?? '.runtime/platform.sqlite')
  const blobRoot = resolve(env.BLOB_ROOT ?? '.runtime/blobs')
  if (mode === 'production' && (!isAbsolute(env.DATABASE_PATH!) || !isAbsolute(env.BLOB_ROOT!))) throw new Error('Production data paths must be absolute')
  const port = Number(env.PORT ?? 3100)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT')
  const origin = env.APP_ORIGIN ?? `http://127.0.0.1:${port}`
  if (new URL(origin).origin !== origin || !['http:', 'https:'].includes(new URL(origin).protocol)) throw new Error('APP_ORIGIN must be an exact HTTP origin')
  if (mode === 'production' && (!env.APP_ORIGIN || !origin.startsWith('https://'))) throw new Error('Production requires HTTPS APP_ORIGIN')
  return { aiEnabled: env.B3_AI_ENABLED === '1', model: env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash', mode, databasePath, blobRoot, host: env.HOST ?? '127.0.0.1', port, origin }
}
export type Config = ReturnType<typeof readConfig>
