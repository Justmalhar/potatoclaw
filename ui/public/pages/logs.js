/* ============================================================
   Logs Page — Live log viewer with SSE stream
   ============================================================ */
(function () {
  'use strict';

  let _autoScroll = true;
  let _levelFilter = '';
  let _lineCount = 0;
  const MAX_LINES = 2000;

  function levelBadge(level) {
    const l = String(level || 'info').toLowerCase();
    const cls = {
      error: 'log-level-error',
      fatal: 'log-level-fatal',
      warn:  'log-level-warn',
      warning: 'log-level-warn',
      info:  'log-level-info',
      debug: 'log-level-debug',
    }[l] || 'log-level-info';
    return `<span class="log-level-${l}" style="font-weight:700;margin-right:6px;">[${l.toUpperCase()}]</span>`;
  }

  function formatLogLine(line) {
    let parsed = null;
    if (typeof line === 'string') {
      try { parsed = JSON.parse(line); } catch (_) { parsed = null; }
    } else if (typeof line === 'object') {
      parsed = line;
    }

    if (parsed) {
      const level = parsed.level || parsed.severity || 'info';
      const ts = parsed.time || parsed.timestamp || parsed.ts || '';
      const msg = parsed.msg || parsed.message || JSON.stringify(parsed);
      const tsStr = ts ? `<span class="log-time">${new Date(ts).toLocaleTimeString()}</span>` : '';
      return `<div class="log-line" data-level="${String(level).toLowerCase()}">${tsStr}${levelBadge(level)}<span class="log-msg">${escHtml(msg)}</span></div>`;
    }

    // Plain text line
    const lineStr = String(line);
    let level = 'info';
    if (/error|fatal/i.test(lineStr)) level = 'error';
    else if (/warn/i.test(lineStr)) level = 'warn';
    else if (/debug/i.test(lineStr)) level = 'debug';

    return `<div class="log-line" data-level="${level}">${levelBadge(level)}<span class="log-msg">${escHtml(lineStr)}</span></div>`;
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function appendLine(lineData) {
    const viewer = document.getElementById('log-viewer');
    if (!viewer) return;

    const el = document.createElement('div');
    el.innerHTML = formatLogLine(lineData);
    const lineEl = el.firstChild;
    if (!lineEl) return;

    // Apply filter
    if (_levelFilter) {
      const lineLevel = (lineEl.dataset?.level || '').toLowerCase();
      const filterLevel = _levelFilter.toLowerCase();
      const hierarchy = ['debug','info','warn','error','fatal'];
      const lineIdx = hierarchy.indexOf(lineLevel);
      const filterIdx = hierarchy.indexOf(filterLevel);
      if (lineIdx < filterIdx) {
        lineEl.style.display = 'none';
      }
    }

    viewer.appendChild(lineEl);
    _lineCount++;

    // Trim old lines
    if (_lineCount > MAX_LINES) {
      const first = viewer.querySelector('.log-line');
      if (first) { first.remove(); _lineCount--; }
    }

    if (_autoScroll) viewer.scrollTop = viewer.scrollHeight;
  }

  function applyFilter(level) {
    _levelFilter = level;
    document.querySelectorAll('.log-pill').forEach((el) => {
      el.classList.toggle('active', el.dataset.level === level);
    });
    const viewer = document.getElementById('log-viewer');
    if (!viewer) return;
    const hierarchy = ['debug','info','warn','error','fatal'];
    const filterIdx = level ? hierarchy.indexOf(level.toLowerCase()) : -1;
    viewer.querySelectorAll('.log-line').forEach((line) => {
      const lineLevel = (line.dataset.level || '').toLowerCase();
      const lineIdx = hierarchy.indexOf(lineLevel);
      if (filterIdx < 0 || lineIdx >= filterIdx) {
        line.style.display = '';
      } else {
        line.style.display = 'none';
      }
    });
  }

  function clearLogs() {
    const viewer = document.getElementById('log-viewer');
    if (viewer) { viewer.innerHTML = ''; _lineCount = 0; }
  }

  window.Pages = window.Pages || {};
  window.Pages.logs = {
    async render(container) {
      container.innerHTML = `
        <div class="log-toolbar">
          <div class="filter-pills">
            <span class="filter-pill log-pill active" data-level="" onclick="LogsPage._filter('')">All</span>
            <span class="filter-pill log-pill" data-level="debug" onclick="LogsPage._filter('debug')" style="color:var(--text-dim);">Debug</span>
            <span class="filter-pill log-pill" data-level="info" onclick="LogsPage._filter('info')" style="color:var(--green);">Info</span>
            <span class="filter-pill log-pill" data-level="warn" onclick="LogsPage._filter('warn')" style="color:var(--yellow);">Warn</span>
            <span class="filter-pill log-pill" data-level="error" onclick="LogsPage._filter('error')" style="color:var(--red);">Error</span>
          </div>
          <div style="display:flex;gap:8px;margin-left:auto;align-items:center;">
            <label class="form-check" style="font-size:12px;">
              <input type="checkbox" id="log-autoscroll" checked onchange="LogsPage._setAutoScroll(this.checked)" style="accent-color:var(--accent);" />
              Auto-scroll
            </label>
            <button class="btn btn-secondary btn-sm" onclick="LogsPage._clear()">Clear</button>
          </div>
        </div>

        <div class="log-viewer" id="log-viewer">
          <div class="log-line" style="color:var(--text-dim);font-style:italic;">Connecting to log stream...</div>
        </div>
      `;

      window.LogsPage._filter = applyFilter;
      window.LogsPage._setAutoScroll = (v) => { _autoScroll = v; };
      window.LogsPage._clear = clearLogs;

      // Load recent logs
      try {
        const res = await api('GET', '/api/logs?limit=200');
        const lines = res?.logs || res?.lines || [];
        clearLogs();
        lines.forEach(appendLine);
      } catch (_) {
        appendLine({ level: 'info', msg: 'Waiting for live log events via SSE...' });
      }
    },

    onSSEEvent(type, data) {
      if (type === 'log' || type === 'log:line') {
        appendLine(data);
      }
    },
  };
})();
