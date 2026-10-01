import { processGuard } from './process-guard.js'
import { readConfig } from './config.js'
import { createServer } from './server.js'
import { contractVersion } from '@research-agent-platform/contracts'

const config = readConfig()
const releaseProcess = processGuard(config.databasePath)
process.once('exit', releaseProcess)
const app = createServer(config)
try {
  const address = await app.listen({ host: config.host, port: config.port })
  console.log(`API listening ${address}; contract ${contractVersion}; AI configuration ${config.aiEnabled ? 'enabled (runtime verification separate)' : 'disabled'}`)
} catch { console.error('API startup failed; check configuration and port availability.'); process.exitCode = 1 }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close() })
