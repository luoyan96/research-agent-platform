import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { contractVersion, data, Health, ErrorResponse, errorStatus, routes } from '@research-agent-platform/contracts'
import { openDatabase, checkDatabase } from './database.js'
import { checkStorage } from './storage.js'
import type { Config } from './config.js'

export function createServer(config: Config) {
  const app = Fastify({ logger: false, bodyLimit: 1048576, genReqId: () => randomUUID(), requestTimeout: 10000 })
  let db: ReturnType<typeof openDatabase> | undefined
  app.addHook('onClose', async () => { db?.close() })
  app.addHook('onSend', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); reply.header('X-Contract-Version', contractVersion); reply.header('X-Content-Type-Options', 'nosniff') })
  function error(code: keyof typeof errorStatus, requestId: string) {
    return ErrorResponse.parse({ error: { code, message: code === 'NOT_IMPLEMENTED' ? 'Endpoint is not implemented in B0.' : 'Request could not be completed.', requestId } })
  }
  app.get('/api/v1/health/live', async () => data(Health).parse({ data: { status: 'ok', contractVersion, checks: { database: 'not_checked', storage: 'not_checked', authentication: 'not_implemented', harness: 'not_verified' } } }))
  app.get('/api/v1/health/ready', async (_request, reply) => {
    let database: 'ok' | 'unavailable' = 'unavailable'
    let storage: 'ok' | 'unavailable' = 'unavailable'
    try {
      if (!existsSync(config.databasePath)) throw new Error('Database missing')
      db ??= openDatabase(config.databasePath)
      checkDatabase(db); database = 'ok'
    } catch { /* Do not return database paths, SQL, or exceptions. */ }
    try { await checkStorage(config.blobRoot); storage = 'ok' } catch { /* Same privacy boundary. */ }
    const ok = database === 'ok' && storage === 'ok'
    reply.code(ok ? 200 : 503)
    return data(Health).parse({ data: { status: ok ? 'ok' : 'unavailable', contractVersion, checks: { database, storage, authentication: 'not_implemented', harness: 'not_verified' } } })
  })
  for (const route of Object.values(routes)) {
    if (route.implemented) continue
    app.route({ method: route.method, url: route.path.replace(/\{id\}/g, ':id'), handler: async (request, reply) => reply.code(501).send(error('NOT_IMPLEMENTED', request.id)) })
  }
  app.setNotFoundHandler((request, reply) => reply.code(404).send(error('NOT_FOUND', request.id)))
  app.setErrorHandler((err, request, reply) => {
    const status = (err as { statusCode?: number }).statusCode
    const code = status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 || status === 415 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR'
    reply.code(errorStatus[code]).send(error(code, request.id))
  })
  return app
}
