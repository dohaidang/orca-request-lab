import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { performRequest } from './main'

test('performs a local HTTP request and returns response metadata', async t => {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ method: request.method, ok: true }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing server address')

  const result = await performRequest({
    requestId: 'test-local',
    method: 'GET',
    url: `http://127.0.0.1:${address.port}/health`
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.status, 200)
  assert.equal(result.bodyKind, 'text')
  assert.match(result.body, /"ok":true/)
})

test('rejects non-HTTP protocols', async () => {
  await assert.rejects(
    () => performRequest({ requestId: 'bad-url', method: 'GET', url: 'file:///secret' }),
    /Only HTTP and HTTPS URLs are supported/
  )
})

test('retries transient failures for idempotent requests', async t => {
  let attempts = 0
  const server = http.createServer((_request, response) => {
    attempts += 1
    response.statusCode = attempts === 1 ? 503 : 200
    response.end('ok')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing server address')
  const result = await performRequest({ requestId: 'retry', method: 'GET', url: `http://127.0.0.1:${address.port}/`, maxRetries: 1 })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.attempts, 2)
})

test('keeps cookies in the in-memory cookie jar', async t => {
  const server = http.createServer((request, response) => {
    if (request.url === '/login') response.setHeader('set-cookie', 'session=abc; Path=/; HttpOnly')
    response.setHeader('content-type', 'text/plain')
    response.end(request.headers.cookie ?? 'set')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing server address')
  const base = `http://127.0.0.1:${address.port}`
  await performRequest({ requestId: 'cookie-set', method: 'GET', url: `${base}/login`, cookieJar: true })
  const result = await performRequest({ requestId: 'cookie-read', method: 'GET', url: `${base}/profile`, cookieJar: true })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.body, 'session=abc')
})

test('gets and caches OAuth client-credentials tokens', async t => {
  let tokenRequests = 0
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url === '/token') {
      tokenRequests += 1
      response.end(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }))
      return
    }
    response.statusCode = request.headers.authorization === 'Bearer test-token' ? 200 : 401
    response.end(JSON.stringify({ authorized: response.statusCode === 200 }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing server address')
  const base = `http://127.0.0.1:${address.port}`
  const oauth2 = { tokenUrl: `${base}/token`, clientId: 'client', clientSecret: 'secret' }
  const first = await performRequest({ requestId: 'oauth-one', method: 'GET', url: `${base}/resource`, oauth2 })
  const second = await performRequest({ requestId: 'oauth-two', method: 'GET', url: `${base}/resource`, oauth2 })
  assert.equal(first.ok && first.status, 200)
  assert.equal(second.ok && second.status, 200)
  assert.equal(tokenRequests, 1)
})
