function showPage(page) {
    const contentArea = document.getElementById('content-area');
    if (!contentArea) return;

    const pageTitles = {
        dashboard: 'Dashboard',
        devices: 'Devices',
        topology: 'Topology Map',
        alerts: 'Alerts',
        reports: 'Reports',
        profile: 'Profile',
        settings: 'Settings'
    };

    document.querySelectorAll('#content-area > div').forEach(div => div.classList.add('d-none'));

    const pageElement = document.getElementById(page + '-page');
    if (pageElement) pageElement.classList.remove('d-none');

    const pageTitle = document.getElementById('page-title');
    if (pageTitle) pageTitle.textContent = pageTitles[page] || 'Dashboard';

    document.querySelectorAll('.sidebar .nav-link').forEach(link => link.classList.remove('active'));
    const activeLink = document.querySelector('.sidebar .nav-link[data-page="' + page + '"]');
    if (activeLink) activeLink.classList.add('active');

    if (window.innerWidth < 992) {
        document.body.classList.remove('sidebar-open');
    }

    if (page === 'topology' && networkInstance) {
        setTimeout(() => {
            networkInstance.resize();
            networkInstance.fit(networkInstance.elements(), 28);
        }, 140);
    }
}

const dummyDevices = [
    {name: "SW-CORE-01", type: "Switch", ip: "192.168.1.10", location: "IC Building - Floor 2", status: "Online", lastSeen: "2 min ago"},
    {name: "ROUTER-GW", type: "Router", ip: "192.168.1.1", location: "Main Server Room", status: "Online", lastSeen: "1 min ago"},
    {name: "AP-ENG-03", type: "Wi-Fi AP", ip: "192.168.2.45", location: "IC Building - Floor 2", status: "Offline", lastSeen: "18 min ago"},
    {name: "SW-LIB-02", type: "Switch", ip: "192.168.3.22", location: "IC Building - Floor 1", status: "Online", lastSeen: "5 min ago"}
];

function populateDevicesTable() {
    const tbody = document.querySelector('#devices-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    dummyDevices.forEach(dev => {
        const statusHTML = dev.status === 'Online'
            ? `<span class="text-success"><i class="fas fa-circle"></i> Online</span>`
            : `<span class="text-danger"><i class="fas fa-circle"></i> Offline</span>`;

        tbody.innerHTML += `
            <tr>
                <td><strong>${dev.name}</strong></td>
                <td>${dev.type}</td>
                <td><code>${dev.ip}</code></td>
                <td>${dev.location}</td>
                <td>${statusHTML}</td>
                <td>${dev.lastSeen}</td>
                <td><button class="btn btn-sm btn-outline-primary">View</button></td>
            </tr>`;
    });
}

const dummyAlerts = [
    {time: "2025-03-31 17:42", device: "AP-ENG-03", issue: "Disconnected", severity: "High"},
    {time: "2025-03-31 16:55", device: "SW-CORE-01", issue: "High CPU Usage", severity: "Medium"},
    {time: "2025-03-31 15:10", device: "ROUTER-GW", issue: "Interface Down", severity: "High"}
];

function populateRecentAlerts() {
    const list = document.getElementById('recent-alerts');
    if (!list) return;

    list.innerHTML = dummyAlerts.map(a => `
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

    tbody.innerHTML = dummyAlerts.map(a => `
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

let networkInstance;

const campusDevices = [
    { id: 1, name: 'CORE-SW-01', type: 'Switch', ip: '192.168.1.10', building: 'IC Building', floor: 'Room A', status: 'Online', addedOn: '2026-04-06', x: -380, y: -170 },
    { id: 2, name: 'ROUTER-GW', type: 'Router', ip: '192.168.1.1', building: 'IC Building', floor: 'Room A', status: 'Online', addedOn: '2026-04-06', x: -120, y: -170 },
    { id: 3, name: 'FW-PERIMETER', type: 'Firewall', ip: '192.168.1.254', building: 'IC Building', floor: 'Room A', status: 'Warning', addedOn: '2026-04-07', x: 140, y: -170 },
    { id: 4, name: 'SW-IT-02', type: 'Switch', ip: '192.168.10.2', building: 'IC Building', floor: 'Floor 2', status: 'Online', addedOn: '2026-04-08', x: -330, y: 0 },
    { id: 5, name: 'AP-IT-2F', type: 'Wi-Fi AP', ip: '192.168.10.45', building: 'IC Building', floor: 'Floor 2', status: 'Online', addedOn: '2026-04-08', x: -110, y: 30 },
    { id: 6, name: 'SW-ENG-01', type: 'Switch', ip: '192.168.20.2', building: 'IC Building', floor: 'Floor 1', status: 'Online', addedOn: '2026-04-09', x: 130, y: 10 },
    { id: 7, name: 'AP-ENG-03', type: 'Wi-Fi AP', ip: '192.168.20.51', building: 'IC Building', floor: 'Floor 3', status: 'Offline', addedOn: '2026-04-10', x: 360, y: 35 },
    { id: 8, name: 'SW-LIB-02', type: 'Switch', ip: '192.168.30.2', building: 'IC Building', floor: 'Floor 1', status: 'Online', addedOn: '2026-04-11', x: -40, y: 220 },
    { id: 9, name: 'AP-LIB-1F', type: 'Wi-Fi AP', ip: '192.168.30.61', building: 'IC Building', floor: 'Floor 1', status: 'Online', addedOn: '2026-04-11', x: 190, y: 230 },
    { id: 10, name: 'SW-ADMIN-01', type: 'Switch', ip: '192.168.40.2', building: 'IC Building', floor: 'Floor 1', status: 'Warning', addedOn: '2026-04-12', x: 410, y: 220 }
];

const campusLinks = [
    { id: 'l1', from: 1, to: 2, medium: 'Fiber', bandwidth: '10 Gbps', status: 'Online' },
    { id: 'l2', from: 2, to: 3, medium: 'Ethernet', bandwidth: '10 Gbps', status: 'Online' },
    { id: 'l3', from: 1, to: 4, medium: 'Fiber', bandwidth: '1 Gbps', status: 'Online' },
    { id: 'l4', from: 4, to: 5, medium: 'Ethernet', bandwidth: '1 Gbps', status: 'Online' },
    { id: 'l5', from: 1, to: 6, medium: 'Fiber', bandwidth: '1 Gbps', status: 'Online' },
    { id: 'l6', from: 6, to: 7, medium: 'Ethernet', bandwidth: '1 Gbps', status: 'Degraded' },
    { id: 'l7', from: 1, to: 8, medium: 'Fiber', bandwidth: '1 Gbps', status: 'Online' },
    { id: 'l8', from: 8, to: 9, medium: 'Ethernet', bandwidth: '1 Gbps', status: 'Online' },
    { id: 'l9', from: 1, to: 10, medium: 'Fiber', bandwidth: '1 Gbps', status: 'Degraded' }
];

function statusColor(status) {
    if (status === 'Online') return '#22a55a';
    if (status === 'Offline') return '#de5b54';
    return '#f09a35';
}

function linkColor(status) {
    if (status === 'Online') return '#1f7ae0';
    return '#f09a35';
}

function getTopologyFilters() {
    const buildingFilter = document.getElementById('building-filter');
    const statusFilter = document.getElementById('status-filter');

    return {
        building: buildingFilter ? buildingFilter.value : 'all',
        status: statusFilter ? statusFilter.value : 'all'
    };
}

function buildTopologyData() {
    const filters = getTopologyFilters();

    const filteredDevices = campusDevices.filter(device => {
        const passBuilding = filters.building === 'all' || device.building === filters.building;
        const passStatus = filters.status === 'all' || device.status === filters.status;
        return passBuilding && passStatus;
    });

    const visibleIds = new Set(filteredDevices.map(device => device.id));

    const nodes = filteredDevices.map(device => ({
        data: {
            id: String(device.id),
            label: `${device.name}\n${device.ip}`,
            type: device.type,
            status: device.status,
            tooltip: `${device.type} • ${device.building} • ${device.floor}`
        },
        position: { x: device.x, y: device.y },
        locked: true
    }));

    const edges = campusLinks
        .filter(link => visibleIds.has(link.from) && visibleIds.has(link.to))
        .map(link => ({
            data: {
                id: link.id,
                source: String(link.from),
                target: String(link.to),
                label: `${link.medium} (${link.bandwidth})`,
                status: link.status,
                lineColor: linkColor(link.status),
                lineStyle: link.status === 'Online' ? 'solid' : 'dashed',
                lineWidth: link.status === 'Online' ? 2 : 3
            }
        }));

    return { nodes, edges };
}

function renderSelectedDevice(deviceId) {
    const detailsContainer = document.getElementById('topology-device-details');
    if (!detailsContainer) return;

    if (!deviceId) {
        detailsContainer.innerHTML = '<p class="text-muted mb-0">No device selected yet.</p>';
        return;
    }

    const device = campusDevices.find(item => item.id === deviceId);
    if (!device) {
        detailsContainer.innerHTML = '<p class="text-muted mb-0">Device details unavailable.</p>';
        return;
    }

    const connectedLinks = campusLinks.filter(link => link.from === deviceId || link.to === deviceId);
    const connectedDevices = connectedLinks.map(link => {
        const peerId = link.from === deviceId ? link.to : link.from;
        const peer = campusDevices.find(item => item.id === peerId);
        return {
            name: peer ? peer.name : 'Unknown',
            medium: link.medium,
            bandwidth: link.bandwidth,
            status: link.status
        };
    });

    detailsContainer.innerHTML = `
        <ul class="device-detail-list">
            <li><span class="device-detail-label">Name</span><strong>${device.name}</strong></li>
            <li><span class="device-detail-label">Type</span><span>${device.type}</span></li>
            <li><span class="device-detail-label">IP Address</span><code>${device.ip}</code></li>
            <li><span class="device-detail-label">Building</span><span>${device.building}</span></li>
            <li><span class="device-detail-label">Floor</span><span>${device.floor}</span></li>
            <li><span class="device-detail-label">Status</span><span style="color:${statusColor(device.status)};font-weight:700">${device.status}</span></li>
        </ul>
        <h6 class="section-title mb-2">Connected Links (${connectedDevices.length})</h6>
        ${connectedDevices.length === 0
            ? '<p class="text-muted mb-0">No active links in current filter scope.</p>'
            : connectedDevices.map(conn => `
                <div class="device-connection-item">
                    <strong>${conn.name}</strong><br>
                    <small>${conn.medium} • ${conn.bandwidth} • <span style="color:${linkColor(conn.status)}">${conn.status}</span></small>
                </div>
            `).join('')}
    `;
}

function refreshTopology() {
    if (!networkInstance) return;

    const topologyData = buildTopologyData();
    networkInstance.elements().remove();
    networkInstance.add([...topologyData.nodes, ...topologyData.edges]);

    renderSelectedDevice(null);
    networkInstance.layout({
        name: 'preset',
        fit: true,
        padding: 28,
        animate: true,
        animationDuration: 350
    }).run();
}

function initTopology() {
    const container = document.getElementById('network');
    if (!container) return;

    const topologyData = buildTopologyData();
    networkInstance = cytoscape({
        container,
        elements: [...topologyData.nodes, ...topologyData.edges],
        style: [
            {
                selector: 'node',
                style: {
                    'label': 'data(label)',
                    'shape': 'round-rectangle',
                    'width': 118,
                    'height': 40,
                    'background-color': 'data(status)',
                    'border-width': 1.4,
                    'border-color': '#0f2338',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'font-size': 11,
                    'font-family': 'IBM Plex Sans',
                    'color': '#10263f',
                    'text-wrap': 'wrap',
                    'text-max-width': 110,
                    'overlay-opacity': 0
                }
            },
            {
                selector: 'node[type = "Wi-Fi AP"]',
                style: {
                    'shape': 'ellipse',
                    'width': 58,
                    'height': 58,
                    'text-max-width': 64
                }
            },
            {
                selector: 'node[status = "Online"]',
                style: {
                    'background-color': '#22a55a'
                }
            },
            {
                selector: 'node[status = "Offline"]',
                style: {
                    'background-color': '#de5b54'
                }
            },
            {
                selector: 'node[status = "Warning"]',
                style: {
                    'background-color': '#f09a35'
                }
            },
            {
                selector: 'edge',
                style: {
                    'curve-style': 'bezier',
                    'line-color': 'data(lineColor)',
                    'width': 'data(lineWidth)',
                    'line-style': 'data(lineStyle)',
                    'target-arrow-shape': 'none',
                    'label': 'data(label)',
                    'font-size': 10,
                    'color': '#4d6681',
                    'text-background-opacity': 1,
                    'text-background-color': '#f8fbff',
                    'text-background-padding': 2,
                    'overlay-opacity': 0
                }
            },
            {
                selector: ':selected',
                style: {
                    'border-width': 3,
                    'border-color': '#12b3c7',
                    'line-color': '#12b3c7'
                }
            }
        ],
        layout: {
            name: 'preset',
            fit: true,
            padding: 28
        },
        userZoomingEnabled: true,
        userPanningEnabled: true,
        boxSelectionEnabled: false
    });

    networkInstance.on('tap', 'node', function(evt) {
        renderSelectedDevice(Number(evt.target.id()));
    });

    const buildingFilter = document.getElementById('building-filter');
    const statusFilter = document.getElementById('status-filter');
    const resetButton = document.getElementById('reset-topology-btn');

    if (buildingFilter) buildingFilter.addEventListener('change', refreshTopology);
    if (statusFilter) statusFilter.addEventListener('change', refreshTopology);
    if (resetButton) {
        resetButton.addEventListener('click', function() {
            if (buildingFilter) buildingFilter.value = 'IC Building';
            if (statusFilter) statusFilter.value = 'all';
            refreshTopology();
        });
    }

    renderSelectedDevice(null);
}

function createStatusChart() {
    const canvas = document.getElementById('statusChart');
    if (!canvas) return;

    const devicesPerDate = campusDevices.reduce((acc, device) => {
        acc[device.addedOn] = (acc[device.addedOn] || 0) + 1;
        return acc;
    }, {});

    const sortedDates = Object.keys(devicesPerDate).sort();
    const labels = [];
    const totals = [];
    let runningTotal = 0;

    sortedDates.forEach(date => {
        runningTotal += devicesPerDate[date];
        labels.push(new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        totals.push(runningTotal);
    });

    new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: totals,
                borderColor: '#1f7ae0',
                backgroundColor: 'rgba(31, 122, 224, 0.18)',
                fill: true,
                tension: 0.35,
                pointRadius: 5,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#4f6681', font: { weight: 600 } }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(109, 143, 180, 0.15)' },
                    ticks: { color: '#5c7591', precision: 0 }
                }
            }
        }
    });
}

function toggleSidebar() {
    document.body.classList.toggle('sidebar-open');
}

function logout() {
    if (confirm('Logout?')) window.location.reload();
}

window.onload = function() {
    populateDevicesTable();
    populateRecentAlerts();
    populateAlertsTable();
    populateReportsTable();
    createStatusChart();
    initTopology();

    if (document.getElementById('content-area') && document.getElementById('dashboard-page')) {
        showPage('dashboard');
    }

    console.log('%cCampusNet UI layout loaded successfully!', 'color:#0d6efd; font-weight:bold');
};

window.addEventListener('resize', () => {
    if (window.innerWidth >= 992) {
        document.body.classList.remove('sidebar-open');
    }
});
