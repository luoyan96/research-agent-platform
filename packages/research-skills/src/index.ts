import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

export interface ResearchSkill {
  name: string
  description: string
  content: string
  directory: string
}

/** Load the canonical skill bodies and their local reference directories. */
export function loadResearchSkills(): ResearchSkill[] {
  const root = new URL('./skills/', import.meta.url)
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(entry => {
      const directory = new URL(`${entry.name}/`, root)
      const text = readFileSync(new URL('SKILL.md', directory), 'utf8')
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text)
      if (!match) throw new Error(`Missing skill metadata: ${entry.name}`)
      const metadata: unknown = parse(match[1]!)
      if (typeof metadata !== 'object' || metadata === null ||
          !('name' in metadata) || metadata.name !== entry.name ||
          !('description' in metadata) || typeof metadata.description !== 'string' || !metadata.description.trim()) {
        throw new Error(`Invalid skill metadata: ${entry.name}`)
      }
      return {
        name: entry.name,
        description: metadata.description,
        content: match[2]!.trim(),
        directory: fileURLToPath(directory),
      }
    })
}
