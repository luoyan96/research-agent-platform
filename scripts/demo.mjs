import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactStore } from '../packages/research-core/dist/index.js'
import { loadResearchSkills } from '../packages/research-skills/dist/index.js'

const workspace = await mkdtemp(join(tmpdir(), 'research-platform-demo-'))
const store = new ArtifactStore(workspace)
await store.createProject({ id: 'demo', name: '科研平台基础演示' })
await store.saveArtifact('demo', {
  id: 'task-plan', type: 'plan', factual: false, sources: [],
  content: '# 下一步\n选择一个真实科研任务，验证材料、执行与成果留存。\n',
})
const reopened = new ArtifactStore(workspace)
const result = await reopened.getArtifact('demo', 'task-plan')
console.log(JSON.stringify({
  workspace,
  project: await reopened.getProject('demo'),
  artifact: result.artifact,
  content: result.content,
  skills: loadResearchSkills().map(skill => skill.name),
}, null, 2))
console.log('演示只验证本地保存、重新读取与 Skills 目录；没有调用模型或执行科研工作流。')
