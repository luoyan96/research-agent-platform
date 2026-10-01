import { writeFile, readFile } from 'node:fs/promises'
import { contractVersion } from '../packages/contracts/dist/index.js'
import { specification, examples } from '../packages/contracts/dist/specification.js'

for (const [name, value] of Object.entries({ 'openapi.json': specification(), 'examples.json': examples() })) {
  const path = new URL(`../packages/contracts/${name}`, import.meta.url)
  const content = JSON.stringify(value, null, 2) + '\n'
  if (process.argv.includes('--check')) {
    if (await readFile(path, 'utf8') !== content) throw new Error(`${name} is stale; run pnpm contracts:export`)
  } else await writeFile(path, content)
}
console.log(`Contract ${contractVersion}: OpenAPI and synthetic examples verified.`)
