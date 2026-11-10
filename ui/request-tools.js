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

export function evaluateAssertions(response, assertions = []) {
  return assertions.map(assertion => {
    let actual
    let passed = false
    let error = ''
    try {
      if (assertion.type === 'status') {
        actual = response.status
        passed = actual === assertion.expected
      } else if (assertion.type === 'header') {
        actual = response.headers?.find(header => header.name.toLowerCase() === assertion.key.toLowerCase())?.value
        passed = compare(actual, assertion.operator, assertion.expected)
      } else if (assertion.type === 'body') {
        actual = response.body
        passed = compare(actual, assertion.operator, assertion.expected)
      } else if (assertion.type === 'json') {
        actual = getJsonPath(JSON.parse(response.body), assertion.path)
        passed = compare(actual, assertion.operator, parseExpected(assertion.expected))
      } else {
        error = 'Invalid assertion syntax.'
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Assertion failed.'
    }
    return { ...assertion, passed, actual: serializable(actual), error }
  })
}

export function extractCaptures(response, captures = []) {
  let json
  try { json = JSON.parse(response.body) } catch { return captures.map(capture => ({ ...capture, ok: false, error: 'Response is not valid JSON.' })) }
  return captures.map(capture => {
    try {
      const value = getJsonPath(json, capture.path)
      return value === undefined
        ? { ...capture, ok: false, error: `Path ${capture.path} was not found.` }
        : { ...capture, ok: true, value: typeof value === 'string' ? value : JSON.stringify(value) }
    } catch (error) {
      return { ...capture, ok: false, error: error instanceof Error ? error.message : 'Capture failed.' }
    }
  })
}

export function generateCode(request, language) {
  const headers = Object.fromEntries(request.headers.map(header => [header.name, header.value]))
  if (language === 'curl') {
    const parts = [`curl -X ${request.method} ${shellQuote(request.url)}`]
    request.headers.forEach(header => parts.push(`  -H ${shellQuote(`${header.name}: ${header.value}`)}`))
    if (request.body) parts.push(`  --data-raw ${shellQuote(request.body)}`)
    return parts.join(' \\\n')
  }
  if (language === 'python') {
    const options = []
    if (Object.keys(headers).length) options.push(`headers=${JSON.stringify(headers, null, 2)}`)
    if (request.body) options.push(`data=${JSON.stringify(request.body)}`)
    const suffix = options.length ? `,\n    ${options.join(',\n    ')}` : ''
    return `import requests\n\nresponse = requests.request(\n    ${JSON.stringify(request.method)},\n    ${JSON.stringify(request.url)}${suffix}\n)\n\nprint(response.status_code)\nprint(response.text)`
  }
  const options = { method: request.method }
  if (Object.keys(headers).length) options.headers = headers
  if (request.body) options.body = request.body
  return `const response = await fetch(${JSON.stringify(request.url)}, ${JSON.stringify(options, null, 2)})\n\nconsole.log(response.status)\nconsole.log(await response.text())`
}

export function getJsonPath(value, path) {
  if (path === '$') return value
  if (!path.startsWith('$.') && !path.startsWith('$[')) throw new Error(`Invalid JSON path: ${path}`)
  const tokens = []
  path.replace(/\.([A-Za-z_$][\w$-]*)|\[(\d+)\]|\[['"]([^'"]+)['"]\]/g, (_, property, index, quoted) => {
    tokens.push(property ?? quoted ?? Number(index))
    return ''
  })
  let current = value
  for (const token of tokens) {
    if (current == null || !Object.prototype.hasOwnProperty.call(Object(current), token)) return undefined
    current = current[token]
  }
  return current
}

function compare(actual, operator, expected) {
  if (operator === 'exists') return actual !== undefined && actual !== null
  if (operator === 'contains') return typeof actual === 'string'
    ? actual.includes(String(expected))
    : Array.isArray(actual) ? actual.some(item => Object.is(item, expected)) : false
  return typeof actual === 'object' || typeof expected === 'object'
    ? JSON.stringify(actual) === JSON.stringify(expected)
    : String(actual) === String(expected)
}

function parseExpected(value) {
  if (value === '') return ''
  try { return JSON.parse(value) } catch { return value }
}

function serializable(value) {
  if (value === undefined) return null
  try { return JSON.parse(JSON.stringify(value)) } catch { return String(value) }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`
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
