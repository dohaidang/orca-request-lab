import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAuth, evaluateAssertions, extractCaptures, generateCode, getJsonPath, parseCurl, redactHistoryRequest, resolveRequest, resolveVariables } from './request-tools.js'

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

test('evaluates status, header, body, and JSON assertions', () => {
  const response = {
    status: 200,
    body: '{"item":{"id":7},"tags":["ready"]}',
    headers: [{ name: 'content-type', value: 'application/json; charset=utf-8' }]
  }
  const results = evaluateAssertions(response, [
    { type: 'status', expected: 200, label: 'status' },
    { type: 'header', key: 'content-type', operator: 'contains', expected: 'application/json', label: 'header' },
    { type: 'json', path: '$.item.id', operator: 'equals', expected: '7', label: 'json' },
    { type: 'body', operator: 'contains', expected: 'ready', label: 'body' }
  ])
  assert.equal(results.every(result => result.passed), true)
})

test('captures values from JSON responses', () => {
  const [capture] = extractCaptures({ body: '{"session":{"token":"abc"}}' }, [{ name: 'token', path: '$.session.token' }])
  assert.deepEqual(capture, { name: 'token', path: '$.session.token', ok: true, value: 'abc' })
  assert.equal(getJsonPath({ items: [{ id: 4 }] }, '$.items[0].id'), 4)
})

test('generates cURL, JavaScript, and Python snippets', () => {
  const request = { method: 'POST', url: 'https://example.com/items', headers: [{ name: 'Content-Type', value: 'application/json' }], body: '{"ok":true}' }
  assert.match(generateCode(request, 'curl'), /curl -X POST/)
  assert.match(generateCode(request, 'javascript'), /await fetch/)
  assert.match(generateCode(request, 'python'), /requests\.request/)
})

test('redacts sensitive history data and omits bodies by default', () => {
  const result = redactHistoryRequest({ url: 'https://example.com?api_key=secret&view=full', headers: [{ name: 'Authorization', value: 'Bearer secret' }, { name: 'Accept', value: 'application/json' }], body: '{"password":"secret"}' })
  assert.match(result.url, /api_key=%5BREDACTED%5D/)
  assert.equal(result.headers[0].value, '[REDACTED]')
  assert.equal(result.headers[1].value, 'application/json')
  assert.equal(result.body, '')
})
