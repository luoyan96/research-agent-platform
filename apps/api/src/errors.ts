import { errorStatus } from '@research-agent-platform/contracts'

export class ApiError extends Error {
  constructor(public readonly code: keyof typeof errorStatus) { super(code) }
}
export function fail(code: keyof typeof errorStatus): never { throw new ApiError(code) }
