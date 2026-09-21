import { readConfig } from './config.js'
import { createServer } from './server.js'

const config = readConfig()
const app = createServer(config)
try {
  const address = await app.listen({ host: config.host, port: config.port })
  console.log(`B0 API listening ${address}; contract 0.1.0; auth and business endpoints not implemented`)
} catch { console.error('API startup failed; check configuration and port availability.'); process.exitCode = 1 }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close() })
