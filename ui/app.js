import { formatBody, parseRequests } from './http-parser.js'
import { applyAuth, evaluateAssertions, extractCaptures, generateCode, parseCurl, resolveRequest } from './request-tools.js'

const isEditor = document.documentElement.dataset.mode === 'editor'
const sample = `# @name Read a sample post
GET {{baseUrl}}/posts/1
Accept: application/json

### Create a post
POST {{baseUrl}}/posts
Content-Type: application/json
X-Request-Id: {{$randomUUID}}

{
  "title": "Request Lab",
  "body": "Send requests without leaving Orca",
  "userId": 1
}`

const defaultEnvironment = {
  id: 'development',
  name: 'Development',
  variables: [{ key: 'baseUrl', value: 'https://jsonplaceholder.typicode.com' }]
}

const state = {
  source: sample,
  requests: [],
  selected: 0,
  response: null,
  responseTab: 'body',
  running: false,
  activeRequestId: '',
  session: null,
  environments: [defaultEnvironment],
  activeEnvironmentId: defaultEnvironment.id,
  auth: { type: 'none', username: '', name: 'X-API-Key', placement: 'header', secret: '' },
  history: [],
  runResults: [],
  collectionRunning: false,
  collectionAbort: false,
  drawer: ''
}

const app = document.querySelector('#app')
app.innerHTML = `
  <main class="workbench">
    <header class="topbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true">RL</span><div><strong>Request Lab</strong><span>${isEditor ? 'FILE WORKBENCH' : 'QUICK WORKBENCH'} · V0.2</span></div></div>
      <div class="top-actions">
        <label class="environment-control"><span>ENV</span><select id="environment-select" aria-label="Active environment"></select></label>
        <button class="tool-button" data-drawer="environment" type="button">Variables</button>
        <button class="tool-button" data-drawer="auth" type="button"><span id="auth-indicator" class="tool-dot"></span>Auth</button>
        <button class="tool-button" data-drawer="history" type="button">History <span id="history-count" class="count-badge">0</span></button>
        <button class="tool-button" data-drawer="curl" type="button">Import cURL</button>
        <button class="tool-button" data-drawer="code" type="button">Generate code</button>
        <button id="run-all" class="button run-all" type="button"><span>▶▶</span> Run all</button>
        <button class="tool-button" data-drawer="results" type="button">Results <span id="results-count" class="count-badge">0</span></button>
        <label class="timeout-label">Timeout <input id="timeout" type="number" min="1" max="300" value="30" aria-label="Timeout in seconds"><span>s</span></label>
        <button id="clear" class="button ghost" type="button">Clear</button>
      </div>
    </header>
    <section class="request-strip" aria-label="Requests">
      <div id="requests" class="request-tabs"></div>
      <div class="strip-hint"><kbd>Ctrl</kbd><span>+</span><kbd>Enter</kbd></div>
    </section>
    <section class="split">
      <article class="pane request-pane">
        <div class="pane-heading"><div><span class="eyebrow">REQUEST</span><h1 id="request-title">No request</h1></div><span id="parse-state" class="parse-state">READY</span></div>
        <textarea id="source" spellcheck="false" aria-label="HTTP file contents"></textarea>
        <footer class="actionbar">
          <div class="request-meta"><span id="method-chip" class="method-chip">GET</span><span id="target-url">—</span></div>
          <div class="send-actions">
            <button id="cancel" class="button danger hidden" type="button">Cancel</button>
            <button id="send" class="button primary" type="button"><span class="send-icon">▶</span><span>Send request</span></button>
          </div>
        </footer>
      </article>
      <article class="pane response-pane">
        <div class="response-head">
          <div class="response-title"><span class="eyebrow">RESPONSE</span><div id="response-metrics" class="metrics"><span class="metric muted">Not sent</span></div></div>
          <div class="response-tabs" role="tablist">
            <button class="response-tab active" data-tab="body" role="tab" type="button">Body</button>
            <button class="response-tab" data-tab="headers" role="tab" type="button">Headers</button>
            <button class="response-tab" data-tab="tests" role="tab" type="button">Tests <span id="test-count" class="test-count">0</span></button>
          </div>
        </div>
        <div id="response-view" class="response-view empty-state"></div>
      </article>
    </section>
    <aside id="drawer" class="drawer" aria-hidden="true">
      <div class="drawer-head"><div><span class="eyebrow">REQUEST LAB / CONFIG</span><h2 id="drawer-title">Configuration</h2></div><button id="drawer-close" class="icon-button" type="button" aria-label="Close panel">×</button></div>
      <div id="drawer-content" class="drawer-content"></div>
    </aside>
    <div id="scrim" class="scrim"></div>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
  </main>`

const elements = Object.fromEntries([
  'source', 'requests', 'request-title', 'parse-state', 'method-chip', 'target-url', 'send', 'cancel', 'clear',
  'timeout', 'response-metrics', 'response-view', 'toast', 'environment-select', 'history-count', 'auth-indicator',
  'drawer', 'drawer-title', 'drawer-content', 'drawer-close', 'scrim', 'run-all', 'results-count', 'test-count'
].map(id => [id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), document.querySelector(`#${id}`)]))

function activeEnvironment() {
  return state.environments.find(environment => environment.id === state.activeEnvironmentId) ?? state.environments[0]
}

function environmentValues() {
  return Object.fromEntries((activeEnvironment()?.variables ?? []).filter(item => item.key).map(item => [item.key, item.value]))
}

function refreshRequests({ preserveSelection = true } = {}) {
  const previousId = preserveSelection ? state.requests[state.selected]?.id : ''
  state.source = elements.source.value
  state.requests = parseRequests(state.source)
  const matched = state.requests.findIndex(item => item.id === previousId)
  state.selected = matched >= 0 ? matched : Math.min(state.selected, Math.max(0, state.requests.length - 1))
  renderTabs()
  renderRequestMeta()
}

function renderTabs() {
  elements.requests.replaceChildren(...state.requests.map((request, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `request-tab${index === state.selected ? ' active' : ''}`
    button.setAttribute('aria-pressed', String(index === state.selected))
    const run = [...state.runResults].reverse().find(item => item.requestId === request.id)
    button.innerHTML = `<span class="tab-method method-${escapeText(request.method)}">${escapeText(request.method)}</span><span>${escapeText(request.name)}</span>${request.error ? '<i aria-label="Invalid request">!</i>' : run ? `<b class="run-signal ${run.passed ? 'passed' : 'failed'}" aria-label="${run.passed ? 'Passed' : 'Failed'}"></b>` : ''}`
    button.addEventListener('click', () => { state.selected = index; renderTabs(); renderRequestMeta() })
    return button
  }))
  if (!state.requests.length) {
    const empty = document.createElement('span')
    empty.className = 'no-requests'
    empty.textContent = 'No requests found'
    elements.requests.append(empty)
  }
}

function renderRequestMeta() {
  const request = state.requests[state.selected]
  if (!request) {
    elements.requestTitle.textContent = 'No request'
    elements.methodChip.textContent = '—'
    elements.targetUrl.textContent = 'Add METHOD and URL to begin'
    elements.parseState.textContent = 'EMPTY'
    elements.parseState.className = 'parse-state warning'
    elements.send.disabled = true
    return
  }
  elements.requestTitle.textContent = request.name
  elements.methodChip.textContent = request.method
  elements.targetUrl.textContent = request.url
  elements.targetUrl.title = request.url
  const unresolved = resolveRequest(request, environmentValues()).missing
  const invalid = Boolean(request.error || unresolved.length)
  elements.parseState.textContent = request.error ? 'CHECK' : unresolved.length ? `${unresolved.length} VAR` : 'VALID'
  elements.parseState.className = `parse-state${invalid ? ' warning' : ''}`
  elements.parseState.title = unresolved.length ? `Missing: ${unresolved.join(', ')}` : ''
  elements.send.disabled = invalid || state.running
}

async function sendRequest() {
  const template = state.requests[state.selected]
  if (!template || template.error || state.running) return
  state.running = true
  setRunning(true)
  try {
    const result = await executeTemplate(template)
    if (!result) return
    state.response = result
    state.responseTab = 'body'
    syncResponseTabs()
    renderResponse()
    await recordHistory(template, result)
    recordRunResult(template, result)
    renderTabs()
  } catch (error) {
    state.response = { ok: false, error: error instanceof Error ? error.message : 'The worker did not respond.' }
    renderResponse()
  } finally {
    state.running = false
    state.activeRequestId = ''
    setRunning(false)
  }
}

async function executeTemplate(template) {
  const resolved = resolveRequest(template, environmentValues())
  if (resolved.missing.length) {
    showToast(`Missing variables: ${resolved.missing.join(', ')}`)
    if (!state.collectionRunning) openDrawer('environment')
    return null
  }
  const request = applyAuth(resolved.request, state.auth)
  state.activeRequestId = crypto.randomUUID()
  const result = await orca.plugin.request('request.send', {
    requestId: state.activeRequestId,
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: request.body,
    timeoutMs: Number(elements.timeout.value) * 1000
  }, { timeoutMs: Math.min(310_000, Number(elements.timeout.value) * 1000 + 10_000) })
  const tests = result.ok ? evaluateAssertions(result, template.assertions) : []
  const captures = result.ok ? extractCaptures(result, template.captures) : []
  if (captures.some(capture => capture.ok)) await applyCapturedVariables(captures)
  return { ...result, tests, captures }
}

async function applyCapturedVariables(captures) {
  const environment = activeEnvironment()
  for (const capture of captures.filter(item => item.ok)) {
    const existing = environment.variables.find(variable => variable.key === capture.name)
    if (existing) existing.value = capture.value
    else environment.variables.push({ key: capture.name, value: capture.value })
  }
  await persistEnvironments()
  renderRequestMeta()
}

function recordRunResult(template, result) {
  const testsPassed = (result.tests ?? []).every(test => test.passed)
  const capturesPassed = (result.captures ?? []).every(capture => capture.ok)
  state.runResults.push({
    id: crypto.randomUUID(), requestId: template.id, name: template.name, method: template.method,
    status: result.ok ? result.status : 0, elapsedMs: result.ok ? result.elapsedMs : null,
    passed: Boolean(result.ok && testsPassed && capturesPassed), tests: result.tests ?? [], captures: result.captures ?? []
  })
  state.runResults = state.runResults.slice(-100)
  elements.resultsCount.textContent = String(state.runResults.length)
  elements.testCount.textContent = String((result.tests ?? []).length)
}

async function runAllRequests() {
  if (state.running || state.collectionRunning || !state.requests.length) return
  state.collectionRunning = true
  state.collectionAbort = false
  state.runResults = []
  elements.resultsCount.textContent = '0'
  elements.runAll.classList.add('loading')
  elements.runAll.innerHTML = '<span>■</span> Stop run'
  elements.runAll.disabled = false

  try {
    for (const template of state.requests) {
      if (state.collectionAbort) break
      if (template.error) {
        recordRunResult(template, { ok: false, tests: [], captures: [] })
        continue
      }
      state.running = true
      setRunning(true)
      let result
      try { result = await executeTemplate(template) }
      catch (error) { result = { ok: false, error: error instanceof Error ? error.message : 'Request failed.', tests: [], captures: [] } }
      if (!result) {
        recordRunResult(template, { ok: false, tests: [], captures: [] })
        break
      }
      recordRunResult(template, result)
      await recordHistory(template, result)
      state.response = result
      renderTabs()
    }
  } finally {
    state.running = false
    state.collectionRunning = false
    state.activeRequestId = ''
    setRunning(false)
    elements.runAll.classList.remove('loading')
    elements.runAll.innerHTML = '<span>▶▶</span> Run all'
    openDrawer('results')
  }
}

async function cancelRequest() {
  if (!state.activeRequestId) return
  state.collectionAbort = true
  elements.cancel.disabled = true
  try { await orca.plugin.request('request.cancel', { requestId: state.activeRequestId }) }
  catch { showToast('Could not send the cancel command.') }
}

function setRunning(running) {
  elements.send.classList.toggle('loading', running)
  elements.send.querySelector('span:last-child').textContent = running ? 'Sending…' : (state.response ? 'Resend' : 'Send request')
  elements.send.disabled = running
  elements.cancel.classList.toggle('hidden', !running)
  elements.cancel.disabled = false
  elements.parseState.textContent = running ? 'SENDING' : (state.requests[state.selected]?.error ? 'CHECK' : 'VALID')
  if (!running) renderRequestMeta()
}

function renderResponse() {
  const response = state.response
  if (!response) {
    elements.testCount.textContent = '0'
    elements.responseMetrics.innerHTML = '<span class="metric muted">Not sent</span>'
    elements.responseView.className = 'response-view empty-state'
    elements.responseView.innerHTML = '<div class="pulse-mark"><span></span><span></span><span></span></div><h2>Waiting for a signal</h2><p>Select a request and send it. The response will appear here.</p>'
    return
  }
  if (!response.ok) {
    elements.testCount.textContent = '0'
    elements.responseMetrics.innerHTML = '<span class="metric status error">ERROR</span>'
    elements.responseView.className = 'response-view error-state'
    elements.responseView.innerHTML = `<div class="error-code">×</div><h2>${response.cancelled ? 'Request stopped' : 'Connection failed'}</h2><p>${escapeText(response.error || 'An unknown error occurred.')}</p>`
    return
  }
  const statusClass = response.status >= 200 && response.status < 300 ? 'success' : response.status >= 400 ? 'error' : 'warning'
  elements.responseMetrics.innerHTML = `<span class="metric status ${statusClass}">${response.status} ${escapeText(response.statusText)}</span><span class="metric">${formatDuration(response.elapsedMs)}</span><span class="metric">${formatBytes(response.declaredSize || response.size)}</span>${response.truncated ? '<span class="metric warning">Truncated</span>' : ''}`
  elements.responseView.className = 'response-view'
  elements.testCount.textContent = String((response.tests ?? []).length)

  if (state.responseTab === 'tests') {
    elements.responseView.innerHTML = renderTestReport(response.tests ?? [], response.captures ?? [])
  } else if (state.responseTab === 'headers') {
    const rows = response.headers.map(header => `<div class="header-row"><strong>${escapeText(header.name)}</strong><span>${escapeText(header.value)}</span></div>`).join('')
    elements.responseView.innerHTML = `<div class="headers-table">${rows || '<p>No response headers.</p>'}</div>`
  } else if (response.bodyKind === 'image') {
    elements.responseView.innerHTML = `<div class="image-result"><img src="data:${escapeText(response.contentType.split(';')[0] || 'image/png')};base64,${response.body}" alt="Response image"><p>${escapeText(response.contentType)} · ${formatBytes(response.size)}</p></div>`
  } else if (response.bodyKind === 'binary') {
    elements.responseView.innerHTML = `<div class="binary-result"><span>01</span><h2>Binary response</h2><p>${escapeText(response.contentType || 'application/octet-stream')} · ${formatBytes(response.size)}</p></div>`
  } else {
    elements.responseView.innerHTML = `<pre><code>${escapeText(formatBody(response.body, response.contentType) || '(empty body)')}</code></pre>`
  }
}

function renderTestReport(tests, captures) {
  if (!tests.length && !captures.length) return '<div class="empty-state"><div class="test-orbit">T</div><h2>No checks declared</h2><p>Add <code># @expect</code> or <code># @capture</code> directives before the request line.</p></div>'
  const testRows = tests.map(test => `<div class="check-row ${test.passed ? 'passed' : 'failed'}"><span>${test.passed ? '✓' : '×'}</span><div><strong>${escapeText(test.label)}</strong><small>${test.error ? escapeText(test.error) : `Actual: ${escapeText(JSON.stringify(test.actual))}`}</small></div></div>`).join('')
  const captureRows = captures.map(capture => `<div class="check-row ${capture.ok ? 'passed' : 'failed'}"><span>${capture.ok ? '↳' : '×'}</span><div><strong>Capture ${escapeText(capture.name)} from ${escapeText(capture.path)}</strong><small>${capture.ok ? `Saved: ${escapeText(capture.value)}` : escapeText(capture.error)}</small></div></div>`).join('')
  const passed = tests.filter(test => test.passed).length + captures.filter(capture => capture.ok).length
  return `<div class="test-report"><div class="test-summary"><span>${passed}/${tests.length + captures.length}</span><div><strong>Checks passed</strong><small>Assertions and captured variables</small></div></div>${testRows}${captureRows}</div>`
}

async function recordHistory(request, response) {
  const entry = {
    id: crypto.randomUUID(),
    time: Date.now(),
    name: request.name,
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: request.body,
    status: response.ok ? response.status : 0,
    elapsedMs: response.ok ? response.elapsedMs : null
  }
  state.history = [entry, ...state.history].slice(0, 30)
  await orca.storage.set('history', state.history)
  renderHistoryCount()
  if (state.drawer === 'history') renderDrawer()
}

function openDrawer(kind) {
  state.drawer = kind
  elements.drawer.classList.add('open')
  elements.scrim.classList.add('open')
  elements.drawer.setAttribute('aria-hidden', 'false')
  renderDrawer()
}

function closeDrawer() {
  state.drawer = ''
  elements.drawer.classList.remove('open')
  elements.scrim.classList.remove('open')
  elements.drawer.setAttribute('aria-hidden', 'true')
}

function renderDrawer() {
  if (state.drawer === 'environment') renderEnvironmentDrawer()
  else if (state.drawer === 'auth') renderAuthDrawer()
  else if (state.drawer === 'history') renderHistoryDrawer()
  else if (state.drawer === 'curl') renderCurlDrawer()
  else if (state.drawer === 'code') renderCodeDrawer()
  else if (state.drawer === 'results') renderResultsDrawer()
}

function renderEnvironmentDrawer() {
  const environment = activeEnvironment()
  elements.drawerTitle.textContent = 'Environments'
  elements.drawerContent.innerHTML = `
    <p class="drawer-lead">Resolve <code>{{variables}}</code> immediately before a request is sent.</p>
    <div class="drawer-toolbar"><select id="environment-edit-select" class="field">${state.environments.map(item => `<option value="${escapeText(item.id)}" ${item.id === environment.id ? 'selected' : ''}>${escapeText(item.name)}</option>`).join('')}</select><button id="environment-new" class="button" type="button">New</button><button id="environment-delete" class="button danger" type="button" ${state.environments.length === 1 ? 'disabled' : ''}>Delete</button></div>
    <label class="form-label">Environment name<input id="environment-name" class="field" value="${escapeText(environment.name)}"></label>
    <div class="section-label"><span>VARIABLES</span><button id="variable-add" class="text-button" type="button">+ Add row</button></div>
    <div id="variable-rows" class="variable-rows">${environment.variables.map(variableRow).join('')}</div>
    <p class="micro-copy">Built in: <code>{{$timestamp}}</code> and <code>{{$randomUUID}}</code>.</p>
    <button id="environment-save" class="button primary drawer-primary" type="button">Save environment</button>`
  document.querySelector('#environment-edit-select').addEventListener('change', event => { state.activeEnvironmentId = event.target.value; renderEnvironmentSelect(); renderEnvironmentDrawer(); renderRequestMeta() })
  document.querySelector('#environment-new').addEventListener('click', createEnvironment)
  document.querySelector('#environment-delete').addEventListener('click', deleteEnvironment)
  document.querySelector('#variable-add').addEventListener('click', () => { document.querySelector('#variable-rows').insertAdjacentHTML('beforeend', variableRow({ key: '', value: '' })) })
  document.querySelector('#variable-rows').addEventListener('click', event => { if (event.target.closest('.row-remove')) event.target.closest('.variable-row').remove() })
  document.querySelector('#environment-save').addEventListener('click', saveEnvironment)
}

function variableRow(variable) {
  return `<div class="variable-row"><input class="field variable-key" value="${escapeText(variable.key)}" placeholder="variable"><input class="field variable-value" value="${escapeText(variable.value)}" placeholder="value"><button class="row-remove" type="button" aria-label="Remove variable">×</button></div>`
}

async function saveEnvironment() {
  const environment = activeEnvironment()
  environment.name = document.querySelector('#environment-name').value.trim() || 'Untitled'
  environment.variables = [...document.querySelectorAll('.variable-row')].map(row => ({ key: row.querySelector('.variable-key').value.trim(), value: row.querySelector('.variable-value').value })).filter(item => item.key)
  await persistEnvironments()
  renderEnvironmentSelect()
  renderRequestMeta()
  showToast('Environment saved locally.')
}

async function createEnvironment() {
  const id = crypto.randomUUID()
  state.environments.push({ id, name: `Environment ${state.environments.length + 1}`, variables: [] })
  state.activeEnvironmentId = id
  await persistEnvironments()
  renderEnvironmentSelect()
  renderEnvironmentDrawer()
}

async function deleteEnvironment() {
  if (state.environments.length === 1) return
  state.environments = state.environments.filter(item => item.id !== state.activeEnvironmentId)
  state.activeEnvironmentId = state.environments[0].id
  await persistEnvironments()
  renderEnvironmentSelect()
  renderEnvironmentDrawer()
  renderRequestMeta()
}

async function persistEnvironments() {
  await orca.storage.set('environments', state.environments)
  await orca.storage.set('activeEnvironmentId', state.activeEnvironmentId)
}

function renderEnvironmentSelect() {
  elements.environmentSelect.innerHTML = state.environments.map(item => `<option value="${escapeText(item.id)}" ${item.id === state.activeEnvironmentId ? 'selected' : ''}>${escapeText(item.name)}</option>`).join('')
}

function renderAuthDrawer() {
  elements.drawerTitle.textContent = 'Authentication'
  elements.drawerContent.innerHTML = `
    <p class="drawer-lead">Credentials are encrypted by Orca Secrets and never written into request history.</p>
    <label class="form-label">Auth type<select id="auth-type" class="field"><option value="none">None</option><option value="bearer">Bearer token</option><option value="basic">Basic auth</option><option value="api-key">API key</option></select></label>
    <div id="auth-fields"></div>
    <button id="auth-save" class="button primary drawer-primary" type="button">Save authentication</button>`
  const select = document.querySelector('#auth-type')
  select.value = state.auth.type
  select.addEventListener('change', () => { state.auth.type = select.value; renderAuthFields() })
  document.querySelector('#auth-save').addEventListener('click', saveAuth)
  renderAuthFields()
}

function renderAuthFields() {
  const container = document.querySelector('#auth-fields')
  if (!container) return
  const secretLabel = state.auth.type === 'basic' ? 'Password' : state.auth.type === 'api-key' ? 'API key value' : 'Token'
  if (state.auth.type === 'none') container.innerHTML = '<div class="quiet-block">No authentication will be added.</div>'
  else container.innerHTML = `
    ${state.auth.type === 'basic' ? `<label class="form-label">Username<input id="auth-username" class="field" value="${escapeText(state.auth.username)}" autocomplete="off"></label>` : ''}
    ${state.auth.type === 'api-key' ? `<label class="form-label">Key name<input id="auth-name" class="field" value="${escapeText(state.auth.name)}" placeholder="X-API-Key"></label><label class="form-label">Placement<select id="auth-placement" class="field"><option value="header">Header</option><option value="query">Query parameter</option></select></label>` : ''}
    <label class="form-label">${secretLabel}<input id="auth-secret" class="field" type="password" value="${escapeText(state.auth.secret)}" autocomplete="new-password"></label>`
  if (state.auth.type === 'api-key') document.querySelector('#auth-placement').value = state.auth.placement
}

async function saveAuth() {
  const type = document.querySelector('#auth-type').value
  const metadata = {
    type,
    username: document.querySelector('#auth-username')?.value ?? '',
    name: document.querySelector('#auth-name')?.value.trim() || 'X-API-Key',
    placement: document.querySelector('#auth-placement')?.value ?? 'header'
  }
  const secret = document.querySelector('#auth-secret')?.value ?? ''
  try {
    if (type === 'none') await orca.secrets.delete('auth-secret')
    else await orca.secrets.set('auth-secret', secret)
    await orca.storage.set('auth', metadata)
    state.auth = { ...metadata, secret }
    renderAuthIndicator()
    showToast(type === 'none' ? 'Authentication disabled.' : 'Authentication saved with Orca Secrets.')
    closeDrawer()
  } catch (error) {
    showToast(`Could not save the credential: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
}

function renderAuthIndicator() {
  elements.authIndicator.classList.toggle('active', state.auth.type !== 'none')
}

function renderHistoryDrawer() {
  elements.drawerTitle.textContent = 'Local history'
  elements.drawerContent.innerHTML = `<div class="history-head"><p class="drawer-lead">Latest 30 requests. Credentials are excluded.</p><button id="history-clear" class="text-button danger-text" type="button">Clear all</button></div><div class="history-list">${state.history.length ? state.history.map(historyRow).join('') : '<div class="quiet-block">No requests have been sent yet.</div>'}</div>`
  document.querySelector('#history-clear').addEventListener('click', async () => { state.history = []; await orca.storage.set('history', []); renderHistoryCount(); renderHistoryDrawer() })
  document.querySelectorAll('[data-history-id]').forEach(button => button.addEventListener('click', () => replayHistory(button.dataset.historyId)))
}

function historyRow(item) {
  const statusClass = item.status >= 200 && item.status < 300 ? 'success' : item.status ? 'error' : 'muted'
  return `<button class="history-row" data-history-id="${escapeText(item.id)}" type="button"><span class="history-method">${escapeText(item.method)}</span><span class="history-detail"><strong>${escapeText(item.name)}</strong><small>${escapeText(item.url)}</small></span><span class="history-result ${statusClass}">${item.status || 'ERR'}<small>${item.elapsedMs == null ? '' : formatDuration(item.elapsedMs)}</small></span></button>`
}

function replayHistory(id) {
  const item = state.history.find(entry => entry.id === id)
  if (!item) return
  const headerText = item.headers.map(header => `${header.name}: ${header.value}`).join('\n')
  const requestText = `# @name ${item.name} replay\n${item.method} ${item.url}${headerText ? `\n${headerText}` : ''}${item.body ? `\n\n${item.body}` : ''}`
  elements.source.value = `${elements.source.value.trim()}\n\n### History replay\n${requestText}`
  elements.source.dispatchEvent(new Event('input'))
  state.selected = state.requests.length - 1
  renderTabs()
  renderRequestMeta()
  closeDrawer()
  showToast('History entry added to the workbench.')
}

function renderHistoryCount() {
  elements.historyCount.textContent = String(state.history.length)
}

function renderCurlDrawer() {
  elements.drawerTitle.textContent = 'Import cURL'
  elements.drawerContent.innerHTML = `<p class="drawer-lead">Paste a common cURL command. It will be converted into an editable request.</p><label class="form-label">cURL command<textarea id="curl-input" class="field curl-input" spellcheck="false" placeholder="curl -X POST https://api.example.com/items -H 'Content-Type: application/json' -d '{&quot;name&quot;:&quot;demo&quot;}'"></textarea></label><button id="curl-import" class="button primary drawer-primary" type="button">Convert and append</button>`
  document.querySelector('#curl-import').addEventListener('click', importCurl)
  document.querySelector('#curl-input').focus()
}

function importCurl() {
  try {
    const converted = parseCurl(document.querySelector('#curl-input').value)
    elements.source.value = `${elements.source.value.trim()}\n\n### Imported from cURL\n${converted}`
    elements.source.dispatchEvent(new Event('input'))
    state.selected = state.requests.length - 1
    renderTabs()
    renderRequestMeta()
    closeDrawer()
    showToast('cURL request imported.')
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Could not parse cURL.')
  }
}

function renderCodeDrawer() {
  elements.drawerTitle.textContent = 'Generate code'
  const template = state.requests[state.selected]
  if (!template) {
    elements.drawerContent.innerHTML = '<div class="quiet-block">Select a valid request first.</div>'
    return
  }
  const resolved = resolveRequest(template, environmentValues())
  if (resolved.missing.length) {
    elements.drawerContent.innerHTML = `<div class="quiet-block">Resolve these variables first: ${escapeText(resolved.missing.join(', '))}</div>`
    return
  }
  elements.drawerContent.innerHTML = `
    <p class="drawer-lead">Generate a runnable snippet from the resolved request. Saved authentication is intentionally excluded.</p>
    <div class="code-languages" role="tablist"><button class="code-language active" data-language="curl" type="button">cURL</button><button class="code-language" data-language="javascript" type="button">JavaScript</button><button class="code-language" data-language="python" type="button">Python</button></div>
    <textarea id="generated-code" class="field generated-code" readonly></textarea>
    <button id="copy-code" class="button primary drawer-primary" type="button">Copy code</button>`
  const renderLanguage = language => {
    document.querySelector('#generated-code').value = generateCode(resolved.request, language)
    document.querySelectorAll('.code-language').forEach(button => button.classList.toggle('active', button.dataset.language === language))
  }
  document.querySelectorAll('.code-language').forEach(button => button.addEventListener('click', () => renderLanguage(button.dataset.language)))
  document.querySelector('#copy-code').addEventListener('click', copyGeneratedCode)
  renderLanguage('curl')
}

async function copyGeneratedCode() {
  const field = document.querySelector('#generated-code')
  try {
    await navigator.clipboard.writeText(field.value)
    showToast('Code copied to the clipboard.')
  } catch {
    field.select()
    const copied = document.execCommand('copy')
    showToast(copied ? 'Code copied to the clipboard.' : 'Select the code and copy it manually.')
  }
}

function renderResultsDrawer() {
  elements.drawerTitle.textContent = 'Collection results'
  if (!state.runResults.length) {
    elements.drawerContent.innerHTML = '<div class="quiet-block">Run the collection to see status and assertion results.</div>'
    return
  }
  const passed = state.runResults.filter(item => item.passed).length
  const totalTime = state.runResults.reduce((sum, item) => sum + (item.elapsedMs ?? 0), 0)
  elements.drawerContent.innerHTML = `
    <div class="collection-score ${passed === state.runResults.length ? 'passed' : 'failed'}"><strong>${passed}/${state.runResults.length}</strong><span>requests passed</span><small>${formatDuration(totalTime)} total</small></div>
    <div class="result-list">${state.runResults.map(resultRow).join('')}</div>`
  document.querySelectorAll('[data-result-index]').forEach(button => button.addEventListener('click', () => {
    const result = state.runResults[Number(button.dataset.resultIndex)]
    const index = state.requests.findIndex(request => request.id === result.requestId)
    if (index >= 0) { state.selected = index; renderTabs(); renderRequestMeta() }
    closeDrawer()
  }))
}

function resultRow(item, index) {
  const checks = item.tests.length + item.captures.length
  const passedChecks = item.tests.filter(test => test.passed).length + item.captures.filter(capture => capture.ok).length
  return `<button class="result-row ${item.passed ? 'passed' : 'failed'}" data-result-index="${index}" type="button"><span class="result-light"></span><span class="result-detail"><strong>${escapeText(item.name)}</strong><small>${escapeText(item.method)} · ${item.status || 'ERR'} · ${item.elapsedMs == null ? '—' : formatDuration(item.elapsedMs)}</small></span><span class="result-checks">${passedChecks}/${checks}</span></button>`
}

function syncResponseTabs() {
  document.querySelectorAll('.response-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === state.responseTab))
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char])
}

function formatDuration(ms) { return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s` }
function formatBytes(bytes) { return !Number.isFinite(bytes) || bytes < 1024 ? `${bytes || 0} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB` }

let toastTimer
function showToast(message) {
  elements.toast.textContent = message
  elements.toast.classList.add('visible')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 3200)
}

elements.source.addEventListener('input', () => { refreshRequests(); state.session?.change(elements.source.value) })
elements.source.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); sendRequest() }
  if (event.key === 'Tab') { event.preventDefault(); const start = elements.source.selectionStart; elements.source.setRangeText('  ', start, elements.source.selectionEnd, 'end'); elements.source.dispatchEvent(new Event('input')) }
})
elements.send.addEventListener('click', sendRequest)
elements.cancel.addEventListener('click', cancelRequest)
elements.runAll.addEventListener('click', () => state.collectionRunning ? cancelRequest() : runAllRequests())
elements.clear.addEventListener('click', () => { state.response = null; renderResponse(); setRunning(false) })
elements.environmentSelect.addEventListener('change', async event => { state.activeEnvironmentId = event.target.value; await orca.storage.set('activeEnvironmentId', state.activeEnvironmentId); renderRequestMeta() })
document.querySelectorAll('[data-drawer]').forEach(button => button.addEventListener('click', () => openDrawer(button.dataset.drawer)))
elements.drawerClose.addEventListener('click', closeDrawer)
elements.scrim.addEventListener('click', closeDrawer)
document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.drawer) closeDrawer() })
document.querySelectorAll('.response-tab').forEach(button => button.addEventListener('click', () => { state.responseTab = button.dataset.tab; syncResponseTabs(); renderResponse() }))

async function loadPersistedState() {
  try {
    const [environments, activeId, auth, history, secret] = await Promise.all([
      orca.storage.get('environments'), orca.storage.get('activeEnvironmentId'), orca.storage.get('auth'), orca.storage.get('history'), orca.secrets.get('auth-secret')
    ])
    if (Array.isArray(environments) && environments.length) state.environments = environments
    if (typeof activeId === 'string' && state.environments.some(item => item.id === activeId)) state.activeEnvironmentId = activeId
    else state.activeEnvironmentId = state.environments[0].id
    if (auth && typeof auth === 'object' && !Array.isArray(auth)) state.auth = { ...state.auth, ...auth, secret: secret ?? '' }
    if (Array.isArray(history)) state.history = history.slice(0, 30)
  } catch (error) {
    showToast(`Local settings could not be loaded: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
}

async function initialize() {
  await loadPersistedState()
  if (isEditor && orca.document) {
    try {
      state.session = await orca.document.session({ debounceMs: 350 })
      state.source = state.session.value
      state.session.onReplace(next => { state.source = next; elements.source.value = next; refreshRequests() })
      window.addEventListener('beforeunload', () => state.session?.dispose())
    } catch (error) {
      showToast(`Could not open the document: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }
  elements.source.value = state.source
  renderEnvironmentSelect()
  renderAuthIndicator()
  renderHistoryCount()
  refreshRequests({ preserveSelection: false })
  renderResponse()
}

initialize()
