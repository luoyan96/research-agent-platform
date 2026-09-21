import { z } from 'zod'
import { routes } from './routes.js'
import { contractVersion, ErrorResponse } from './models.js'
import { fixtures, endpointExamples } from './fixtures.js'

export function specification() {
  const paths: Record<string, unknown> = {}
  const json = (schema: z.ZodType) => z.toJSONSchema(schema, { unrepresentable: 'any' })
  for (const [name, route] of Object.entries(routes)) {
    const request = json(route.request) as { properties: Record<string, { properties?: Record<string, unknown>; required?: string[] }> }
    const parameters = ['params', 'query', 'headers'].flatMap(part => Object.entries(request.properties[part]!.properties ?? {}).map(([key, schema]) => ({ name: key, in: part === 'params' ? 'path' : part === 'headers' ? 'header' : 'query', required: request.properties[part]!.required?.includes(key) ?? false, schema })))
    if (route.method !== 'GET' && route.access === 'session') parameters.push({ name: 'X-CSRF-Token', in: 'header', required: true, schema: { type: 'string', minLength: 32, maxLength: 128 } })
    const responses: Record<string, unknown> = {}
    for (const status of new Set(Object.values(route.errorStatuses))) responses[status] = { description: 'See error.code mapping and retry rules in protocol.md.', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } }
    const success = { description: `${route.stage} contract; ${route.implemented ? 'implemented' : 'not implemented in B0 (501)'}`, content: name === 'content' ? { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } : { 'application/json': { schema: json(route.response), example: endpointExamples[name]!.response } } }
    responses[route.status] = success
    if (name === 'ready') responses[503] = { ...success, description: 'Dependency probe unavailable; same health response schema.' }
    paths[route.path] = { ...paths[route.path] as object, [route.method.toLowerCase()]: { operationId: name, description: route.rule, 'x-stage': route.stage, 'x-implemented': route.implemented, security: route.access === 'public' ? [] : [{ sessionCookie: [] }], parameters, ...(route.method === 'GET' ? {} : { requestBody: { required: true, content: { 'application/json': { schema: request.properties.body, example: (endpointExamples[name]!.request as { body: unknown }).body } } } }), responses } }
  }
  return { openapi: '3.1.0', info: { title: 'Research Agent Platform B0 contract', version: contractVersion }, paths, components: { schemas: { ErrorResponse: json(ErrorResponse) }, securitySchemes: { sessionCookie: { type: 'apiKey', in: 'cookie', name: 'rap_session' } } } }
}
export function examples() {
  return { contractVersion, synthetic: true, scenarios: Object.fromEntries(Object.entries(fixtures).map(([name, fixture]) => [name, fixture.schema.parse(fixture.value)])), endpoints: endpointExamples }
}

