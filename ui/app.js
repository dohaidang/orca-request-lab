import { formatBody, parseRequests } from './http-parser.js'

const isEditor = document.documentElement.dataset.mode === 'editor'
const sample = `# @name Xem bài viết mẫu
GET https://jsonplaceholder.typicode.com/posts/1
Accept: application/json

### Tạo bài viết
POST https://jsonplaceholder.typicode.com/posts
Content-Type: application/json

{
  "title": "Request Lab",
  "body": "Gửi request ngay trong Orca",
  "userId": 1
}`

const state = {
  source: sample,
  requests: [],
  selected: 0,
  response: null,
  responseTab: 'body',
  running: false,
  activeRequestId: '',
  session: null,
  lastError: ''
}

const app = document.querySelector('#app')
app.innerHTML = `
  <main class="workbench">
    <header class="topbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true">RL</span><div><strong>Request Lab</strong><span>${isEditor ? 'FILE WORKBENCH' : 'QUICK WORKBENCH'}</span></div></div>
      <div class="top-actions">
        <label class="timeout-label">Timeout <input id="timeout" type="number" min="1" max="300" value="30" aria-label="Timeout tính bằng giây"><span>s</span></label>
        <button id="clear" class="button ghost" type="button">Xóa kết quả</button>
      </div>
    </header>
    <section class="request-strip" aria-label="Danh sách request">
      <div id="requests" class="request-tabs"></div>
      <div class="strip-hint"><kbd>Ctrl</kbd><span>+</span><kbd>Enter</kbd></div>
    </section>
    <section class="split">
      <article class="pane request-pane">
        <div class="pane-heading"><div><span class="eyebrow">REQUEST</span><h1 id="request-title">Chưa có request</h1></div><span id="parse-state" class="parse-state">READY</span></div>
        <textarea id="source" spellcheck="false" aria-label="Nội dung file HTTP"></textarea>
        <footer class="actionbar">
          <div class="request-meta"><span id="method-chip" class="method-chip">GET</span><span id="target-url">—</span></div>
          <div class="send-actions">
            <button id="cancel" class="button danger hidden" type="button">Hủy</button>
            <button id="send" class="button primary" type="button"><span class="send-icon">▶</span><span>Gửi request</span></button>
          </div>
        </footer>
      </article>
      <article class="pane response-pane">
        <div class="response-head">
          <div class="response-title"><span class="eyebrow">RESPONSE</span><div id="response-metrics" class="metrics"><span class="metric muted">Chưa gửi</span></div></div>
          <div class="response-tabs" role="tablist">
            <button class="response-tab active" data-tab="body" role="tab" type="button">Body</button>
            <button class="response-tab" data-tab="headers" role="tab" type="button">Headers</button>
          </div>
        </div>
        <div id="response-view" class="response-view empty-state">
          <div class="pulse-mark" aria-hidden="true"><span></span><span></span><span></span></div>
          <h2>Đang chờ tín hiệu</h2>
          <p>Chọn một request rồi nhấn Gửi. Kết quả sẽ xuất hiện tại đây.</p>
        </div>
      </article>
    </section>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
  </main>`

const elements = {
  source: document.querySelector('#source'),
  requests: document.querySelector('#requests'),
  requestTitle: document.querySelector('#request-title'),
  parseState: document.querySelector('#parse-state'),
  methodChip: document.querySelector('#method-chip'),
  targetUrl: document.querySelector('#target-url'),
  send: document.querySelector('#send'),
  cancel: document.querySelector('#cancel'),
  clear: document.querySelector('#clear'),
  timeout: document.querySelector('#timeout'),
  metrics: document.querySelector('#response-metrics'),
  responseView: document.querySelector('#response-view'),
  toast: document.querySelector('#toast')
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
    button.innerHTML = `<span class="tab-method method-${escapeText(request.method)}">${escapeText(request.method)}</span><span>${escapeText(request.name)}</span>${request.error ? '<i aria-label="Có lỗi">!</i>' : ''}`
    button.addEventListener('click', () => {
      state.selected = index
      renderTabs()
      renderRequestMeta()
    })
    return button
  }))
  if (!state.requests.length) {
    const empty = document.createElement('span')
    empty.className = 'no-requests'
    empty.textContent = 'Chưa tìm thấy request'
    elements.requests.append(empty)
  }
}

function renderRequestMeta() {
  const request = state.requests[state.selected]
  if (!request) {
    elements.requestTitle.textContent = 'Chưa có request'
    elements.methodChip.textContent = '—'
    elements.targetUrl.textContent = 'Thêm METHOD và URL để bắt đầu'
    elements.parseState.textContent = 'EMPTY'
    elements.parseState.className = 'parse-state warning'
    elements.send.disabled = true
    return
  }
  elements.requestTitle.textContent = request.name
  elements.methodChip.textContent = request.method
  elements.methodChip.dataset.method = request.method
  elements.targetUrl.textContent = request.url
  elements.targetUrl.title = request.url
  elements.parseState.textContent = request.error ? 'CHECK' : 'VALID'
  elements.parseState.className = `parse-state${request.error ? ' warning' : ''}`
  elements.send.disabled = Boolean(request.error) || state.running
}

async function sendRequest() {
  const request = state.requests[state.selected]
  if (!request || request.error || state.running) {
    if (request?.error) showToast(request.error)
    return
  }
  state.running = true
  state.activeRequestId = crypto.randomUUID()
  state.lastError = ''
  setRunning(true)

  try {
    const result = await orca.plugin.request('request.send', {
      requestId: state.activeRequestId,
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body,
      timeoutMs: Number(elements.timeout.value) * 1000
    }, { timeoutMs: Math.min(310_000, Number(elements.timeout.value) * 1000 + 10_000) })
    state.response = result
    state.responseTab = 'body'
    syncResponseTabs()
    renderResponse()
  } catch (error) {
    state.response = { ok: false, error: error instanceof Error ? error.message : 'Worker không phản hồi.' }
    renderResponse()
  } finally {
    state.running = false
    state.activeRequestId = ''
    setRunning(false)
  }
}

async function cancelRequest() {
  if (!state.activeRequestId) return
  elements.cancel.disabled = true
  try {
    await orca.plugin.request('request.cancel', { requestId: state.activeRequestId })
  } catch {
    showToast('Không thể gửi lệnh hủy.')
  }
}

function setRunning(running) {
  elements.send.classList.toggle('loading', running)
  elements.send.querySelector('span:last-child').textContent = running ? 'Đang gửi…' : (state.response ? 'Gửi lại' : 'Gửi request')
  elements.send.disabled = running
  elements.cancel.classList.toggle('hidden', !running)
  elements.cancel.disabled = false
  elements.parseState.textContent = running ? 'SENDING' : (state.requests[state.selected]?.error ? 'CHECK' : 'VALID')
}

function renderResponse() {
  const response = state.response
  if (!response) {
    elements.metrics.innerHTML = '<span class="metric muted">Chưa gửi</span>'
    elements.responseView.className = 'response-view empty-state'
    elements.responseView.innerHTML = '<div class="pulse-mark"><span></span><span></span><span></span></div><h2>Đang chờ tín hiệu</h2><p>Chọn một request rồi nhấn Gửi. Kết quả sẽ xuất hiện tại đây.</p>'
    return
  }
  if (!response.ok) {
    elements.metrics.innerHTML = '<span class="metric status error">ERROR</span>'
    elements.responseView.className = 'response-view error-state'
    elements.responseView.innerHTML = `<div class="error-code">×</div><h2>${response.cancelled ? 'Đã dừng request' : 'Không thể kết nối'}</h2><p>${escapeText(response.error || 'Đã xảy ra lỗi không xác định.')}</p>`
    return
  }

  const statusClass = response.status >= 200 && response.status < 300 ? 'success' : response.status >= 400 ? 'error' : 'warning'
  elements.metrics.innerHTML = `
    <span class="metric status ${statusClass}">${response.status} ${escapeText(response.statusText)}</span>
    <span class="metric">${formatDuration(response.elapsedMs)}</span>
    <span class="metric">${formatBytes(response.declaredSize || response.size)}</span>
    ${response.truncated ? '<span class="metric warning">Đã cắt bớt</span>' : ''}`
  elements.responseView.className = 'response-view'

  if (state.responseTab === 'headers') {
    const rows = response.headers.map(header => `<div class="header-row"><strong>${escapeText(header.name)}</strong><span>${escapeText(header.value)}</span></div>`).join('')
    elements.responseView.innerHTML = `<div class="headers-table">${rows || '<p>Không có header.</p>'}</div>`
    return
  }
  if (response.bodyKind === 'image') {
    elements.responseView.innerHTML = `<div class="image-result"><img src="data:${escapeText(response.contentType.split(';')[0] || 'image/png')};base64,${response.body}" alt="Nội dung hình ảnh trả về"><p>${escapeText(response.contentType)} · ${formatBytes(response.size)}</p></div>`
    return
  }
  if (response.bodyKind === 'binary') {
    elements.responseView.innerHTML = `<div class="binary-result"><span>01</span><h2>Dữ liệu nhị phân</h2><p>${escapeText(response.contentType || 'application/octet-stream')} · ${formatBytes(response.size)}</p></div>`
    return
  }
  const formatted = formatBody(response.body, response.contentType)
  elements.responseView.innerHTML = `<pre><code>${escapeText(formatted || '(body rỗng)')}</code></pre>`
}

function syncResponseTabs() {
  document.querySelectorAll('.response-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === state.responseTab))
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char])
}

function formatDuration(ms) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes || 0} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

let toastTimer
function showToast(message) {
  elements.toast.textContent = message
  elements.toast.classList.add('visible')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 3000)
}

elements.source.addEventListener('input', () => {
  refreshRequests()
  state.session?.change(elements.source.value)
})
elements.source.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    sendRequest()
  }
  if (event.key === 'Tab') {
    event.preventDefault()
    const start = elements.source.selectionStart
    elements.source.setRangeText('  ', start, elements.source.selectionEnd, 'end')
    elements.source.dispatchEvent(new Event('input'))
  }
})
elements.send.addEventListener('click', sendRequest)
elements.cancel.addEventListener('click', cancelRequest)
elements.clear.addEventListener('click', () => { state.response = null; renderResponse(); setRunning(false) })
document.querySelectorAll('.response-tab').forEach(button => button.addEventListener('click', () => {
  state.responseTab = button.dataset.tab
  syncResponseTabs()
  renderResponse()
}))

async function initialize() {
  if (isEditor && orca.document) {
    try {
      state.session = await orca.document.session({ debounceMs: 350 })
      state.source = state.session.value
      state.session.onReplace(next => {
        state.source = next
        elements.source.value = next
        refreshRequests()
      })
      window.addEventListener('beforeunload', () => state.session?.dispose())
    } catch (error) {
      showToast(`Không thể mở tài liệu: ${error instanceof Error ? error.message : 'lỗi không xác định'}`)
    }
  }
  elements.source.value = state.source
  refreshRequests({ preserveSelection: false })
  renderResponse()
}

initialize()
