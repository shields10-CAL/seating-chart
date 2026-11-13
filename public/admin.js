(() => {
  const rows = document.querySelector('#userRows');
  const message = document.querySelector('#adminMessage');
  const form = document.querySelector('#createUserForm');
  const schoolConfigMessage = document.querySelector('#schoolConfigMessage');
  const bellScheduleStatus = document.querySelector('#bellScheduleStatus');
  const bellScheduleDetail = document.querySelector('#bellScheduleDetail');
  const bellScheduleFile = document.querySelector('#bellScheduleFile');
  const calendarStatus = document.querySelector('#calendarStatus');
  const calendarDetail = document.querySelector('#calendarDetail');
  const calendarFile = document.querySelector('#calendarFile');
  const lateStartDays = document.querySelector('#lateStartDays');
  const lateStartDetail = document.querySelector('#lateStartDetail');

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (response.status === 401) {
      window.location.replace('/login');
      throw new Error('Session expired.');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || 'Request failed.');
    return payload;
  }

  function userListFromPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.users)) return payload.users;
    if (Array.isArray(payload.data?.users)) return payload.data.users;
    return [];
  }

  function formatUpdated(value) {
    if (!value) return 'Never updated';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Updated' : `Updated ${date.toLocaleString()}`;
  }

  function setConfiguredChip(element, configured) {
    element.textContent = configured ? 'Configured' : 'Not configured';
    element.classList.toggle('disabled', !configured);
  }

  async function loadSchoolConfig() {
    try {
      const config = await api('/api/admin/school-config');
      setConfiguredChip(bellScheduleStatus, config.bellConfigured);
      setConfiguredChip(calendarStatus, config.calendarConfigured);
      bellScheduleDetail.textContent = config.bellConfigured
        ? `${config.counts?.bellRows || 0} rows across ${config.counts?.scheduleCount || 0} schedule types · ${formatUpdated(config.bellUpdatedAt)}`
        : 'No bell schedule uploaded. Download the template, edit it, then upload the CSV.';
      calendarDetail.textContent = config.calendarConfigured
        ? `${config.counts?.calendarRows || 0} calendar dates · ${formatUpdated(config.calendarUpdatedAt)}`
        : 'No school-year calendar uploaded. Dates not listed will not be treated as school days.';
      const selected = new Set((config.lateStartDays || []).map(Number));
      lateStartDays.querySelectorAll('input[type="checkbox"]').forEach(input => {
        input.checked = selected.has(Number(input.value));
      });
      const names = [...lateStartDays.querySelectorAll('input:checked')].map(input => input.parentElement.textContent.trim());
      lateStartDetail.textContent = names.length ? `Recurring late start: ${names.join(', ')}` : 'No recurring late-start weekdays selected.';
      schoolConfigMessage.textContent = '';
    } catch (error) {
      schoolConfigMessage.style.color = 'var(--danger)';
      schoolConfigMessage.textContent = error.message;
    }
  }

  async function uploadCsv(fileInput, endpoint, successMessage) {
    const file = fileInput.files?.[0];
    if (!file) return;
    schoolConfigMessage.textContent = '';
    try {
      const csv = await file.text();
      await api(endpoint, { method: 'POST', body: JSON.stringify({ csv }) });
      schoolConfigMessage.style.color = 'var(--success)';
      schoolConfigMessage.textContent = successMessage;
      fileInput.value = '';
      await loadSchoolConfig();
    } catch (error) {
      schoolConfigMessage.style.color = 'var(--danger)';
      schoolConfigMessage.textContent = error.message;
      fileInput.value = '';
    }
  }

  async function loadUsers() {
    try {
      const payload = await api('/api/admin/users');
      const users = userListFromPayload(payload);
      rows.innerHTML = users.length ? users.map(user => {
        const role = String(user.role || 'user');
        const banned = Boolean(user.banned);
        const created = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—';
        return `
          <tr data-user-id="${escapeHtml(user.id)}">
            <td class="user-name-cell"><strong>${escapeHtml(user.name || 'Teacher')}</strong><span>${escapeHtml(user.email)}</span></td>
            <td><span class="status-chip ${role.includes('admin') ? 'admin' : ''}">${escapeHtml(role)}</span></td>
            <td><span class="status-chip ${banned ? 'disabled' : ''}">${banned ? 'Disabled' : 'Active'}</span></td>
            <td>${escapeHtml(created)}</td>
            <td><div class="table-actions">
              ${role.includes('admin') ? '' : `<button class="mini-button" data-toggle-disabled="${banned ? 'false' : 'true'}">${banned ? 'Enable' : 'Disable'}</button>`}
              ${role.includes('admin') ? '' : '<button class="mini-button" data-reset-password>Reset password</button>'}
              ${role.includes('admin') ? '' : '<button class="mini-button danger" data-delete-user>Delete</button>'}
            </div></td>
          </tr>`;
      }).join('') : '<tr><td colspan="5">No users found.</td></tr>';
      bindRowActions();
    } catch (error) {
      rows.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  function bindRowActions() {
    rows.querySelectorAll('[data-toggle-disabled]').forEach(button => {
      button.addEventListener('click', async () => {
        const userId = button.closest('tr').dataset.userId;
        const disabled = button.dataset.toggleDisabled === 'true';
        try {
          await api(`/api/admin/users/${encodeURIComponent(userId)}/disabled`, {
            method: 'POST', body: JSON.stringify({ disabled })
          });
          await loadUsers();
        } catch (error) { alert(error.message); }
      });
    });

    rows.querySelectorAll('[data-reset-password]').forEach(button => {
      button.addEventListener('click', async () => {
        const userId = button.closest('tr').dataset.userId;
        const password = window.prompt('Enter a new temporary password (10+ characters):');
        if (!password) return;
        try {
          await api(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
            method: 'POST', body: JSON.stringify({ password })
          });
          alert('Password updated.');
        } catch (error) { alert(error.message); }
      });
    });

    rows.querySelectorAll('[data-delete-user]').forEach(button => {
      button.addEventListener('click', async () => {
        const tr = button.closest('tr');
        const teacherName = tr.querySelector('.user-name-cell strong')?.textContent || 'this teacher';
        if (!window.confirm(`Permanently delete ${teacherName} and all of their seating-chart data?`)) return;
        try {
          await api(`/api/admin/users/${encodeURIComponent(tr.dataset.userId)}`, { method: 'DELETE' });
          await loadUsers();
        } catch (error) { alert(error.message); }
      });
    });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    message.textContent = '';
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          name: document.querySelector('#newUserName').value.trim(),
          email: document.querySelector('#newUserEmail').value.trim().toLowerCase(),
          password: document.querySelector('#newUserPassword').value
        })
      });
      form.reset();
      message.style.color = 'var(--success)';
      message.textContent = 'Teacher account created.';
      await loadUsers();
    } catch (error) {
      message.style.color = 'var(--danger)';
      message.textContent = error.message;
    }
  });

  document.querySelector('#uploadBellScheduleBtn').addEventListener('click', () => bellScheduleFile.click());
  bellScheduleFile.addEventListener('change', () => uploadCsv(
    bellScheduleFile,
    '/api/admin/school-config/bell-schedule',
    'Bell schedule uploaded. All teacher accounts will use the new times.'
  ));

  document.querySelector('#uploadCalendarBtn').addEventListener('click', () => calendarFile.click());
  calendarFile.addEventListener('change', () => uploadCsv(
    calendarFile,
    '/api/admin/school-config/calendar',
    'A/B calendar uploaded. All teacher accounts will use the new school-year calendar.'
  ));

  document.querySelector('#saveLateStartDaysBtn').addEventListener('click', async () => {
    const days = [...lateStartDays.querySelectorAll('input:checked')].map(input => Number(input.value));
    schoolConfigMessage.textContent = '';
    try {
      await api('/api/admin/school-config/late-start-days', {
        method: 'PUT',
        body: JSON.stringify({ days })
      });
      schoolConfigMessage.style.color = 'var(--success)';
      schoolConfigMessage.textContent = 'Late-start weekdays updated.';
      await loadSchoolConfig();
    } catch (error) {
      schoolConfigMessage.style.color = 'var(--danger)';
      schoolConfigMessage.textContent = error.message;
    }
  });

  document.querySelector('#adminSignOut').addEventListener('click', async () => {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin' });
    window.location.replace('/login');
  });

  loadSchoolConfig();
  loadUsers();
})();
