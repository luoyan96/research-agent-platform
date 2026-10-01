import { Context } from '@deepseek-ai/cordis'
import Llm from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'

export const harnessVersion = '0.2.0-rc.1'
export interface ModelInput { system: string; prompt: string; model: string; maxTokens: number; timeoutMs: number }
export interface ModelResult { text: string; failure: string | null; inputTokens: number | null; outputTokens: number | null; elapsedMs: number }

// A bounded official Harness composition. No shell, filesystem, discovery,
// session-upload, credentials-store or local ArtifactStore plugins are mounted.
export async function generate(input: ModelInput, signal?: AbortSignal): Promise<ModelResult> {
  const ctx = new Context(), started = Date.now()
  const result: ModelResult = { text: '', failure: null, inputTokens: null, outputTokens: null, elapsedMs: 0 }
  try {
    await ctx.plugin(Llm)
    await ctx.plugin(DeepSeek, { apiKeyEnv: 'DEEPSEEK_API_KEY', ...(process.env.DEEPSEEK_BASE_URL ? { baseURL: process.env.DEEPSEEK_BASE_URL } : {}) })
    for await (const chunk of ctx.llm.stream({ provider: 'deepseek-official', model: input.model, system: input.system, messages: [{role:'user',content:[{type:'text',text:input.prompt}]}], tools: [], maxTokens: input.maxTokens, signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(input.timeoutMs)]) : AbortSignal.timeout(input.timeoutMs) })) {
      if (chunk.type === 'text-delta') result.text += chunk.text
      if (chunk.type === 'usage') { result.inputTokens = chunk.usage.inputTokens; result.outputTokens = chunk.usage.outputTokens }
      if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) result.failure = chunk.reason.failure.code
      if (result.text.length > 100000) { result.failure = 'OUTPUT_LIMIT'; break }
    }
  } catch (error) {
    const code = (error as { code?: unknown }).code
    result.failure = typeof code === 'string' && /^[A-Z_]{1,80}$/.test(code) ? code : 'HARNESS_ERROR'
  } finally { await ctx.fiber.dispose(); result.elapsedMs = Date.now()-started }
  if (result.failure) result.text = ''
  return result
}
