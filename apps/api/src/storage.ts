import { randomUUID } from 'node:crypto'
import { writeFile, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export async function checkStorage(root: string) {
  const probe = join(root, `.health-${randomUUID()}`)
  const value = randomUUID()
  let created = false
  try {
    await writeFile(probe, value, { flag: 'wx', mode: 0o600 }); created = true
    if (await readFile(probe, 'utf8') !== value) throw new Error('Storage read mismatch')
  } finally { if (created) await unlink(probe) }
}
