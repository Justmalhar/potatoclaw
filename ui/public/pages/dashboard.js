/* ============================================================
   Dashboard Page
   ============================================================ */
(function () {
  'use strict';

  let _refreshInterval = null;

  // --------------------------------------------------------
  // Helpers
  // --------------------------------------------------------
  function fmt(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDur(ms) {
    if (!ms) return '';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  function statusIcon(status) {
    switch (status) {
      case 'completed': return '✅';
      case 'failed':    return '❌';
      case 'running':   return '🔄';
      case 'queued':    return '⏳';
      default:          return '📌';
    }
  }

  // --------------------------------------------------------
  // Data fetchers
  // --------------------------------------------------------
  async function fetchAll() {
    const [agentsRes, tasksRes, runsRes] = await Promise.allSettled([
      api('GET', '/api/agents'),
      api('GET', '/api/tasks?limit=100'),
      api('GET', '/api/runs?limit=50'),
    ]);

    const agents = agentsRes.status === 'fulfilled' ? (agentsRes.value?.agents || []) : [];
    const tasks  = tasksRes.status  === 'fulfilled' ? (tasksRes.value?.tasks  || []) : [];
    const runs   = runsRes.status   === 'fulfilled' ? (runsRes.value?.runs    || []) : [];

    App.agents = agents;
    App.tasks  = tasks;
    App.runs   = runs;

    return { agents, tasks, runs };
  }

  // --------------------------------------------------------
  // Render helpers
  // --------------------------------------------------------
  function buildStats(agents, tasks, runs) {
    const activeAgents   = agents.filter((a) => a.status === 'busy').length;
    const tasksToday     = tasks.length;
    const runningNow     = runs.filter((r) => r.status === 'running').length;
    const queued         = runs.filter((r) => r.status === 'queued').length;

    return `
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-value">${activeAgents}</div>
          <div class="stat-label">Active Agents</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${tasksToday}</div>
          <div class="stat-label">Total Tasks</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${runningNow}</div>
          <div class="stat-label">Running Now</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${queued}</div>
          <div class="stat-label">Up Next</div>
        </div>
      </div>
    `;
  }

  function buildActiveAgents(agents) {
    const busy = agents.filter((a) => a.status === 'busy');
    if (busy.length === 0) {
      return `<p class="text-dim text-sm">No agents currently active</p>`;
    }
    return busy.map((a) => `
      <div class="active-agent-item sse-target" data-agent-id="${a.id}">
        <div class="active-agent-row">
          <span class="active-agent-name">${a.avatar || '🤖'} ${a.name}</span>
          <span class="badge badge-busy">busy</span>
        </div>
        <div class="active-agent-task">${a.currentTask ? a.currentTask.title || '...' : 'Working...'}</div>
      </div>
    `).join('');
  }

  function buildEvents() {
    if (App.events.length === 0) {
      return `<p class="text-dim text-sm">No events yet — waiting for activity...</p>`;
    }
    return App.events.slice(0, 20).map((ev) => `
      <div class="event-item">
        <span class="event-time">${ev.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        <span class="event-icon">${statusIcon(ev.data?.status)}</span>
        <span class="event-msg">${ev.type} — ${ev.data?.task?.title || ev.data?.run?.id || JSON.stringify(ev.data).slice(0, 60)}</span>
      </div>
    `).join('');
  }

  function buildQueueDepth(agents) {
    if (agents.length === 0) return `<p class="text-dim text-sm">No agents configured</p>`;

    const rows = agents.map((a) => {
      const dot = a.status === 'busy'
        ? `<span class="agent-status-dot busy" style="position:static;display:inline-block;margin-right:6px;"></span>`
        : `<span class="agent-status-dot idle" style="position:static;display:inline-block;margin-right:6px;"></span>`;
      return `
        <tr>
          <td>${dot}${a.avatar || '🤖'} ${a.name}</td>
          <td><span class="badge badge-${a.status}">${a.status}</span></td>
          <td>${a.currentTask ? '1 running' : '—'}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="table-wrap">
        <table class="queue-table">
          <thead><tr><th>Agent</th><th>Status</th><th>Queue</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  // --------------------------------------------------------
  // Full render
  // --------------------------------------------------------
  function renderDashboard(container, { agents, tasks, runs }) {
    container.innerHTML = `
      ${buildStats(agents, tasks, runs)}

      <div class="dashboard-grid">
        <div>
          <div class="card mb-4">
            <div class="card-header">
              <span class="card-title">Active Agents</span>
              <button class="btn btn-sm btn-secondary" onclick="navigate('agents')">View All →</button>
            </div>
            <div class="active-agents-list" id="active-agents-list">
              ${buildActiveAgents(agents)}
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">Agent Status</span>
            </div>
            <div id="queue-depth-panel">
              ${buildQueueDepth(agents)}
            </div>
          </div>
        </div>

        <div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">Recent Events</span>
              <span class="text-dim text-xs">Live SSE feed</span>
            </div>
            <div class="events-feed" id="events-feed">
              ${buildEvents()}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // --------------------------------------------------------
  // SSE update — partial refresh
  // --------------------------------------------------------
  function updateEvents() {
    const feed = document.getElementById('events-feed');
    if (feed) feed.innerHTML = buildEvents();
  }

  // --------------------------------------------------------
  // Page API
  // --------------------------------------------------------
  window.Pages = window.Pages || {};
  window.Pages.dashboard = {
    async render(container) {
      try {
        const data = await fetchAll();
        renderDashboard(container, data);
      } catch (err) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Failed to load</div><div class="empty-state-desc">${err.message}</div></div>`;
      }
    },

    async onMount(container) {
      // Auto-refresh every 15s
      clearInterval(_refreshInterval);
      _refreshInterval = setInterval(async () => {
        try {
          const data = await fetchAll();
          const statsEl = container.querySelector('.stats-row');
          if (statsEl) statsEl.outerHTML = buildStats(data.agents, data.tasks, data.runs);
          const aaList = document.getElementById('active-agents-list');
          if (aaList) aaList.innerHTML = buildActiveAgents(data.agents);
          const qdPanel = document.getElementById('queue-depth-panel');
          if (qdPanel) qdPanel.innerHTML = buildQueueDepth(data.agents);
          updateEvents();
        } catch (_) {}
      }, 15000);
    },

    onSSEEvent(type, data) {
      updateEvents();
    },
  };
})();
