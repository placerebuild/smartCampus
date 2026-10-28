const MONITOR_API_BASE = window.MONITOR_API_BASE || window.location.origin;
const ROUTER_IP = window.ROUTER_IP || '';
const ROUTER_LABEL = window.ROUTER_LABEL || 'Router';
const ROUTER_TYPE = window.ROUTER_TYPE || 'Modem/Router';
const ROUTER_LOCATION = window.ROUTER_LOCATION || 'Gateway';
const MONITOR_INTERVAL_MS = Number(window.MONITOR_INTERVAL_MS || 15000);

let monitorTimer = null;
let monitorInFlight = false;
let monitoringEnabledCache = null;
let monitoringEnabledCachedAt = 0;
const MONITORING_CACHE_TTL_MS = 60000;

let realtimeEventSource = null;
window.__scRealtimeConnected = false;

async function resolveMonitoringEnabled() {
    const now = Date.now();
    if (monitoringEnabledCache !== null && (now - monitoringEnabledCachedAt) < MONITORING_CACHE_TTL_MS) {
        return monitoringEnabledCache;
    }

    try {
        const response = await fetch(`${MONITOR_API_BASE}/api/settings/scanning`, { credentials: 'include' });
        if (response.ok) {
            const payload = await response.json();
            if (payload && typeof payload.enabled === 'boolean') {
                monitoringEnabledCache = payload.enabled;
                monitoringEnabledCachedAt = Date.now();
                return monitoringEnabledCache;
            }
        }
    } catch (error) {
        console.warn('Monitoring status check failed:', error.message || error);
    }

    monitoringEnabledCache = true;
    monitoringEnabledCachedAt = Date.now();
    return monitoringEnabledCache;
}

function buildMonitorUrl() {
    const url = new URL(`${MONITOR_API_BASE}/api/monitor/router`);
    if (ROUTER_IP) {
        url.searchParams.set('target', ROUTER_IP);
    }
    return url.toString();
}

async function handleApiError(response, defaultError) {
    if (response.status === 401) return null;
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || defaultError);
    }
    return response.json();
}

async function fetchRouterSnapshot() {
    const url = buildMonitorUrl();
    const response = await fetch(url, { credentials: 'include' });
    return handleApiError(response, 'Router monitor request failed.');
}

async function fetchDeviceList() {
    const response = await fetch(`${MONITOR_API_BASE}/api/devices`, { credentials: 'include' });
    return handleApiError(response, 'Device list request failed.');
}

function statusFromSnapshot(snapshot) {
    if (!snapshot || !snapshot.icmp || !snapshot.icmp.ok) return 'Unknown';
    return snapshot.icmp.alive ? 'Online' : 'Offline';
}

function formatLastSeenValue(value) {
    if (typeof window.formatLastSeen === 'function') {
        return window.formatLastSeen(value);
    }
    return value || '';
}

function buildRouterDevice(snapshot) {
    if (!snapshot || !snapshot.target) return null;

    const snmpOk = snapshot.snmp && snapshot.snmp.ok;
    const routerName = snmpOk && snapshot.snmp.sysName ? snapshot.snmp.sysName : ROUTER_LABEL;
    const macAddress = snapshot.arp && snapshot.arp.ok && snapshot.arp.entry ? snapshot.arp.entry.mac : '';

    return {
        name: routerName,
        type: ROUTER_TYPE,
        ip: snapshot.target,
        mac: macAddress || '',
        location: macAddress ? `${ROUTER_LOCATION} (${macAddress})` : ROUTER_LOCATION,
        status: statusFromSnapshot(snapshot),
        lastSeen: formatLastSeenValue(snapshot.scannedAt),
        description: snmpOk ? snapshot.snmp.sysDescr : ''
    };
}

function updateDeviceTable(snapshot) {
    const device = buildRouterDevice(snapshot);
    if (!device) return;

    if (typeof window.upsertDevice === 'function') {
        window.upsertDevice(device);
    }
    if (typeof window.populateDevicesTable === 'function') {
        window.populateDevicesTable();
    }
}

function updateDashboardMetrics(total, onlineCount, offlineCount, unknownCount, devicesToAlert) {
    const totalEl = document.getElementById('total-devices');
    const onlineEl = document.getElementById('online-count');
    const offlineEl = document.getElementById('offline-count');

    if (totalEl) totalEl.textContent = total;
    if (onlineEl) onlineEl.textContent = onlineCount;
    if (offlineEl) offlineEl.textContent = offlineCount;

    if (typeof window.createStatusChart === 'function') {
        window.createStatusChart(onlineCount, offlineCount, unknownCount);
    }

    if (typeof window.populateDashboardAlerts === 'function') {
        window.populateDashboardAlerts(devicesToAlert);
    }
}

function updateDashboard(snapshot) {
    const device = buildRouterDevice(snapshot);
    if (!device) return;

    const status = device.status;
    const onlineCount = status === 'Online' ? 1 : 0;
    const offlineCount = status === 'Offline' ? 1 : 0;
    const unknownCount = status === 'Unknown' ? 1 : 0;
    const totalCount = onlineCount + offlineCount + unknownCount;

    updateDashboardMetrics(totalCount, onlineCount, offlineCount, unknownCount, [device]);
}

function updateUiFromDevices(devices) {
    if (!Array.isArray(devices)) return;

    if (typeof window.applyDeviceResults === 'function') {
        window.applyDeviceResults(devices);
    }

    const onlineCount = devices.filter(device => device.status === 'Online').length;
    const offlineCount = devices.filter(device => device.status === 'Offline').length;
    const unknownCount = Math.max(0, devices.length - onlineCount - offlineCount);

    updateDashboardMetrics(devices.length, onlineCount, offlineCount, unknownCount, devices);
}

async function refreshAlertsIfPossible() {
    // Snapshot known IDs before refresh so we can toast only the new arrivals.
    const knownIds = new Set(
        (typeof alertsData !== 'undefined' ? alertsData : []).map(a => a.id)
    );

    if (typeof populateAlertsTable === 'function') {
        await populateAlertsTable();
    } else if (typeof setAlertsData === 'function' && typeof populateRecentAlerts === 'function') {
        try {
            const response = await fetch(`${MONITOR_API_BASE}/api/alerts`, { credentials: 'include' });
            const alerts = await handleApiError(response, 'Alerts request failed.');
            if (Array.isArray(alerts)) {
                setAlertsData(alerts);
                populateRecentAlerts();
            }
        } catch (error) {
            console.warn('Alert refresh failed:', error.message || error);
        }
    }

    // Show toast notifications for alerts that just arrived.
    // API returns {id, type, severity, issue, device, time} — map to showAlertToast shape.
    if (typeof showAlertToast === 'function' && typeof alertsData !== 'undefined') {
        for (const a of alertsData) {
            if (!knownIds.has(a.id)) {
                showAlertToast({ ...a, message: a.issue, deviceName: a.device });
            }
        }
    }
}

// Supabase Realtime, relayed to the browser over Server-Sent Events (see
// GET /api/events/stream in server/server.js). Socket.IO can't hold a persistent
// connection on Vercel serverless, so the cloud dashboard uses this instead; the local
// (campus) instance keeps using Socket.IO unchanged. Purely additive: the 15s poll cycle
// above keeps running regardless, so a blocked/unsupported EventSource just falls back
// to polling with no functional loss.
function startRealtimeEvents() {
    if (!window.SMARTCAMPUS_CLOUD || typeof EventSource !== 'function') return;
    if (realtimeEventSource) return;

    realtimeEventSource = new EventSource(`${MONITOR_API_BASE}/api/events/stream`, { withCredentials: true });

    realtimeEventSource.addEventListener('open', () => {
        window.__scRealtimeConnected = true;
    });

    realtimeEventSource.addEventListener('error', () => {
        window.__scRealtimeConnected = false;
        // EventSource reconnects automatically; nothing else to do here.
    });

    realtimeEventSource.addEventListener('devices', (event) => {
        try {
            updateUiFromDevices(JSON.parse(event.data));
        } catch (error) {
            console.warn('Realtime device update failed:', error.message || error);
        }
    });

    realtimeEventSource.addEventListener('alert', () => {
        refreshAlertsIfPossible();
    });

    // Fallback: poll alerts every 30s so notifications still appear during SSE
    // reconnect gaps (Vercel serverless closes SSE after ~50s; EventSource auto-reconnects
    // but there is a window where the 'alert' event would be missed).
    setInterval(refreshAlertsIfPossible, 30000);
}

function shouldStartMonitoring() {
    return Boolean(
        document.getElementById('devices-table') ||
        document.getElementById('statusChart') ||
        document.getElementById('total-devices')
    );
}

// Broader than shouldStartMonitoring(): also covers alerts.html, which has no device
// table/stat tiles but still needs the 'alert' realtime channel (see refreshAlertsIfPossible).
function shouldStartRealtimeEvents() {
    return shouldStartMonitoring() || Boolean(
        document.getElementById('alerts-table') ||
        document.getElementById('recent-alerts')
    );
}

async function runMonitorCycle() {
    const isEnabled = await resolveMonitoringEnabled();
    if (monitorInFlight) return;
    monitorInFlight = true;

    try {
        let devices = null;
        try {
            devices = await fetchDeviceList();
        } catch (error) {
            console.warn('Device list load failed:', error.message || error);
        }

        let snapshot = null;
        try {
            if (isEnabled) snapshot = await fetchRouterSnapshot();
        } catch (error) {
            console.warn('Router monitor failed:', error.message || error);
        }

        if (Array.isArray(devices)) {
            updateUiFromDevices(devices);
        } else if (snapshot) {
            updateDeviceTable(snapshot);
            updateDashboard(snapshot);
        }
    } finally {
        monitorInFlight = false;
    }
}

async function startMonitoring() {
    runMonitorCycle();
    if (monitorTimer) clearInterval(monitorTimer);
    monitorTimer = setInterval(runMonitorCycle, MONITOR_INTERVAL_MS);
}

window.addEventListener('load', () => {
    if (shouldStartMonitoring()) {
        startMonitoring();
    }
    if (shouldStartRealtimeEvents()) {
        startRealtimeEvents();
    }
});
