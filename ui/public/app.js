/* ============================================================
   PotatoClaw Mission Control — app.js
   Main SPA router, SSE connection, global state, API helper
   ============================================================ */

'use strict';

// ------------------------------------------------------------
// Global state
// ------------------------------------------------------------
window.App = {
  agents:  [],
  tasks:   [],
  runs:    [],
  events:  [], // last 50 SSE events
  config:  {},
  _sseReconnectTimer: null,
  _sseSource: null,
  _pageScripts: {}, // loaded page module instances
};

// ------------------------------------------------------------
// API helper
// ------------------------------------------------------------
async function api(method, path, body) {
  const opts = {
    method: method.toUpperCase(),
    headers: { 'Content-Type': 'application/json' },
  };

  // Attach basic-auth if credentials stored in sessionStorage
  const creds = sessionStorage.getItem('auth');
  if (creds) opts.headers['Authorization'] = 'Basic ' + creds;

  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(path, opts);

  if (res.status === 401) {
    const pass = prompt('Enter UI password:');
    if (pass) {
      sessionStorage.setItem('auth', btoa(':' + pass));
      return api(method, path, body); // retry
    }
    throw new Error('Unauthorized');
  }

  if (res.status === 204) return null;

  const text = await res.text();
  if (!text) return null;

  try {
    const data = JSON.parse(text);
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (e) {
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    throw e;
  }
}

window.api = api;

// ------------------------------------------------------------
// Toast notifications
// ------------------------------------------------------------
function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3700);
}

window.toast = toast;

// ------------------------------------------------------------
// Modal
// ------------------------------------------------------------
function openModal(contentHtml) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = contentHtml;
  overlay.classList.remove('hidden');
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('hidden');
  document.getElementById('modal-content').innerHTML = '';
}

window.openModal = openModal;
window.closeModal = closeModal;

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// ------------------------------------------------------------
// Router (hash-based)
// ------------------------------------------------------------
const PAGE_TITLES = {
  dashboard: 'Dashboard',
  kanban:    'Kanban Board',
  agents:    'Agents',
  runs:      'Run History',
  channels:  'Channels',
  memory:    'Memory',
  sessions:  'Sessions',
  scheduler: 'Scheduler',
  secrets:   'Secrets',
  logs:      'Logs',
  settings:  'Settings',
};

function currentPage() {
  const hash = window.location.hash.slice(2) || 'dashboard';
  return hash.split('/')[0];
}

async function loadPage(pageName) {
  const container = document.getElementById('page-container');
  const titleEl   = document.getElementById('page-title');

  // Update nav
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.page === pageName);
  });

  titleEl.textContent = PAGE_TITLES[pageName] || pageName;
  container.innerHTML = '<div class="loading-spinner-wrap"><div class="spinner"></div></div>';

  try {
    // Dynamically load page script if not already loaded
    if (!window.Pages) window.Pages = {};

    if (!window.Pages[pageName]) {
      await loadScript(`/pages/${pageName}.js`);
    }

    const page = window.Pages[pageName];
    if (!page || typeof page.render !== 'function') {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🚧</div><div class="empty-state-title">Page not found</div><div class="empty-state-desc">${pageName}</div></div>`;
      return;
    }

    await page.render(container);

    // Call onMount if defined
    if (typeof page.onMount === 'function') {
      await page.onMount(container);
    }

  } catch (err) {
    console.error('Page load error:', err);
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Error loading page</div><div class="empty-state-desc">${err.message}</div></div>`;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    // Avoid double-loading
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

function navigate(page) {
  window.location.hash = `#/${page}`;
}

window.navigate = navigate;

window.addEventListener('hashchange', () => {
  loadPage(currentPage());
});

// Sidebar nav clicks
document.getElementById('nav-list').addEventListener('click', (e) => {
  const item = e.target.closest('[data-page]');
  if (item) navigate(item.dataset.page);
});

// Sidebar toggle
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  const sidebar = document.getElementById('sidebar');
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sidebar.classList.toggle('mobile-open');
  } else {
    sidebar.classList.toggle('collapsed');
  }
});

// ------------------------------------------------------------
// Clock
// ------------------------------------------------------------
function updateClock() {
  const el = document.getElementById('topbar-time');
  if (el) {
    el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}
setInterval(updateClock, 1000);
updateClock();

// ------------------------------------------------------------
// SSE Connection
// ------------------------------------------------------------
function connectSSE() {
  if (App._sseSource) {
    App._sseSource.close();
  }

  const creds = sessionStorage.getItem('auth');
  const url = '/api/events';

  try {
    App._sseSource = new EventSource(url);
  } catch (_) {
    scheduleSSEReconnect();
    return;
  }

  const sseStatus = document.getElementById('sse-status');
  const connDot   = document.querySelector('.conn-dot');
  const connLabel = document.querySelector('.conn-label');

  App._sseSource.onopen = () => {
    if (sseStatus) { sseStatus.className = 'sse-status sse-connected'; }
    if (connDot)   { connDot.className = 'conn-dot conn-ok'; }
    if (connLabel) connLabel.textContent = 'Live';
    clearTimeout(App._sseReconnectTimer);
  };

  App._sseSource.onerror = () => {
    if (sseStatus) { sseStatus.className = 'sse-status sse-error'; }
    if (connDot)   { connDot.className = 'conn-dot conn-err'; }
    if (connLabel) connLabel.textContent = 'Offline';
    scheduleSSEReconnect();
  };

  // Generic message handler — dispatch to page handlers
  const handleEvent = (type, data) => {
    let parsed;
    try { parsed = typeof data === 'string' ? JSON.parse(data) : data; } catch { parsed = data; }

    const event = { type, data: parsed, time: new Date() };
    App.events.unshift(event);
    if (App.events.length > 50) App.events.pop();

    // Update global state
    if (type === 'task:status_changed' || type === 'task:created') {
      const task = parsed.task;
      if (task) {
        const idx = App.tasks.findIndex((t) => t.id === task.id);
        if (idx >= 0) App.tasks[idx] = task;
        else App.tasks.unshift(task);
      }
    }

    if (type === 'run:started' && parsed.run) {
      App.runs.unshift(parsed.run);
    }

    if (type === 'run:completed' || type === 'run:failed') {
      const run = parsed.run;
      if (run) {
        const idx = App.runs.findIndex((r) => r.id === run.id);
        if (idx >= 0) App.runs[idx] = run;
      }
    }

    // Dispatch to current page handler
    const pageName = currentPage();
    const page = window.Pages?.[pageName];
    if (page && typeof page.onSSEEvent === 'function') {
      try { page.onSSEEvent(type, parsed); } catch (_) {}
    }
  };

  const SSE_EVENTS = [
    'task:created', 'task:assigned', 'task:status_changed', 'task:completed', 'task:failed',
    'run:started', 'run:step', 'run:completed', 'run:failed',
  ];

  for (const evName of SSE_EVENTS) {
    App._sseSource.addEventListener(evName, (e) => handleEvent(evName, e.data));
  }

  App._sseSource.onmessage = (e) => handleEvent('message', e.data);
}

function scheduleSSEReconnect() {
  clearTimeout(App._sseReconnectTimer);
  App._sseReconnectTimer = setTimeout(connectSSE, 4000);
}

// ------------------------------------------------------------
// Bootstrap
// ------------------------------------------------------------
async function bootstrap() {
  // Load health / version
  try {
    const health = await api('GET', '/api/health');
    if (health && health.version) {
      const versionEl = document.getElementById('sidebar-version');
      if (versionEl) versionEl.textContent = `v${health.version}`;
    }
  } catch (_) {}

  // Connect SSE
  connectSSE();

  // Load initial page
  const page = currentPage() || 'dashboard';
  await loadPage(page);
}

bootstrap();
