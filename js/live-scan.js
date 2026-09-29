// Live Scanning panel (Devices page). States: Ready, Scanning, Devices Detected,
// Scan Completed, No Devices Found, Scanner Offline, Network Error, Database Error,
// Scan Failed. On the local (campus) instance this triggers a real ARP/ICMP discovery
// scan via the existing /api/monitor/discover endpoint. On the cloud dashboard, scanning
// can't run here (see CLOUD_MODE in server/server.js) — this panel instead shows the
// most recent scan recorded by the campus scanner and the live realtime connection state.
(function () {
    const API_BASE = window.MONITOR_API_BASE || window.location.origin;
    let scanInFlight = false;

    function els() {
        return {
            panel: document.getElementById('live-scan-panel'),
            stateText: document.getElementById('scan-state-text'),
            summary: document.getElementById('scan-summary'),
            button: document.getElementById('start-scan-btn'),
            indicator: document.getElementById('scan-realtime-indicator')
        };
    }

    function setState(text, variant) {
        const { stateText } = els();
        if (!stateText) return;
        stateText.textContent = text;
        stateText.className = `small fw-semibold scan-state-pill scan-state-pill--${variant || 'idle'}`;
    }

    function setSummary(text) {
        const { summary } = els();
        if (summary) summary.textContent = text || '';
    }

    function formatRelativeTime(isoString) {
        if (!isoString) return null;
        const diffMs = Date.now() - new Date(isoString).getTime();
        if (!Number.isFinite(diffMs) || diffMs < 0) return null;
        const minutes = Math.round(diffMs / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes} min ago`;
        const hours = Math.round(minutes / 60);
        if (hours < 24) return `${hours} hr ago`;
        return `${Math.round(hours / 24)} day(s) ago`;
    }

    async function refreshDeviceTable() {
        try {
            if (typeof fetchDeviceList === 'function') {
                const devices = await fetchDeviceList();
                if (Array.isArray(devices) && typeof applyDeviceResults === 'function') {
                    applyDeviceResults(devices);
                }
            }
        } catch (error) {
            console.warn('Device table refresh after scan failed:', error.message || error);
        }
    }

    async function startLiveScan() {
        if (scanInFlight) return;
        scanInFlight = true;
        const { button } = els();
        if (button) button.disabled = true;
        setState('Scanning…', 'scanning');
        setSummary('Sweeping the campus network for active devices.');

        try {
            const response = await fetch(`${API_BASE}/api/monitor/discover`, {
                method: 'POST',
                credentials: 'include'
            });

            if (response.status === 409) {
                setState('Scanner Offline', 'warn');
                setSummary('Scanning is disabled in Settings — enable it to run a live scan.');
                return;
            }
            if (response.status === 401 || response.status === 403) {
                setState('Scan Failed', 'error');
                setSummary('You do not have permission to run a scan.');
                return;
            }
            if (response.status >= 500) {
                setState('Database Error', 'error');
                setSummary('The scan ran but saving results to the database failed. Try again shortly.');
                return;
            }
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                setState('Scan Failed', 'error');
                setSummary(payload.error || 'The scan could not be completed.');
                return;
            }

            const result = await response.json();
            const found = Array.isArray(result.discovered) ? result.discovered.length : 0;
            const newCount = Number(result.newCount) || 0;

            if (found === 0) {
                setState('No Devices Found', 'warn');
                setSummary('No responsive devices were found on the configured subnet.');
            } else {
                setState('Scan Completed', 'ok');
                setSummary(`${found} device(s) detected — ${newCount} new. Devices Detected.`);
            }

            await refreshDeviceTable();
        } catch (error) {
            setState('Network Error', 'error');
            setSummary('Could not reach the scanner service. Check the campus server connection.');
        } finally {
            scanInFlight = false;
            if (button) button.disabled = false;
        }
    }

    async function loadLastScanSummary() {
        try {
            const response = await fetch(`${API_BASE}/api/scan-sessions?limit=1`, { credentials: 'include' });
            if (!response.ok) return;
            const sessions = await response.json();
            const last = Array.isArray(sessions) ? sessions[0] : null;
            if (!last) {
                setSummary('No scans recorded yet.');
                return;
            }
            const when = formatRelativeTime(last.completedAt || last.startedAt) || 'recently';
            if (last.status === 'completed') {
                setSummary(`Last scan ${when}: ${last.devicesFound ?? 0} device(s) found, ${last.newDevices ?? 0} new.`);
            } else if (last.status === 'failed') {
                setSummary(`Last scan ${when} failed: ${last.errorMessage || 'Unknown error'}.`);
            } else {
                setSummary(`Last scan started ${when}…`);
            }
        } catch (error) {
            console.warn('Scan history load failed:', error.message || error);
        }
    }

    function updateRealtimeIndicator() {
        const { indicator } = els();
        if (!indicator) return;
        const connected = Boolean(window.__scRealtimeConnected);
        indicator.textContent = connected ? 'Live: Connected' : 'Live: Connecting…';
        indicator.className = `status-pill scan-realtime-pill ${connected ? 'scan-realtime-pill--connected' : ''}`;
    }

    async function initCloudMode() {
        const { button } = els();
        if (button) button.remove();
        setState('Ready', 'idle');
        await loadLastScanSummary();
        updateRealtimeIndicator();
        setInterval(updateRealtimeIndicator, 3000);
        setInterval(loadLastScanSummary, 30000);
    }

    async function initLocalMode() {
        const { indicator, button } = els();
        if (indicator) indicator.remove();
        setState('Ready', 'idle');
        setSummary('Click "Start Live Scan" to sweep the campus network via ARP/ICMP.');

        // Attach the handler immediately — startLiveScan() itself surfaces a 401/403
        // from the server as a "Scan Failed" state, so there's no dead window where a
        // click while the role check below is still in flight silently does nothing.
        if (button) button.addEventListener('click', startLiveScan);

        try {
            const response = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
            const user = response.ok ? await response.json() : null;
            if (!user || user.role !== 'Admin') {
                if (button) {
                    button.disabled = true;
                    button.title = 'Only Admins can start a live scan.';
                }
            }
        } catch (error) {
            // Leave the button enabled; the scan request itself enforces auth/role.
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const { panel } = els();
        if (!panel) return;

        if (window.SMARTCAMPUS_CLOUD) {
            initCloudMode();
        } else {
            initLocalMode();
        }
    });
})();
