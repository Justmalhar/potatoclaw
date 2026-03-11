/* ============================================================
   Agents Page
   ============================================================ */
(function () {
  'use strict';

  let _agents = [];
  let _selectedAgent = null;
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

  function statusBadge(status) {
    const map = { idle: 'badge-idle', busy: 'badge-busy', error: 'badge-error', running: 'badge-running' };
    return `<span class="badge ${map[status] || 'badge-idle'}">${esc(status || 'idle')}</span>`;
  }

  function modelBadge(model) {
    if (!model) return '';
    const short = model.split('/').pop().split(':')[0];
    return `<span class="tag" style="background:rgba(59,130,246,0.1);color:#93c5fd;">${esc(short)}</span>`;
  }

  // --------------------------------------------------------
  // Agent card
  // --------------------------------------------------------
  function agentCardHTML(agent) {
    const dotCls = agent.status === 'busy' ? 'busy' : agent.status === 'error' ? 'error' : 'idle';
    return `
      <div class="agent-card" data-agent-id="${esc(agent.id)}" onclick="AgentsPage.openPanel('${esc(agent.id)}')">
        <span class="agent-status-dot ${dotCls}" title="${esc(agent.status)}"></span>
        <div class="agent-card-header">
          <span class="agent-avatar">${esc(agent.avatar || '🤖')}</span>
          <div class="agent-info">
            <div class="agent-name">${esc(agent.name)}</div>
            <div class="agent-model">${modelBadge(agent.model)}</div>
          </div>
          ${statusBadge(agent.status)}
        </div>
        <div class="agent-desc">${esc(agent.description || agent.systemPrompt?.slice(0,120) || 'No description')}</div>
        ${agent.currentTask ? `<div class="agent-current-task">📌 ${esc(agent.currentTask.title || agent.currentTask)}</div>` : ''}
        <div style="display:flex;gap:6px;margin-top:12px;">
          <button class="btn btn-secondary btn-xs" onclick="event.stopPropagation();AgentsPage.openPanel('${esc(agent.id)}')">Edit</button>
          <button class="btn btn-danger btn-xs" onclick="event.stopPropagation();AgentsPage.deleteAgent('${esc(agent.id)}')">Delete</button>
        </div>
      </div>
    `;
  }

  // --------------------------------------------------------
  // Detail panel
  // --------------------------------------------------------
  async function openPanel(agentId) {
    const agent = _agents.find((a) => a.id === agentId);
    if (!agent) return;
    _selectedAgent = agent;

    // Create or show panel
    if (!_panel) {
      _panel = document.createElement('div');
      _panel.className = 'detail-panel';
      document.body.appendChild(_panel);
    }

    _panel.innerHTML = `
      <div class="detail-panel-header">
        <div>
          <div style="font-size:15px;font-weight:700;">${esc(agent.avatar || '🤖')} ${esc(agent.name)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${esc(agent.id)}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          ${statusBadge(agent.status)}
          <button class="btn-icon" onclick="AgentsPage.closePanel()">✕</button>
        </div>
      </div>
      <div class="detail-panel-body">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input class="form-input" id="ap-name" value="${esc(agent.name)}" />
        </div>
        <div class="form-group">
          <label class="form-label">Avatar</label>
          <input class="form-input" id="ap-avatar" value="${esc(agent.avatar || '')}" style="width:80px;" />
        </div>
        <div class="form-group">
          <label class="form-label">Model</label>
          <input class="form-input" id="ap-model" value="${esc(agent.model || '')}" />
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <input class="form-input" id="ap-desc" value="${esc(agent.description || '')}" />
        </div>
        <div class="form-group">
          <label class="form-label">System Prompt</label>
          <textarea class="form-textarea memory-textarea" id="ap-prompt" rows="8">${esc(agent.systemPrompt || agent.system_prompt || '')}</textarea>
        </div>

        <div class="section-title">Tools</div>
        <div id="ap-tools" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
          ${(agent.tools || []).map((t) => `
            <label class="form-check">
              <input type="checkbox" checked data-tool="${esc(t)}" />
              <span>${esc(t)}</span>
            </label>
          `).join('')}
        </div>

        <div class="form-actions" style="justify-content:flex-start;">
          <button class="btn btn-primary btn-sm" onclick="AgentsPage.saveAgent()">Save Changes</button>
          <button class="btn btn-secondary btn-sm" onclick="AgentsPage.closePanel()">Close</button>
        </div>

        <div class="divider"></div>
        <div class="section-title">Recent Runs</div>
        <div id="ap-runs"><div class="spinner" style="width:20px;height:20px;margin:10px auto;"></div></div>
      </div>
    `;

    _panel.classList.add('open');
    loadAgentRuns(agentId);
  }

  async function loadAgentRuns(agentId) {
    const el = document.getElementById('ap-runs');
    if (!el) return;
    try {
      const res = await api('GET', `/api/runs?agent_id=${encodeURIComponent(agentId)}&limit=5`);
      const runs = res?.runs || [];
      if (runs.length === 0) {
        el.innerHTML = '<p class="text-dim text-sm">No runs yet</p>';
        return;
      }
      el.innerHTML = runs.map((r) => `
        <div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;">
          <span class="badge badge-${r.status}">${r.status}</span>
          <span class="text-xs text-muted truncate" style="flex:1">${esc(r.taskTitle || r.task_title || r.taskId || '—')}</span>
          <span class="text-xs text-dim">${timeAgo(r.startedAt || r.created_at)}</span>
        </div>
      `).join('');
    } catch (_) {
      el.innerHTML = '<p class="text-dim text-sm">Could not load runs</p>';
    }
  }

  function closePanel() {
    if (_panel) _panel.classList.remove('open');
    _selectedAgent = null;
  }

  async function saveAgent() {
    if (!_selectedAgent) return;
    const body = {
      name:         document.getElementById('ap-name')?.value?.trim(),
      avatar:       document.getElementById('ap-avatar')?.value?.trim(),
      model:        document.getElementById('ap-model')?.value?.trim(),
      description:  document.getElementById('ap-desc')?.value?.trim(),
      systemPrompt: document.getElementById('ap-prompt')?.value?.trim(),
    };
    try {
      const res = await api('PUT', `/api/agents/${_selectedAgent.id}`, body);
      const updated = res?.agent || res;
      if (updated) {
        const idx = _agents.findIndex((a) => a.id === _selectedAgent.id);
        if (idx >= 0) _agents[idx] = { ..._agents[idx], ...updated };
        refreshGrid();
      }
      toast('Agent saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function deleteAgent(agentId) {
    if (!confirm('Delete this agent? This cannot be undone.')) return;
    try {
      await api('DELETE', `/api/agents/${agentId}`);
      _agents = _agents.filter((a) => a.id !== agentId);
      refreshGrid();
      if (_selectedAgent?.id === agentId) closePanel();
      toast('Agent deleted', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // --------------------------------------------------------
  // New agent modal
  // --------------------------------------------------------
  function showNewAgentModal() {
    openModal(`
      <div style="padding:24px;">
        <h2 style="font-size:16px;font-weight:700;margin-bottom:20px;">New Agent</h2>
        <div class="form-group">
          <label class="form-label">Name *</label>
          <input class="form-input" id="na-name" placeholder="agent-name" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Avatar</label>
            <input class="form-input" id="na-avatar" placeholder="🤖" value="🤖" />
          </div>
          <div class="form-group">
            <label class="form-label">Model</label>
            <input class="form-input" id="na-model" placeholder="gpt-4o" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <input class="form-input" id="na-desc" placeholder="Brief description..." />
        </div>
        <div class="form-group">
          <label class="form-label">System Prompt</label>
          <textarea class="form-textarea" id="na-prompt" rows="5" placeholder="You are a helpful assistant..."></textarea>
        </div>
        <div class="form-actions">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="na-save">Create Agent</button>
        </div>
      </div>
    `);
    document.getElementById('na-save').addEventListener('click', createAgent);
  }

  async function createAgent() {
    const name = document.getElementById('na-name')?.value?.trim();
    if (!name) { toast('Name required', 'warn'); return; }
    const body = {
      name,
      avatar:       document.getElementById('na-avatar')?.value?.trim() || '🤖',
      model:        document.getElementById('na-model')?.value?.trim(),
      description:  document.getElementById('na-desc')?.value?.trim(),
      systemPrompt: document.getElementById('na-prompt')?.value?.trim(),
    };
    try {
      const res = await api('POST', '/api/agents', body);
      const agent = res?.agent || res;
      if (agent) { _agents.unshift(agent); refreshGrid(); }
      closeModal();
      toast('Agent created', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // --------------------------------------------------------
  // Grid
  // --------------------------------------------------------
  function refreshGrid() {
    const grid = document.getElementById('agents-grid');
    if (!grid) return;
    if (_agents.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">🤖</div><div class="empty-state-title">No agents yet</div><div class="empty-state-desc">Create your first agent to get started.</div></div>`;
      return;
    }
    grid.innerHTML = _agents.map(agentCardHTML).join('');
  }

  window.AgentsPage = { openPanel, closePanel, saveAgent, deleteAgent };

  window.Pages = window.Pages || {};
  window.Pages.agents = {
    async render(container) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h2 style="font-size:15px;font-weight:700;">Agents <span id="agents-count" class="text-dim text-sm"></span></h2>
          <button class="btn btn-primary btn-sm" onclick="AgentsPage._showNew()">+ New Agent</button>
        </div>
        <div class="agent-grid" id="agents-grid">
          <div class="loading-spinner-wrap"><div class="spinner"></div></div>
        </div>
      `;
      window.AgentsPage._showNew = showNewAgentModal;
      try {
        const res = await api('GET', '/api/agents');
        _agents = res?.agents || res || [];
        App.agents = _agents;
        refreshGrid();
        const countEl = document.getElementById('agents-count');
        if (countEl) countEl.textContent = `(${_agents.length})`;
      } catch (err) {
        document.getElementById('agents-grid').innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Failed to load</div><div class="empty-state-desc">${esc(err.message)}</div></div>`;
      }
    },

    onSSEEvent(type, data) {
      if (type === 'agent:status_changed' || type === 'agent:updated') {
        const agent = data?.agent;
        if (!agent) return;
        const idx = _agents.findIndex((a) => a.id === agent.id);
        if (idx >= 0) {
          _agents[idx] = { ..._agents[idx], ...agent };
          refreshGrid();
          // Update panel badge if open
          if (_selectedAgent?.id === agent.id) {
            const badge = _panel?.querySelector('.badge');
            if (badge) {
              const map = { idle: 'badge-idle', busy: 'badge-busy', error: 'badge-error' };
              badge.className = `badge ${map[agent.status] || 'badge-idle'}`;
              badge.textContent = agent.status || 'idle';
            }
          }
        }
      }
    },
  };
})();
