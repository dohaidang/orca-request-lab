const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']

export function importOpenApi(source) {
  let document
  try { document = typeof source === 'string' ? JSON.parse(source) : source } catch { throw new Error('OpenAPI import currently requires valid JSON.') }
  if (!document || typeof document !== 'object' || !String(document.openapi ?? '').startsWith('3.')) throw new Error('Only OpenAPI 3.x documents are supported.')
  const baseUrl = document.servers?.[0]?.url || 'https://api.example.com'
  const requests = []

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of METHODS) {
      const operation = pathItem?.[method]
      if (!operation) continue
      const name = operation.summary || operation.operationId || `${method.toUpperCase()} ${path}`
      const urlPath = path.replace(/\{([^}]+)\}/g, '{{$1}}')
      const query = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]
        .filter(parameter => parameter.in === 'query' && parameter.required)
        .map(parameter => `${encodeURIComponent(parameter.name)}={{${parameter.name}}}`)
      const headers = []
      const requestContent = operation.requestBody?.content ?? {}
      const contentType = Object.keys(requestContent)[0]
      if (contentType) headers.push(`Content-Type: ${contentType}`)
      const responseContent = Object.values(operation.responses ?? {}).flatMap(response => Object.keys(response?.content ?? {}))[0]
      if (responseContent) headers.push(`Accept: ${responseContent}`)
      const bodySchema = contentType ? requestContent[contentType]?.schema : undefined
      const bodyExample = contentType ? requestContent[contentType]?.example ?? schemaExample(bodySchema) : undefined
      const successStatus = Object.keys(operation.responses ?? {}).find(status => /^2\d\d$/.test(status))
      const lines = [`# @name ${name}`]
      if (successStatus) lines.push(`# @expect status ${successStatus}`)
      lines.push(`${method.toUpperCase()} ${baseUrl}${urlPath}${query.length ? `?${query.join('&')}` : ''}`)
      if (headers.length) lines.push(...headers)
      if (bodyExample !== undefined) lines.push('', JSON.stringify(bodyExample, null, 2))
      requests.push(lines.join('\n'))
    }
  }
  if (!requests.length) throw new Error('No HTTP operations were found in the OpenAPI document.')
  return requests.join('\n\n###\n')
}

function schemaExample(schema, depth = 0) {
  if (!schema || depth > 5) return undefined
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (schema.enum?.length) return schema.enum[0]
  if (schema.type === 'object' || schema.properties) return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => [key, schemaExample(value, depth + 1)]).filter(([, value]) => value !== undefined))
  if (schema.type === 'array') return [schemaExample(schema.items, depth + 1)].filter(value => value !== undefined)
  if (schema.type === 'integer' || schema.type === 'number') return 0
  if (schema.type === 'boolean') return false
  if (schema.type === 'string') return schema.format === 'date-time' ? '2026-01-01T00:00:00Z' : schema.format === 'date' ? '2026-01-01' : 'string'
  return undefined
}

export function exportRunReport(results, format, metadata = {}) {
  const generatedAt = new Date(metadata.generatedAt ?? Date.now()).toISOString()
  if (format === 'json') return JSON.stringify({ version: 1, generatedAt, environment: metadata.environment ?? '', summary: summarize(results), results }, null, 2)
  const failures = results.filter(result => !result.passed).length
  const duration = results.reduce((sum, result) => sum + (result.elapsedMs ?? 0), 0) / 1000
  const cases = results.map(result => {
    const checks = [...(result.tests ?? []), ...(result.captures ?? [])]
    const failed = checks.filter(check => check.passed === false || check.ok === false)
    const failure = !result.passed ? `<failure message="${xmlEscape(failed[0]?.error || `HTTP ${result.status || 'error'}`)}">${xmlEscape(JSON.stringify(failed))}</failure>` : ''
    return `<testcase classname="RequestLab" name="${xmlEscape(result.name)}" time="${((result.elapsedMs ?? 0) / 1000).toFixed(3)}">${failure}</testcase>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Request Lab" tests="${results.length}" failures="${failures}" time="${duration.toFixed(3)}" timestamp="${generatedAt}">${cases}</testsuite>\n`
}

export function buildGraphqlRequest({ endpoint, operationName = '', query, variables = '' }) {
  if (!/^https?:\/\//i.test(endpoint)) throw new Error('GraphQL endpoint must be an HTTP or HTTPS URL.')
  if (!String(query).trim()) throw new Error('GraphQL query is required.')
  let parsedVariables = {}
  if (String(variables).trim()) {
    try { parsedVariables = JSON.parse(variables) } catch { throw new Error('GraphQL variables must be valid JSON.') }
  }
  const body = { query: String(query).trim(), variables: parsedVariables }
  if (operationName.trim()) body.operationName = operationName.trim()
  const name = operationName.trim() || String(query).match(/\b(query|mutation|subscription)\s+([A-Za-z_]\w*)/)?.[2] || 'GraphQL request'
  return `# @name ${name}\n# @expect status 200\n# @expect json $.data exists\nPOST ${endpoint}\nContent-Type: application/json\nAccept: application/json\n\n${JSON.stringify(body, null, 2)}`
}

export function createWorkspaceBundle({ source, environments, includeValues = false, createdAt = Date.now() }) {
  const safeEnvironments = environments.map(environment => ({
    name: String(environment.name || 'Environment'),
    variables: (environment.variables ?? []).map(variable => ({ key: String(variable.key), value: includeValues ? String(variable.value ?? '') : '' }))
  }))
  return JSON.stringify({ format: 'request-lab-workspace', version: 1, createdAt: new Date(createdAt).toISOString(), source: String(source ?? ''), environments: safeEnvironments }, null, 2)
}

export function parseWorkspaceBundle(source) {
  let bundle
  try { bundle = JSON.parse(source) } catch { throw new Error('Workspace bundle must be valid JSON.') }
  if (bundle?.format !== 'request-lab-workspace' || bundle?.version !== 1 || typeof bundle.source !== 'string' || !Array.isArray(bundle.environments)) throw new Error('Unsupported Request Lab workspace bundle.')
  return {
    source: bundle.source,
    environments: bundle.environments.map(environment => ({ name: String(environment?.name || 'Imported'), variables: Array.isArray(environment?.variables) ? environment.variables.filter(variable => variable && typeof variable.key === 'string').map(variable => ({ key: variable.key, value: String(variable.value ?? '') })) : [] }))
  }
}

function summarize(results) {
  return { total: results.length, passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length, durationMs: Math.round(results.reduce((sum, result) => sum + (result.elapsedMs ?? 0), 0) * 10) / 10 }
}

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character])
}
