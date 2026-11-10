import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAuth, parseCurl, resolveRequest, resolveVariables } from './request-tools.js'

test('resolves environment and dynamic variables', () => {
  const result = resolveVariables('{{baseUrl}}/items/{{$timestamp}}', { baseUrl: 'https://api.example.com' }, { timestamp: 42, randomUUID: 'id' })
  assert.equal(result.value, 'https://api.example.com/items/42')
  assert.deepEqual(result.missing, [])
})

test('reports unresolved variables across a request', () => {
  const result = resolveRequest({ url: '{{baseUrl}}/items', headers: [{ name: 'X-Key', value: '{{token}}' }], body: '' }, { baseUrl: 'https://api.example.com' })
  assert.deepEqual(result.missing, ['token'])
})

test('applies bearer and api key authentication', () => {
  const base = { url: 'https://example.com', headers: [], body: '' }
  assert.deepEqual(applyAuth(base, { type: 'bearer', secret: 'abc' }).headers, [{ name: 'Authorization', value: 'Bearer abc' }])
  assert.match(applyAuth(base, { type: 'api-key', placement: 'query', name: 'key', secret: '123' }).url, /key=123/)
})

test('imports a cURL request', () => {
  const result = parseCurl(`curl -X POST 'https://example.com/items' -H 'Content-Type: application/json' --data '{"name":"demo"}'`)
  assert.match(result, /^POST https:\/\/example.com\/items/)
  assert.match(result, /Content-Type: application\/json/)
  assert.match(result, /\{"name":"demo"\}$/)
})
