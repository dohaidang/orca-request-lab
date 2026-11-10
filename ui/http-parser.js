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

  while (cursor < lines.length) {
    const line = lines[cursor].trim()
    const named = line.match(/^#\s*@name\s+(.+)$/i)
    if (named) name = named[1].trim()
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
    if (!METHODS.has(method)) error = `Phương thức ${method} chưa được hỗ trợ.`
  } else if (!/^https?:\/\//i.test(requestLine)) {
    error = 'Dòng request phải có dạng: METHOD https://example.com/path'
  }
  cursor += 1

  const headers = []
  while (cursor < lines.length && lines[cursor].trim() !== '') {
    const line = lines[cursor]
    if (!line.trim().startsWith('#') && !line.trim().startsWith('//')) {
      const colon = line.indexOf(':')
      if (colon < 1) {
        error ||= `Header không hợp lệ ở dòng: ${line.trim()}`
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
    error
  }
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
