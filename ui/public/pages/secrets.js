/* ============================================================
   Secrets Page — Secrets manager with masked values
   ============================================================ */
(function () {
  'use strict';

  let _secrets = [];
  let _revealed = {};

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
          <div class="empty-state-desc">Add API keys and credentials below.</div>
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
      const res = await api('GET', `/api/secrets/${encodeURIComponent(key)}`);
      _revealed[key] = res?.value || res?.secret || '';
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
          <input class="form-input" id="sec-key" value="${esc(existingKey || '')}" ${isEdit ? 'readonly style="opacity:0.6;"' : ''} placeholder="e.g. OPENAI_API_KEY" />
        </div>
        <div class="form-group">
          <label class="form-label">Value *</label>
          <input class="form-input" type="password" id="sec-val" placeholder="Enter secret value..." />
          <div class="form-hint">Value is encrypted at rest.</div>
        </div>
        <div class="form-actions">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="sec-save">${isEdit ? 'Update' : 'Add Secret'}</button>
        </div>
      </div>
    `);
    document.getElementById('sec-save').addEventListener('click', () => saveSecret(existingKey));
  }

  async function saveSecret(existingKey) {
    const key = document.getElementById('sec-key')?.value?.trim();
    const val = document.getElementById('sec-val')?.value?.trim();
    if (!key) { toast('Key name required', 'warn'); return; }
    if (!val) { toast('Value required', 'warn'); return; }

    try {
      if (existingKey) {
        await api('PUT', `/api/secrets/${encodeURIComponent(existingKey)}`, { value: val });
        delete _revealed[existingKey];
      } else {
        await api('POST', '/api/secrets', { key, value: val });
        if (!_secrets.some((s) => (s.key || s.name) === key)) {
          _secrets.push({ key });
        }
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
        <div class="secrets-warning">
          ⚠️ Changes to secrets require an application restart to take effect.
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h2 style="font-size:15px;font-weight:700;">Secrets Manager</h2>
          <button class="btn btn-primary btn-sm" onclick="SecretsPage._showAdd()">+ Add Secret</button>
        </div>
        <div id="secrets-table-wrap">
          <div class="loading-spinner-wrap"><div class="spinner"></div></div>
        </div>
      `;

      window.SecretsPage._showAdd = () => showAddModal(null);

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
