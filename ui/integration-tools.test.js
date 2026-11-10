import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGraphqlRequest, createWorkspaceBundle, exportRunReport, importOpenApi, parseWorkspaceBundle } from './integration-tools.js'

test('imports OpenAPI operations as HTTP requests', () => {
  const source = JSON.stringify({
    openapi: '3.0.3', servers: [{ url: 'https://api.example.com' }],
    paths: { '/items/{id}': { get: { summary: 'Read item', parameters: [{ name: 'verbose', in: 'query', required: true }], responses: { 200: { content: { 'application/json': {} } } } } } }
  })
  const output = importOpenApi(source)
  assert.match(output, /# @name Read item/)
  assert.match(output, /# @expect status 200/)
  assert.match(output, /GET https:\/\/api\.example\.com\/items\/\{\{id\}\}\?verbose=\{\{verbose\}\}/)
})

test('creates request body examples from OpenAPI schemas', () => {
  const output = importOpenApi({ openapi: '3.1.0', paths: { '/items': { post: { requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, enabled: { type: 'boolean' } } } } } }, responses: { 201: {} } } } } })
  assert.match(output, /"name": "string"/)
  assert.match(output, /"enabled": false/)
})

test('exports JSON and JUnit collection reports', () => {
  const results = [{ name: 'Health <check>', passed: true, status: 200, elapsedMs: 12, tests: [], captures: [] }]
  assert.equal(JSON.parse(exportRunReport(results, 'json', { generatedAt: 0 })).summary.passed, 1)
  assert.match(exportRunReport(results, 'junit', { generatedAt: 0 }), /name="Health &lt;check&gt;"/)
})

test('builds a GraphQL HTTP request', () => {
  const output = buildGraphqlRequest({ endpoint: 'https://api.example.com/graphql', operationName: 'ReadUser', query: 'query ReadUser($id: ID!) { user(id: $id) { id } }', variables: '{"id":"7"}' })
  assert.match(output, /# @name ReadUser/)
  assert.match(output, /POST https:\/\/api\.example\.com\/graphql/)
  assert.match(output, /"id": "7"/)
})

test('exports portable workspace bundles without values by default', () => {
  const encoded = createWorkspaceBundle({ source: 'GET https://example.com', environments: [{ name: 'Dev', variables: [{ key: 'token', value: 'secret' }] }], createdAt: 0 })
  assert.doesNotMatch(encoded, /secret/)
  const parsed = parseWorkspaceBundle(encoded)
  assert.equal(parsed.source, 'GET https://example.com')
  assert.deepEqual(parsed.environments[0].variables, [{ key: 'token', value: '' }])
})
