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
