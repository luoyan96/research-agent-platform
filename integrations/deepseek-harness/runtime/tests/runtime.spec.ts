import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe,it,expect } from 'vitest'
import { harnessVersion } from '../src/index.js'
describe('installed official Harness boundary; no live credential in default CI',()=>{
 it('loads fixed public interfaces and reports real missing credential, never mock success',()=>{
  expect(harnessVersion).toBe('0.2.0-rc.1')
  const env={...process.env};delete env.DEEPSEEK_API_KEY;delete env.DEEPSEEK_BASE_URL
  const run=spawnSync(process.execPath,[resolve('integrations/deepseek-harness/runtime/dist/cli.js')],{env,input:JSON.stringify({system:'Return OK only; no tools.',prompt:'Synthetic connectivity check.',model:'deepseek-v4-flash',maxTokens:32,timeoutMs:1000}),encoding:'utf8',windowsHide:true})
  expect(run.status).toBe(0);const result=JSON.parse(run.stdout)
  expect(result.failure).toBe('MISSING_CREDENTIAL');expect(result.text).toBe('');expect(result.inputTokens).toBeNull();expect(result.outputTokens).toBeNull()
 })
})
