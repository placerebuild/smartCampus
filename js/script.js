let devicesData = [];

function populateDevicesTable() {
    const tbody = document.querySelector('#devices-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    devicesData.forEach(dev => {
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

let alertsData = [];

function setDevicesData(devices) {
    devicesData = Array.isArray(devices) ? devices : [];
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

let networkInstance;

const campusDevices = [];

const campusLinks = [];

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

    networkInstance.on('tap', 'node', function (evt) {
        renderSelectedDevice(Number(evt.target.id()));
    });

    const buildingFilter = document.getElementById('building-filter');
    const statusFilter = document.getElementById('status-filter');
    const resetButton = document.getElementById('reset-topology-btn');

    if (buildingFilter) buildingFilter.addEventListener('change', refreshTopology);
    if (statusFilter) statusFilter.addEventListener('change', refreshTopology);
    if (resetButton) {
        resetButton.addEventListener('click', function () {
            if (buildingFilter) buildingFilter.value = 'all';
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
        window.location.href = 'login.html';
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

window.onload = async function () {
    await loadSidebar();
    populateDevicesTable();
    populateRecentAlerts();
    populateAlertsTable();
    populateReportsTable();
    createStatusChart();
    initTopology();

    console.log('%cCampusNet UI layout loaded successfully!', 'color:#0d6efd; font-weight:bold');
};

window.addEventListener('resize', () => {
    if (window.innerWidth >= 992) {
        document.body.classList.remove('sidebar-open');
    }
});
