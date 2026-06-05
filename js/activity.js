const ACTIVITY_API_BASE = window.MONITOR_API_BASE || `http://${window.location.hostname || 'localhost'}:4000`;
const PAGE_SIZE = 50;

let currentOffset = 0;
let totalLogs = 0;
let allLoaded = false;

const ACTION_LABELS = {
    login: 'Login',
    logout: 'Logout',
    user_registered: 'User Registered',
    device_deleted: 'Device Deleted',
    device_updated: 'Device Updated',
    alert_resolved: 'Alert Resolved',
    settings_changed: 'Settings Changed',
    discovery_scan: 'Discovery Scan',
    user_role_changed: 'Role Changed',
    user_deleted: 'User Deleted'
};

const ACTION_ICONS = {
    login: 'fa-sign-in-alt text-success',
    logout: 'fa-sign-out-alt text-secondary',
    user_registered: 'fa-user-plus text-primary',
    device_deleted: 'fa-trash-alt text-danger',
    device_updated: 'fa-edit text-info',
    alert_resolved: 'fa-check-circle text-success',
    settings_changed: 'fa-cog text-warning',
    discovery_scan: 'fa-search text-primary',
    user_role_changed: 'fa-user-shield text-warning',
    user_deleted: 'fa-user-times text-danger'
};

function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDateTime(val) {
    if (!val) return 'N/A';
    const d = new Date(val);
    return isNaN(d) ? String(val) : d.toLocaleString();
}

async function loadActivityLogs(reset = false) {
    if (reset) {
        currentOffset = 0;
        allLoaded = false;
        const tbody = document.querySelector('#activity-table tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';
    }

    const actionFilter = document.getElementById('actionFilter');
    const filterVal = actionFilter ? actionFilter.value : '';
    const errorEl = document.getElementById('activity-error');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    const countEl = document.getElementById('activity-count');

    try {
        const url = new URL(`${ACTIVITY_API_BASE}/api/activity-logs`);
        url.searchParams.set('limit', PAGE_SIZE);
        url.searchParams.set('offset', currentOffset);

        const res = await fetch(url.toString(), { credentials: 'include' });
        if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            throw new Error(payload.error || 'Failed to load activity logs.');
        }

        const data = await res.json();
        totalLogs = data.total;

        let logs = data.logs || [];
        if (filterVal) {
            logs = logs.filter(l => l.Action === filterVal);
        }

        renderLogs(logs, reset);
        currentOffset += data.logs.length;

        const loaded = Math.min(currentOffset, totalLogs);
        if (countEl) countEl.textContent = `Showing ${loaded} of ${totalLogs} entries`;

        allLoaded = currentOffset >= totalLogs;
        if (loadMoreBtn) loadMoreBtn.classList.toggle('d-none', allLoaded);
    } catch (err) {
        if (errorEl) {
            errorEl.textContent = err.message;
            errorEl.classList.remove('d-none');
        }
        const tbody = document.querySelector('#activity-table tbody');
        if (tbody && reset) tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">${err.message}</td></tr>`;
    }
}

function renderLogs(logs, reset) {
    const tbody = document.querySelector('#activity-table tbody');
    if (!tbody) return;

    if (reset) tbody.innerHTML = '';

    if (!logs.length && reset) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No log entries found.</td></tr>';
        return;
    }

    logs.forEach(log => {
        const icon = ACTION_ICONS[log.Action] || 'fa-circle text-muted';
        const label = ACTION_LABELS[log.Action] || escapeHtml(log.Action);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><small class="text-muted">${formatDateTime(log.CreatedAt)}</small></td>
            <td>${escapeHtml(log.FullName || 'System')}</td>
            <td><i class="fas ${icon} me-1"></i>${label}</td>
            <td><small class="text-muted">${escapeHtml(log.Details || '')}</small></td>
            <td><code class="small">${escapeHtml(log.IPAddress || '')}</code></td>`;
        tbody.appendChild(tr);
    });
}

function loadMore() {
    if (!allLoaded) loadActivityLogs(false);
}

window.loadActivityLogs = loadActivityLogs;
window.loadMore = loadMore;

window.addEventListener('load', () => {
    const filterEl = document.getElementById('actionFilter');
    if (filterEl) filterEl.addEventListener('change', () => loadActivityLogs(true));
    loadActivityLogs(true);
});
