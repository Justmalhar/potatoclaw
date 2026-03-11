/* ============================================================
   Sessions Page — Conversation transcript viewer
   ============================================================ */
(function () {
  'use strict';

  let _agents = [];
  let _sessions = [];
  let _selectedAgent = '';
  let _panel = null;

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function fmtSize(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  // --------------------------------------------------------
  // Session table
  // --------------------------------------------------------
  function renderSessionTable() {
    const wrap = document.getElementById('sessions-table-wrap');
    if (!wrap) return;

    if (_sessions.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">💬</div>
          <div class="empty-state-title">No sessions found</div>
          <div class="empty-state-desc">${_selectedAgent ? 'No conversations for this agent yet.' : 'Select an agent to view sessions.'}</div>
        </div>`;
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Session Key</th>
              <th>Last Activity</th>
              <th>Messages</th>
              <th>Size</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${_sessions.map((s) => `
              <tr style="cursor:pointer;" onclick="SessionsPage.openSession('${esc(s.key || s.id)}')">
                <td class="font-mono text-xs">${esc((s.key || s.id || '').slice(0, 20))}</td>
                <td class="text-dim">${timeAgo(s.lastActivity || s.last_activity || s.updatedAt)}</td>
                <td>${s.messageCount || s.message_count || '—'}</td>
                <td class="text-dim">${fmtSize(s.size || s.fileSize)}</td>
                <td onclick="event.stopPropagation();">
                  <button class="btn btn-danger btn-xs" onclick="SessionsPage.deleteSession('${esc(s.key || s.id)}')">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // --------------------------------------------------------
  // Detail panel — transcript viewer
  // --------------------------------------------------------
  async function openSession(sessionKey) {
    if (!_panel) {
      _panel = document.createElement('div');
      _panel.className = 'detail-panel';
      document.body.appendChild(_panel);
    }

    _panel.innerHTML = `
      <div class="detail-panel-header">
        <div>
          <div style="font-size:14px;font-weight:700;">Session Transcript</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;font-family:monospace;">${esc(sessionKey)}</div>
        </div>
        <button class="btn-icon" onclick="SessionsPage.closePanel()">✕</button>
      </div>
      <div class="detail-panel-body" id="session-transcript">
        <div class="loading-spinner-wrap"><div class="spinner"></div></div>
      </div>
    `;

    _panel.classList.add('open');

    try {
      const res = await api('GET', `/api/sessions/${encodeURIComponent(_selectedAgent)}/${encodeURIComponent(sessionKey)}`);
      const messages = res?.messages || res?.transcript || [];
      const el = document.getElementById('session-transcript');
      if (!el) return;

      if (messages.length === 0) {
        el.innerHTML = '<p class="text-dim text-sm">No messages in this session</p>';
        return;
      }

      el.innerHTML = messages.map((msg) => {
        const role = msg.role || 'user';
        const content = msg.content || '';
        const ts = msg.timestamp || msg.created_at || '';

        const isUser = role === 'user';
        const isSystem = role === 'system';

        if (isSystem) {
          return `
            <div style="padding:8px 12px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:var(--radius);margin-bottom:8px;font-size:11px;color:var(--text-muted);">
              <span style="font-weight:700;color:var(--accent-light);">system</span><br>
              ${esc(content)}
            </div>`;
        }

        return `
          <div style="margin-bottom:12px;display:flex;flex-direction:column;align-items:${isUser ? 'flex-end' : 'flex-start'};">
            <div style="font-size:10px;color:var(--text-dim);margin-bottom:3px;${isUser ? 'text-align:right;' : ''}">${esc(role)} ${ts ? '· ' + new Date(ts).toLocaleTimeString() : ''}</div>
            <div style="
              max-width:85%;
              background:${isUser ? 'rgba(124,58,237,0.15)' : 'var(--surface-2)'};
              border:1px solid ${isUser ? 'rgba(124,58,237,0.3)' : 'var(--border)'};
              border-radius:${isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px'};
              padding:10px 14px;
              font-size:12px;
              line-height:1.6;
              color:var(--text);
              white-space:pre-wrap;
              word-break:break-word;
            ">${esc(typeof content === 'string' ? content : JSON.stringify(content, null, 2))}</div>
          </div>`;
      }).join('');

      // Scroll to bottom
      el.scrollTop = el.scrollHeight;
    } catch (err) {
      const el = document.getElementById('session-transcript');
      if (el) el.innerHTML = `<p style="color:var(--red);">Error: ${esc(err.message)}</p>`;
    }
  }

  function closePanel() {
    if (_panel) _panel.classList.remove('open');
  }

  async function deleteSession(sessionKey) {
    if (!confirm('Delete this session transcript?')) return;
    try {
      await api('DELETE', `/api/sessions/${encodeURIComponent(_selectedAgent)}/${encodeURIComponent(sessionKey)}`);
      _sessions = _sessions.filter((s) => (s.key || s.id) !== sessionKey);
      renderSessionTable();
      closePanel();
      toast('Session deleted', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function loadSessions(agentId) {
    _selectedAgent = agentId;
    _sessions = [];
    renderSessionTable();

    if (!agentId) return;

    const wrap = document.getElementById('sessions-table-wrap');
    if (wrap) wrap.innerHTML = '<div class="loading-spinner-wrap"><div class="spinner"></div></div>';

    try {
      const res = await api('GET', `/api/sessions/${encodeURIComponent(agentId)}`);
      _sessions = res?.sessions || res || [];
      renderSessionTable();
    } catch (err) {
      if (wrap) wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Failed to load sessions</div><div class="empty-state-desc">${esc(err.message)}</div></div>`;
    }
  }

  window.SessionsPage = { openSession, closePanel, deleteSession };

  window.Pages = window.Pages || {};
  window.Pages.sessions = {
    async render(container) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
          <h2 style="font-size:15px;font-weight:700;">Session Transcripts</h2>
          <div style="display:flex;align-items:center;gap:8px;margin-left:auto;">
            <label class="form-label" style="margin:0;white-space:nowrap;">Agent:</label>
            <select class="form-select" id="sessions-agent-select" style="width:200px;" onchange="SessionsPage._loadSessions(this.value)">
              <option value="">Select agent...</option>
            </select>
          </div>
        </div>
        <div id="sessions-table-wrap">
          <div class="empty-state">
            <div class="empty-state-icon">💬</div>
            <div class="empty-state-title">Select an agent</div>
            <div class="empty-state-desc">Choose an agent above to browse their conversation sessions.</div>
          </div>
        </div>
      `;

      window.SessionsPage._loadSessions = loadSessions;

      try {
        const res = await api('GET', '/api/agents');
        _agents = res?.agents || res || [];
        const sel = document.getElementById('sessions-agent-select');
        if (sel) {
          _agents.forEach((a) => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = `${a.avatar || '🤖'} ${a.name}`;
            sel.appendChild(opt);
          });
        }
      } catch (_) {}
    },
  };
})();
