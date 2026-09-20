# 科研 Skills 加载

`loadResearchSkills()` 返回打包的完整方法正文、名称、描述和本地参考目录。它不依赖 Harness，也不执行科研任务。

唯一编辑来源是 [agents/skills](../../agents/skills)。构建将该目录复制到 `dist/skills`；参考文件随包保留，插件可按实际运行环境注册能力。

```ts
import { loadResearchSkills } from '@research-agent-platform/research-skills'

for (const skill of loadResearchSkills()) {
  console.log(skill.name, skill.directory)
}
```

从仓库根目录运行 `pnpm run ci`，验证源文件与打包内容一致、参考文件存在。内容能正确打包不意味着执行工具已提供或科研质量已通过评测。
