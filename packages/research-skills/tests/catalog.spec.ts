import { readFile, readdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadResearchSkills } from '../dist/index.js'

const sourceRoot = fileURLToPath(new URL('../../../agents/skills/', import.meta.url))

describe('packaged research skills', () => {
  it('ships every canonical skill with the full instruction body and references', async () => {
    const directories = (await readdir(sourceRoot)).sort()
    const skills = loadResearchSkills()
    expect(skills.map(skill => skill.name)).toEqual(directories)
    expect(skills).toHaveLength(10)
    for (const skill of skills) {
      const original = await readFile(join(sourceRoot, skill.name, 'SKILL.md'), 'utf8')
      const packaged = await readFile(join(skill.directory, 'SKILL.md'), 'utf8')
      expect(packaged).toBe(original)
      expect(original).toContain(skill.content)
      expect(skill.description.length).toBeGreaterThan(0)
      for (const match of skill.content.matchAll(/\]\((references\/[^)#]+)(?:#[^)]*)?\)/g)) {
        await access(join(skill.directory, match[1]!))
      }
    }
  })
})
