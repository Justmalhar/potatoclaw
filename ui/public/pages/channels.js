/* ============================================================
   Channels Page — Channel bindings management
   ============================================================ */
(function () {
  'use strict';

  let _channels = [];
  let _agents = [];

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  const PLATFORM_ICONS = {
    slack:    '🟢',
    telegram: '✈️',
    discord:  '🎮',
    whatsapp: '💬',
    email:    '📧',
    webhook:  '🔗',
    sms:      '📱',
  };

  function platformIcon(platform) {
    return PLATFORM_ICONS[String(platform).toLowerCase()] || '📡';
  }

  function agentName(agentId) {
    const a = _agents.find((x) => x.id === agentId);
    return a ? `${a.avatar || '🤖'} ${a.name}` : (agentId || '—');
  }

  // --------------------------------------------------------
  // Render table
  // --------------------------------------------------------
  function renderTable() {
    const wrap = document.getElementById('channels-table-wrap');
    if (!wrap) return;

    if (_channels.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📡</div>
          <div class="empty-state-title">No channels configured</div>
          <div class="empty-state-desc">Add a channel to connect agents to messaging platforms.</div>
        </div>`;
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Platform</th>
              <th>Channel ID</th>
              <th>Bound Agent</th>
              <th>Window Size</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${_channels.map((ch) => `
              <tr>
                <td>
                  <span style="font-size:18px;margin-right:6px;">${platformIcon(ch.platform)}</span>
                  <span style="text-transform:capitalize;">${esc(ch.platform)}</span>
                </td>
                <td class="font-mono text-xs">${esc(ch.channelId || ch.channel_id)}</td>
                <td>${esc(agentName(ch.agentId || ch.agent_id))}</td>
                <td>${ch.windowSize || ch.window_size || '—'}</td>
                <td>
                  <span class="badge ${ch.active !== false ? 'badge-done' : 'badge-idle'}">${ch.active !== false ? 'active' : 'inactive'}</span>
                </td>
                <td>
                  <div style="display:flex;gap:6px;">
                    <button class="btn btn-secondary btn-xs" onclick="ChannelsPage.editChannel('${esc(ch.id)}')">Edit</button>
                    <button class="btn btn-danger btn-xs" onclick="ChannelsPage.deleteChannel('${esc(ch.id)}')">Delete</button>
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
  // Add/edit modal
  // --------------------------------------------------------
  function showAddChannelModal(existing) {
    const ch = existing || {};
    const agentOpts = _agents.map((a) => `<option value="${esc(a.id)}" ${a.id === (ch.agentId || ch.agent_id) ? 'selected' : ''}>${esc(a.avatar || '🤖')} ${esc(a.name)}</option>`).join('');
    const isEdit = !!ch.id;

    openModal(`
      <div style="padding:24px;">
        <h2 style="font-size:16px;font-weight:700;margin-bottom:20px;">${isEdit ? 'Edit Channel' : 'Add Channel'}</h2>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Platform</label>
            <select class="form-select" id="ch-platform">
              ${['slack','telegram','discord','whatsapp','email','webhook','sms'].map((p) =>
                `<option value="${p}" ${(ch.platform||'').toLowerCase()===p?'selected':''}>${platformIcon(p)} ${p}</option>`
              ).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Channel ID *</label>
            <input class="form-input" id="ch-channel-id" value="${esc(ch.channelId || ch.channel_id || '')}" placeholder="e.g. C1234567890" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Bound Agent *</label>
          <select class="form-select" id="ch-agent">
            <option value="">Select agent...</option>
            ${agentOpts}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">System Prompt Override <span class="text-dim">(optional)</span></label>
          <textarea class="form-textarea" id="ch-prompt" rows="4" placeholder="Leave blank to use agent default...">${esc(ch.systemPromptOverride || ch.system_prompt_override || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Window Size <span class="text-dim">(messages to include)</span></label>
          <input class="form-input" type="number" id="ch-window" value="${ch.windowSize || ch.window_size || 20}" min="1" max="200" style="width:120px;" />
        </div>
        <div class="form-actions">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="ch-save">${isEdit ? 'Save Changes' : 'Add Channel'}</button>
        </div>
      </div>
    `);

    document.getElementById('ch-save').addEventListener('click', () => saveChannel(ch.id || null));
  }

  async function saveChannel(channelId) {
    const platform = document.getElementById('ch-platform')?.value;
    const chId = document.getElementById('ch-channel-id')?.value?.trim();
    const agentId = document.getElementById('ch-agent')?.value;
    if (!chId) { toast('Channel ID required', 'warn'); return; }
    if (!agentId) { toast('Agent required', 'warn'); return; }

    const body = {
      platform,
      channelId: chId,
      agentId,
      systemPromptOverride: document.getElementById('ch-prompt')?.value?.trim() || null,
      windowSize: parseInt(document.getElementById('ch-window')?.value) || 20,
    };

    try {
      if (channelId) {
        const res = await api('PUT', `/api/channels/${channelId}`, body);
        const updated = res?.channel || res;
        const idx = _channels.findIndex((c) => c.id === channelId);
        if (idx >= 0 && updated) _channels[idx] = updated;
      } else {
        const res = await api('POST', '/api/channels', body);
        const channel = res?.channel || res;
        if (channel) _channels.unshift(channel);
      }
      closeModal();
      renderTable();
      toast(channelId ? 'Channel updated' : 'Channel added', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function editChannel(channelId) {
    const ch = _channels.find((c) => c.id === channelId);
    if (!ch) return;
    showAddChannelModal(ch);
  }

  async function deleteChannel(channelId) {
    if (!confirm('Delete this channel binding?')) return;
    try {
      await api('DELETE', `/api/channels/${channelId}`);
      _channels = _channels.filter((c) => c.id !== channelId);
      renderTable();
      toast('Channel deleted', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  window.ChannelsPage = { editChannel, deleteChannel };

  window.Pages = window.Pages || {};
  window.Pages.channels = {
    async render(container) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h2 style="font-size:15px;font-weight:700;">Channel Bindings</h2>
          <button class="btn btn-primary btn-sm" onclick="ChannelsPage._showAdd()">+ Add Channel</button>
        </div>
        <div id="channels-table-wrap">
          <div class="loading-spinner-wrap"><div class="spinner"></div></div>
        </div>
      `;

      window.ChannelsPage._showAdd = () => showAddChannelModal(null);

      try {
        const [chRes, agRes] = await Promise.allSettled([
          api('GET', '/api/channels'),
          api('GET', '/api/agents'),
        ]);
        _channels = chRes.status === 'fulfilled' ? (chRes.value?.channels || chRes.value || []) : [];
        _agents = agRes.status === 'fulfilled' ? (agRes.value?.agents || agRes.value || []) : [];
        renderTable();
      } catch (err) {
        document.getElementById('channels-table-wrap').innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Failed to load</div><div class="empty-state-desc">${esc(err.message)}</div></div>`;
      }
    },
  };
})();
