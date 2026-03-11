/* ============================================================
   Kanban Board Page
   Drag-and-drop between columns, SSE real-time updates
   ============================================================ */
(function () {
  'use strict';

  const COLUMNS = [
    { id: 'backlog',     label: 'Backlog',      color: '#6b7280' },
    { id: 'todo',        label: 'Todo',         color: '#3b82f6' },
    { id: 'in_progress', label: 'In Progress',  color: '#7c3aed' },
    { id: 'review',      label: 'Review',       color: '#f59e0b' },
    { id: 'done',        label: 'Done',         color: '#10b981' },
    { id: 'blocked',     label: 'Blocked',      color: '#ef4444' },
  ];

  const PRIORITY_COLORS = {
    critical: '#ef4444',
    high:     '#f97316',
    medium:   '#f59e0b',
    low:      '#6b7280',
  };

  let _allTasks   = [];
  let _agents     = [];
  let _filters    = { agentId: '', priority: '', tag: '' };
  let _dragTaskId = null;
  let _newTaskCol = null;

  // --------------------------------------------------------
  // Data
  // --------------------------------------------------------
  async function loadData() {
    const [tr, ar] = await Promise.allSettled([
      api('GET', '/api/tasks?limit=500'),
      api('GET', '/api/agents'),
    ]);
    _allTasks = tr.status === 'fulfilled' ? (tr.value?.tasks || []) : [];
    _agents   = ar.status === 'fulfilled' ? (ar.value?.agents || []) : [];
    App.agents = _agents;
    App.tasks  = _allTasks;
  }

  function filteredTasks() {
    return _allTasks.filter((t) => {
      if (_filters.agentId && t.assignedAgentId !== _filters.agentId) return false;
      if (_filters.priority && t.priority !== _filters.priority) return false;
      if (_filters.tag) {
        const tags = Array.isArray(t.tags) ? t.tags : [];
        if (!tags.some((tg) => tg.includes(_filters.tag))) return false;
      }
      return true;
    });
  }

  function agentName(agentId) {
    const a = _agents.find((a) => a.id === agentId);
    return a ? `${a.avatar || '🤖'} ${a.name}` : agentId || '';
  }

  // --------------------------------------------------------
  // Card HTML
  // --------------------------------------------------------
  function cardHtml(task) {
    const pColor = PRIORITY_COLORS[task.priority] || '#6b7280';
    const due = task.dueDate
      ? `<span class="task-due${new Date(task.dueDate) < new Date() ? ' overdue' : ''}">${new Date(task.dueDate).toLocaleDateString()}</span>`
      : '';

    return `
      <div class="task-card"
           draggable="true"
           data-task-id="${task.id}"
           data-status="${task.status}"
           onclick="KanbanPage.openTask('${task.id}')">
        <div class="task-card-top">
          <span class="priority-dot" style="background:${pColor}; box-shadow: ${task.priority === 'critical' ? '0 0 4px ' + pColor : 'none'}; margin-top:3px;"></span>
          <span class="task-title">${escHtml(task.title)}</span>
        </div>
        <div class="task-card-meta">
          ${task.assignedAgentId ? `<span class="task-agent-badge">${agentName(task.assignedAgentId)}</span>` : '<span></span>'}
          ${due}
        </div>
      </div>
    `;
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // --------------------------------------------------------
  // Column HTML
  // --------------------------------------------------------
  function columnHtml(col, tasks) {
    const colTasks = tasks.filter((t) => t.status === col.id);
    return `
      <div class="kanban-column" data-column="${col.id}">
        <div class="kanban-col-header" style="border-top: 2px solid ${col.color};">
          <span class="kanban-col-title">${col.label}</span>
          <span class="kanban-col-count" id="count-${col.id}">${colTasks.length}</span>
        </div>
        <div class="kanban-cards"
             id="col-${col.id}"
             data-status="${col.id}"
             ondragover="KanbanPage.onDragOver(event)"
             ondragenter="KanbanPage.onDragEnter(event)"
             ondragleave="KanbanPage.onDragLeave(event)"
             ondrop="KanbanPage.onDrop(event)">
          ${col.id === 'backlog' ? `
            <button class="btn btn-xs btn-secondary w-full mb-2" onclick="KanbanPage.showNewTaskForm('${col.id}')">+ New Task</button>
            <div id="new-task-form-wrap"></div>
          ` : ''}
          ${colTasks.map(cardHtml).join('')}
        </div>
      </div>
    `;
  }

  // --------------------------------------------------------
  // Toolbar HTML
  // --------------------------------------------------------
  function toolbarHtml() {
    const agentOptions = _agents.map((a) => `<option value="${a.id}">${a.avatar || '🤖'} ${a.name}</option>`).join('');
    return `
      <div class="kanban-toolbar">
        <button class="btn btn-primary btn-sm" onclick="KanbanPage.showNewTaskForm('backlog')">+ New Task</button>

        <div class="kanban-filter">
          <select class="form-select" style="width:160px;" onchange="KanbanPage.setFilter('agentId', this.value)">
            <option value="">All Agents</option>
            ${agentOptions}
          </select>
          <select class="form-select" style="width:130px;" onchange="KanbanPage.setFilter('priority', this.value)">
            <option value="">All Priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>
    `;
  }

  // --------------------------------------------------------
  // Render board
  // --------------------------------------------------------
  function renderBoard(container) {
    const tasks = filteredTasks();
    container.innerHTML = `
      ${toolbarHtml()}
      <div class="kanban-board" id="kanban-board">
        ${COLUMNS.map((col) => columnHtml(col, tasks)).join('')}
      </div>
    `;

    // Attach drag listeners to cards
    attachDragListeners();
  }

  function attachDragListeners() {
    document.querySelectorAll('.task-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        _dragTaskId = card.dataset.taskId;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        _dragTaskId = null;
      });
    });
  }

  // --------------------------------------------------------
  // New task form
  // --------------------------------------------------------
  function showNewTaskForm(colId) {
    _newTaskCol = colId;
    const wrap = document.getElementById('new-task-form-wrap');
    if (!wrap) return;

    const agentOpts = _agents.map((a) => `<option value="${a.id}">${a.avatar || '🤖'} ${a.name}</option>`).join('');

    wrap.innerHTML = `
      <div class="new-task-form" id="new-task-form">
        <input class="form-input" id="nt-title" placeholder="Task title..." autofocus />
        <select class="form-select" id="nt-agent" style="margin-bottom:6px;">
          <option value="">No agent</option>
          ${agentOpts}
        </select>
        <select class="form-select" id="nt-priority" style="margin-bottom:6px;">
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
          <option value="low">Low</option>
        </select>
        <div class="new-task-form-actions">
          <button class="btn btn-primary btn-xs" onclick="KanbanPage.submitNewTask()">Add</button>
          <button class="btn btn-secondary btn-xs" onclick="KanbanPage.hideNewTaskForm()">Cancel</button>
        </div>
      </div>
    `;

    document.getElementById('nt-title').focus();

    // Submit on Enter
    document.getElementById('nt-title').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') KanbanPage.submitNewTask();
      if (e.key === 'Escape') KanbanPage.hideNewTaskForm();
    });
  }

  async function submitNewTask() {
    const titleEl = document.getElementById('nt-title');
    const title = titleEl?.value?.trim();
    if (!title) { titleEl?.focus(); return; }

    const agentId   = document.getElementById('nt-agent')?.value || '';
    const priority  = document.getElementById('nt-priority')?.value || 'medium';

    try {
      const task = await api('POST', '/api/tasks', {
        title,
        status: _newTaskCol || 'backlog',
        priority,
        assignedAgentId: agentId || undefined,
      });

      _allTasks.push(task);
      App.tasks = _allTasks;
      toast('Task created', 'success');
      hideNewTaskForm();
      refreshColumn(_newTaskCol || 'backlog');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function hideNewTaskForm() {
    const wrap = document.getElementById('new-task-form-wrap');
    if (wrap) wrap.innerHTML = '';
  }

  // --------------------------------------------------------
  // Drag & Drop handlers
  // --------------------------------------------------------
  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function onDragEnter(e) {
    const col = e.currentTarget;
    col.classList.add('drag-over');
  }

  function onDragLeave(e) {
    const col = e.currentTarget;
    // Only remove if leaving the column, not a child
    if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
  }

  async function onDrop(e) {
    e.preventDefault();
    const col = e.currentTarget;
    col.classList.remove('drag-over');

    const newStatus = col.dataset.status;
    if (!_dragTaskId || !newStatus) return;

    const task = _allTasks.find((t) => t.id === _dragTaskId);
    if (!task || task.status === newStatus) return;

    const oldStatus = task.status;
    // Optimistic update
    task.status = newStatus;
    refreshColumn(oldStatus);
    refreshColumn(newStatus);

    try {
      const updated = await api('POST', `/api/tasks/${_dragTaskId}/transition`, { status: newStatus });
      if (updated) {
        const idx = _allTasks.findIndex((t) => t.id === _dragTaskId);
        if (idx >= 0) _allTasks[idx] = updated;
      }
    } catch (err) {
      // Revert on failure
      task.status = oldStatus;
      refreshColumn(oldStatus);
      refreshColumn(newStatus);
      toast(`Cannot move: ${err.message}`, 'error');
    }
  }

  // --------------------------------------------------------
  // Refresh a single column's cards
  // --------------------------------------------------------
  function refreshColumn(colId) {
    const colEl    = document.getElementById(`col-${colId}`);
    const countEl  = document.getElementById(`count-${colId}`);
    if (!colEl) return;

    const tasks      = filteredTasks().filter((t) => t.status === colId);
    const isBacklog  = colId === 'backlog';

    // Preserve new-task-form-wrap if present
    const formWrap = colEl.querySelector('#new-task-form-wrap');
    const formHtml = formWrap ? formWrap.innerHTML : '';
    const formBtn  = isBacklog
      ? `<button class="btn btn-xs btn-secondary w-full mb-2" onclick="KanbanPage.showNewTaskForm('backlog')">+ New Task</button><div id="new-task-form-wrap">${formHtml}</div>`
      : '';

    colEl.innerHTML = formBtn + tasks.map(cardHtml).join('');

    if (countEl) countEl.textContent = tasks.length;

    attachDragListeners();
  }

  // --------------------------------------------------------
  // Open task detail modal
  // --------------------------------------------------------
  async function openTask(taskId) {
    try {
      const task = await api('GET', `/api/tasks/${taskId}`);
      showTaskModal(task);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function showTaskModal(task) {
    const priorityDot = `<span class="priority-dot priority-${task.priority}" style="display:inline-block;"></span>`;
    const tags = (Array.isArray(task.tags) ? task.tags : []).map((t) => `<span class="tag">${escHtml(t)}</span>`).join('');
    const agentOpts = _agents.map((a) => `<option value="${a.id}" ${a.id === task.assignedAgentId ? 'selected' : ''}>${a.avatar || '🤖'} ${a.name}</option>`).join('');
    const statusOpts = ['backlog','todo','in_progress','review','done','blocked'].map((s) => `<option value="${s}" ${s === task.status ? 'selected' : ''}>${s.replace('_',' ')}</option>`).join('');

    const runsHtml = (task.runHistory || []).slice(0, 5).map((rid) => `
      <div class="flex items-center gap-2 text-sm py-2" style="border-bottom:1px solid var(--border);">
        <span class="text-dim font-mono text-xs">${rid}</span>
        <button class="btn btn-xs btn-secondary" onclick="KanbanPage.openRun('${rid}')">View Run</button>
      </div>
    `).join('') || '<p class="text-dim text-sm">No runs yet</p>';

    const notesHtml = (task.notes || []).map((n) => `
      <div class="text-sm py-2" style="border-bottom:1px solid var(--border);">
        <span class="text-dim text-xs">${n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}</span>
        <p>${escHtml(n.note)}</p>
      </div>
    `).join('') || '<p class="text-dim text-sm">No notes</p>';

    openModal(`
      <div style="padding:20px;">
        <div class="flex items-center gap-2 mb-4">
          ${priorityDot}
          <h2 style="font-size:16px;font-weight:700;">${escHtml(task.title)}</h2>
          <span class="badge badge-${task.status}" style="margin-left:auto;">${task.status.replace('_',' ')}</span>
        </div>

        <p class="text-muted text-sm mb-4">${escHtml(task.description || '')}</p>

        <div class="form-row mb-4">
          <div class="form-group">
            <label class="form-label">Assigned Agent</label>
            <select class="form-select" id="modal-agent-select" onchange="KanbanPage.updateTaskField('${task.id}','assignedAgentId',this.value)">
              <option value="">Unassigned</option>
              ${agentOpts}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Status</label>
            <select class="form-select" id="modal-status-select" onchange="KanbanPage.moveTask('${task.id}',this.value)">
              ${statusOpts}
            </select>
          </div>
        </div>

        ${tags ? `<div class="tags mb-4">${tags}</div>` : ''}

        <div class="divider"></div>

        <div class="mb-4">
          <div class="section-title">Run History</div>
          ${runsHtml}
        </div>

        <div class="mb-4">
          <div class="section-title">Notes</div>
          ${notesHtml}
          <div class="mt-2 flex gap-2">
            <input class="form-input" style="flex:1;" id="note-input-${task.id}" placeholder="Add note..." />
            <button class="btn btn-secondary btn-sm" onclick="KanbanPage.addNote('${task.id}')">Add</button>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-danger btn-sm" onclick="KanbanPage.deleteTask('${task.id}')">Delete</button>
          <button class="btn btn-secondary btn-sm" onclick="closeModal()">Close</button>
        </div>
      </div>
    `);
  }

  async function moveTask(taskId, newStatus) {
    try {
      const updated = await api('POST', `/api/tasks/${taskId}/transition`, { status: newStatus });
      const idx = _allTasks.findIndex((t) => t.id === taskId);
      if (idx >= 0) {
        const old = _allTasks[idx].status;
        _allTasks[idx] = updated || _allTasks[idx];
        refreshColumn(old);
        refreshColumn(newStatus);
      }
      toast('Status updated', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function updateTaskField(taskId, field, value) {
    try {
      await api('PUT', `/api/tasks/${taskId}`, { [field]: value });
      const idx = _allTasks.findIndex((t) => t.id === taskId);
      if (idx >= 0) _allTasks[idx][field] = value;
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function addNote(taskId) {
    const input = document.getElementById(`note-input-${taskId}`);
    const note = input?.value?.trim();
    if (!note) return;
    try {
      await api('POST', `/api/tasks/${taskId}/notes`, { note });
      input.value = '';
      toast('Note added', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function deleteTask(taskId) {
    if (!confirm('Delete this task?')) return;
    try {
      await api('DELETE', `/api/tasks/${taskId}`);
      _allTasks = _allTasks.filter((t) => t.id !== taskId);
      App.tasks = _allTasks;
      closeModal();
      COLUMNS.forEach((c) => refreshColumn(c.id));
      toast('Task deleted', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function openRun(runId) {
    closeModal();
    navigate(`runs?run=${runId}`);
  }

  // --------------------------------------------------------
  // Filter
  // --------------------------------------------------------
  function setFilter(key, value) {
    _filters[key] = value;
    COLUMNS.forEach((c) => refreshColumn(c.id));
  }

  // --------------------------------------------------------
  // Expose to window for onclick handlers
  // --------------------------------------------------------
  window.KanbanPage = {
    showNewTaskForm,
    hideNewTaskForm,
    submitNewTask,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
    openTask,
    moveTask,
    updateTaskField,
    addNote,
    deleteTask,
    openRun,
    setFilter,
  };

  // --------------------------------------------------------
  // Page API
  // --------------------------------------------------------
  window.Pages = window.Pages || {};
  window.Pages.kanban = {
    async render(container) {
      try {
        await loadData();
        renderBoard(container);
      } catch (err) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Failed to load</div><div class="empty-state-desc">${err.message}</div></div>`;
      }
    },

    onMount(container) {},

    onSSEEvent(type, data) {
      if (type === 'task:created' || type === 'task:status_changed' || type === 'task:assigned') {
        const task = data?.task;
        if (!task) return;

        const idx = _allTasks.findIndex((t) => t.id === task.id);
        if (idx >= 0) {
          const oldStatus = _allTasks[idx].status;
          _allTasks[idx] = task;
          if (oldStatus !== task.status) refreshColumn(oldStatus);
          refreshColumn(task.status);
        } else {
          _allTasks.push(task);
          refreshColumn(task.status);
        }
        App.tasks = _allTasks;
      }
    },
  };
})();
