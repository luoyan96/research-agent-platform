import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, relative, isAbsolute } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = resolve(root, 'agents/skills')
const target = resolve(root, 'packages/research-skills/dist/skills')
const builtRoot = resolve(root, 'packages/research-skills/dist')
const child = relative(builtRoot, target)
if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Invalid generated skills path')
// This exact generated directory is replaced so removed skills cannot remain in a build.
await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true })
console.log(`Packaged ${(await readdir(source)).length} skills from agents/skills.`)
