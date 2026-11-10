const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'])

export function parseRequests(source) {
  const normalized = String(source ?? '').replace(/\r\n?/g, '\n')
  const sections = normalized.split(/^\s*###(?:\s+(.*))?\s*$/m)
  const requests = []

  for (let index = 0; index < sections.length; index += 2) {
    const text = sections[index]
    const separatorTitle = index > 0 ? String(sections[index - 1] ?? '').trim() : ''
    const parsed = parseSection(text, separatorTitle)
    if (parsed) requests.push(parsed)
  }
  return requests
}

function parseSection(text, separatorTitle) {
  const lines = text.split('\n')
  let cursor = 0
  let name = separatorTitle
  const assertions = []
  const captures = []
  const runtime = { timeoutMs: null, retries: null, cookies: null }

  while (cursor < lines.length) {
    const line = lines[cursor].trim()
    const named = line.match(/^#\s*@name\s+(.+)$/i)
    if (named) name = named[1].trim()
    const expected = line.match(/^#\s*@expect\s+(.+)$/i)
    if (expected) {
      const assertion = parseAssertion(expected[1].trim())
      if (assertion) assertions.push(assertion)
    }
    const captured = line.match(/^#\s*@capture\s+([A-Za-z_][\w.-]*)\s+(\$[^\s]*)$/i)
    if (captured) captures.push({ name: captured[1], path: captured[2] })
    const timeout = line.match(/^#\s*@timeout\s+(\d+)(ms|s)?$/i)
    if (timeout) runtime.timeoutMs = Number(timeout[1]) * (timeout[2]?.toLowerCase() === 's' ? 1000 : 1)
    const retries = line.match(/^#\s*@retry\s+([0-3])$/i)
    if (retries) runtime.retries = Number(retries[1])
    const cookies = line.match(/^#\s*@cookies\s+(on|off)$/i)
    if (cookies) runtime.cookies = cookies[1].toLowerCase() === 'on'
    if (line && !line.startsWith('#') && !line.startsWith('//')) break
    cursor += 1
  }
  if (cursor >= lines.length) return null

  const requestLine = lines[cursor].trim()
  const match = requestLine.match(/^([A-Za-z]+)\s+(\S+?)(?:\s+HTTP\/\d(?:\.\d)?)?$/)
  let method = 'GET'
  let url = requestLine
  let error = ''
  if (match) {
    method = match[1].toUpperCase()
    url = match[2]
    if (!METHODS.has(method)) error = `Method ${method} is not supported.`
  } else if (!/^https?:\/\//i.test(requestLine)) {
    error = 'Use this request-line format: METHOD https://example.com/path'
  }
  cursor += 1

  const headers = []
  while (cursor < lines.length && lines[cursor].trim() !== '') {
    const line = lines[cursor]
    if (!line.trim().startsWith('#') && !line.trim().startsWith('//')) {
      const colon = line.indexOf(':')
      if (colon < 1) {
        error ||= `Invalid header line: ${line.trim()}`
      } else {
        headers.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() })
      }
    }
    cursor += 1
  }
  while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1

  const body = lines.slice(cursor).join('\n').trimEnd()
  return {
    id: `${method}-${url}-${name}-${text.length}`,
    name: name || `${method} ${shortUrl(url)}`,
    method,
    url,
    headers,
    body,
    assertions,
    captures,
    runtime,
    error
  }
}

function parseAssertion(source) {
  const status = source.match(/^status\s+(\d{3})$/i)
  if (status) return { type: 'status', expected: Number(status[1]), label: `Status is ${status[1]}` }
  const header = source.match(/^header\s+(\S+)\s+(equals|contains|exists)(?:\s+(.+))?$/i)
  if (header) return { type: 'header', key: header[1], operator: header[2].toLowerCase(), expected: header[3] ?? '', label: `${header[1]} ${header[2].toLowerCase()}${header[3] ? ` ${header[3]}` : ''}` }
  const json = source.match(/^json\s+(\$[^\s]*)\s+(equals|contains|exists)(?:\s+(.+))?$/i)
  if (json) return { type: 'json', path: json[1], operator: json[2].toLowerCase(), expected: json[3] ?? '', label: `${json[1]} ${json[2].toLowerCase()}${json[3] ? ` ${json[3]}` : ''}` }
  const body = source.match(/^body\s+(contains|equals)\s+(.+)$/i)
  if (body) return { type: 'body', operator: body[1].toLowerCase(), expected: body[2], label: `Body ${body[1].toLowerCase()} ${body[2]}` }
  return { type: 'invalid', label: source }
}

function shortUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.pathname === '/' ? parsed.hostname : parsed.pathname
  } catch {
    return url.length > 34 ? `${url.slice(0, 31)}…` : url
  }
}

export function formatBody(text, contentType = '') {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return ''
  if (contentType.toLowerCase().includes('json') || /^[\[{]/.test(trimmed)) {
    try { return JSON.stringify(JSON.parse(trimmed), null, 2) } catch { /* keep source */ }
  }
  if (contentType.toLowerCase().includes('xml') || trimmed.startsWith('<')) {
    return formatXml(trimmed)
  }
  return text
}

function formatXml(xml) {
  const source = xml.replace(/>\s*</g, '><').replace(/</g, '\n<').trim()
  let depth = 0
  return source.split('\n').map(token => {
    if (/^<\//.test(token)) depth = Math.max(0, depth - 1)
    const line = `${'  '.repeat(depth)}${token}`
    if (/^<[^!?/][^>]*[^/]>/i.test(token) && !/<\/[^>]+>$/.test(token)) depth += 1
    return line
  }).join('\n')
}
