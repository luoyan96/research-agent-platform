import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
const root = 'D:/deepseek-agent/research-agent-platform-g0-audit/apps/web';
const require = createRequire(`${root}/package.json`);
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const server = await createServer({root, configFile: false, server: {middlewareMode: true}});
try {
  const { contractTasks, fixture } = await server.ssrLoadModule('/src/fixture-adapter.ts');
  const memberId = 'member_A';
  const expected = contractTasks.filter(t => [t.initiatorId,t.leadId,t.reviewerId,...t.participantIds].includes(memberId)).map(t=>t.id);
  const actual = fixture.tasks.filter(t=>t.mine).map(t=>t.id);
  const result = {memberId, expected, actual, omitted:expected.filter(id=>!actual.includes(id)), relationships:contractTasks.map(t=>({id:t.id,initiatorId:t.initiatorId,reviewerId:t.reviewerId,leadId:t.leadId,participantIds:t.participantIds}))};
  const output = JSON.stringify(result,null,2)+'\n';
  console.log(output);
  await writeFile(new URL('./fixture-scope-evidence.json',import.meta.url),output);
} finally { await server.close(); }
