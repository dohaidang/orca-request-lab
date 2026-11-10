import assert from 'node:assert/strict'
import test from 'node:test'
import { formatBody, parseRequests } from './http-parser.js'

test('parses multiple requests with headers and body', () => {
  const requests = parseRequests(`# @name Read item
GET https://example.com/items/1
Accept: application/json

### Create item
POST https://example.com/items
Content-Type: application/json

{"name":"demo"}`)
  assert.equal(requests.length, 2)
  assert.equal(requests[0].name, 'Read item')
  assert.deepEqual(requests[0].headers, [{ name: 'Accept', value: 'application/json' }])
  assert.equal(requests[1].method, 'POST')
  assert.equal(requests[1].body, '{"name":"demo"}')
})

test('accepts an URL-only request as GET', () => {
  const [request] = parseRequests('https://example.com/status')
  assert.equal(request.method, 'GET')
  assert.equal(request.url, 'https://example.com/status')
  assert.equal(request.error, '')
})

test('formats JSON response bodies', () => {
  assert.equal(formatBody('{"ok":true}', 'application/json'), '{\n  "ok": true\n}')
})

test('parses assertions and response captures', () => {
  const [request] = parseRequests(`# @name Create session
# @expect status 201
# @expect header content-type contains application/json
# @expect json $.token exists
# @capture accessToken $.token
POST https://example.com/session`)
  assert.equal(request.assertions.length, 3)
  assert.deepEqual(request.captures, [{ name: 'accessToken', path: '$.token' }])
  assert.equal(request.assertions[0].expected, 201)
})
