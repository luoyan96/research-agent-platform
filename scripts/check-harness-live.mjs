import { generate,harnessVersion } from '../integrations/deepseek-harness/runtime/dist/index.js'
const result=await generate({system:'Return only OK. No tools.',prompt:'Synthetic connectivity check.',model:process.env.DEEPSEEK_MODEL??'deepseek-v4-flash',maxTokens:32,timeoutMs:30000})
console.log(JSON.stringify({harnessVersion,model:process.env.DEEPSEEK_MODEL??'deepseek-v4-flash',status:result.failure?'failed':'responded',failure:result.failure,inputTokens:result.inputTokens,outputTokens:result.outputTokens,elapsedMs:result.elapsedMs,cost:null,currency:null,nonemptyResponse:result.text.trim().length>0}))
if(result.failure||!result.text.trim())process.exitCode=2
