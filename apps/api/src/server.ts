import { ReuseService, reuseCommands } from './reuse.js'
import type { ReuseCommand } from './reuse.js'
import { AiService, aiCommands } from './ai.js'
import type { AiCommand } from './ai.js'
import { reconcile } from './execution-worker.js'
import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { contractVersion, data, Health, ErrorResponse, errorStatus, routes } from '@research-agent-platform/contracts'
import { openDatabase, checkDatabase, transaction } from './database.js'
import { checkStorage } from './storage.js'
import type { Config } from './config.js'
import { authenticate, cookieToken, csrfToken, hash, login, requireCsrf, signingKey } from './auth.js'
import { Collaboration, collaborationCommands } from './collaboration.js'
import type { CollaborationCommand } from './collaboration.js'
import type { RequestFor } from '@research-agent-platform/contracts'
import { cleanBlobs } from './coordination.js'
import { ApiError, fail } from './errors.js'

export function createServer(config: Config) {
  const app = Fastify({ logger: false, bodyLimit: 1048576, genReqId: () => randomUUID(), requestTimeout: 10000 })
  let db: ReturnType<typeof openDatabase> | undefined
  function database() {
    try {
      if (!db) {
        db = openDatabase(config.databasePath)
        checkDatabase(db)
        signingKey(db)
      }
      return db
    } catch { db?.close(); db = undefined; fail('SERVICE_UNAVAILABLE') }
  }
  app.addHook('onClose', async () => { db?.close() })
  app.addHook('onSend', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); reply.header('X-Contract-Version', contractVersion); reply.header('X-Content-Type-Options', 'nosniff') })
  function error(code: keyof typeof errorStatus, requestId: string) {
    return ErrorResponse.parse({ error: { code, message: code === 'NOT_IMPLEMENTED' ? 'Endpoint is not implemented in B3.' : 'Request could not be completed.', requestId } })
  }
  app.get('/api/v1/health/live', async () => data(Health).parse({ data: { status: 'ok', contractVersion, checks: { database: 'not_checked', storage: 'not_checked', authentication: 'not_checked', harness: 'not_verified' } } }))
  app.get('/api/v1/health/ready', async (_request, reply) => {
    let database: 'ok' | 'unavailable' = 'unavailable'
    let storage: 'ok' | 'unavailable' = 'unavailable'
    try {
      if (!existsSync(config.databasePath)) throw new Error('Database missing')
      db ??= openDatabase(config.databasePath)
      checkDatabase(db); signingKey(db); database = 'ok'
    } catch { db?.close(); db = undefined /* Do not return database paths, SQL, or exceptions. */ }
    try { await checkStorage(config.blobRoot); storage = 'ok' } catch { /* Same privacy boundary. */ }
    const ok = database === 'ok' && storage === 'ok'
    reply.code(ok ? 200 : 503)
    return data(Health).parse({ data: { status: ok ? 'ok' : 'unavailable', contractVersion, checks: { database, storage, authentication: database, harness: 'not_verified' } } })
  })
  for (const [name, route] of Object.entries(routes)) {
    if (route.stage === 'B0') continue
    app.route({ method: route.method, url: route.path.replace(/\{id\}/g, ':id'), ...(name==='upload'?{bodyLimit:14000000}:{}), handler: async (request, reply) => {
      if (!route.implemented && name !== 'planRequest') fail('NOT_IMPLEMENTED')
      if (route.method !== 'GET' && request.headers.origin !== config.origin) fail('FORBIDDEN')
      const connection = database()
      const token = cookieToken(request.headers.cookie)
      // Reject malformed query numbers instead of accepting 1x, arrays, or coercing null.
      const query = { ...request.query as Record<string, unknown> }
      if ('limit' in query && typeof query.limit === 'string' && /^\d+$/.test(query.limit)) query.limit = Number(query.limit)
      if(name==='upload' && typeof (request.body as {contentBase64?:unknown})?.contentBase64==='string' && (request.body as {contentBase64:string}).contentBase64.length>13981016) fail('PAYLOAD_TOO_LARGE')
      const parsed = route.request.safeParse({ params: request.params, query, headers: route.idempotent ? { 'Idempotency-Key': request.headers['idempotency-key'] } : {}, body: route.method === 'GET' ? null : request.body })
      if (!parsed.success) fail('VALIDATION_ERROR')
      reply.code(route.status)
      const cookie = (value: string, maxAge: number) => `rap_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.mode === 'production' ? '; Secure' : ''}`
      if (name === 'login') {
        const input = parsed.data as RequestFor<'login'>
        const loggedIn = await login(connection, input.body.username, input.body.password, request.ip, token)
        reply.header('Set-Cookie', cookie(loggedIn.token, 43200))
        return transaction(connection, () => {
          const actor = authenticate(connection, loggedIn.token)
          return routes.login.response.parse({ data: new Collaboration(connection, actor).member(loggedIn.memberId) })
        })
      }
      let collaboration: Collaboration | undefined
      try { return transaction(connection, () => {
        const actor = authenticate(connection, token)
        if (route.method !== 'GET') requireCsrf(actor, request.headers['x-csrf-token'])
        if (name === 'session') return routes.session.response.parse({ data: { member: new Collaboration(connection, actor).member(actor.id), csrfToken: csrfToken(connection, token), expiresAt: actor.expiresAt } })
        if (name === 'logout') {
          connection.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').run(new Date().toISOString(), hash(token))
          reply.header('Set-Cookie', cookie('', 0)); return { data: { loggedOut: true } }
        }
        collaboration = new Collaboration(connection,actor,config.blobRoot,{enabled:config.aiEnabled,model:config.model})
        reconcile(connection,config)
        if((reuseCommands as readonly string[]).includes(name)){const result=new ReuseService(collaboration).run(name as ReuseCommand,parsed.data as RequestFor<ReuseCommand>);reconcile(connection,config);return result}
        if((aiCommands as readonly string[]).includes(name))return new AiService(collaboration,config.aiEnabled,config.model).run(name as AiCommand,parsed.data as RequestFor<AiCommand>)
        if (!(collaborationCommands as readonly string[]).includes(name)) fail('NOT_IMPLEMENTED')
        const result=collaboration.run(name as CollaborationCommand, parsed.data as RequestFor<CollaborationCommand>)
        reconcile(connection,config)
        if(name==='content') {const file=collaboration.coordination.artifact((parsed.data.params as {id:string}).id).model;reply.header('Content-Type',file.mediaType);reply.header('Content-Disposition',`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);return Buffer.from(result as Uint8Array)}
        return result
      }) } catch(error) {if(collaboration) cleanBlobs(collaboration.createdBlobs);throw error}
    } })
  }
  app.setNotFoundHandler((request, reply) => reply.code(404).send(error('NOT_FOUND', request.id)))
  app.setErrorHandler((err, request, reply) => {
    const status = (err as { statusCode?: number }).statusCode
    const code = err instanceof ApiError ? err.code : status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 || status === 415 ? 'VALIDATION_ERROR' : (err as { code?: string }).code === 'ERR_SQLITE_ERROR' && /locked|busy/i.test(String(err)) ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR'
    if (code === 'RATE_LIMITED') reply.header('Retry-After', '900')
    reply.code(errorStatus[code]).send(error(code, request.id))
  })
  return app
}
