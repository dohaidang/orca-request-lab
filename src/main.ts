import type { Activate, OrcaWorkerApi } from 'orca/worker'

type HeaderPair = { name: string; value: string }
type RequestInput = {
  requestId: string
  method: string
  url: string
  headers?: HeaderPair[]
  body?: string
  timeoutMs?: number
}

const MAX_RESPONSE_BYTES = 768 * 1024
const activeRequests = new Map<string, AbortController>()

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
  if (!/^[A-Z]+$/.test(method)) throw invalid('Phương thức HTTP không hợp lệ.')

  let target: URL
  try {
    target = new URL(input.url)
  } catch {
    throw invalid('URL không hợp lệ.')
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw invalid('Chỉ hỗ trợ URL HTTP và HTTPS.')
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

  try {
    const response = await fetch(target, {
      method,
      headers,
      body: mayHaveBody && input.body ? input.body : undefined,
      redirect: 'follow',
      signal: controller.signal
    })
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
      headers: Array.from(response.headers.entries()).map(([name, value]) => ({ name, value }))
    }
  } catch (error) {
    const cancelled = controller.signal.aborted
    return {
      ok: false,
      cancelled,
      error: cancelled
        ? (controller.signal.reason instanceof Error && controller.signal.reason.message === 'timeout'
          ? `Quá thời gian chờ ${timeoutMs} ms.`
          : 'Yêu cầu đã bị hủy.')
        : error instanceof Error ? error.message : 'Không thể gửi yêu cầu.'
    }
  } finally {
    clearTimeout(timeout)
    outerSignal?.removeEventListener('abort', abortFromOuter)
    activeRequests.delete(input.requestId)
  }
}

const activate: Activate = (orca: OrcaWorkerApi) => {
  orca.panels.handle('request.send', async (raw, context) => {
    if (!isRequestInput(raw)) throw invalid('Dữ liệu request không hợp lệ.')
    return performRequest(raw, context.signal)
  })

  orca.panels.handle('request.cancel', raw => {
    const requestId = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).requestId : undefined
    if (typeof requestId !== 'string') throw invalid('Thiếu requestId.')
    const controller = activeRequests.get(requestId)
    controller?.abort(new Error('cancelled'))
    return { cancelled: Boolean(controller) }
  })
}

export default activate
