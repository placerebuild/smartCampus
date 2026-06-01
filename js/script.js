let devicesData = [];
let deviceIdCounter = 1;

function isValidIpAddress(value) {
    if (typeof value !== 'string') return false;
    const parts = value.trim().split('.');
    if (parts.length !== 4) return false;
    return parts.every(part => part !== '' && Number.isInteger(Number(part)) && Number(part) >= 0 && Number(part) <= 255);
}

function upsertDevice(device) {
    const index = devicesData.findIndex(item => item.ip === device.ip);
    if (index >= 0) {
        const existing = devicesData[index];
        devicesData[index] = {
            ...existing,
            ...device,
            name: device.name || existing.name,
            type: device.type || existing.type,
            location: device.location || existing.location
        };
        return;
    }

    devicesData.unshift(device);
}

function setScanStatusTone(target, tone) {
    if (!target) return;
    target.className = `small ${tone}`;
}

function formatLastSeen(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function formatDeviceValue(value, fallback = 'N/A') {
    if (value === undefined || value === null || value === '') return fallback;
    return value;
}

function resolveDeviceMetric(device, keys) {
    if (!device) return null;
    for (const key of keys) {
        const value = device[key];
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }
    return null;
}

function formatMetricValue(value, unit) {
    if (value === undefined || value === null || value === '') return 'N/A';
    if (typeof value === 'number' && Number.isFinite(value)) {
        return unit ? `${value} ${unit}` : `${value}`;
    }
    return value;
}

function getDeviceKey(device) {
    if (!device) return '';
    const key = device.id || device.ip;
    return key ? String(key) : '';
}

function findDeviceByKey(key) {
    if (!key) return null;
    return devicesData.find(device => getDeviceKey(device) === key || String(device.ip || '') === key) || null;
}

function buildStatusMarkup(status) {
    const statusValue = status || 'Unknown';
    let statusClass = 'text-warning';
    if (statusValue === 'Online') statusClass = 'text-success';
    if (statusValue === 'Offline') statusClass = 'text-danger';
    return `<span class="${statusClass}"><i class="fas fa-circle"></i> ${statusValue}</span>`;
}

function applyDeviceResults(devices) {
    if (!Array.isArray(devices)) return;
    devicesData = devices.map(device => ({
        ...device,
        lastSeen: formatLastSeen(device.lastSeen)
    }));
    populateDevicesTable();
    setTopologyDevices(devices);
    updateTopologyData({ fit: false });
}



function populateDevicesTable() {
    const tbody = document.querySelector('#devices-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    devicesData.forEach(dev => {
        const statusHTML = buildStatusMarkup(dev.status);
        const deviceKey = getDeviceKey(dev);
        const macValue = formatDeviceValue(dev.mac);
        const macCell = macValue === 'N/A'
            ? '<span class="text-muted">N/A</span>'
            : `<code>${macValue}</code>`;

        tbody.innerHTML += `
            <tr>
                <td><strong>${formatDeviceValue(dev.name || dev.ip || 'Device', 'Device')}</strong></td>
                <td>${formatDeviceValue(dev.type)}</td>
                <td><code>${formatDeviceValue(dev.ip)}</code></td>
                <td>${macCell}</td>
                <td>${formatDeviceValue(dev.location)}</td>
                <td>${statusHTML}</td>
                <td>${formatDeviceValue(dev.lastSeen)}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" data-device-action="view" data-device-key="${deviceKey}">View</button>
                </td>
            </tr>`;
    });
}

function openDeviceDetailsModal(device) {
    const existing = document.getElementById('deviceDetailsModal');
    if (existing) existing.remove();

    const selected = device || {};
    const name = formatDeviceValue(selected.name || selected.ip || 'Device', 'Device');
    const type = formatDeviceValue(selected.type);
    const ip = formatDeviceValue(selected.ip);
    const mac = formatDeviceValue(selected.mac);
    const location = formatDeviceValue(selected.location);
    const building = formatDeviceValue(selected.building);
    const floor = formatDeviceValue(selected.floor);
    const room = formatDeviceValue(selected.room);
    const statusMarkup = buildStatusMarkup(selected.status);
    const lastSeen = formatDeviceValue(selected.lastSeen);
    const description = formatDeviceValue(selected.description, '');

    const bandwidth = formatMetricValue(resolveDeviceMetric(selected, [
        'bandwidth',
        'linkBandwidth',
        'uplinkBandwidth',
        'downlinkBandwidth'
    ]));
    const speed = formatMetricValue(resolveDeviceMetric(selected, [
        'speed',
        'linkSpeed',
        'uplinkSpeed',
        'downlinkSpeed'
    ]));
    const latency = formatMetricValue(resolveDeviceMetric(selected, [
        'latency',
        'responseTime',
        'icmpTimeMs'
    ]), 'ms');
    const traffic = formatMetricValue(resolveDeviceMetric(selected, [
        'traffic',
        'throughput',
        'utilization'
    ]));

    const modalHTML = `
        <div class="modal fade" id="deviceDetailsModal" tabindex="-1" aria-labelledby="deviceDetailsLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-lg">
                <div class="modal-content device-modal-content">
                    <div class="modal-header border-0 pb-0">
                        <div>
                            <h5 class="modal-title" id="deviceDetailsLabel" style="font-family:'Sora',sans-serif;">${name}</h5>
                            <p class="device-modal-meta mb-0">${type} - ${ip}</p>
                        </div>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body pt-3">
                        <div class="device-detail-section">
                            <h6 class="section-title mb-2">Device Overview</h6>
                            <ul class="device-detail-list">
                                <li><span class="device-detail-label">Name</span><strong>${name}</strong></li>
                                <li><span class="device-detail-label">Type</span><span>${type}</span></li>
                                <li><span class="device-detail-label">IP Address</span><code>${ip}</code></li>
                                <li><span class="device-detail-label">MAC Address</span><span>${mac}</span></li>
                                <li><span class="device-detail-label">Location</span><span>${location}</span></li>
                                <li><span class="device-detail-label">Building</span><span>${building}</span></li>
                                <li><span class="device-detail-label">Floor</span><span>${floor}</span></li>
                                <li><span class="device-detail-label">Room/Area</span><span>${room}</span></li>
                                <li><span class="device-detail-label">Status</span>${statusMarkup}</li>
                                <li><span class="device-detail-label">Last Seen</span><span>${lastSeen}</span></li>
                            </ul>
                        </div>
                        <div class="device-detail-section">
                            <h6 class="section-title mb-2">Performance</h6>
                            <div class="device-metric-grid">
                                <div class="device-metric-card">
                                    <span class="device-metric-label">Bandwidth</span>
                                    <strong class="device-metric-value">${bandwidth}</strong>
                                </div>
                                <div class="device-metric-card">
                                    <span class="device-metric-label">Link Speed</span>
                                    <strong class="device-metric-value">${speed}</strong>
                                </div>
                                <div class="device-metric-card">
                                    <span class="device-metric-label">Latency</span>
                                    <strong class="device-metric-value">${latency}</strong>
                                </div>
                                <div class="device-metric-card">
                                    <span class="device-metric-label">Traffic Load</span>
                                    <strong class="device-metric-value">${traffic}</strong>
                                </div>
                            </div>
                        </div>
                        ${description ? `
                        <div class="device-detail-section">
                            <h6 class="section-title mb-2">Notes</h6>
                            <p class="text-muted mb-0">${description}</p>
                        </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const modalEl = document.getElementById('deviceDetailsModal');
    const modal = new bootstrap.Modal(modalEl);
    modalEl.addEventListener('hidden.bs.modal', function () {
        modalEl.remove();
    });
    modal.show();
}

function initDeviceTableActions() {
    const table = document.getElementById('devices-table');
    if (!table || table.dataset.actionsBound === 'true') return;
    table.dataset.actionsBound = 'true';

    table.addEventListener('click', event => {
        const button = event.target.closest('[data-device-action="view"]');
        if (!button) return;

        const deviceKey = button.getAttribute('data-device-key');
        const device = findDeviceByKey(deviceKey);
        openDeviceDetailsModal(device);
    });
}

let alertsData = [];

function setDevicesData(devices) {
    devicesData = Array.isArray(devices) ? devices : [];
    populateDevicesTable();
}

function setAlertsData(alerts) {
    alertsData = Array.isArray(alerts) ? alerts : [];
}

function populateRecentAlerts() {
    const list = document.getElementById('recent-alerts');
    if (!list) return;

    list.innerHTML = alertsData.map(a => `
        <li class="list-group-item d-flex justify-content-between align-items-center">
            <div>
                <strong>${a.device}</strong> - ${a.issue}
                <br><small class="text-muted">${a.time}</small>
            </div>
            <span class="badge bg-${a.severity === 'High' ? 'danger' : 'warning'}">${a.severity}</span>
        </li>`).join('');
}

function populateAlertsTable() {
    const tbody = document.querySelector('#alerts-table tbody');
    if (!tbody) return;

    tbody.innerHTML = alertsData.map(a => `
        <tr>
            <td>${a.time}</td>
            <td>${a.device}</td>
            <td>${a.issue}</td>
            <td><span class="badge bg-${a.severity === 'High' ? 'danger' : 'warning'}">${a.severity}</span></td>
        </tr>`).join('');
}

function populateReportsTable() {
    const tbody = document.querySelector('#reports-devices-table tbody');
    if (!tbody) return;

    tbody.innerHTML = campusDevices.map(device => {
        let statusClass = 'warning';
        if (device.status === 'Online') statusClass = 'success';
        if (device.status === 'Offline') statusClass = 'danger';

        return `
            <tr>
                <td><strong>${device.name}</strong></td>
                <td>${device.type}</td>
                <td><code>${device.ip}</code></td>
                <td>${device.building}</td>
                <td>${device.floor}</td>
                <td><span class="badge bg-${statusClass}">${device.status}</span></td>
            </tr>`;
    }).join('');
}

let topologyNetwork = null;
let topologyNodes = null;
let topologyEdges = null;
let topologySelectedId = null;
let topologyViewMode = 'logical';
let topologyTrafficTimer = null;
let topologyPollTimer = null;
let topologySocket = null;

const topologyIconCache = new Map();

let campusDevices = [];

let campusLinks = [];

function getTopologyApiBase() {
    const host = window.location.hostname || 'localhost';
    return window.TOPOLOGY_API_BASE || window.MONITOR_API_BASE || `http://${host}:4000`;
}

const TOPOLOGY_POLL_INTERVAL_MS = Number(window.TOPOLOGY_POLL_INTERVAL_MS || 15000);

function normalizeTopologyDevice(device) {
    const idSource = device && (device.id || device.DeviceID || device.ip || device.name);
    return {
        id: idSource ? String(idSource) : 'device-unknown',
        name: (device && (device.name || device.DeviceName || device.ip)) || 'Device',
        type: (device && (device.type || device.DeviceType)) || 'Device',
        ip: (device && (device.ip || device.IPAddress)) || '',
        status: (device && device.status) || 'Warning',
        building: (device && device.building) || '',
        floor: (device && device.floor) || '',
        room: (device && device.room) || '',
        location: (device && device.location) || ''
    };
}

function normalizeTopologyLink(link) {
    const fromId = link && link.from ? String(link.from) : '';
    const toId = link && link.to ? String(link.to) : '';
    const idFallback = fromId && toId ? `link-${fromId}-${toId}` : 'link-unknown';
    return {
        id: link && link.id ? String(link.id) : idFallback,
        from: fromId,
        to: toId,
        medium: (link && link.medium) || '',
        bandwidth: (link && link.bandwidth) || '',
        status: (link && link.status) || 'Online',
        traffic: link && link.traffic ? link.traffic : 'normal'
    };
}

function setTopologyDevices(devices) {
    campusDevices = Array.isArray(devices) ? devices.map(normalizeTopologyDevice) : [];
}

function setTopologyLinks(links) {
    campusLinks = Array.isArray(links) ? links.map(normalizeTopologyLink) : [];
}

function statusColor(status) {
    if (status === 'Online') return '#22a55a';
    if (status === 'Offline') return '#de5b54';
    return '#f09a35';
}

function linkColor(status) {
    if (status === 'Online') return '#1f7ae0';
    return '#f09a35';
}

function buildSvgDataUri(svg) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function getTopologyIcon(type) {
    const key = String(type || '').toLowerCase();
    if (topologyIconCache.has(key)) {
        return topologyIconCache.get(key);
    }

    const routerSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="22" fill="#f2f7ff" stroke="#0f2338" stroke-width="3"/><path d="M32 14v10M32 40v10M14 32h10M40 32h10" stroke="#0f2338" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="32" r="4" fill="#0f2338"/></svg>';
    const switchSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="8" y="18" width="48" height="28" rx="6" fill="#f2f7ff" stroke="#0f2338" stroke-width="3"/><circle cx="20" cy="32" r="2" fill="#0f2338"/><circle cx="28" cy="32" r="2" fill="#0f2338"/><circle cx="36" cy="32" r="2" fill="#0f2338"/><circle cx="44" cy="32" r="2" fill="#0f2338"/></svg>';
    const serverSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="18" y="10" width="28" height="44" rx="4" fill="#f2f7ff" stroke="#0f2338" stroke-width="3"/><rect x="24" y="22" width="16" height="2" fill="#0f2338"/><rect x="24" y="30" width="16" height="2" fill="#0f2338"/><rect x="24" y="38" width="16" height="2" fill="#0f2338"/><circle cx="32" cy="46" r="2" fill="#0f2338"/></svg>';
    const pcSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="12" y="14" width="40" height="26" rx="4" fill="#f2f7ff" stroke="#0f2338" stroke-width="3"/><rect x="24" y="42" width="16" height="4" fill="#0f2338"/><rect x="20" y="48" width="24" height="4" fill="#0f2338"/></svg>';
    const apSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="34" r="6" fill="#0f2338"/><path d="M20 26c7-7 17-7 24 0" stroke="#0f2338" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M24 30c4-4 12-4 16 0" stroke="#0f2338" stroke-width="3" stroke-linecap="round" fill="none"/></svg>';

    let svg = switchSvg;
    if (key.includes('router') || key.includes('gateway')) {
        svg = routerSvg;
    } else if (key.includes('server')) {
        svg = serverSvg;
    } else if (key.includes('pc') || key.includes('workstation') || key.includes('desktop')) {
        svg = pcSvg;
    } else if (key.includes('ap') || key.includes('wifi') || key.includes('wireless')) {
        svg = apSvg;
    } else if (key.includes('switch')) {
        svg = switchSvg;
    }

    const icon = buildSvgDataUri(svg);
    topologyIconCache.set(key, icon);
    return icon;
}

function buildTopologyLabel(device) {
    const ipLine = device.ip ? `\n${device.ip}` : '';
    return `${device.name}${ipLine}`.trim();
}

function buildTopologyTitle(device) {
    const parts = [device.type, device.building, device.floor].filter(Boolean);
    return parts.join(' | ');
}

function getTopologyFilters() {
    const buildingFilter = document.getElementById('building-filter');
    const statusFilter = document.getElementById('status-filter');

    return {
        building: buildingFilter ? buildingFilter.value : 'all',
        status: statusFilter ? statusFilter.value : 'all'
    };
}

function initTopologyFilters() {
    const buildingFilter = document.getElementById('building-filter');
    if (!buildingFilter) return;

    const buildings = [...new Set(campusDevices.map(device => device.building))].sort((a, b) =>
        a.localeCompare(b)
    );

    buildingFilter.innerHTML = `
        <option value="all" selected>All Buildings</option>
        ${buildings.map(building => `<option value="${building}">${building}</option>`).join('')}
    `;
}

function normalizeTopologyPayload(payload) {
    if (Array.isArray(payload)) {
        return { devices: payload, links: [] };
    }

    return {
        devices: Array.isArray(payload && payload.devices) ? payload.devices : [],
        links: Array.isArray(payload && payload.links) ? payload.links : []
    };
}

async function fetchTopologySnapshot() {
    const baseUrl = getTopologyApiBase();
    const response = await fetch(`${baseUrl}/api/topology`, { credentials: 'include' });

    if (response.status === 401) {
        return null;
    }

    if (response.ok) {
        return response.json();
    }

    if (response.status === 404) {
        const fallback = await fetch(`${baseUrl}/api/devices`, { credentials: 'include' });
        if (!fallback.ok) return null;
        return fallback.json();
    }

    return null;
}

async function loadTopologySnapshot(options = {}) {
    try {
        const payload = await fetchTopologySnapshot();
        if (!payload) {
            updateTopologyEmptyState(false);
            return;
        }

        const normalized = normalizeTopologyPayload(payload);
        setTopologyDevices(normalized.devices);
        setTopologyLinks(normalized.links);
        updateTopologyData(options);
    } catch (error) {
        console.warn('Topology snapshot load failed:', error.message || error);
    }
}

async function triggerTopologyScan() {
    const baseUrl = getTopologyApiBase();
    try {
        await fetch(`${baseUrl}/api/monitor/discover`, {
            method: 'POST',
            credentials: 'include'
        });
        await fetch(`${baseUrl}/api/monitor/router`, { credentials: 'include' });
    } catch (error) {
        console.warn('Topology scan trigger failed:', error.message || error);
    }
}

function updateTopologyEmptyState(hasData) {
    const emptyState = document.getElementById('topology-empty-state');
    if (!emptyState) return;
    if (hasData) {
        emptyState.classList.remove('active');
    } else {
        emptyState.classList.add('active');
    }
}

function syncDataSet(dataset, items) {
    const ids = new Set(items.map(item => item.id));
    dataset.forEach(item => {
        if (!ids.has(item.id)) {
            dataset.remove(item.id);
        }
    });
    dataset.update(items);
}

function updateTopologyData(options = {}) {
    if (!topologyNetwork || !topologyNodes || !topologyEdges) return;

    const topologyData = buildTopologyData();
    syncDataSet(topologyNodes, topologyData.nodes);
    syncDataSet(topologyEdges, topologyData.edges);

    initTopologyFilters();
    updateTopologyEmptyState(topologyData.nodes.length > 0);

    if (topologySelectedId) {
        renderSelectedDevice(topologySelectedId);
    }

    if (options.fit) {
        topologyNetwork.fit({
            animation: {
                duration: 350,
                easingFunction: 'easeInOutQuad'
            }
        });
    }
}

function applyTopologyLayout(viewMode) {
    if (!topologyNetwork) return;

    if (viewMode === 'floor') {
        topologyNetwork.setOptions({
            layout: { hierarchical: { enabled: false } },
            physics: { enabled: false },
            interaction: {
                dragNodes: true,
                dragView: true,
                zoomView: true
            }
        });
        return;
    }

    topologyNetwork.setOptions({
        layout: { hierarchical: { enabled: false } },
        physics: {
            enabled: true,
            solver: 'forceAtlas2Based',
            forceAtlas2Based: {
                gravitationalConstant: -45,
                centralGravity: 0.015,
                springLength: 190,
                springConstant: 0.08
            },
            stabilization: { iterations: 140 }
        },
        interaction: {
            dragNodes: true,
            dragView: true,
            zoomView: true
        }
    });
}

function startLinkTrafficAnimation() {
    stopLinkTrafficAnimation();
    if (!topologyEdges) return;

    let pulse = false;
    topologyTrafficTimer = setInterval(() => {
        if (!topologyEdges) return;
        pulse = !pulse;
        const updates = [];
        topologyEdges.forEach(edge => {
            if (edge.status !== 'Online') return;
            updates.push({
                id: edge.id,
                width: pulse ? 3 : 2,
                color: { color: pulse ? '#12b3c7' : edge.baseColor || linkColor(edge.status) }
            });
        });
        if (updates.length) {
            topologyEdges.update(updates);
        }
    }, 700);
}

function stopLinkTrafficAnimation() {
    if (topologyTrafficTimer) {
        clearInterval(topologyTrafficTimer);
        topologyTrafficTimer = null;
    }
}

function startTopologyRealtime() {
    stopTopologyRealtime();
    const poll = async () => {
        await triggerTopologyScan();
        await loadTopologySnapshot({ fit: false });
    };

    poll();
    topologyPollTimer = setInterval(poll, TOPOLOGY_POLL_INTERVAL_MS);

    if (typeof io === 'function') {
        topologySocket = io(getTopologyApiBase(), {
            withCredentials: true,
            transports: ['websocket', 'polling']
        });

        topologySocket.on('topology:update', payload => {
            const normalized = normalizeTopologyPayload(payload);
            setTopologyDevices(normalized.devices);
            setTopologyLinks(normalized.links);
            updateTopologyData({ fit: false });
        });

        topologySocket.on('topology:devices', devices => {
            setTopologyDevices(devices);
            updateTopologyData({ fit: false });
        });

        topologySocket.on('topology:links', links => {
            setTopologyLinks(links);
            updateTopologyData({ fit: false });
        });
    }

    startLinkTrafficAnimation();
}

function stopTopologyRealtime() {
    if (topologyPollTimer) {
        clearInterval(topologyPollTimer);
        topologyPollTimer = null;
    }

    if (topologySocket) {
        topologySocket.disconnect();
        topologySocket = null;
    }

    stopLinkTrafficAnimation();
}

function buildTopologyData() {
    const filters = getTopologyFilters();

    const filteredDevices = campusDevices.filter(device => {
        const passBuilding = filters.building === 'all' || device.building === filters.building;
        const passStatus = filters.status === 'all' || device.status === filters.status;
        return passBuilding && passStatus;
    });

    const visibleIds = new Set(filteredDevices.map(device => device.id));

    const nodes = filteredDevices.map(device => {
        const nodeColor = statusColor(device.status);
        const node = {
            id: device.id,
            label: buildTopologyLabel(device),
            title: buildTopologyTitle(device),
            shape: 'image',
            image: getTopologyIcon(device.type),
            size: 30,
            borderWidth: 2,
            color: {
                border: nodeColor,
                background: '#ffffff',
                highlight: {
                    border: '#12b3c7',
                    background: '#ffffff'
                }
            },
            font: {
                color: '#0f2338',
                size: 12,
                face: 'IBM Plex Sans',
                align: 'center'
            },
            shapeProperties: {
                useBorderWithImage: true
            }
        };

        if (Number.isFinite(device.x) && Number.isFinite(device.y)) {
            node.x = device.x;
            node.y = device.y;
            node.fixed = device.locked === true;
        }

        return node;
    });

    const edges = campusLinks
        .filter(link => visibleIds.has(link.from) && visibleIds.has(link.to))
        .map(link => {
            const baseColor = linkColor(link.status);
            const labelParts = [link.medium, link.bandwidth].filter(Boolean);
            return {
                id: link.id,
                from: link.from,
                to: link.to,
                label: labelParts.length ? labelParts.join(' (') + (labelParts.length > 1 ? ')' : '') : '',
                color: { color: baseColor },
                width: link.status === 'Online' ? 2 : 3,
                dashes: link.status !== 'Online',
                smooth: { type: 'dynamic' },
                arrows: { to: { enabled: false } },
                status: link.status,
                baseColor
            };
        });

    return { nodes, edges };
}

function renderSelectedDevice(deviceId) {
    const detailsContainer = document.getElementById('topology-device-details');
    if (!detailsContainer) return;

    if (!deviceId) {
        topologySelectedId = null;
        detailsContainer.innerHTML = '<p class="text-muted mb-0">No device selected yet.</p>';
        return;
    }

    const normalizedId = String(deviceId);
    topologySelectedId = normalizedId;
    const device = campusDevices.find(item => item.id === normalizedId);
    if (!device) {
        detailsContainer.innerHTML = '<p class="text-muted mb-0">Device details unavailable.</p>';
        return;
    }

    const connectedLinks = campusLinks.filter(link => link.from === normalizedId || link.to === normalizedId);
    const connectedDevices = connectedLinks.map(link => {
        const peerId = link.from === normalizedId ? link.to : link.from;
        const peer = campusDevices.find(item => item.id === peerId);
        const metaParts = [];
        if (link.medium) metaParts.push(link.medium);
        if (link.bandwidth) metaParts.push(link.bandwidth);
        metaParts.push(`<span style="color:${linkColor(link.status)}">${link.status}</span>`);
        return {
            name: peer ? peer.name : 'Unknown',
            metaLine: metaParts.join(' | ')
        };
    });

    detailsContainer.innerHTML = `
        <ul class="device-detail-list">
            <li><span class="device-detail-label">Name</span><strong>${device.name}</strong></li>
            <li><span class="device-detail-label">Type</span><span>${device.type}</span></li>
            <li><span class="device-detail-label">IP Address</span><code>${device.ip}</code></li>
            <li><span class="device-detail-label">Building</span><span>${device.building}</span></li>
            <li><span class="device-detail-label">Floor</span><span>${device.floor}</span></li>
            <li><span class="device-detail-label">Room/Area</span><span>${device.room || 'N/A'}</span></li>
            <li><span class="device-detail-label">Status</span><span style="color:${statusColor(device.status)};font-weight:700">${device.status}</span></li>
        </ul>
        <h6 class="section-title mb-2">Connected Links (${connectedDevices.length})</h6>
        ${connectedDevices.length === 0
                    ? '<p class="text-muted mb-0">No active links in current filter scope.</p>'
                    : connectedDevices.map(conn => `
                        <div class="device-connection-item">
                            <strong>${conn.name}</strong><br>
                            <small>${conn.metaLine}</small>
                        </div>
                    `).join('')}
    `;
}

function refreshTopology() {
    updateTopologyData({ fit: true });
}

function initTopology() {
    const container = document.getElementById('network');
    if (!container || typeof vis === 'undefined') return;

    topologyNodes = new vis.DataSet([]);
    topologyEdges = new vis.DataSet([]);
    topologyNetwork = new vis.Network(container, { nodes: topologyNodes, edges: topologyEdges }, {
        autoResize: true,
        interaction: {
            hover: true,
            dragNodes: true,
            dragView: true,
            zoomView: true
        },
        nodes: {
            borderWidth: 2,
            shape: 'image',
            font: {
                face: 'IBM Plex Sans',
                size: 12,
                color: '#0f2338',
                align: 'center'
            }
        },
        edges: {
            smooth: { type: 'dynamic' },
            font: {
                face: 'IBM Plex Sans',
                size: 10,
                color: '#4d6681',
                align: 'top'
            }
        },
        physics: {
            enabled: true,
            solver: 'forceAtlas2Based',
            forceAtlas2Based: {
                gravitationalConstant: -45,
                centralGravity: 0.015,
                springLength: 190,
                springConstant: 0.08
            },
            stabilization: { iterations: 140 }
        }
    });

    topologyNetwork.on('click', params => {
        if (params.nodes && params.nodes.length) {
            renderSelectedDevice(String(params.nodes[0]));
        } else {
            renderSelectedDevice(null);
        }
    });

    initTopologyFilters();

    const buildingFilter = document.getElementById('building-filter');
    const statusFilter = document.getElementById('status-filter');
    const resetButton = document.getElementById('reset-topology-btn');
    const viewModeSelect = document.getElementById('topology-view-mode');

    if (buildingFilter) buildingFilter.addEventListener('change', refreshTopology);
    if (statusFilter) statusFilter.addEventListener('change', refreshTopology);
    if (viewModeSelect) {
        topologyViewMode = viewModeSelect.value || 'logical';
        viewModeSelect.addEventListener('change', function () {
            topologyViewMode = viewModeSelect.value || 'logical';
            applyTopologyLayout(topologyViewMode);
            if (topologyViewMode === 'realtime') {
                startTopologyRealtime();
            } else {
                stopTopologyRealtime();
                loadTopologySnapshot({ fit: false });
            }
        });
    }
    if (resetButton) {
        resetButton.addEventListener('click', function () {
            if (buildingFilter) buildingFilter.value = 'all';
            if (statusFilter) statusFilter.value = 'all';
            refreshTopology();
        });
    }

    applyTopologyLayout(topologyViewMode);
    renderSelectedDevice(null);
    loadTopologySnapshot({ fit: true });

    if (topologyViewMode === 'realtime') {
        startTopologyRealtime();
    }
}

let dashboardChartInstance = null;
let dashboardRefreshTimer = null;

function createStatusChart(onlineCount, offlineCount, unknownCount) {
    const canvas = document.getElementById('statusChart');
    if (!canvas) return;

    const total = onlineCount + offlineCount + unknownCount;

    if (dashboardChartInstance) {
        dashboardChartInstance.data.datasets[0].data = [onlineCount, offlineCount, unknownCount];
        dashboardChartInstance.options.plugins.title.text = `${total} Total Device${total !== 1 ? 's' : ''}`;
        dashboardChartInstance.update();
        return;
    }

    dashboardChartInstance = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: ['Online', 'Offline', 'Unknown'],
            datasets: [{
                data: [onlineCount, offlineCount, unknownCount],
                backgroundColor: [
                    'rgba(24,163,104,0.85)',
                    'rgba(222,91,84,0.85)',
                    'rgba(240,154,53,0.85)'
                ],
                borderColor: [
                    '#18a368',
                    '#de5b54',
                    '#f09a35'
                ],
                borderWidth: 2,
                hoverOffset: 8,
                borderRadius: 4,
                spacing: 2
            }]
        },
        options: {
            responsive: true,
            cutout: '62%',
            plugins: {
                title: {
                    display: true,
                    text: `${total} Total Device${total !== 1 ? 's' : ''}`,
                    font: { family: "'Sora', sans-serif", size: 15, weight: 700 },
                    color: '#122f4b',
                    padding: { bottom: 14 }
                },
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 18,
                        font: { family: "'IBM Plex Sans', sans-serif", size: 13, weight: 600 },
                        color: '#435972'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15,35,56,0.92)',
                    titleFont: { family: "'Sora', sans-serif", weight: 700 },
                    bodyFont: { family: "'IBM Plex Sans', sans-serif" },
                    cornerRadius: 10,
                    padding: 12,
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed;
                            const pct = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return ` ${context.label}: ${value} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function populateDashboardAlerts(devices) {
    const list = document.getElementById('recent-alerts');
    if (!list) return;

    const offlineDevices = devices.filter(d => d.status === 'Offline');
    const alertsEl = document.getElementById('alerts-today');

    if (alertsEl) {
        alertsEl.textContent = offlineDevices.length;
    }

    if (offlineDevices.length === 0) {
        list.innerHTML = `
            <li class="list-group-item d-flex align-items-center gap-2" style="background:transparent;border-color:#e5eef8;padding-left:0;">
                <i class="fas fa-check-circle text-success"></i>
                <span class="text-muted">All devices are online. No alerts.</span>
            </li>`;
        return;
    }

    list.innerHTML = offlineDevices.slice(0, 8).map(d => {
        const time = d.lastSeen ? d.lastSeen : 'Unknown';
        return `
        <li class="list-group-item d-flex justify-content-between align-items-center">
            <div>
                <strong>${d.name || d.ip}</strong> - Device unreachable
                <br><small class="text-muted">${time}</small>
            </div>
            <span class="badge bg-danger">Offline</span>
        </li>`;
    }).join('');
}



function toggleSidebar() {
    document.body.classList.toggle('sidebar-open');
}

function logout() {
    const existing = document.getElementById('logoutConfirmModal');
    if (existing) existing.remove();

    const modalHTML = `
    <div class="modal fade" id="logoutConfirmModal" tabindex="-1" aria-labelledby="logoutConfirmLabel" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content" style="border:none; border-radius:16px; overflow:hidden; box-shadow:0 12px 40px rgba(0,0,0,.25);">
          <div class="modal-body text-center px-4 pt-4 pb-2">
            <div style="width:56px;height:56px;border-radius:50%;background:rgba(220,53,69,.12);display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
              <i class="fas fa-sign-out-alt" style="font-size:24px;color:#dc3545;"></i>
            </div>
            <h5 class="fw-bold mb-2" id="logoutConfirmLabel" style="font-family:'Sora',sans-serif;">Sign Out</h5>
            <p class="text-muted mb-0" style="font-size:.92rem;">Are you sure you want to log out of <strong>SmartCampus SecureNet</strong>?</p>
          </div>
          <div class="modal-footer border-0 justify-content-center gap-2 pb-4 pt-3">
            <button type="button" class="btn px-4" data-bs-dismiss="modal"
              style="border-radius:10px;font-weight:600;border:1.5px solid #dee2e6;background:#fff;color:#495057;">Cancel</button>
            <button type="button" class="btn px-4" id="confirmLogoutBtn"
              style="border-radius:10px;font-weight:600;background:linear-gradient(135deg,#dc3545,#b02a37);color:#fff;border:none;">Log Out</button>
          </div>
        </div>
      </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const modalEl = document.getElementById('logoutConfirmModal');
    const bsModal = new bootstrap.Modal(modalEl, { backdrop: 'static' });

    document.getElementById('confirmLogoutBtn').addEventListener('click', function () {
        if (typeof window.appLogout === 'function') {
            window.appLogout();
        } else {
            window.location.href = 'login.html';
        }
    });

    modalEl.addEventListener('hidden.bs.modal', function () {
        modalEl.remove();
    });

    bsModal.show();
}

async function loadSidebar() {
    try {
        const response = await fetch('../components/sidebar.html');
        if (!response.ok) return;
        const html = await response.text();
        const container = document.getElementById('sidebar-container');
        if (container) {
            container.innerHTML = html;
            const currentPath = window.location.pathname.split('/').pop() || 'index.html';
            const links = container.querySelectorAll('.nav-link');
            links.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === currentPath) {
                    link.classList.add('active');
                }
            });
        }
    } catch (e) {
        console.warn('Sidebar not loaded. Are you running a local server?', e);
    }
}

function getSettingsApiBase() {
    const host = window.location.hostname || 'localhost';
    return window.MONITOR_API_BASE || `http://${host}:4000`;
}

async function fetchScanSettings() {
    try {
        const response = await fetch(`${getSettingsApiBase()}/api/settings/scanning`, {
            credentials: 'include'
        });
        if (!response.ok) return null;
        return response.json();
    } catch (error) {
        console.warn('Scan settings load failed:', error.message || error);
        return null;
    }
}

async function updateScanSettings(enabled) {
    const response = await fetch(`${getSettingsApiBase()}/api/settings/scanning`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
    });

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Unable to update scanning settings.');
    }

    return response.json();
}

function renderScanToggleStatus(enabled, statusEl) {
    if (!statusEl) return;
    statusEl.textContent = enabled ? 'Scanning is on.' : 'Scanning is off.';
    statusEl.className = `text-${enabled ? 'success' : 'danger'} small d-block`;
}

async function initScanSettings() {
    const toggle = document.getElementById('scanToggle');
    if (!toggle) return;

    const statusEl = document.getElementById('scan-toggle-status');
    toggle.disabled = true;
    if (statusEl) {
        statusEl.textContent = 'Loading scanning status...';
        statusEl.className = 'text-muted small d-block';
    }

    let enabled = true;
    const settings = await fetchScanSettings();
    if (settings && typeof settings.enabled === 'boolean') {
        enabled = settings.enabled;
    }

    toggle.checked = enabled;
    renderScanToggleStatus(enabled, statusEl);
    toggle.disabled = false;

    toggle.addEventListener('change', async () => {
        const nextValue = toggle.checked;
        toggle.disabled = true;
        if (statusEl) {
            statusEl.textContent = 'Saving...';
            statusEl.className = 'text-muted small d-block';
        }

        try {
            const payload = await updateScanSettings(nextValue);
            const applied = payload && typeof payload.enabled === 'boolean' ? payload.enabled : nextValue;
            toggle.checked = applied;
            renderScanToggleStatus(applied, statusEl);
        } catch (error) {
            toggle.checked = !nextValue;
            if (statusEl) {
                statusEl.textContent = error.message || 'Unable to update scanning settings.';
                statusEl.className = 'text-danger small d-block';
            }
        } finally {
            toggle.disabled = false;
        }
    });
}

window.onload = async function () {
    await loadSidebar();
    await initScanSettings();
    populateDevicesTable();
    initDeviceTableActions();
    populateRecentAlerts();
    populateAlertsTable();
    populateReportsTable();
    initTopology();

    console.log('%cCampusNet UI layout loaded successfully!', 'color:#0d6efd; font-weight:bold');
};

window.addEventListener('resize', () => {
    if (window.innerWidth >= 992) {
        document.body.classList.remove('sidebar-open');
    }
});
