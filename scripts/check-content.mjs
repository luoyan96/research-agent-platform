import { readdir, readFile, access } from 'node:fs/promises'
import { resolve, dirname, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const ignored = new Set(['.git', 'node_modules', 'dist', 'coverage', '.runtime'])
const files = []
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await visit(path)
    else if (entry.name.endsWith('.md')) files.push(path)
  }
}
await visit(root)
const errors = []
for (const path of files) {
  const text = await readFile(path, 'utf8')
  const prose = text.replace(/```[^\n]*\n[\s\S]*?```/g, '')
  for (const match of prose.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const link = match[1]
    if (/^(https?:|mailto:|#)/.test(link)) continue
    const target = resolve(dirname(path), decodeURIComponent(link.split('#')[0]))
    const child = relative(root, target)
    if (child.startsWith('..') || isAbsolute(child)) {
      errors.push(`${relative(root, path)}: link leaves repository: ${link}`)
      continue
    }
    try { await access(target) } catch { errors.push(`${relative(root, path)}: missing ${link}`) }
  }
}
const skillRoot = resolve(root, 'agents/skills')
const skills = await readdir(skillRoot, { withFileTypes: true })
for (const skill of skills.filter(entry => entry.isDirectory())) {
  const text = await readFile(resolve(skillRoot, skill.name, 'SKILL.md'), 'utf8')
  const metadata = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  const name = metadata?.match(/^name:\s*(\S+)\s*$/m)?.[1]
  if (name !== skill.name || !/^description:\s*\S/m.test(metadata ?? '')) errors.push(`Invalid Skill metadata: ${skill.name}`)
}
if (errors.length) throw new Error(errors.join('\n'))
console.log(`Checked ${files.length} Markdown files and ${skills.length} skill definitions.`)
