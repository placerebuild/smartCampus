const monitorHost = window.location.hostname || 'localhost';
const MONITOR_API_BASE = window.MONITOR_API_BASE || `http://${monitorHost}:4000`;
const ROUTER_IP = window.ROUTER_IP || '';
const ROUTER_LABEL = window.ROUTER_LABEL || 'Router';
const ROUTER_TYPE = window.ROUTER_TYPE || 'Modem/Router';
const ROUTER_LOCATION = window.ROUTER_LOCATION || 'Gateway';
const MONITOR_INTERVAL_MS = Number(window.MONITOR_INTERVAL_MS || 15000);

let monitorTimer = null;
let monitorInFlight = false;
let monitoringEnabledCache = null;

async function resolveMonitoringEnabled() {
    if (monitoringEnabledCache !== null) return monitoringEnabledCache;

    try {
        const response = await fetch(`${MONITOR_API_BASE}/api/settings/scanning`, { credentials: 'include' });
        if (response.ok) {
            const payload = await response.json();
            if (payload && typeof payload.enabled === 'boolean') {
                monitoringEnabledCache = payload.enabled;
                return monitoringEnabledCache;
            }
        }
    } catch (error) {
        console.warn('Monitoring status check failed:', error.message || error);
    }

    monitoringEnabledCache = true;
    return monitoringEnabledCache;
}

function buildMonitorUrl() {
    const url = new URL(`${MONITOR_API_BASE}/api/monitor/router`);
    if (ROUTER_IP) {
        url.searchParams.set('target', ROUTER_IP);
    }
    return url.toString();
}

async function fetchRouterSnapshot() {
    const url = buildMonitorUrl();
    const response = await fetch(url, { credentials: 'include' });

    if (response.status === 401) {
        return null;
    }

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Router monitor request failed.');
    }

    return response.json();
}

async function fetchDeviceList() {
    const response = await fetch(`${MONITOR_API_BASE}/api/devices`, { credentials: 'include' });

    if (response.status === 401) {
        return null;
    }

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Device list request failed.');
    }

    return response.json();
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

function updateDashboard(snapshot) {
    const device = buildRouterDevice(snapshot);
    if (!device) return;

    const status = device.status;
    const onlineCount = status === 'Online' ? 1 : 0;
    const offlineCount = status === 'Offline' ? 1 : 0;
    const unknownCount = status === 'Unknown' ? 1 : 0;
    const totalCount = onlineCount + offlineCount + unknownCount;

    const totalEl = document.getElementById('total-devices');
    const onlineEl = document.getElementById('online-count');
    const offlineEl = document.getElementById('offline-count');

    if (totalEl) totalEl.textContent = totalCount;
    if (onlineEl) onlineEl.textContent = onlineCount;
    if (offlineEl) offlineEl.textContent = offlineCount;

    if (typeof window.createStatusChart === 'function') {
        window.createStatusChart(onlineCount, offlineCount, unknownCount);
    }

    if (typeof window.populateDashboardAlerts === 'function') {
        window.populateDashboardAlerts([device]);
    }
}

function updateUiFromDevices(devices) {
    if (!Array.isArray(devices)) return;

    if (typeof window.applyDeviceResults === 'function') {
        window.applyDeviceResults(devices);
    } else if (typeof window.setDevicesData === 'function') {
        window.setDevicesData(devices);
    }

    const onlineCount = devices.filter(device => device.status === 'Online').length;
    const offlineCount = devices.filter(device => device.status === 'Offline').length;
    const unknownCount = Math.max(0, devices.length - onlineCount - offlineCount);

    const totalEl = document.getElementById('total-devices');
    const onlineEl = document.getElementById('online-count');
    const offlineEl = document.getElementById('offline-count');

    if (totalEl) totalEl.textContent = devices.length;
    if (onlineEl) onlineEl.textContent = onlineCount;
    if (offlineEl) offlineEl.textContent = offlineCount;

    if (typeof window.createStatusChart === 'function') {
        window.createStatusChart(onlineCount, offlineCount, unknownCount);
    }

    if (typeof window.populateDashboardAlerts === 'function') {
        window.populateDashboardAlerts(devices);
    }
}

function shouldStartMonitoring() {
    return Boolean(
        document.getElementById('devices-table') ||
        document.getElementById('statusChart') ||
        document.getElementById('total-devices')
    );
}

async function runMonitorCycle() {
    if (monitoringEnabledCache === false) return;
    if (monitorInFlight) return;
    monitorInFlight = true;

    try {
        const snapshot = await fetchRouterSnapshot();
        if (!snapshot) return;

        let devices = null;
        try {
            devices = await fetchDeviceList();
        } catch (error) {
            console.warn('Device list load failed:', error.message || error);
        }

        if (Array.isArray(devices) && devices.length > 0) {
            updateUiFromDevices(devices);
        } else {
            updateDeviceTable(snapshot);
            updateDashboard(snapshot);
        }
    } catch (error) {
        console.warn('Router monitor failed:', error.message || error);
    } finally {
        monitorInFlight = false;
    }
}

async function startMonitoring() {
    const isEnabled = await resolveMonitoringEnabled();
    if (!isEnabled) return;

    runMonitorCycle();
    if (monitorTimer) clearInterval(monitorTimer);
    monitorTimer = setInterval(runMonitorCycle, MONITOR_INTERVAL_MS);
}

window.addEventListener('load', () => {
    if (shouldStartMonitoring()) {
        startMonitoring();
    }
});
