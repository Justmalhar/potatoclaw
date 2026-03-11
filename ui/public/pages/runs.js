/* ============================================================
   Runs Page — Run history + live step viewer
   ============================================================ */
(function () {
  'use strict';

  let _runs = [];
  let _agents = [];
  let _filterStatus = '';
  let _filterAgent = '';
  let _openRunId = null;
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

  function fmtDur(ms) {
    if (!ms && ms !== 0) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  function agentName(agentId) {
    const a = _agents.find((x) => x.id === agentId);
    return a ? `${a.avatar || '🤖'} ${a.name}` : (agentId || '—');
  }

  function filteredRuns() {
    return _runs.filter((r) => {
      if (_filterStatus && r.status !== _filterStatus) return false;
      if (_filterAgent && r.agentId !== _filterAgent && r.agent_id !== _filterAgent) return false;
      return true;
    });
  }

  // --------------------------------------------------------
  // Step rendering
  // --------------------------------------------------------
  function stepIcon(type) {
    const icons = { thought: '💭', tool_call: '🔧', tool_result: '📄', message: '💬', error: '⚠️' };
    return icons[type] || '•';
  }

  function stepIconClass(type) {
    const classes = { thought: 'step-icon-thought', tool_call: 'step-icon-tool_call', tool_result: 'step-icon-tool_result', message: 'step-icon-message', error: 'step-icon-error' };
    return classes[type] || '';
  }

  function collapsible(label, content) {
    const id = 'coll-' + Math.random().toString(36).slice(2);
    return `
      <div class="step-collapsible">
        <button class="step-collapsible-toggle" onclick="
          var b=document.getElementById('${id}');
          b.classList.toggle('open');
          this.textContent=(b.classList.contains('open')?'▾ ':'▸ ')+this.textContent.slice(2);
        ">▸ ${esc(label)}</button>
        <div class="step-collapsible-body" id="${id}">
          <pre class="step-json">${esc(content)}</pre>
        </div>
      </div>
    `;
  }

  function renderStep(step) {
    const type = step.type || step.role || 'message';
    const ts = step.timestamp || step.created_at || '';
    let body = '';

    if (type === 'thought') {
      body = `<div class="step-content" style="font-style:italic;color:var(--text-muted);">${esc(step.content || step.thought || '')}</div>`;
    } else if (type === 'tool_call') {
      const toolName = step.toolName || step.tool_name || step.name || '?';
      const input = typeof step.input === 'object' ? JSON.stringify(step.input, null, 2) : String(step.input || '');
      body = `
        <div class="step-tool-name">🔧 ${esc(toolName)}</div>
        ${input ? collapsible('Input', input) : ''}
      `;
    } else if (type === 'tool_result') {
      const output = typeof step.output === 'object' ? JSON.stringify(step.output, null, 2) : String(step.output || step.content || '');
      const preview = output.slice(0, 200);
      body = output.length > 200
        ? `<div class="step-content text-muted">${esc(preview)}…</div>${collapsible('Full Output', output)}`
        : `<div class="step-content text-muted">${esc(output)}</div>`;
    } else if (type === 'error') {
      body = `<div class="step-content" style="color:var(--red);">${esc(step.content || step.error || '')}</div>`;
    } else {
      // message / assistant
      body = `<div class="step-content">${esc(step.content || step.message || '')}</div>`;
    }

    return `
      <div class="step-item" data-step-type="${esc(type)}">
        <div class="step-icon ${stepIconClass(type)}">${stepIcon(type)}</div>
        <div class="step-body">
          ${ts ? `<div class="step-timestamp">${new Date(ts).toLocaleTimeString()}</div>` : ''}
          ${body}
        </div>
      </div>
    `;
  }

  // --------------------------------------------------------
  // Detail panel
  // --------------------------------------------------------
  async function openRunDetail(runId) {
    _openRunId = runId;

    if (!_panel) {
      _panel = document.createElement('div');
      _panel.className = 'detail-panel';
      document.body.appendChild(_panel);
    }

    const run = _runs.find((r) => r.id === runId) || {};

    _panel.innerHTML = `
      <div class="detail-panel-header">
        <div>
          <div style="font-size:14px;font-weight:700;">Run <span class="font-mono text-xs">${esc(runId.slice(0,8))}</span></div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${agentName(run.agentId || run.agent_id)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="badge badge-${run.status}">${esc(run.status || '—')}</span>
          <button class="btn-icon" onclick="RunsPage.closePanel()">✕</button>
        </div>
      </div>
      <div class="detail-panel-body">
        <div class="run-detail-header" style="margin-bottom:16px;">
          <div class="run-meta-item"><div class="run-meta-label">Task</div><div class="run-meta-value">${esc(run.taskTitle || run.task_title || run.taskId || '—')}</div></div>
          <div class="run-meta-item"><div class="run-meta-label">Duration</div><div class="run-meta-value" id="rpanel-dur">${fmtDur(run.durationMs || run.duration_ms)}</div></div>
          <div class="run-meta-item"><div class="run-meta-label">Tokens</div><div class="run-meta-value">${run.tokensUsed || run.tokens_used || '—'}</div></div>
          <div class="run-meta-item"><div class="run-meta-label">Started</div><div class="run-meta-value">${timeAgo(run.startedAt || run.created_at)}</div></div>
        </div>

        <div class="run-steps">
          <div class="run-steps-header" style="display:flex;align-items:center;justify-content:space-between;">
            <span>Steps</span>
            <label style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px;cursor:pointer;">
              <input type="checkbox" id="rpanel-autoscroll" checked style="accent-color:var(--accent);" />
              Auto-scroll
            </label>
          </div>
          <div class="run-steps-list" id="rpanel-steps">
            <div class="loading-spinner-wrap"><div class="spinner"></div></div>
          </div>
        </div>
      </div>
    `;

    _panel.classList.add('open');
    await loadRunSteps(runId);
  }

  async function loadRunSteps(runId) {
    const stepsEl = document.getElementById('rpanel-steps');
    if (!stepsEl) return;
    try {
      const res = await api('GET', `/api/runs/${runId}`);
      const run = res?.run || res || {};
      const steps = run.steps || [];
      if (steps.length === 0) {
        stepsEl.innerHTML = '<p class="text-dim text-sm" style="padding:16px;">No steps recorded</p>';
        return;
      }
      stepsEl.innerHTML = steps.map(renderStep).join('');
      scrollRunSteps();
    } catch (err) {
      stepsEl.innerHTML = `<p class="text-dim text-sm" style="padding:16px;">Failed: ${esc(err.message)}</p>`;
    }
  }

  function scrollRunSteps() {
    const autoScroll = document.getElementById('rpanel-autoscroll');
    if (!autoScroll?.checked) return;
    const stepsEl = document.getElementById('rpanel-steps');
    if (stepsEl) stepsEl.scrollTop = stepsEl.scrollHeight;
  }

  function closePanel() {
    if (_panel) _panel.classList.remove('open');
    _openRunId = null;
  }

  // --------------------------------------------------------
  // Table
  // --------------------------------------------------------
  function buildTable() {
    const runs = filteredRuns();
    const tableWrap = document.getElementById('runs-table-wrap');
    if (!tableWrap) return;

    if (runs.length === 0) {
      tableWrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">▶️</div>
          <div class="empty-state-title">No runs found</div>
          <div class="empty-state-desc">Runs will appear here when agents execute tasks.</div>
        </div>`;
      return;
    }

    tableWrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Run ID</th>
              <th>Agent</th>
              <th>Task</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Tokens</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            ${runs.map((r) => `
              <tr style="cursor:pointer;" onclick="RunsPage.openDetail('${esc(r.id)}')">
                <td class="font-mono text-xs">${esc(r.id.slice(0,8))}</td>
                <td>${esc(agentName(r.agentId || r.agent_id))}</td>
                <td class="truncate" style="max-width:200px;">${esc(r.taskTitle || r.task_title || r.taskId || '—')}</td>
                <td><span class="badge badge-${r.status}">${esc(r.status)}</span></td>
                <td>${fmtDur(r.durationMs || r.duration_ms)}</td>
                <td>${r.tokensUsed || r.tokens_used || '—'}</td>
                <td class="text-dim">${timeAgo(r.startedAt || r.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  window.RunsPage = {
    openDetail: openRunDetail,
    closePanel,
  };

  window.Pages = window.Pages || {};
  window.Pages.runs = {
    async render(container) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
          <h2 style="font-size:15px;font-weight:700;">Run History</h2>
          <div style="display:flex;gap:8px;margin-left:auto;flex-wrap:wrap;">
            <select class="form-select" id="filter-run-status" style="width:140px;" onchange="RunsPage._filterStatus(this.value)">
              <option value="">All Statuses</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="queued">Queued</option>
            </select>
            <select class="form-select" id="filter-run-agent" style="width:160px;" onchange="RunsPage._filterAgent(this.value)">
              <option value="">All Agents</option>
            </select>
            <button class="btn btn-secondary btn-sm" onclick="RunsPage._refresh()">↻ Refresh</button>
          </div>
        </div>
        <div id="runs-table-wrap">
          <div class="loading-spinner-wrap"><div class="spinner"></div></div>
        </div>
      `;

      window.RunsPage._filterStatus = (v) => { _filterStatus = v; buildTable(); };
      window.RunsPage._filterAgent = (v) => { _filterAgent = v; buildTable(); };
      window.RunsPage._refresh = async () => {
        try {
          const res = await api('GET', '/api/runs?limit=200');
          _runs = res?.runs || [];
          App.runs = _runs;
          buildTable();
        } catch (err) { toast(err.message, 'error'); }
      };

      try {
        const [runsRes, agentsRes] = await Promise.allSettled([
          api('GET', '/api/runs?limit=200'),
          api('GET', '/api/agents'),
        ]);
        _runs = runsRes.status === 'fulfilled' ? (runsRes.value?.runs || []) : [];
        _agents = agentsRes.status === 'fulfilled' ? (agentsRes.value?.agents || []) : [];
        App.runs = _runs;
        App.agents = _agents;

        // Populate agent filter
        const agentSel = document.getElementById('filter-run-agent');
        if (agentSel) {
          _agents.forEach((a) => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = `${a.avatar || '🤖'} ${a.name}`;
            agentSel.appendChild(opt);
          });
        }

        buildTable();
      } catch (err) {
        document.getElementById('runs-table-wrap').innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Failed to load</div><div class="empty-state-desc">${esc(err.message)}</div></div>`;
      }
    },

    onSSEEvent(type, data) {
      if (type === 'run:started') {
        const run = data?.run;
        if (run) { _runs.unshift(run); buildTable(); }
      } else if (type === 'run:completed' || type === 'run:failed') {
        const run = data?.run;
        if (run) {
          const idx = _runs.findIndex((r) => r.id === run.id);
          if (idx >= 0) _runs[idx] = run;
          else _runs.unshift(run);
          buildTable();
        }
      } else if (type === 'run:step') {
        if (data?.runId !== _openRunId && data?.run_id !== _openRunId) return;
        const step = data?.step;
        if (!step) return;
        const stepsEl = document.getElementById('rpanel-steps');
        if (!stepsEl) return;
        const stepEl = document.createElement('div');
        stepEl.innerHTML = renderStep(step);
        while (stepEl.firstChild) stepsEl.appendChild(stepEl.firstChild);
        scrollRunSteps();
      }
    },
  };
})();
