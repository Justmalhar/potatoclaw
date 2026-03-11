/* ============================================================
   Memory Page — Agent memory, daily logs, search
   ============================================================ */
(function () {
  'use strict';

  let _agents = [];
  let _activeTab = 'agent';
  let _selectedAgent = '';
  let _logFiles = [];

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // --------------------------------------------------------
  // Tab switching
  // --------------------------------------------------------
  function switchTab(tab) {
    _activeTab = tab;
    document.querySelectorAll('.mem-tab').forEach((el) => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });
    document.querySelectorAll('.mem-tab-panel').forEach((el) => {
      el.style.display = el.dataset.tabPanel === tab ? '' : 'none';
    });
  }

  // --------------------------------------------------------
  // Agent Memory tab
  // --------------------------------------------------------
  async function loadAgentMemory(agentId) {
    const editor = document.getElementById('mem-editor');
    const statusEl = document.getElementById('mem-status');
    if (!editor) return;
    if (!agentId) { editor.value = ''; return; }
    editor.value = 'Loading...';
    if (statusEl) statusEl.textContent = '';
    try {
      const res = await api('GET', `/api/agents/${encodeURIComponent(agentId)}/memory`);
      editor.value = res?.content || res?.memory || '';
    } catch (err) {
      editor.value = `# Error loading memory\n${err.message}`;
    }
  }

  async function saveAgentMemory() {
    if (!_selectedAgent) { toast('Select an agent first', 'warn'); return; }
    const content = document.getElementById('mem-editor')?.value || '';
    const statusEl = document.getElementById('mem-status');
    try {
      await api('PUT', `/api/agents/${encodeURIComponent(_selectedAgent)}/memory`, { content });
      if (statusEl) { statusEl.textContent = 'Saved ✓'; statusEl.style.color = 'var(--green)'; }
      toast('Memory saved', 'success');
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // --------------------------------------------------------
  // Daily Logs tab
  // --------------------------------------------------------
  async function loadLogFiles() {
    const listEl = document.getElementById('log-files-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="text-dim text-sm">Loading...</div>';
    try {
      const res = await api('GET', '/api/logs/files');
      _logFiles = res?.files || [];
      if (_logFiles.length === 0) {
        listEl.innerHTML = '<div class="text-dim text-sm">No log files found</div>';
        return;
      }
      listEl.innerHTML = _logFiles.map((f, i) => `
        <div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;transition:background var(--transition);"
             class="log-file-item"
             onclick="MemoryPage.openLogFile(${i})"
             onmouseover="this.style.background='var(--surface-3)'"
             onmouseout="this.style.background=''">
          📄 ${esc(f.name || f)}
        </div>
      `).join('');
    } catch (err) {
      listEl.innerHTML = `<div class="text-dim text-sm">Error: ${esc(err.message)}</div>`;
    }
  }

  async function openLogFile(idx) {
    const file = _logFiles[idx];
    const viewEl = document.getElementById('log-file-viewer');
    if (!viewEl || !file) return;
    viewEl.textContent = 'Loading...';
    try {
      const filename = file.name || file;
      const res = await api('GET', `/api/logs/files/${encodeURIComponent(filename)}`);
      viewEl.textContent = res?.content || res || '(empty)';
    } catch (err) {
      viewEl.textContent = `Error: ${err.message}`;
    }
  }

  // --------------------------------------------------------
  // Search tab
  // --------------------------------------------------------
  async function searchMemory() {
    const query = document.getElementById('mem-search-query')?.value?.trim();
    const scope = document.querySelector('input[name="mem-scope"]:checked')?.value || 'all';
    const agentId = _selectedAgent;
    const resultsEl = document.getElementById('mem-search-results');
    if (!query) { toast('Enter a search query', 'warn'); return; }
    if (!resultsEl) return;
    resultsEl.innerHTML = '<div class="spinner" style="width:20px;height:20px;margin:20px auto;"></div>';
    try {
      const params = new URLSearchParams({ q: query, scope });
      if (scope === 'agent' && agentId) params.set('agentId', agentId);
      const res = await api('GET', `/api/memory/search?${params}`);
      const results = res?.results || [];
      if (results.length === 0) {
        resultsEl.innerHTML = '<p class="text-dim text-sm">No results found</p>';
        return;
      }
      resultsEl.innerHTML = results.map((r) => `
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:8px;">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <span class="badge badge-idle">${esc(r.agentId || r.agent_id || 'unknown')}</span>
            ${r.score ? `<span class="text-dim text-xs">score: ${r.score.toFixed(3)}</span>` : ''}
            <span class="text-dim text-xs" style="margin-left:auto;">${r.file || ''}</span>
          </div>
          <div style="font-size:12px;color:var(--text-muted);line-height:1.5;white-space:pre-wrap;">${esc(r.excerpt || r.content || '')}</div>
        </div>
      `).join('');
    } catch (err) {
      resultsEl.innerHTML = `<p style="color:var(--red);">Error: ${esc(err.message)}</p>`;
    }
  }

  window.MemoryPage = { saveAgentMemory, openLogFile, searchMemory };

  window.Pages = window.Pages || {};
  window.Pages.memory = {
    async render(container) {
      const tabs = [
        { id: 'agent',  label: '🧠 Agent Memory' },
        { id: 'logs',   label: '📅 Daily Logs' },
        { id: 'search', label: '🔍 Search' },
      ];

      container.innerHTML = `
        <div style="display:flex;gap:0;margin-bottom:20px;border-bottom:1px solid var(--border);">
          ${tabs.map((t) => `
            <button class="mem-tab filter-pill" data-tab="${t.id}"
              style="border-radius:0;border:none;border-bottom:2px solid transparent;padding:10px 18px;"
              onclick="MemoryPage._switchTab('${t.id}')">${t.label}</button>
          `).join('')}
        </div>

        <!-- Agent Memory -->
        <div data-tab-panel="agent" class="mem-tab-panel">
          <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">
            <label class="form-label" style="margin:0;">Agent:</label>
            <select class="form-select" id="mem-agent-select" style="width:200px;" onchange="MemoryPage._selectAgent(this.value)">
              <option value="">Select agent...</option>
            </select>
            <span id="mem-status" style="font-size:12px;"></span>
            <button class="btn btn-primary btn-sm" style="margin-left:auto;" onclick="MemoryPage.saveAgentMemory()">💾 Save Memory</button>
          </div>
          <div class="memory-editor-wrap">
            <textarea class="memory-textarea form-textarea" id="mem-editor" placeholder="Select an agent to view and edit their MEMORY.md..." style="min-height:500px;"></textarea>
          </div>
        </div>

        <!-- Daily Logs -->
        <div data-tab-panel="logs" class="mem-tab-panel" style="display:none;">
          <div class="memory-layout">
            <div class="memory-sidebar">
              <div style="padding:12px 14px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;color:var(--text-muted);">LOG FILES</div>
              <div id="log-files-list" style="overflow-y:auto;max-height:calc(100vh - 300px);">
                <div class="text-dim text-sm" style="padding:12px;">Loading...</div>
              </div>
            </div>
            <div>
              <div class="panel">
                <div class="panel-header"><span class="panel-title">Log Content</span></div>
                <div class="panel-body">
                  <pre id="log-file-viewer" style="font-size:11px;color:var(--text-muted);white-space:pre-wrap;max-height:calc(100vh - 300px);overflow-y:auto;line-height:1.6;">Select a log file to view its contents.</pre>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Search -->
        <div data-tab-panel="search" class="mem-tab-panel" style="display:none;">
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;margin-bottom:20px;">
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
              <div class="form-group" style="flex:1;min-width:200px;margin:0;">
                <label class="form-label">Search Query</label>
                <input class="form-input" id="mem-search-query" placeholder="Search memories..." onkeydown="if(event.key==='Enter')MemoryPage.searchMemory()" />
              </div>
              <div class="form-group" style="margin:0;">
                <label class="form-label">Scope</label>
                <div style="display:flex;gap:12px;align-items:center;height:38px;">
                  <label class="form-check"><input type="radio" name="mem-scope" value="all" checked /> All Agents</label>
                  <label class="form-check"><input type="radio" name="mem-scope" value="agent" /> Current Agent</label>
                </div>
              </div>
              <button class="btn btn-primary" onclick="MemoryPage.searchMemory()">Search</button>
            </div>
          </div>
          <div id="mem-search-results"></div>
        </div>
      `;

      window.MemoryPage._switchTab = switchTab;
      window.MemoryPage._selectAgent = async (agentId) => {
        _selectedAgent = agentId;
        if (_activeTab === 'agent') await loadAgentMemory(agentId);
      };

      // Mark first tab active
      switchTab('agent');
      document.querySelector('.mem-tab[data-tab="agent"]')?.classList.add('active');

      try {
        const res = await api('GET', '/api/agents');
        _agents = res?.agents || res || [];
        const sel = document.getElementById('mem-agent-select');
        if (sel) {
          _agents.forEach((a) => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = `${a.avatar || '🤖'} ${a.name}`;
            sel.appendChild(opt);
          });
        }
      } catch (_) {}

      loadLogFiles();
    },
  };
})();
