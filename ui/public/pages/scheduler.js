/* ============================================================
   Scheduler Page — Cron / delayed / recurring job manager
   ============================================================ */
(function () {
  'use strict';

  let _jobs = [];
  let _agents = [];
  let _channels = [];

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function timeAgo(ts) {
    if (!ts) return '—';
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function fmtNextRun(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const diff = d.getTime() - Date.now();
    if (diff < 0) return 'overdue';
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'in <1m';
    if (m < 60) return `in ${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `in ${h}h`;
    return d.toLocaleDateString();
  }

  function statusBadge(status) {
    const map = { active: 'badge-done', paused: 'badge-idle', cancelled: 'badge-failed', completed: 'badge-completed', error: 'badge-error' };
    return `<span class="badge ${map[status] || 'badge-idle'}">${esc(status || 'unknown')}</span>`;
  }

  function renderTable() {
    const wrap = document.getElementById('sched-table-wrap');
    if (!wrap) return;

    if (_jobs.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🕐</div>
          <div class="empty-state-title">No scheduled jobs</div>
          <div class="empty-state-desc">Create recurring tasks, delayed messages, or cron jobs.</div>
        </div>`;
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Description</th>
              <th>Schedule</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Next Run</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${_jobs.map((job) => `
              <tr>
                <td class="font-mono text-xs">${esc((job.id || '').slice(0,8))}</td>
                <td style="max-width:200px;" class="truncate">${esc(job.description || job.message?.slice(0,60) || '—')}</td>
                <td class="font-mono text-xs">
                  ${job.type === 'cron' ? esc(job.cron || job.schedule) :
                    job.type === 'recurring' ? `every ${esc(job.interval || job.intervalMs)}ms` :
                    `delayed ${esc(job.delay || job.delayMs)}ms`}
                </td>
                <td>${esc(job.channelId || job.channel_id || '—')}</td>
                <td>${statusBadge(job.status)}</td>
                <td class="text-dim text-xs">${fmtNextRun(job.nextRun || job.next_run)}</td>
                <td>
                  <div style="display:flex;gap:6px;">
                    ${job.status === 'active'
                      ? `<button class="btn btn-secondary btn-xs" onclick="SchedPage.pauseJob('${esc(job.id)}')">Pause</button>`
                      : `<button class="btn btn-secondary btn-xs" onclick="SchedPage.resumeJob('${esc(job.id)}')">Resume</button>`}
                    <button class="btn btn-danger btn-xs" onclick="SchedPage.cancelJob('${esc(job.id)}')">Cancel</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // --------------------------------------------------------
  // New job modal
  // --------------------------------------------------------
  function showNewJobModal() {
    const agentOpts = _agents.map((a) => `<option value="${esc(a.id)}">${esc(a.avatar || '🤖')} ${esc(a.name)}</option>`).join('');
    const channelOpts = _channels.map((c) => `<option value="${esc(c.id || c.channelId)}">${esc(c.platform)} — ${esc(c.channelId || c.channel_id)}</option>`).join('');

    openModal(`
      <div style="padding:24px;">
        <h2 style="font-size:16px;font-weight:700;margin-bottom:20px;">New Scheduled Job</h2>

        <div class="form-group">
          <label class="form-label">Job Type</label>
          <select class="form-select" id="sj-type" onchange="SchedPage._toggleType(this.value)">
            <option value="delayed">Delayed (one-time, delayed)</option>
            <option value="recurring">Recurring (repeat every N ms)</option>
            <option value="cron">Cron expression</option>
          </select>
        </div>

        <div id="sj-type-fields">
          <div class="form-group">
            <label class="form-label">Delay (ms)</label>
            <input class="form-input" type="number" id="sj-delay" value="60000" min="1000" />
            <div class="form-hint">Milliseconds before first execution</div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Message / Prompt</label>
          <textarea class="form-textarea" id="sj-message" placeholder="Message to send or task to create..." rows="3"></textarea>
        </div>

        <div class="form-group">
          <label class="form-label">Description</label>
          <input class="form-input" id="sj-desc" placeholder="Human-readable description..." />
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Channel <span class="text-dim">(optional)</span></label>
            <select class="form-select" id="sj-channel">
              <option value="">No channel</option>
              ${channelOpts}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Invoke Agent <span class="text-dim">(optional)</span></label>
            <select class="form-select" id="sj-agent">
              <option value="">No agent</option>
              ${agentOpts}
            </select>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="sj-save">Create Job</button>
        </div>
      </div>
    `);

    document.getElementById('sj-save').addEventListener('click', createJob);
    window.SchedPage._toggleType = toggleJobType;
  }

  function toggleJobType(type) {
    const fields = document.getElementById('sj-type-fields');
    if (!fields) return;
    if (type === 'delayed') {
      fields.innerHTML = `
        <div class="form-group">
          <label class="form-label">Delay (ms)</label>
          <input class="form-input" type="number" id="sj-delay" value="60000" min="1000" />
          <div class="form-hint">Milliseconds before execution</div>
        </div>`;
    } else if (type === 'recurring') {
      fields.innerHTML = `
        <div class="form-group">
          <label class="form-label">Interval (ms)</label>
          <input class="form-input" type="number" id="sj-interval" value="3600000" min="1000" />
          <div class="form-hint">Repeat every N milliseconds (3600000 = 1 hour)</div>
        </div>`;
    } else if (type === 'cron') {
      fields.innerHTML = `
        <div class="form-group">
          <label class="form-label">Cron Expression</label>
          <input class="form-input" id="sj-cron" value="0 9 * * *" placeholder="0 9 * * *" />
          <div class="form-hint">Standard cron syntax: min hour day month weekday</div>
        </div>`;
    }
  }

  async function createJob() {
    const type = document.getElementById('sj-type')?.value;
    const message = document.getElementById('sj-message')?.value?.trim();
    const desc = document.getElementById('sj-desc')?.value?.trim();
    const channelId = document.getElementById('sj-channel')?.value;
    const agentId = document.getElementById('sj-agent')?.value;

    if (!message) { toast('Message/prompt required', 'warn'); return; }

    const body = { type, message, description: desc, channelId: channelId || null, agentId: agentId || null };

    if (type === 'delayed') {
      body.delayMs = parseInt(document.getElementById('sj-delay')?.value) || 60000;
    } else if (type === 'recurring') {
      body.intervalMs = parseInt(document.getElementById('sj-interval')?.value) || 3600000;
    } else if (type === 'cron') {
      body.cron = document.getElementById('sj-cron')?.value?.trim();
      if (!body.cron) { toast('Cron expression required', 'warn'); return; }
    }

    try {
      const res = await api('POST', '/api/scheduler/jobs', body);
      const job = res?.job || res;
      if (job) _jobs.unshift(job);
      closeModal();
      renderTable();
      toast('Job scheduled', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function pauseJob(jobId) {
    try {
      await api('POST', `/api/scheduler/jobs/${jobId}/pause`);
      const job = _jobs.find((j) => j.id === jobId);
      if (job) job.status = 'paused';
      renderTable();
      toast('Job paused', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function resumeJob(jobId) {
    try {
      await api('POST', `/api/scheduler/jobs/${jobId}/resume`);
      const job = _jobs.find((j) => j.id === jobId);
      if (job) job.status = 'active';
      renderTable();
      toast('Job resumed', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function cancelJob(jobId) {
    if (!confirm('Cancel this scheduled job?')) return;
    try {
      await api('DELETE', `/api/scheduler/jobs/${jobId}`);
      _jobs = _jobs.filter((j) => j.id !== jobId);
      renderTable();
      toast('Job cancelled', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  window.SchedPage = { pauseJob, resumeJob, cancelJob };

  window.Pages = window.Pages || {};
  window.Pages.scheduler = {
    async render(container) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h2 style="font-size:15px;font-weight:700;">Scheduled Jobs</h2>
          <button class="btn btn-primary btn-sm" onclick="SchedPage._showNew()">+ New Job</button>
        </div>
        <div id="sched-table-wrap">
          <div class="loading-spinner-wrap"><div class="spinner"></div></div>
        </div>
      `;

      window.SchedPage._showNew = showNewJobModal;
      window.SchedPage._toggleType = toggleJobType;

      try {
        const [jobsRes, agRes, chRes] = await Promise.allSettled([
          api('GET', '/api/scheduler/jobs'),
          api('GET', '/api/agents'),
          api('GET', '/api/channels'),
        ]);
        _jobs = jobsRes.status === 'fulfilled' ? (jobsRes.value?.jobs || jobsRes.value || []) : [];
        _agents = agRes.status === 'fulfilled' ? (agRes.value?.agents || agRes.value || []) : [];
        _channels = chRes.status === 'fulfilled' ? (chRes.value?.channels || chRes.value || []) : [];
        renderTable();
      } catch (err) {
        document.getElementById('sched-table-wrap').innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Failed to load</div><div class="empty-state-desc">${esc(err.message)}</div></div>`;
      }
    },
  };
})();
