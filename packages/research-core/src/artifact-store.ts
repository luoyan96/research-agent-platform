import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { RESEARCH_SCHEMA_VERSION, type Artifact, type ArtifactStatus, type Project, type SourceRef } from './domain/index.js'
import { requireArtifactStatus, requireIdentifier, requireNonEmpty, validateSources } from './domain/validation.js'

type ProjectIndex = { schema_version: number, artifacts: Artifact[] }
export interface CreateProjectInput { id?: string, name: string }
export interface SaveArtifactInput { id?: string, type: string, content: string, sources: readonly SourceRef[], status?: ArtifactStatus, factual?: boolean }

/** Local prototype: serialized per instance, without cross-process transactions or member authorization. */
export class ArtifactStore {
  private readonly writeTails = new Map<string, Promise<void>>()

  constructor(private readonly workspaceRoot: string) {}

  async createProject(input: CreateProjectInput): Promise<Project> {
    requireNonEmpty(input.name, 'name')
    const id = input.id ?? randomUUID()
    requireIdentifier(id, 'project id')
    return this.withProjectLock(id, () => this.createProjectUnlocked(id, input.name))
  }

  private async createProjectUnlocked(id: string, name: string): Promise<Project> {
    const root = this.projectRoot(id)
    await mkdir(root, { recursive: true })
    const projectPath = resolve(root, 'project.json')
    try { return await this.readJson<Project>(projectPath) } catch (error: unknown) {
      if (!isMissing(error)) throw error
    }
    const now = new Date().toISOString()
    const project: Project = { schema_version: RESEARCH_SCHEMA_VERSION, id, name: name.trim(), created_at: now, updated_at: now }
    await writeJsonAtomic(projectPath, project)
    await writeJsonAtomic(resolve(root, 'artifacts.json'), { schema_version: RESEARCH_SCHEMA_VERSION, artifacts: [] } satisfies ProjectIndex)
    return project
  }

  async getProject(id: string): Promise<Project> {
    requireIdentifier(id, 'project id')
    return this.readJson<Project>(resolve(this.projectRoot(id), 'project.json'))
  }

  async saveArtifact(projectId: string, input: SaveArtifactInput): Promise<Artifact> {
    return this.withProjectLock(projectId, async () => this.saveArtifactUnlocked(projectId, input))
  }

  private async saveArtifactUnlocked(projectId: string, input: SaveArtifactInput): Promise<Artifact> {
    await this.getProject(projectId)
    requireNonEmpty(input.type, 'type')
    validateSources(input.sources, input.factual ?? true)
    const status = input.status ?? 'draft'
    requireArtifactStatus(status)
    const id = input.id ?? randomUUID()
    requireIdentifier(id, 'artifact id')
    const root = this.projectRoot(projectId)
    const indexPath = resolve(root, 'artifacts.json')
    const index = await this.readJson<ProjectIndex>(indexPath)
    // Reject before writing so a duplicate id never overwrites the original body.
    if (index.artifacts.some(existing => existing.id === id)) throw new Error(`artifact already exists: ${id}`)
    const relativePath = `artifacts/${id}.md`
    const outputPath = this.safePath(root, relativePath)
    await mkdir(dirname(outputPath), { recursive: true })
    const content = input.content.replace(/\r\n/g, '\n')
    await writeAtomic(outputPath, content)
    const artifact: Artifact = {
      schema_version: RESEARCH_SCHEMA_VERSION, id, project_id: projectId, type: input.type.trim(), path: relativePath,
      sha256: createHash('sha256').update(content).digest('hex'), created_at: new Date().toISOString(), status, sources: [...input.sources],
    }
    await writeJsonAtomic(indexPath, { ...index, artifacts: [...index.artifacts, artifact] })
    return artifact
  }

  async listArtifacts(projectId: string): Promise<Artifact[]> {
    await this.getProject(projectId)
    return (await this.readJson<ProjectIndex>(resolve(this.projectRoot(projectId), 'artifacts.json'))).artifacts
  }

  async getArtifact(projectId: string, artifactId: string): Promise<{ artifact: Artifact, content: string }> {
    requireIdentifier(artifactId, 'artifact id')
    const artifact = (await this.listArtifacts(projectId)).find(item => item.id === artifactId)
    if (artifact === undefined) throw new Error(`artifact not found: ${artifactId}`)
    return { artifact, content: await readFile(this.safePath(this.projectRoot(projectId), artifact.path), 'utf8') }
  }

  private projectRoot(id: string): string { return this.safePath(resolve(this.workspaceRoot, 'research-projects'), id) }
  private safePath(root: string, child: string): string {
    const candidate = resolve(root, child)
    const rel = relative(root, candidate)
    if (rel === '' || isAbsolute(rel) || rel.startsWith(`..${sep}`) || rel === '..') throw new Error('unsafe project path')
    return candidate
  }
  private async readJson<T>(path: string): Promise<T> {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (typeof value !== 'object' || value === null || !('schema_version' in value) || value.schema_version !== RESEARCH_SCHEMA_VERSION) {
      throw new Error(`unsupported or malformed research schema in ${path}`)
    }
    return value as T
  }
  private async withProjectLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeTails.get(projectId) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>(resolveRelease => { release = resolveRelease })
    const tail = previous.then(() => current)
    this.writeTails.set(projectId, tail)
    await previous
    try { return await operation() } finally {
      release()
      if (this.writeTails.get(projectId) === tail) this.writeTails.delete(projectId)
    }
  }
}

function isMissing(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT' }
async function writeAtomic(path: string, text: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, text, 'utf8')
  await rename(temporary, path)
}
async function writeJsonAtomic(path: string, value: unknown): Promise<void> { await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`) }
