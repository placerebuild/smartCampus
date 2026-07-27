const USERS_API_BASE = window.MONITOR_API_BASE || window.location.origin;

let usersData = [];
let pendingDeleteId = null;

async function loadUsers() {
    const tbody = document.querySelector('#users-table tbody');
    const errorEl = document.getElementById('users-error');
    if (!tbody) return;

    try {
        const res = await fetch(`${USERS_API_BASE}/api/users`, { credentials: 'include' });
        if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            throw new Error(payload.error || 'Failed to load users.');
        }
        usersData = await res.json();
        renderUsersTable(tbody);
    } catch (err) {
        if (errorEl) {
            errorEl.textContent = err.message || 'Unable to load users.';
            errorEl.classList.remove('d-none');
        }
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">${err.message}</td></tr>`;
    }
}

function renderUsersTable(tbody) {
    const currentUser = window._sessionUser;
    if (!usersData.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No users found.</td></tr>';
        return;
    }

    tbody.innerHTML = usersData.map(user => {
        const isSelf = currentUser && currentUser.userId === user.id;
        const joined = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A';
        const roleBadge = user.role === 'Admin'
            ? '<span class="badge" style="background:#1ecc83">Admin</span>'
            : '<span class="badge bg-secondary">ITStaff</span>';
        const oppositeRole = user.role === 'Admin' ? 'ITStaff' : 'Admin';
        const oppositeLabel = user.role === 'Admin' ? 'Demote to ITStaff' : 'Promote to Admin';

        const actions = isSelf
            ? '<span class="text-muted small">(you)</span>'
            : `<button class="btn btn-sm btn-outline-primary me-1" onclick="changeRole(${user.id}, '${oppositeRole}', this)"
                    title="${oppositeLabel}">
                    <i class="fas fa-exchange-alt me-1"></i>${oppositeLabel}
               </button>
               <button class="btn btn-sm btn-outline-danger" onclick="promptDelete(${user.id}, '${escapeHtml(user.fullName)}')">
                    <i class="fas fa-trash-alt me-1"></i>Delete
               </button>`;

        return `<tr data-user-id="${user.id}">
            <td><strong>${escapeHtml(user.fullName)}</strong></td>
            <td>${escapeHtml(user.email)}</td>
            <td>${roleBadge}</td>
            <td><small class="text-muted">${joined}</small></td>
            <td>${actions}</td>
        </tr>`;
    }).join('');
}

function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function changeRole(userId, newRole, btn) {
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
        const res = await fetch(`${USERS_API_BASE}/api/users/${userId}/role`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: newRole })
        });
        if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            throw new Error(payload.error || 'Failed to change role.');
        }
        await loadUsers();
    } catch (err) {
        btn.disabled = false;
        btn.innerHTML = original;
        alert(err.message || 'Unable to change role.');
    }
}

function promptDelete(userId, userName) {
    pendingDeleteId = userId;
    document.getElementById('deleteUserName').textContent = userName;
    const modal = new bootstrap.Modal(document.getElementById('confirmDeleteModal'));
    modal.show();
}

async function deleteUser() {
    if (!pendingDeleteId) return;
    const btn = document.getElementById('confirmDeleteBtn');
    btn.disabled = true;
    btn.textContent = 'Deleting...';
    try {
        const res = await fetch(`${USERS_API_BASE}/api/users/${pendingDeleteId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            throw new Error(payload.error || 'Failed to delete user.');
        }
        bootstrap.Modal.getInstance(document.getElementById('confirmDeleteModal')).hide();
        pendingDeleteId = null;
        await loadUsers();
    } catch (err) {
        alert(err.message || 'Unable to delete user.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Delete';
    }
}

window.changeRole = changeRole;
window.promptDelete = promptDelete;

window.addEventListener('load', () => {
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    if (confirmBtn) confirmBtn.addEventListener('click', deleteUser);
    loadUsers();
});
