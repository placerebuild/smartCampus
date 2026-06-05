let devicesData = [];



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

function formatLocationLabel(building, floor, room) {
    const parts = [building, floor, room].filter(part => part !== undefined && part !== null && part !== '');
    return parts.length ? parts.join(' / ') : '';
}

function resolveLocationLabel(device) {
    if (!device) return '';
    return device.location || formatLocationLabel(device.building, device.floor, device.room);
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
    populateReportsTable();
    if (typeof topologyViewMode !== 'undefined' && topologyViewMode === 'floor') {
        renderFloorMap(currentFloor);
    }
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
        const locationLabel = resolveLocationLabel(dev);

        tbody.innerHTML += `
            <tr data-device-row="${deviceKey}">
                <td><strong>${formatDeviceValue(dev.name || dev.ip || 'Device', 'Device')}</strong></td>
                <td>${formatDeviceValue(dev.type)}</td>
                <td><code>${formatDeviceValue(dev.ip)}</code></td>
                <td>${macCell}</td>
                <td>${formatDeviceValue(locationLabel)}</td>
                <td data-status-cell>${statusHTML}</td>
                <td data-last-seen-cell>${formatDeviceValue(dev.lastSeen)}</td>
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
    const location = formatDeviceValue(resolveLocationLabel(selected));
    const building = formatDeviceValue(selected.building);
    const floor = formatDeviceValue(selected.floor);
    const room = formatDeviceValue(selected.room);
    const statusMarkup = buildStatusMarkup(selected.status);
    const lastSeen = formatDeviceValue(selected.lastSeen);
    const description = formatDeviceValue(selected.description, '');
    const nameInput = selected.name ? String(selected.name) : '';
    const typeInput = selected.type ? String(selected.type) : '';
    const buildingInput = selected.building ? String(selected.building) : '';
    const floorInput = selected.floor ? String(selected.floor) : '';
    const roomInput = selected.room ? String(selected.room) : '';
    const canEditLocation = Boolean(selected && selected.id);

    const packetLoss = formatMetricValue(resolveDeviceMetric(selected, [
        'packetLoss'
    ]), '%');

    const modalHTML = `
        <div class="modal fade" id="deviceDetailsModal" tabindex="-1" aria-labelledby="deviceDetailsLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-lg">
                <div class="modal-content device-modal-content">
                    <div class="modal-header border-0 pb-0">
                        <div>
                            <h5 class="modal-title" id="deviceDetailsLabel" style="font-family:'Sora',sans-serif;" data-device-field="title">${name}</h5>
                            <p class="device-modal-meta mb-0" data-device-field="meta">${type} - ${ip}</p>
                        </div>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body pt-3">
                        <div class="device-detail-section">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <h6 class="section-title mb-0">Device Overview</h6>
                                <button type="button" class="btn btn-sm btn-outline-primary" data-device-action="toggle-location-edit" ${canEditLocation ? '' : 'disabled'}>Edit Details</button>
                            </div>
                            <ul class="device-detail-list">
                                <li><span class="device-detail-label">Name</span><strong data-device-field="name">${name}</strong></li>
                                <li><span class="device-detail-label">Type</span><span data-device-field="type">${type}</span></li>
                                <li><span class="device-detail-label">IP Address</span><code>${ip}</code></li>
                                <li><span class="device-detail-label">MAC Address</span><span>${mac}</span></li>
                                <li><span class="device-detail-label">Location</span><span data-device-field="location">${location}</span></li>
                                <li><span class="device-detail-label">Building</span><span data-device-field="building">${building}</span></li>
                                <li><span class="device-detail-label">Floor</span><span data-device-field="floor">${floor}</span></li>
                                <li><span class="device-detail-label">Room/Area</span><span data-device-field="room">${room}</span></li>
                                <li><span class="device-detail-label">Status</span>${statusMarkup}</li>
                                <li><span class="device-detail-label">Last Seen</span><span>${lastSeen}</span></li>
                            </ul>
                            <form class="device-location-form d-none" data-device-form="location">
                                <div class="row g-2">
                                    <div class="col-md-6">
                                        <label class="form-label small text-muted fw-semibold">Device Name</label>
                                        <input class="form-control" name="deviceName" type="text" value="${nameInput}" ${canEditLocation ? 'required' : 'disabled'}>
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label small text-muted fw-semibold">Device Type</label>
                                        <input class="form-control" name="deviceType" type="text" value="${typeInput}" ${canEditLocation ? 'required' : 'disabled'}>
                                    </div>
                                </div>
                                <div class="row g-2 mt-1">
                                    <div class="col-md-4">
                                        <label class="form-label small text-muted fw-semibold">Building</label>
                                        <input class="form-control" name="building" type="text" value="${buildingInput}" ${canEditLocation ? 'required' : 'disabled'}>
                                    </div>
                                    <div class="col-md-4">
                                        <label class="form-label small text-muted fw-semibold">Floor</label>
                                        <input class="form-control" name="floor" type="text" value="${floorInput}" ${canEditLocation ? 'required' : 'disabled'}>
                                    </div>
                                    <div class="col-md-4">
                                        <label class="form-label small text-muted fw-semibold">Room/Area</label>
                                        <input class="form-control" name="room" type="text" value="${roomInput}" ${canEditLocation ? '' : 'disabled'}>
                                    </div>
                                </div>
                                <div class="d-flex gap-2 mt-3">
                                    <button class="btn btn-primary btn-sm" type="submit" ${canEditLocation ? '' : 'disabled'}>Save Changes</button>
                                    <button class="btn btn-outline-secondary btn-sm" type="button" data-device-action="cancel-location-edit">Cancel</button>
                                </div>
                                <div class="small text-muted mt-2" data-device-location-hint></div>
                                <div class="small text-danger mt-2 d-none" data-device-location-error></div>
                            </form>
                        </div>
                        <div class="device-detail-section">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <h6 class="section-title mb-0">Performance (ICMP)</h6>
                                <button type="button" class="btn btn-sm btn-outline-secondary" data-device-action="re-ping" title="Ping again">
                                    <i class="fas fa-sync-alt"></i> Ping
                                </button>
                            </div>
                            <div class="device-metric-grid" data-device-metrics>
                                <div class="device-metric-card">
                                    <span class="device-metric-label">Latency</span>
                                    <strong class="device-metric-value" data-metric="latency">N/A</strong>
                                </div>
                                <div class="device-metric-card">
                                    <span class="device-metric-label">Packet Loss</span>
                                    <strong class="device-metric-value" data-metric="packetLoss">${packetLoss}</strong>
                                </div>
                                <div class="device-metric-card">
                                    <span class="device-metric-label">Min Latency</span>
                                    <strong class="device-metric-value" data-metric="minLatency">N/A</strong>
                                </div>
                                <div class="device-metric-card">
                                    <span class="device-metric-label">Max Latency</span>
                                    <strong class="device-metric-value" data-metric="maxLatency">N/A</strong>
                                </div>
                            </div>
                            <div class="small text-muted mt-2" data-device-ping-status>
                                <i class="fas fa-spinner fa-spin me-1"></i> Pinging device...
                            </div>
                        </div>
                        ${description ? `
                        <div class="device-detail-section">
                            <h6 class="section-title mb-2">Notes</h6>
                            <p class="text-muted mb-0">${description}</p>
                        </div>
                        ` : ''}
                    </div>
                    ${(selected.id && window._sessionUser && window._sessionUser.role === 'Admin') ? `
                    <div class="modal-footer border-0 pt-0">
                        <button type="button" class="btn btn-sm btn-outline-danger ms-auto" data-device-action="delete">
                            <i class="fas fa-trash-alt me-1"></i> Delete Device
                        </button>
                    </div>` : ''}
                </div>
            </div>
        </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const modalEl = document.getElementById('deviceDetailsModal');
    const modal = new bootstrap.Modal(modalEl);
    modalEl.addEventListener('hidden.bs.modal', function () {
        modalEl.remove();
    });

    const deleteBtn = modalEl.querySelector('[data-device-action="delete"]');
    if (deleteBtn && selected.id) {
        deleteBtn.addEventListener('click', async () => {
            if (!confirm(`Delete "${selected.name || selected.ip}"? This cannot be undone.`)) return;
            deleteBtn.disabled = true;
            deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Deleting...';
            try {
                const res = await fetch(`${getTopologyApiBase()}/api/devices/${encodeURIComponent(selected.id)}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                if (!res.ok) {
                    const payload = await res.json().catch(() => ({}));
                    throw new Error(payload.error || 'Delete failed.');
                }
                modal.hide();
                devicesData = devicesData.filter(d => d.id !== selected.id);
                populateDevicesTable();
            } catch (err) {
                deleteBtn.disabled = false;
                deleteBtn.innerHTML = '<i class="fas fa-trash-alt me-1"></i> Delete Device';
                alert(err.message || 'Unable to delete device.');
            }
        });
    }

    const editToggle = modalEl.querySelector('[data-device-action="toggle-location-edit"]');
    const form = modalEl.querySelector('[data-device-form="location"]');
    const cancelButton = modalEl.querySelector('[data-device-action="cancel-location-edit"]');
    const errorEl = modalEl.querySelector('[data-device-location-error]');
    const hintEl = modalEl.querySelector('[data-device-location-hint]');
    const titleEl = modalEl.querySelector('[data-device-field="title"]');
    const metaEl = modalEl.querySelector('[data-device-field="meta"]');
    const nameEl = modalEl.querySelector('[data-device-field="name"]');
    const typeEl = modalEl.querySelector('[data-device-field="type"]');
    const locationEl = modalEl.querySelector('[data-device-field="location"]');
    const buildingEl = modalEl.querySelector('[data-device-field="building"]');
    const floorEl = modalEl.querySelector('[data-device-field="floor"]');
    const roomEl = modalEl.querySelector('[data-device-field="room"]');
    const nameInputEl = form ? form.querySelector('input[name="deviceName"]') : null;
    const typeInputEl = form ? form.querySelector('input[name="deviceType"]') : null;
    const buildingInputEl = form ? form.querySelector('input[name="building"]') : null;
    const floorInputEl = form ? form.querySelector('input[name="floor"]') : null;
    const roomInputEl = form ? form.querySelector('input[name="room"]') : null;
    const submitButton = form ? form.querySelector('button[type="submit"]') : null;

    const setFormVisible = (visible) => {
        if (!form) return;
        form.classList.toggle('d-none', !visible);
        if (editToggle) {
            editToggle.textContent = visible ? 'Close Editor' : 'Edit Details';
        }
    };

    const resetFormValues = () => {
        if (nameInputEl) nameInputEl.value = selected.name ? String(selected.name) : '';
        if (typeInputEl) typeInputEl.value = selected.type ? String(selected.type) : '';
        if (buildingInputEl) buildingInputEl.value = selected.building ? String(selected.building) : '';
        if (floorInputEl) floorInputEl.value = selected.floor ? String(selected.floor) : '';
        if (roomInputEl) roomInputEl.value = selected.room ? String(selected.room) : '';
    };

    const setBusy = (busy) => {
        if (nameInputEl) nameInputEl.disabled = busy;
        if (typeInputEl) typeInputEl.disabled = busy;
        if (buildingInputEl) buildingInputEl.disabled = busy;
        if (floorInputEl) floorInputEl.disabled = busy;
        if (roomInputEl) roomInputEl.disabled = busy;
        if (submitButton) submitButton.disabled = busy;
        if (cancelButton) cancelButton.disabled = busy;
        if (editToggle) editToggle.disabled = busy;
    };

    const setError = (message) => {
        if (!errorEl) return;
        if (!message) {
            errorEl.classList.add('d-none');
            errorEl.textContent = '';
            return;
        }
        errorEl.textContent = message;
        errorEl.classList.remove('d-none');
    };

    const applyDeviceUpdate = (payload) => {
        if (!payload) return;
        const nameValue = payload.name || selected.name || '';
        const typeValue = payload.type || selected.type || '';
        const buildingValue = payload.building || '';
        const floorValue = payload.floor || '';
        const roomValue = payload.room || '';
        const locationLabel = formatLocationLabel(buildingValue, floorValue, roomValue);

        selected.name = nameValue;
        selected.type = typeValue;
        selected.building = buildingValue;
        selected.floor = floorValue;
        selected.room = roomValue;
        selected.location = locationLabel;

        const deviceId = selected.id;
        const deviceIp = selected.ip;
        const deviceIdValue = deviceId ? String(deviceId) : '';
        const cached = devicesData.find(item => {
            if (deviceIp && item.ip === deviceIp) return true;
            if (deviceIdValue && item.id !== undefined && item.id !== null) {
                return String(item.id) === deviceIdValue;
            }
            return false;
        });
        if (cached && cached !== selected) {
            cached.name = nameValue;
            cached.type = typeValue;
            cached.building = buildingValue;
            cached.floor = floorValue;
            cached.room = roomValue;
            cached.location = locationLabel;
        }

        const topoDevice = campusDevices.find(item => {
            if (deviceIp && item.ip === deviceIp) return true;
            if (deviceIdValue && item.id !== undefined && item.id !== null) {
                return String(item.id) === deviceIdValue;
            }
            return false;
        });
        if (topoDevice) {
            topoDevice.name = nameValue;
            topoDevice.type = typeValue;
            topoDevice.building = buildingValue;
            topoDevice.floor = floorValue;
            topoDevice.room = roomValue;
            topoDevice.location = locationLabel;
        }

        if (titleEl) titleEl.textContent = formatDeviceValue(nameValue || selected.ip || 'Device', 'Device');
        if (metaEl) metaEl.textContent = `${formatDeviceValue(typeValue)} - ${ip}`;
        if (nameEl) nameEl.textContent = formatDeviceValue(nameValue || 'Device', 'Device');
        if (typeEl) typeEl.textContent = formatDeviceValue(typeValue);
        if (locationEl) locationEl.textContent = formatDeviceValue(locationLabel);
        if (buildingEl) buildingEl.textContent = formatDeviceValue(buildingValue);
        if (floorEl) floorEl.textContent = formatDeviceValue(floorValue);
        if (roomEl) roomEl.textContent = formatDeviceValue(roomValue);
    };

    if (hintEl) {
        hintEl.textContent = canEditLocation
            ? 'Updates are saved to the device and location records.'
            : 'Device edits are unavailable for this device.';
    }

    if (form && editToggle) {
        if (canEditLocation) {
            editToggle.addEventListener('click', () => {
                const isHidden = form.classList.contains('d-none');
                if (isHidden) {
                    resetFormValues();
                    setError('');
                }
                setFormVisible(isHidden);
            });
        }

        if (cancelButton) {
            cancelButton.addEventListener('click', () => {
                setError('');
                resetFormValues();
                setFormVisible(false);
            });
        }

        if (canEditLocation) {
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                setError('');

                const buildingValue = buildingInputEl ? buildingInputEl.value.trim() : '';
                const floorValue = floorInputEl ? floorInputEl.value.trim() : '';
                const roomValue = roomInputEl ? roomInputEl.value.trim() : '';
                const nameValue = nameInputEl ? nameInputEl.value.trim() : '';
                const typeValue = typeInputEl ? typeInputEl.value.trim() : '';

                if (!nameValue || !typeValue) {
                    setError('Device name and type are required.');
                    return;
                }

                if (nameValue.length > 120) {
                    setError('Device name is too long.');
                    return;
                }

                if (typeValue.length > 60) {
                    setError('Device type is too long.');
                    return;
                }

                if (!buildingValue || !floorValue) {
                    setError('Building and floor are required.');
                    return;
                }

                if (buildingValue.length > 120) {
                    setError('Building name is too long.');
                    return;
                }

                if (floorValue.length > 50) {
                    setError('Floor value is too long.');
                    return;
                }

                if (roomValue.length > 80) {
                    setError('Room/area value is too long.');
                    return;
                }

                if (!selected.id) {
                    setError('This device does not have an ID yet.');
                    return;
                }

                setBusy(true);
                try {
                    const baseUrl = getTopologyApiBase();
                    const response = await fetch(`${baseUrl}/api/devices/${encodeURIComponent(selected.id)}/location`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            name: nameValue,
                            type: typeValue,
                            building: buildingValue,
                            floor: floorValue,
                            room: roomValue
                        })
                    });

                    if (!response.ok) {
                        let message = '';
                        const payload = await response.json().catch(() => null);
                        if (payload && payload.error) {
                            message = payload.error;
                        } else {
                            const text = await response.text().catch(() => '');
                            message = text ? text.trim() : '';
                        }
                        const statusLabel = response.status ? `HTTP ${response.status}` : 'Request failed';
                        throw new Error(message ? `${statusLabel}: ${message}` : `${statusLabel}: Unable to update device details right now.`);
                    }

                    const updated = await response.json();
                    applyDeviceUpdate({
                        name: updated.name || nameValue,
                        type: updated.type || typeValue,
                        building: updated.building || buildingValue,
                        floor: updated.floor || floorValue,
                        room: updated.room || roomValue
                    });
                    populateDevicesTable();
                    setFormVisible(false);
                } catch (error) {
                    setError(error.message || 'Unable to update device details right now.');
                } finally {
                    setBusy(false);
                }
            });
        }
    }

    // Live ICMP ping fetch helper
    const latencyEl = modalEl.querySelector('[data-metric="latency"]');
    const packetLossEl = modalEl.querySelector('[data-metric="packetLoss"]');
    const minLatencyEl = modalEl.querySelector('[data-metric="minLatency"]');
    const maxLatencyEl = modalEl.querySelector('[data-metric="maxLatency"]');
    const pingStatusEl = modalEl.querySelector('[data-device-ping-status]');
    const rePingBtn = modalEl.querySelector('[data-device-action="re-ping"]');

    const formatPingMs = (value) => {
        if (value === null || value === undefined) return 'N/A';
        const num = Number(value);
        return Number.isFinite(num) ? `${num.toFixed(1)} ms` : 'N/A';
    };

    const formatLoss = (value) => {
        if (value === null || value === undefined) return 'N/A';
        const num = Number(value);
        return Number.isFinite(num) ? `${num.toFixed(1)}%` : 'N/A';
    };

    const getLossColor = (value) => {
        if (value === null || value === undefined) return '';
        const num = Number(value);
        if (!Number.isFinite(num)) return '';
        if (num === 0) return '#18a368';
        if (num <= 5) return '#f09a35';
        return '#de5b54';
    };

    const getLatencyColor = (value) => {
        if (value === null || value === undefined) return '';
        const num = Number(value);
        if (!Number.isFinite(num)) return '';
        if (num <= 50) return '#18a368';
        if (num <= 150) return '#f09a35';
        return '#de5b54';
    };

    const applyPingResults = (data) => {
        if (latencyEl) {
            latencyEl.textContent = formatPingMs(data.latencyMs !== undefined ? data.latencyMs : data.avgMs);
            const latColor = getLatencyColor(data.latencyMs !== undefined ? data.latencyMs : data.avgMs);
            if (latColor) latencyEl.style.color = latColor;
        }
        if (packetLossEl) {
            packetLossEl.textContent = formatLoss(data.packetLoss);
            const lossColor = getLossColor(data.packetLoss);
            if (lossColor) packetLossEl.style.color = lossColor;
        }
        if (minLatencyEl) {
            minLatencyEl.textContent = formatPingMs(data.minMs);
        }
        if (maxLatencyEl) {
            maxLatencyEl.textContent = formatPingMs(data.maxMs);
        }
    };

    const fetchLivePing = async () => {
        if (pingStatusEl) {
            pingStatusEl.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Pinging device...';
            pingStatusEl.className = 'small text-muted mt-2';
        }
        if (rePingBtn) rePingBtn.disabled = true;

        try {
            const baseUrl = getTopologyApiBase();
            let url;
            if (selected.id && !isNaN(Number(selected.id)) && Number(selected.id) > 0) {
                url = `${baseUrl}/api/devices/${encodeURIComponent(selected.id)}/ping`;
            } else if (selected.ip) {
                url = `${baseUrl}/api/ping?target=${encodeURIComponent(selected.ip)}`;
            } else {
                if (pingStatusEl) {
                    pingStatusEl.innerHTML = '<i class="fas fa-exclamation-triangle me-1"></i> No IP address available for ping.';
                    pingStatusEl.className = 'small text-warning mt-2';
                }
                return;
            }

            const response = await fetch(url, { credentials: 'include' });
            if (!response.ok) {
                const errPayload = await response.json().catch(() => ({}));
                throw new Error(errPayload.error || 'Ping request failed.');
            }

            const data = await response.json();
            applyPingResults(data);

            if (data.alive) {
                const probeInfo = data.probes ? ` (${data.probes} probes)` : '';
                if (pingStatusEl) {
                    pingStatusEl.innerHTML = `<i class="fas fa-check-circle me-1 text-success"></i> Device reachable${probeInfo}`;
                    pingStatusEl.className = 'small text-success mt-2';
                }
            } else {
                if (pingStatusEl) {
                    pingStatusEl.innerHTML = '<i class="fas fa-times-circle me-1"></i> Device unreachable';
                    pingStatusEl.className = 'small text-danger mt-2';
                }
            }
        } catch (error) {
            if (pingStatusEl) {
                pingStatusEl.innerHTML = `<i class="fas fa-exclamation-circle me-1"></i> ${error.message || 'Ping failed'}`;
                pingStatusEl.className = 'small text-danger mt-2';
            }
        } finally {
            if (rePingBtn) rePingBtn.disabled = false;
        }
    };

    if (rePingBtn) {
        rePingBtn.addEventListener('click', fetchLivePing);
    }

    modal.show();

    // Trigger live ping after modal is visible
    fetchLivePing();
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

async function populateAlertsTable() {
    const tbody = document.querySelector('#alerts-table tbody');
    if (!tbody) return;

    try {
        const res = await fetch(getTopologyApiBase() + '/api/alerts', { credentials: 'include' });
        if (res.ok) alertsData = await res.json();
    } catch (e) { /* keep alertsData as-is */ }

    tbody.innerHTML = alertsData.map(a => {
        const label = a.severity === 'danger' ? 'High' : a.severity === 'warning' ? 'Warning' : 'Info';
        const badgeClass = a.severity === 'danger' ? 'danger' : a.severity === 'warning' ? 'warning' : 'success';
        const statusBadge = a.resolved
            ? `<span class="badge bg-success">Resolved</span>${a.resolvedBy ? `<br><small class="text-muted">${a.resolvedBy}</small>` : ''}`
            : '<span class="badge bg-secondary">Open</span>';
        const actionBtn = a.resolved
            ? ''
            : `<button class="btn btn-sm btn-outline-success" onclick="resolveAlert(${a.id}, this)"><i class="fas fa-check me-1"></i>Resolve</button>`;
        return `<tr data-alert-id="${a.id}">
            <td>${new Date(a.time).toLocaleString()}</td>
            <td>${a.device}</td>
            <td>${a.issue}</td>
            <td><span class="badge bg-${badgeClass}">${label}</span></td>
            <td>${statusBadge}</td>
            <td>${actionBtn}</td>
        </tr>`;
    }).join('');
}

async function resolveAlert(alertId, btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
        const res = await fetch(getTopologyApiBase() + `/api/alerts/${alertId}/resolve`, {
            method: 'PUT',
            credentials: 'include'
        });
        if (!res.ok) throw new Error('Server error');
        const data = await res.json();
        const row = document.querySelector(`tr[data-alert-id="${alertId}"]`);
        if (row) {
            row.cells[4].innerHTML = `<span class="badge bg-success">Resolved</span>${data.resolvedBy ? `<br><small class="text-muted">${data.resolvedBy}</small>` : ''}`;
            row.cells[5].innerHTML = '';
            const entry = alertsData.find(item => item.id === alertId);
            if (entry) { entry.resolved = true; entry.resolvedAt = data.resolvedAt; entry.resolvedBy = data.resolvedBy; }
        }
    } catch (e) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check me-1"></i>Resolve';
        console.error('Failed to resolve alert:', e);
    }
}

function exportAlertsCSV() {
    if (!alertsData.length) return;
    const headers = ['ID', 'Timestamp', 'Device', 'Issue', 'Severity', 'Status', 'Resolved At', 'Resolved By'];
    const csvRows = alertsData.map(a => [
        a.id,
        new Date(a.time).toLocaleString(),
        a.device,
        a.issue,
        a.severity === 'danger' ? 'High' : a.severity === 'warning' ? 'Warning' : 'Info',
        a.resolved ? 'Resolved' : 'Open',
        a.resolvedAt ? new Date(a.resolvedAt).toLocaleString() : '',
        a.resolvedBy || ''
    ]);
    const csv = [headers, ...csvRows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `alerts_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

function populateReportsTable() {
    const tbody = document.querySelector('#reports-devices-table tbody');
    if (!tbody) return;

    const source = campusDevices.length > 0 ? campusDevices : devicesData;
    tbody.innerHTML = source.map(device => {
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
    const idSource = device && (device.ip || device.id || device.DeviceID || device.name);
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

// ---- Floor Map ----

let currentFloor = 1;

function getFloorPositions() {
    try { return JSON.parse(localStorage.getItem('floorMapPositions') || '{}'); } catch (_) { return {}; }
}

function saveFloorPosition(key, x, y) {
    const pos = getFloorPositions();
    pos[key] = { x, y };
    localStorage.setItem('floorMapPositions', JSON.stringify(pos));
}

function deviceStatusClass(status) {
    if (!status) return 'status-unknown';
    const s = String(status).toLowerCase();
    if (s === 'online') return 'status-online';
    if (s === 'offline') return 'status-offline';
    if (s === 'warning') return 'status-warning';
    return 'status-unknown';
}

function defaultFloorPosition(key, index, total) {
    const hash = [...key].reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const cols = Math.max(Math.ceil(Math.sqrt(total + 1)), 2);
    const rows = Math.ceil(total / cols);
    const col = index % cols;
    const row = Math.floor(index / cols);
    const jx = ((hash * 7) % 9) - 4;
    const jy = ((hash * 13) % 9) - 4;
    const x = 10 + (col / Math.max(cols - 1, 1)) * 78 + jx;
    const y = 12 + (row / Math.max(rows - 1, 1)) * 72 + jy;
    return { x: Math.min(Math.max(x, 5), 93), y: Math.min(Math.max(y, 5), 93) };
}

function getDeviceFloorNumber(device) {
    const f = String(device.floor || '').toLowerCase();
    if (/\b(1|first|ground|uno)\b/.test(f)) return 1;
    if (/\b(2|second|dos)\b/.test(f)) return 2;
    return null;
}

function makeMarkerDraggable(marker, container, key) {
    let dragging = false;
    let startX, startY, startLeft, startTop;

    marker.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = parseFloat(marker.style.left);
        startTop = parseFloat(marker.style.top);
        marker.style.zIndex = 20;
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const rect = container.getBoundingClientRect();
        const dx = ((e.clientX - startX) / rect.width) * 100;
        const dy = ((e.clientY - startY) / rect.height) * 100;
        const newX = Math.min(Math.max(startLeft + dx, 2), 97);
        const newY = Math.min(Math.max(startTop + dy, 2), 97);
        marker.style.left = newX + '%';
        marker.style.top = newY + '%';
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        marker.style.zIndex = 5;
        saveFloorPosition(key, parseFloat(marker.style.left), parseFloat(marker.style.top));
    });
}

function renderFloorMap(floorNum) {
    const container = document.getElementById('floor-map-container');
    const img = document.getElementById('floor-map-img');
    if (!container || !img) return;

    img.src = floorNum === 2 ? '../images/2ndFloor.jpg' : '../images/1stFloor.jpg';

    container.querySelectorAll('.floor-device-marker').forEach(el => el.remove());

    const positions = getFloorPositions();
    const devices = (typeof devicesData !== 'undefined' && devicesData.length) ? devicesData :
                    (typeof topologyDevices !== 'undefined' ? topologyDevices : []);

    let visibleIndex = 0;
    const visibleDevices = devices.filter(d => {
        const df = getDeviceFloorNumber(d);
        return df === null || df === floorNum;
    });

    visibleDevices.forEach((device, idx) => {
        const key = typeof getDeviceKey === 'function' ? getDeviceKey(device) : (device.ip || String(idx));
        const pos = positions[key] || defaultFloorPosition(key, idx, visibleDevices.length);

        const marker = document.createElement('div');
        marker.className = 'floor-device-marker';
        marker.style.left = pos.x + '%';
        marker.style.top = pos.y + '%';
        marker.dataset.deviceKey = key;

        const dot = document.createElement('span');
        dot.className = `floor-marker-dot ${deviceStatusClass(device.status)}`;

        const label = document.createElement('span');
        label.className = 'floor-marker-label';
        label.textContent = `${device.name || device.ip || 'Device'} · ${device.ip || ''} · ${device.status || 'Unknown'}`;

        marker.appendChild(dot);
        marker.appendChild(label);
        container.appendChild(marker);
        makeMarkerDraggable(marker, container, key);
        visibleIndex++;
    });
}

function showFloorMap() {
    const container = document.getElementById('floor-map-container');
    const network = document.getElementById('network');
    const floorGroup = document.getElementById('floor-selector-group');
    const resetCol = document.getElementById('reset-btn-col');

    if (container) container.style.display = 'block';
    if (network) network.style.display = 'none';
    if (floorGroup) floorGroup.style.display = '';
    if (resetCol) resetCol.style.display = 'none';

    renderFloorMap(currentFloor);
}

function hideFloorMap() {
    const container = document.getElementById('floor-map-container');
    const network = document.getElementById('network');
    const floorGroup = document.getElementById('floor-selector-group');
    const resetCol = document.getElementById('reset-btn-col');

    if (container) container.style.display = 'none';
    if (network) network.style.display = '';
    if (floorGroup) floorGroup.style.display = 'none';
    if (resetCol) resetCol.style.display = '';
}

window.switchFloor = function (floorNum) {
    currentFloor = floorNum;
    document.getElementById('floor-btn-1').classList.toggle('active', floorNum === 1);
    document.getElementById('floor-btn-2').classList.toggle('active', floorNum === 2);
    renderFloorMap(floorNum);
};

// ---- End Floor Map ----

function applyTopologyLayout(viewMode) {
    if (!topologyNetwork) return;

    if (viewMode === 'hierarchy') {
        topologyNetwork.setOptions({
            layout: {
                hierarchical: {
                    enabled: true,
                    direction: 'UD',
                    sortMethod: 'hubsize',
                    levelSeparation: 150,
                    nodeSpacing: 120,
                    treeSpacing: 200
                }
            },
            physics: { enabled: false },
            interaction: {
                dragNodes: true,
                dragView: true,
                zoomView: true
            }
        });
        topologyNetwork.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
        return;
    }

    if (viewMode === 'floor') {
        showFloorMap();
        return;
    }

    hideFloorMap();

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
            if (topologyViewMode !== 'floor') hideFloorMap();
            applyTopologyLayout(topologyViewMode);
            if (topologyViewMode === 'realtime') {
                startTopologyRealtime();
            } else if (topologyViewMode !== 'floor') {
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
                        label: function (context) {
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

            // Show admin-only nav items if the current user is an Admin
            try {
                const userRes = await fetch(`${getTopologyApiBase()}/api/auth/me`, { credentials: 'include' });
                if (userRes.ok) {
                    const user = await userRes.json();
                    if (user.role === 'Admin') {
                        container.querySelectorAll('[data-admin-only]').forEach(el => { el.style.display = ''; });
                    }
                }
            } catch (_) {}
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

function initDashboardRealtime() {
    const pingStreamFeed = document.getElementById('ping-stream-feed');

    if (typeof io === 'function') {
        const dashboardSocket = io(getTopologyApiBase(), {
            withCredentials: true,
            transports: ['websocket', 'polling']
        });

        dashboardSocket.on('devices:ping_stream', (results) => {
            if (pingStreamFeed) {
                let html = '';
                results.forEach(res => {
                    const displayStatus = res.status || (res.alive ? 'Online' : 'Offline');
                    const statusColor = displayStatus === 'Online' ? 'success' : 'danger';
                    const latencyText = res.latencyMs !== null ? `${res.latencyMs.toFixed(1)} ms` : 'N/A';
                    html += `
                        <div class="list-group-item d-flex justify-content-between align-items-center py-2">
                            <div>
                                <small class="fw-bold">${res.name || res.ip}</small><br>
                                <small class="text-muted" style="font-size:0.75rem;">${new Date(res.time).toLocaleTimeString()}</small>
                            </div>
                            <div class="text-end">
                                <span class="badge bg-${statusColor} mb-1">${displayStatus}</span><br>
                                <small class="text-muted" style="font-size:0.75rem;">${latencyText}</small>
                            </div>
                        </div>
                    `;
                });
                pingStreamFeed.innerHTML = html;
            }

            // Real-time table updates
            if (typeof devicesData !== 'undefined' && Array.isArray(devicesData)) {
                let onlineCount = 0;
                let offlineCount = 0;
                let unknownCount = 0;
                let topologyNeedsUpdate = false;

                results.forEach(res => {
                    const newStatus = res.status || (res.alive ? 'Online' : 'Offline');
                    const dev = devicesData.find(d => d.id === res.deviceId || d.ip === res.ip);
                    if (dev) {
                        dev.status = newStatus;
                        dev.lastSeen = formatLastSeen(res.time);

                        const deviceKey = getDeviceKey(dev);
                        const row = document.querySelector(`tr[data-device-row="${deviceKey}"]`);
                        if (row) {
                            const statusCell = row.querySelector('[data-status-cell]');
                            if (statusCell) {
                                statusCell.innerHTML = buildStatusMarkup(newStatus);
                            }
                            const lastSeenCell = row.querySelector('[data-last-seen-cell]');
                            if (lastSeenCell) {
                                lastSeenCell.innerText = formatDeviceValue(dev.lastSeen);
                            }
                        }
                    }

                    if (typeof campusDevices !== 'undefined') {
                        const topoDev = campusDevices.find(d => d.id === res.deviceId || d.ip === res.ip);
                        if (topoDev && topoDev.status !== newStatus) {
                            topoDev.status = newStatus;
                            topologyNeedsUpdate = true;
                        }
                    }
                });

                if (topologyNeedsUpdate && typeof updateTopologyData === 'function') {
                    updateTopologyData({ fit: false });
                }

                devicesData.forEach(d => {
                    if (d.status === 'Online') onlineCount++;
                    else if (d.status === 'Offline') offlineCount++;
                    else unknownCount++;
                });

                const totalEl = document.getElementById('total-devices');
                const onlineEl = document.getElementById('online-count');
                const offlineEl = document.getElementById('offline-count');
                const alertsEl = document.getElementById('alerts-today');

                if (totalEl) totalEl.innerText = devicesData.length;
                if (onlineEl) onlineEl.innerText = onlineCount;
                if (offlineEl) offlineEl.innerText = offlineCount;
                if (alertsEl) alertsEl.innerText = offlineCount;

                if (typeof window.createStatusChart === 'function') {
                    window.createStatusChart(onlineCount, offlineCount, unknownCount);
                }
            }
        });

        dashboardSocket.on('devices:update', (devices) => {
            if (Array.isArray(devices)) {
                setDevicesData(devices.map(d => ({
                    ...d,
                    lastSeen: typeof formatLastSeen === 'function' ? formatLastSeen(d.lastSeen) : d.lastSeen
                })));
            }
        });

        dashboardSocket.on('alert:new', (alert) => {
            // Show toast notification
            let toastContainer = document.getElementById('alertToastContainer');
            if (!toastContainer) {
                toastContainer = document.createElement('div');
                toastContainer.id = 'alertToastContainer';
                toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
                toastContainer.style.zIndex = '1055';
                document.body.appendChild(toastContainer);
            }

            const toastId = 'toast-' + Date.now();
            const icon = alert.severity === 'danger' ? 'fa-exclamation-triangle' : (alert.severity === 'warning' ? 'fa-exclamation-circle' : 'fa-check-circle');
            const toastHtml = `
                <div id="${toastId}" class="toast align-items-center text-bg-${alert.severity} border-0" role="alert" aria-live="assertive" aria-atomic="true">
                    <div class="d-flex">
                        <div class="toast-body fw-semibold">
                            <i class="fas ${icon} me-2"></i> ${alert.message}
                        </div>
                        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
                    </div>
                </div>
            `;
            toastContainer.insertAdjacentHTML('beforeend', toastHtml);
            
            // Enforce maximum of 4 alerts by removing the oldest one
            const existingToasts = toastContainer.querySelectorAll('.toast');
            if (existingToasts.length > 4) {
                existingToasts[0].remove();
            }
            
            const toastEl = document.getElementById(toastId);

            if (typeof bootstrap !== 'undefined') {
                const bsToast = new bootstrap.Toast(toastEl, {
                    autohide: true,
                    delay: 3000
                });

                bsToast.show();
                toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
            }

            // Add to "Recent Alerts" feed on dashboard
            const recentAlerts = document.getElementById('recent-alerts');
            if (recentAlerts) {
                const timeStr = new Date(alert.time).toLocaleTimeString();
                const alertHtml = `
                    <li class="list-group-item px-0 py-3">
                        <div class="d-flex justify-content-between align-items-start">
                            <div class="ms-2 me-auto">
                                <div class="fw-bold mb-1">${alert.message}</div>
                                <span class="badge bg-${alert.severity} me-1">${alert.type.toUpperCase()}</span>
                                <small class="text-muted"><i class="far fa-clock me-1"></i>${timeStr}</small>
                            </div>
                        </div>
                    </li>
                `;
                recentAlerts.insertAdjacentHTML('afterbegin', alertHtml);
                // Keep only the 10 most recent
                while (recentAlerts.children.length > 10) {
                    recentAlerts.lastElementChild.remove();
                }
            }

            // Prepend live row to the Alerts page table if it's open
            const alertTbody = document.querySelector('#alerts-table tbody');
            if (alertTbody) {
                const label = alert.severity === 'danger' ? 'High' : alert.severity === 'warning' ? 'Warning' : 'Info';
                const badgeClass = alert.severity === 'danger' ? 'danger' : alert.severity === 'warning' ? 'warning' : 'success';
                alertTbody.insertAdjacentHTML('afterbegin', `<tr>
                    <td>${new Date(alert.time).toLocaleString()}</td>
                    <td>${alert.deviceName || 'Unknown'}</td>
                    <td>${alert.message}</td>
                    <td><span class="badge bg-${badgeClass}">${label}</span></td>
                </tr>`);
            }
        });
    }
}

window.addEventListener('load', async function () {
    await loadSidebar();
    await initScanSettings();
    populateDevicesTable();
    initDeviceTableActions();
    populateRecentAlerts();
    populateAlertsTable();
    populateReportsTable();
    initTopology();
    initDashboardRealtime();

    // Wire up the email alert toggle in Settings
    const emailSwitch = document.getElementById('emailAlertSwitch');
    if (emailSwitch) {
        fetch(getSettingsApiBase() + '/api/settings/email-alerts', { credentials: 'include' })
            .then(r => r.json())
            .then(d => { emailSwitch.checked = d.emailAlertsEnabled; })
            .catch(() => {});
        emailSwitch.addEventListener('change', () => {
            fetch(getSettingsApiBase() + '/api/settings/email-alerts', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: emailSwitch.checked })
            }).catch(() => {});
        });
    }

    console.log('%cCampusNet UI layout loaded successfully!', 'color:#0d6efd; font-weight:bold');
});

window.addEventListener('resize', () => {
    if (window.innerWidth >= 992) {
        document.body.classList.remove('sidebar-open');
    }
});
