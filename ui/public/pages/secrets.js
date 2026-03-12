/* ============================================================
   Secrets Page — Secrets manager with masked values
   ============================================================ */
(function () {
  'use strict';

  let _secrets = [];
  let _revealed = {};

  const OPENROUTER_PRESET = [
    { key: 'ANTHROPIC_BASE_URL',              value: 'https://openrouter.ai/api' },
    { key: 'ANTHROPIC_AUTH_TOKEN',            value: '' },   // user fills in their key
    { key: 'ANTHROPIC_API_KEY',               value: '' },   // must be empty
    { key: 'ANTHROPIC_DEFAULT_SONNET_MODEL',  value: 'google/gemini-3-flash-preview' },
    { key: 'ANTHROPIC_DEFAULT_OPUS_MODEL',    value: 'google/gemini-3-pro-preview' },
    { key: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',   value: 'google/gemini-2.5-flash-lite' },
    { key: 'CLAUDE_CODE_SUBAGENT_MODEL',      value: 'google/gemini-3-flash' },
    { key: 'OPENROUTER_API_KEY',              value: '' },   // user fills in their key
  ];

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function maskedValue(key) {
    if (_revealed[key]) return `<span class="secret-value" style="color:var(--text);letter-spacing:normal;">${esc(_revealed[key])}</span>`;
    return `<span class="secret-value">••••••••••••</span>`;
  }

  function renderTable() {
    const wrap = document.getElementById('secrets-table-wrap');
    if (!wrap) return;

    if (_secrets.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔐</div>
          <div class="empty-state-title">No secrets stored</div>
          <div class="empty-state-desc">Add API keys and credentials, or use the OpenRouter preset.</div>
        </div>`;
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Key Name</th>
              <th>Value</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${_secrets.map((s) => {
              const key = s.key || s.name;
              return `
                <tr>
                  <td class="font-mono">${esc(key)}</td>
                  <td>${maskedValue(key)}</td>
                  <td>
                    <div style="display:flex;gap:6px;">
                      <button class="btn btn-secondary btn-xs" onclick="SecretsPage.toggleReveal('${esc(key)}')">
                        ${_revealed[key] ? '🙈 Hide' : '👁 Reveal'}
                      </button>
                      <button class="btn btn-secondary btn-xs" onclick="SecretsPage.editSecret('${esc(key)}')">Edit</button>
                      <button class="btn btn-danger btn-xs" onclick="SecretsPage.deleteSecret('${esc(key)}')">Delete</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  async function toggleReveal(key) {
    if (_revealed[key]) {
      delete _revealed[key];
      renderTable();
      return;
    }
    try {
      // Use the test endpoint to check if set, then show masked value from list
      const s = _secrets.find((x) => (x.key || x.name) === key);
      _revealed[key] = s?.maskedValue || '****';
      renderTable();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function showAddModal(existingKey) {
    const isEdit = !!existingKey;
    openModal(`
      <div style="padding:24px;">
        <h2 style="font-size:16px;font-weight:700;margin-bottom:20px;">${isEdit ? 'Edit Secret' : 'Add Secret'}</h2>
        <div class="form-group">
          <label class="form-label">Key Name *</label>
          <input class="form-input" id="sec-key" value="${esc(existingKey || '')}" ${isEdit ? 'readonly style="opacity:0.6;"' : ''} placeholder="e.g. ANTHROPIC_API_KEY" />
        </div>
        <div class="form-group">
          <label class="form-label">Value *</label>
          <input class="form-input" type="password" id="sec-val" placeholder="Enter secret value..." />
          <div class="form-hint">Value is encrypted at rest with AES-256-GCM.</div>
        </div>
        <div class="form-actions">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="sec-save">${isEdit ? 'Update' : 'Add Secret'}</button>
        </div>
      </div>
    `);
    document.getElementById('sec-save').addEventListener('click', () => saveSecret(existingKey));
  }

  function showOpenRouterModal() {
    openModal(`
      <div style="padding:24px;min-width:480px;">
        <h2 style="font-size:16px;font-weight:700;margin-bottom:6px;">OpenRouter Preset</h2>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:20px;">
          Routes Claude SDK calls through <a href="https://openrouter.ai" target="_blank" style="color:var(--accent);">OpenRouter</a> to use models like Gemini, GPT-4, etc.
        </p>
        <div class="form-group">
          <label class="form-label">OpenRouter API Key *</label>
          <input class="form-input" id="or-key" type="password" placeholder="sk-or-..." />
          <div class="form-hint">Get your key from <a href="https://openrouter.ai/keys" target="_blank" style="color:var(--accent);">openrouter.ai/keys</a></div>
        </div>
        <div class="form-group">
          <label class="form-label">Sonnet model</label>
          <input class="form-input" id="or-sonnet" value="google/gemini-3-flash-preview" />
        </div>
        <div class="form-group">
          <label class="form-label">Opus model</label>
          <input class="form-input" id="or-opus" value="google/gemini-3-pro-preview" />
        </div>
        <div class="form-group">
          <label class="form-label">Haiku model</label>
          <input class="form-input" id="or-haiku" value="google/gemini-2.5-flash-lite" />
        </div>
        <div class="form-group">
          <label class="form-label">Subagent model</label>
          <input class="form-input" id="or-subagent" value="google/gemini-3-flash" />
        </div>
        <div style="background:var(--bg-secondary);border-radius:6px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:var(--text-muted);">
          ℹ️ This will save 8 secrets: <code>OPENROUTER_API_KEY</code>, <code>ANTHROPIC_BASE_URL</code>, <code>ANTHROPIC_AUTH_TOKEN</code>, <code>ANTHROPIC_API_KEY</code> (empty), and the four model overrides.
          A <strong>restart</strong> is required for changes to take effect.
        </div>
        <div class="form-actions">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="or-save">Apply Preset</button>
        </div>
      </div>
    `);
    document.getElementById('or-save').addEventListener('click', applyOpenRouterPreset);
  }

  async function applyOpenRouterPreset() {
    const orKey   = document.getElementById('or-key')?.value?.trim();
    const sonnet  = document.getElementById('or-sonnet')?.value?.trim();
    const opus    = document.getElementById('or-opus')?.value?.trim();
    const haiku   = document.getElementById('or-haiku')?.value?.trim();
    const subagent = document.getElementById('or-subagent')?.value?.trim();

    if (!orKey) { toast('OpenRouter API Key is required', 'warn'); return; }

    const secrets = [
      { key: 'OPENROUTER_API_KEY',             value: orKey },
      { key: 'ANTHROPIC_BASE_URL',              value: 'https://openrouter.ai/api' },
      { key: 'ANTHROPIC_AUTH_TOKEN',            value: orKey },
      { key: 'ANTHROPIC_API_KEY',               value: '' },
      { key: 'ANTHROPIC_DEFAULT_SONNET_MODEL',  value: sonnet },
      { key: 'ANTHROPIC_DEFAULT_OPUS_MODEL',    value: opus },
      { key: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',   value: haiku },
      { key: 'CLAUDE_CODE_SUBAGENT_MODEL',      value: subagent },
    ];

    try {
      for (const s of secrets) {
        await api('POST', '/api/secrets', { key: s.key, value: s.value });
        if (!_secrets.some((x) => (x.key || x.name) === s.key)) {
          _secrets.push({ key: s.key, maskedValue: '****' });
        }
      }
      closeModal();
      renderTable();
      toast('OpenRouter preset applied — restart required to take effect', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function saveSecret(existingKey) {
    const key = document.getElementById('sec-key')?.value?.trim();
    const val = document.getElementById('sec-val')?.value;
    if (!key) { toast('Key name required', 'warn'); return; }
    if (val === undefined || val === null) { toast('Value required', 'warn'); return; }

    try {
      await api('POST', '/api/secrets', { key, value: val });
      if (!_secrets.some((s) => (s.key || s.name) === key)) {
        _secrets.push({ key, maskedValue: '****' });
      }
      closeModal();
      renderTable();
      toast('Secret saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function editSecret(key) {
    showAddModal(key);
  }

  async function deleteSecret(key) {
    if (!confirm(`Delete secret "${key}"?`)) return;
    try {
      await api('DELETE', `/api/secrets/${encodeURIComponent(key)}`);
      _secrets = _secrets.filter((s) => (s.key || s.name) !== key);
      delete _revealed[key];
      renderTable();
      toast('Secret deleted', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  window.SecretsPage = { toggleReveal, editSecret, deleteSecret };

  window.Pages = window.Pages || {};
  window.Pages.secrets = {
    async render(container) {
      container.innerHTML = `
        <div class="secrets-warning" style="display:flex;align-items:center;justify-content:space-between;">
          <span>⚠️ Changes to secrets require a restart to take effect.</span>
          <button class="btn btn-danger btn-sm" id="restart-btn" onclick="SecretsPage._restart()">🔄 Restart Now</button>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h2 style="font-size:15px;font-weight:700;">Secrets Manager</h2>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-secondary btn-sm" onclick="SecretsPage._showOpenRouter()">⚡ OpenRouter Preset</button>
            <button class="btn btn-primary btn-sm" onclick="SecretsPage._showAdd()">+ Add Secret</button>
          </div>
        </div>
        <div id="secrets-table-wrap">
          <div class="loading-spinner-wrap"><div class="spinner"></div></div>
        </div>
      `;

      window.SecretsPage._showAdd = () => showAddModal(null);
      window.SecretsPage._showOpenRouter = () => showOpenRouterModal();
      window.SecretsPage._restart = async () => {
        if (!confirm('Restart PotatoClaw now? The UI will be unavailable for a few seconds.')) return;
        const btn = document.getElementById('restart-btn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Restarting...'; }
        try {
          await api('POST', '/api/system/restart');
          toast('Restarting... reconnecting in 5s', 'success');
          setTimeout(() => window.location.reload(), 5000);
        } catch (_) {
          // Expected — server closed the connection
          toast('Restarting... reconnecting in 5s', 'success');
          setTimeout(() => window.location.reload(), 5000);
        }
      };

      try {
        const res = await api('GET', '/api/secrets');
        _secrets = res?.secrets || res || [];
        renderTable();
      } catch (err) {
        document.getElementById('secrets-table-wrap').innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Failed to load secrets</div><div class="empty-state-desc">${esc(err.message)}</div></div>`;
      }
    },
  };
})();
