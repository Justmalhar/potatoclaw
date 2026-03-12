/* ============================================================
   Settings Page
   ============================================================ */
(function () {
  'use strict';

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  async function saveSettings() {
    const body = {
      defaultModel:    document.getElementById('cfg-model')?.value?.trim(),
      defaultProvider: document.getElementById('cfg-provider')?.value?.trim(),
      maxTurns:        parseInt(document.getElementById('cfg-max-turns')?.value) || 10,
      logLevel:        document.getElementById('cfg-log-level')?.value,
    };
    try {
      await api('PUT', '/api/settings', body);
      toast('Settings saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  window.Pages = window.Pages || {};
  window.Pages.settings = {
    async render(container) {
      container.innerHTML = `
        <div style="max-width:600px;">
          <div class="card mb-4">
            <div class="card-header"><span class="card-title">General Settings</span></div>
            <div id="settings-form">
              <div class="loading-spinner-wrap"><div class="spinner"></div></div>
            </div>
          </div>
          <div class="card mb-4">
            <div class="card-header"><span class="card-title">System</span></div>
            <div style="padding:16px 0;">
              <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">
                Restart the application to apply secrets and environment changes.
              </p>
              <button class="btn btn-danger" id="sys-restart-btn" onclick="SettingsPage._restart()">🔄 Restart PotatoClaw</button>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">About</span></div>
            <div id="settings-about" style="padding:4px 0;"></div>
          </div>
        </div>
      `;

      try {
        const res = await api('GET', '/api/settings');
        const cfg = res?.settings || res || {};

        document.getElementById('settings-form').innerHTML = `
          <div style="padding:4px 0;">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Default Model</label>
                <input class="form-input" id="cfg-model" value="${esc(cfg.defaultModel || cfg.default_model || '')}" placeholder="gpt-4o" />
                <div class="form-hint">e.g. gpt-4o, claude-3-5-sonnet-20241022</div>
              </div>
              <div class="form-group">
                <label class="form-label">Default Provider</label>
                <select class="form-select" id="cfg-provider">
                  ${['openai','anthropic','google','ollama','groq','together'].map((p) =>
                    `<option value="${p}" ${(cfg.defaultProvider||cfg.default_provider||'').toLowerCase()===p?'selected':''}>${p}</option>`
                  ).join('')}
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Max Turns Per Run</label>
                <input class="form-input" type="number" id="cfg-max-turns" value="${cfg.maxTurns || cfg.max_turns || 10}" min="1" max="100" style="width:120px;" />
                <div class="form-hint">Maximum agent loop iterations</div>
              </div>
              <div class="form-group">
                <label class="form-label">Log Level</label>
                <select class="form-select" id="cfg-log-level">
                  ${['debug','info','warn','error'].map((l) =>
                    `<option value="${l}" ${(cfg.logLevel||cfg.log_level||'info')===l?'selected':''}>${l}</option>`
                  ).join('')}
                </select>
              </div>
            </div>
            ${cfg.dataDir || cfg.data_dir ? `
              <div class="form-group">
                <label class="form-label">Data Directory <span class="text-dim">(read-only)</span></label>
                <input class="form-input" readonly value="${esc(cfg.dataDir || cfg.data_dir)}" style="opacity:0.6;font-family:monospace;" />
              </div>
            ` : ''}
            <div class="form-actions" style="border-top:1px solid var(--border);padding-top:16px;margin-top:8px;justify-content:flex-start;">
              <button class="btn btn-primary" onclick="SettingsPage._save()">Save Settings</button>
            </div>
          </div>
        `;

        document.getElementById('settings-about').innerHTML = `
          <div style="display:grid;gap:8px;">
            ${cfg.version ? `<div style="display:flex;gap:8px;"><span class="text-dim text-sm" style="width:120px;">Version</span><span class="text-sm">${esc(cfg.version)}</span></div>` : ''}
            ${cfg.dataDir || cfg.data_dir ? `<div style="display:flex;gap:8px;"><span class="text-dim text-sm" style="width:120px;">Data Dir</span><span class="text-sm font-mono">${esc(cfg.dataDir || cfg.data_dir)}</span></div>` : ''}
            ${cfg.uptime ? `<div style="display:flex;gap:8px;"><span class="text-dim text-sm" style="width:120px;">Uptime</span><span class="text-sm">${esc(cfg.uptime)}</span></div>` : ''}
          </div>
        `;
      } catch (err) {
        document.getElementById('settings-form').innerHTML = `<p style="color:var(--red);padding:4px 0;">${esc(err.message)}</p>`;
      }

      window.SettingsPage = {
        _save: saveSettings,
        _restart: async () => {
          if (!confirm('Restart PotatoClaw now? The UI will be unavailable for a few seconds.')) return;
          const btn = document.getElementById('sys-restart-btn');
          if (btn) { btn.disabled = true; btn.textContent = '⏳ Restarting...'; }
          try {
            await api('POST', '/api/system/restart');
          } catch (_) {}
          toast('Restarting... page will reload in 6s', 'success');
          setTimeout(() => window.location.reload(), 6000);
        },
      };
    },
  };
})();
