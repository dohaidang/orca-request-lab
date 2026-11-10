export function resolveVariables(value, variables = {}, dynamic = {}) {
  const missing = new Set()
  const builtins = {
    '$timestamp': String(dynamic.timestamp ?? Math.floor(Date.now() / 1000)),
    '$randomUUID': dynamic.randomUUID ?? crypto.randomUUID()
  }
  const resolved = String(value ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key) => {
    const name = key.trim()
    if (Object.prototype.hasOwnProperty.call(builtins, name)) return builtins[name]
    if (Object.prototype.hasOwnProperty.call(variables, name)) return String(variables[name])
    missing.add(name)
    return match
  })
  return { value: resolved, missing: [...missing] }
}

export function resolveRequest(request, variables) {
  const missing = new Set()
  const dynamic = { timestamp: Math.floor(Date.now() / 1000), randomUUID: crypto.randomUUID() }
  const resolve = value => {
    const result = resolveVariables(value, variables, dynamic)
    result.missing.forEach(name => missing.add(name))
    return result.value
  }
  return {
    request: {
      ...request,
      url: resolve(request.url),
      headers: request.headers.map(header => ({ name: resolve(header.name), value: resolve(header.value) })),
      body: resolve(request.body)
    },
    missing: [...missing]
  }
}

export function applyAuth(request, auth) {
  const headers = request.headers.filter(header => header.name.trim())
  const next = { ...request, headers: [...headers] }
  if (!auth || auth.type === 'none') return next

  if (auth.type === 'bearer' && auth.secret) {
    upsertHeader(next.headers, 'Authorization', `Bearer ${auth.secret}`)
  } else if (auth.type === 'basic') {
    const encoded = btoa(unescape(encodeURIComponent(`${auth.username ?? ''}:${auth.secret ?? ''}`)))
    upsertHeader(next.headers, 'Authorization', `Basic ${encoded}`)
  } else if (auth.type === 'api-key' && auth.name && auth.secret) {
    if (auth.placement === 'query') {
      const target = new URL(next.url)
      target.searchParams.set(auth.name, auth.secret)
      next.url = target.toString()
    } else {
      upsertHeader(next.headers, auth.name, auth.secret)
    }
  }
  return next
}

function upsertHeader(headers, name, value) {
  const existing = headers.find(header => header.name.toLowerCase() === name.toLowerCase())
  if (existing) existing.value = value
  else headers.push({ name, value })
}

export function parseCurl(command) {
  const tokens = tokenize(command.trim())
  if (!tokens.length || tokens[0].toLowerCase() !== 'curl') throw new Error('The command must start with curl.')
  let method = ''
  let url = ''
  let body = ''
  const headers = []

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '-X' || token === '--request') method = requireValue(tokens, ++index, token).toUpperCase()
    else if (token === '-H' || token === '--header') {
      const header = requireValue(tokens, ++index, token)
      const colon = header.indexOf(':')
      if (colon < 1) throw new Error(`Invalid header: ${header}`)
      headers.push({ name: header.slice(0, colon).trim(), value: header.slice(colon + 1).trim() })
    } else if (['-d', '--data', '--data-raw', '--data-binary'].includes(token)) {
      body = requireValue(tokens, ++index, token)
    } else if (token === '--url') url = requireValue(tokens, ++index, token)
    else if (!token.startsWith('-') && !url) url = token
  }
  if (!url) throw new Error('The cURL command does not contain a URL.')
  method ||= body ? 'POST' : 'GET'
  const headerText = headers.map(header => `${header.name}: ${header.value}`).join('\n')
  return `${method} ${url}${headerText ? `\n${headerText}` : ''}${body ? `\n\n${body}` : ''}`
}

function requireValue(tokens, index, option) {
  if (index >= tokens.length) throw new Error(`Missing value after ${option}.`)
  return tokens[index]
}

function tokenize(source) {
  const tokens = []
  let current = ''
  let quote = ''
  let escaped = false
  for (const char of source) {
    if (escaped) {
      current += char
      escaped = false
    } else if (char === '\\' && quote !== "'") {
      escaped = true
    } else if (quote) {
      if (char === quote) quote = ''
      else current += char
    } else if (char === '"' || char === "'") quote = char
    else if (/\s/.test(char)) {
      if (current) { tokens.push(current); current = '' }
    } else current += char
  }
  if (quote) throw new Error('The cURL command has an unclosed quote.')
  if (current) tokens.push(current)
  return tokens
}
