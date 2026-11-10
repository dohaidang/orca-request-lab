import type { Activate, OrcaWorkerApi } from 'orca/worker'

type HeaderPair = { name: string; value: string }
type OAuth2Config = { tokenUrl: string; clientId: string; clientSecret: string; scope?: string; audience?: string }
type RequestInput = {
  requestId: string
  method: string
  url: string
  headers?: HeaderPair[]
  body?: string
  timeoutMs?: number
  cookieJar?: boolean
  maxRetries?: number
  oauth2?: OAuth2Config
}

type StoredCookie = { name: string; value: string; domain: string; path: string; secure: boolean; expires: number | null }

const MAX_RESPONSE_BYTES = 768 * 1024
const activeRequests = new Map<string, AbortController>()
const cookieJar = new Map<string, StoredCookie>()
const RETRYABLE_STATUS = new Set([429, 502, 503, 504])
const RETRYABLE_METHOD = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'])
const oauthTokenCache = new Map<string, { token: string; expiresAt: number }>()

function invalid(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'invalid_params' })
}

function isRequestInput(value: unknown): value is RequestInput {
  if (!value || typeof value !== 'object') return false
  const input = value as Record<string, unknown>
  return typeof input.requestId === 'string' && typeof input.method === 'string' && typeof input.url === 'string'
}

function classifyBody(contentType: string): 'text' | 'image' | 'binary' {
  const type = contentType.toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (
    type.startsWith('text/') ||
    type.includes('json') ||
    type.includes('xml') ||
    type.includes('javascript') ||
    type.includes('x-www-form-urlencoded')
  ) return 'text'
  return 'binary'
}

async function readLimited(response: Response): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(), truncated: false }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    const remaining = MAX_RESPONSE_BYTES - size
    if (value.byteLength > remaining) {
      if (remaining > 0) chunks.push(value.subarray(0, remaining))
      size = MAX_RESPONSE_BYTES
      truncated = true
      await reader.cancel()
      break
    }
    chunks.push(value)
    size += value.byteLength
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, truncated }
}

export async function performRequest(input: RequestInput, outerSignal?: AbortSignal) {
  const method = input.method.trim().toUpperCase()
  if (!/^[A-Z]+$/.test(method)) throw invalid('Invalid HTTP method.')

  let target: URL
  try {
    target = new URL(input.url)
  } catch {
    throw invalid('Invalid URL.')
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw invalid('Only HTTP and HTTPS URLs are supported.')
  }

  const controller = new AbortController()
  activeRequests.set(input.requestId, controller)
  const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || 30_000, 1_000), 300_000)
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  const abortFromOuter = () => controller.abort(outerSignal?.reason)
  outerSignal?.addEventListener('abort', abortFromOuter, { once: true })

  const headers = new Headers()
  for (const pair of input.headers ?? []) {
    if (!pair || typeof pair.name !== 'string' || typeof pair.value !== 'string') continue
    if (pair.name.trim()) headers.append(pair.name.trim(), pair.value.trim())
  }
  const mayHaveBody = method !== 'GET' && method !== 'HEAD'
  const started = performance.now()
  const maxRetries = RETRYABLE_METHOD.has(method) ? Math.min(Math.max(Number(input.maxRetries) || 0, 0), 3) : 0
  let attempts = 0

  try {
    if (input.oauth2 && !headers.has('authorization')) {
      headers.set('authorization', `Bearer ${await getOAuthToken(input.oauth2, controller.signal)}`)
    }
    let response: Response | undefined
    let lastError: unknown
    while (attempts <= maxRetries) {
      attempts += 1
      const attemptHeaders = new Headers(headers)
      if (input.cookieJar && !attemptHeaders.has('cookie')) {
        const cookie = cookieHeader(target)
        if (cookie) attemptHeaders.set('cookie', cookie)
      }
      try {
        response = await fetch(target, {
          method,
          headers: attemptHeaders,
          body: mayHaveBody && input.body ? input.body : undefined,
          redirect: 'follow',
          signal: controller.signal
        })
        if (input.cookieJar) storeResponseCookies(response, target)
        if (!RETRYABLE_STATUS.has(response.status) || attempts > maxRetries) break
        await response.body?.cancel()
      } catch (error) {
        lastError = error
        if (controller.signal.aborted || attempts > maxRetries) throw error
      }
      await abortableDelay(Math.min(250 * 2 ** (attempts - 1), 1_000), controller.signal)
    }
    if (!response) throw lastError ?? new Error('The request could not be sent.')
    const { bytes, truncated } = await readLimited(response)
    const elapsedMs = performance.now() - started
    const contentType = response.headers.get('content-type') ?? ''
    const bodyKind = classifyBody(contentType)
    const body = bodyKind === 'text'
      ? new TextDecoder().decode(bytes)
      : Buffer.from(bytes).toString('base64')

    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      elapsedMs: Math.round(elapsedMs * 10) / 10,
      size: bytes.byteLength,
      declaredSize: Number(response.headers.get('content-length')) || null,
      contentType,
      bodyKind,
      body,
      truncated,
      attempts,
      cookieCount: cookieJar.size,
      headers: Array.from(response.headers.entries()).map(([name, value]) => ({ name, value }))
    }
  } catch (error) {
    const cancelled = controller.signal.aborted
    return {
      ok: false,
      cancelled,
      error: cancelled
        ? (controller.signal.reason instanceof Error && controller.signal.reason.message === 'timeout'
          ? `The request timed out after ${timeoutMs} ms.`
          : 'The request was cancelled.')
        : error instanceof Error ? error.message : 'The request could not be sent.'
    }
  } finally {
    clearTimeout(timeout)
    outerSignal?.removeEventListener('abort', abortFromOuter)
    activeRequests.delete(input.requestId)
  }
}

async function getOAuthToken(config: OAuth2Config, signal: AbortSignal): Promise<string> {
  let tokenTarget: URL
  try { tokenTarget = new URL(config.tokenUrl) } catch { throw invalid('Invalid OAuth token URL.') }
  if (!['http:', 'https:'].includes(tokenTarget.protocol)) throw invalid('OAuth token URL must use HTTP or HTTPS.')
  if (!config.clientId || !config.clientSecret) throw invalid('OAuth client ID and client secret are required.')
  const cacheKey = `${tokenTarget.toString()}|${config.clientId}|${config.scope ?? ''}|${config.audience ?? ''}`
  const cached = oauthTokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token

  const body = new URLSearchParams({ grant_type: 'client_credentials' })
  if (config.scope) body.set('scope', config.scope)
  if (config.audience) body.set('audience', config.audience)
  const authorization = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
  const response = await fetch(tokenTarget, {
    method: 'POST',
    headers: { authorization: `Basic ${authorization}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
    signal
  })
  if (!response.ok) throw new Error(`OAuth token endpoint returned ${response.status}.`)
  const payload = await response.json() as { access_token?: unknown; expires_in?: unknown }
  if (typeof payload.access_token !== 'string' || !payload.access_token) throw new Error('OAuth token response has no access_token.')
  const expiresIn = Math.max(Number(payload.expires_in) || 3600, 60)
  oauthTokenCache.set(cacheKey, { token: payload.access_token, expiresAt: Date.now() + expiresIn * 1000 })
  return payload.access_token
}

function cookieHeader(target: URL): string {
  const now = Date.now()
  const matches: string[] = []
  for (const [key, cookie] of cookieJar) {
    if (cookie.expires !== null && cookie.expires <= now) { cookieJar.delete(key); continue }
    const domainMatches = target.hostname === cookie.domain || target.hostname.endsWith(`.${cookie.domain}`)
    if (domainMatches && target.pathname.startsWith(cookie.path) && (!cookie.secure || target.protocol === 'https:')) matches.push(`${cookie.name}=${cookie.value}`)
  }
  return matches.join('; ')
}

function storeResponseCookies(response: Response, target: URL) {
  const extended = response.headers as Headers & { getSetCookie?: () => string[] }
  const values = extended.getSetCookie?.() ?? (response.headers.get('set-cookie') ? [response.headers.get('set-cookie') as string] : [])
  for (const value of values) {
    const parts = value.split(';').map(part => part.trim())
    const separator = parts[0].indexOf('=')
    if (separator < 1) continue
    const cookie: StoredCookie = { name: parts[0].slice(0, separator), value: parts[0].slice(separator + 1), domain: target.hostname, path: '/', secure: false, expires: null }
    for (const attribute of parts.slice(1)) {
      const [rawName, ...rest] = attribute.split('=')
      const name = rawName.toLowerCase()
      const attributeValue = rest.join('=')
      if (name === 'domain') cookie.domain = attributeValue.replace(/^\./, '').toLowerCase()
      else if (name === 'path') cookie.path = attributeValue || '/'
      else if (name === 'secure') cookie.secure = true
      else if (name === 'max-age') cookie.expires = Date.now() + Number(attributeValue) * 1000
      else if (name === 'expires') cookie.expires = Number.isNaN(Date.parse(attributeValue)) ? null : Date.parse(attributeValue)
    }
    const key = `${cookie.name}|${cookie.domain}|${cookie.path}`
    if (!cookie.value || (cookie.expires !== null && cookie.expires <= Date.now())) cookieJar.delete(key)
    else cookieJar.set(key, cookie)
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  })
}

const activate: Activate = (orca: OrcaWorkerApi) => {
  orca.panels.handle('request.send', async (raw, context) => {
    if (!isRequestInput(raw)) throw invalid('Invalid request payload.')
    return performRequest(raw, context.signal)
  })

  orca.panels.handle('request.cancel', raw => {
    const requestId = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).requestId : undefined
    if (typeof requestId !== 'string') throw invalid('Missing requestId.')
    const controller = activeRequests.get(requestId)
    controller?.abort(new Error('cancelled'))
    return { cancelled: Boolean(controller) }
  })

  orca.panels.handle('cookies.status', () => ({ count: cookieJar.size }))
  orca.panels.handle('cookies.clear', () => { const count = cookieJar.size; cookieJar.clear(); return { cleared: count } })
}

export default activate
