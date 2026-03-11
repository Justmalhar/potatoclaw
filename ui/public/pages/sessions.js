/* ============================================================
   Sessions Page — Transcript viewer
   ============================================================ */
(function () {
  'use strict';

  let _agents   = [];
  let _sessions = [];
  let _selectedAgent = null;

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString();
  }

  async function selectAgent(agentId) {
    _selectedAgent = agentId;

    document.querySelectorAll('.sessions-agent-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.agentId === agentId);
    });

    const listEl = document.getElementById('sessions-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="spinner" style="width:20px;height:20px;margin:16px auto;"></div>';

    try {
      const res = await api('GET', `/api/sessions/${agentId}`);
      _sessions = res?.sessions || [];
      renderSessionsList(listEl, agentId);
    } catch (err) {
      listEl.innerHTML = `<p class="text-dim text-sm" style="padding:12px;">${err.message}</p>`;
    }
  }

  function renderSessionsList(container, agentId) {
    if (_sessions.length === 0) {
      container.innerHTML = '<p class="text-dim text-sm" style="padding:12px;">No sessions</p>';
      return;
    }

    container.innerHTML = _sessions.map((s) => `
      <div class="nav-item" style="flex-direction:column;align-items:flex-start;gap:2px;"
           onclick="SessionsPage.openSession('${escHtml(agentId)}','${escHtml(s.key)}')">
        <span class="text-xs font-mono truncate" style="width:100%;">${escHtml(s.key)}</span>
        <span class="text-xs text-dim">${s.messageCount || 0} messages · ${timeAgo(s.lastActivity)}</span>
      </div>
    `).join('');
  }

  async function openSession(agentId, key) {
    const viewerEl = document.getElementById('transcript-viewer');
    if (!viewerEl) return;

    viewerEl.innerHTML = '<div class="loading-spinner-wrap"><div class="spinner"></div></div>';

    try {
      const res = await api('GET', `/api/sessions/${agentId}/${encodeURIComponent(key)}?limit=200`);
      const transcript = res?.transcript || [];
      renderTranscript(viewerEl, key, agentId, transcript);
    } catch (err) {
      viewerEl.innerHTML = `<p class="text-dim">${err.message}</p>`;
    }
  }

  function renderTranscript(container, key, agentId, transcript) {
    const msgs = transcript.map((msg) => {
      const isUser = msg.role === 'user';
      const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '';
      return `
        <div style="margin-bottom:12px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span class="badge ${isUser ? 'badge-idle' : 'badge-running'}">${escHtml(msg.role || 'unknown')}</span>
            ${ts ? `<span class="text-dim text-xs">${ts}</span>` : ''}
          </div>
          <div style="padding:10px 14px;background:var(--surface-2);border-radius:var(--radius);font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;">
            ${escHtml(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content))}
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <div>
          <div class="font-mono text-xs text-dim">${escHtml(key)}</div>
          <div class="text-sm text-muted mt-1">${transcript.length} messages</div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="SessionsPage.deleteSession('${escHtml(agentId)}','${escHtml(key)}')">Delete Session</button>
      </div>
      <div style="max-height:calc(100vh - 300px);overflow-y:auto;">
        ${msgs || '<p class="text-dim text-sm">No messages</p>'}
      </div>
    `;
  }

  async function deleteSession(agentId, key) {
    if (!confirm('Delete this session?')) return;
    try {
      await api('DELETE', `/api/sessions/${agentId}/${encodeURIComponent(key)}`);
      toast('Session deleted', 'success');
      const viewerEl = document.getElementById('transcript-viewer');
      if (viewerEl) viewerEl.innerHTML = '<p class="text-dim">Session deleted.</p>';
      // Refresh sessions list
      if (_selectedAgent) await selectAgent(_selectedAgent);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  window.SessionsPage = { selectAgent, openSession, deleteSession };

  window.Pages = window.Pages || {};
  window.Pages.sessions = {
    async render(container) {
      container.innerHTML = `
        <div style="display:grid;grid-template-columns:200px 240px 1fr;gap:16px;min-height:calc(100vh - 180px);">
          <!-- Agents -->
          <div class="panel" style="overflow:hidden;">
            <div class="panel-header"><span class="panel-title">Agents</span></div>
            <div id="sessions-agents-list">
              <div class="loading-spinner-wrap"><div class="spinner" style="width:20px;height:20px;"></div></div>
            </div>
          </div>

          <!-- Sessions -->
          <div class="panel" style="overflow:hidden;">
            <div class="panel-header"><span class="panel-title">Sessions</span></div>
            <div id="sessions-list" style="overflow-y:auto;max-height:calc(100vh - 200px);">
              <p class="text-dim text-sm" style="padding:12px;">Select an agent</p>
            </div>
          </div>

          <!-- Transcript -->
          <div class="panel">
            <div class="panel-header"><span class="panel-title">Transcript</span></div>
            <div class="panel-body" id="transcript-viewer">
              <p class="text-dim text-sm">Select a session to view transcript</p>
            </div>
          </div>
        </div>
      `;

      try {
        const res = await api('GET', '/api/agents');
        _agents = res?.agents || [];

        const listEl = document.getElementById('sessions-agents-list');
        if (!listEl) return;

        if (_agents.length === 0) {
          listEl.innerHTML = '<p class="text-dim text-sm" style="padding:12px;">No agents</p>';
          return;
        }

        listEl.innerHTML = _agents.map((a) => `
          <div class="nav-item sessions-agent-item" data-agent-id="${escHtml(a.id)}"
               onclick="SessionsPage.selectAgent('${escHtml(a.id)}')">
            <span>${escHtml(a.avatar || '🤖')}</span>
            <span class="truncate">${escHtml(a.name)}</span>
          </div>
        `).join('');
      } catch (err) {
        document.getElementById('sessions-agents-list').innerHTML = `<p class="text-dim text-sm" style="padding:12px;">${err.message}</p>`;
      }
    },
    onMount() {},
    onSSEEvent() {},
  };
})();
