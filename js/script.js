let devicesData = [];

function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
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
            <tr data-device-row="${escapeHtml(deviceKey)}">
                <td><strong>${escapeHtml(formatDeviceValue(dev.name || dev.ip || 'Device', 'Device'))}</strong></td>
                <td>${escapeHtml(formatDeviceValue(dev.type))}</td>
                <td><code>${escapeHtml(formatDeviceValue(dev.ip))}</code></td>
                <td>${macCell}</td>
                <td>${escapeHtml(formatDeviceValue(locationLabel))}</td>
                <td data-status-cell>${statusHTML}</td>
                <td data-last-seen-cell>${escapeHtml(formatDeviceValue(dev.lastSeen))}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" data-device-action="view" data-device-key="${escapeHtml(deviceKey)}">View</button>
                </td>
            </tr>`;
    });
}

function openDeviceDetailsModal(device) {
    const existing = document.getElementById('deviceDetailsModal');
    if (existing) existing.remove();

    const selected = device || {};
    const name = escapeHtml(formatDeviceValue(selected.name || selected.ip || 'Device', 'Device'));
    const type = escapeHtml(formatDeviceValue(selected.type));
    const ip = escapeHtml(formatDeviceValue(selected.ip));
    const mac = escapeHtml(formatDeviceValue(selected.mac));
    const location = escapeHtml(formatDeviceValue(resolveLocationLabel(selected)));
    const building = escapeHtml(formatDeviceValue(selected.building));
    const floor = escapeHtml(formatDeviceValue(selected.floor));
    const room = escapeHtml(formatDeviceValue(selected.room));
    const statusMarkup = buildStatusMarkup(selected.status);
    const lastSeen = escapeHtml(formatDeviceValue(selected.lastSeen));
    const description = escapeHtml(formatDeviceValue(selected.description, ''));
    const nameInput = escapeHtml(selected.name ? String(selected.name) : '');
    const typeInput = escapeHtml(selected.type ? String(selected.type) : '');
    const buildingInput = escapeHtml(selected.building ? String(selected.building) : '');
    const floorInput = escapeHtml(selected.floor ? String(selected.floor) : '');
    const roomInput = escapeHtml(selected.room ? String(selected.room) : '');
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

    const onlineCount  = devicesData.filter(d => d.status === 'Online').length;
    const offlineCount = devicesData.filter(d => d.status === 'Offline').length;
    const unknownCount = Math.max(0, devicesData.length - onlineCount - offlineCount);
    if (typeof window.createStatusChart === 'function') {
        window.createStatusChart(onlineCount, offlineCount, unknownCount);
    }
    const totalEl   = document.getElementById('total-devices');
    const onlineEl  = document.getElementById('online-count');
    const offlineEl = document.getElementById('offline-count');
    if (totalEl)  totalEl.textContent  = devicesData.length;
    if (onlineEl) onlineEl.textContent = onlineCount;
    if (offlineEl) offlineEl.textContent = offlineCount;
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
            ? `<span class="badge bg-success">Resolved</span>`
            : '<span class="badge bg-secondary">Open</span>';
        const notesCell = a.resolutionNotes
            ? `<button class="btn btn-sm btn-outline-secondary" onclick="viewResolutionNotes(${a.id})"><i class="fas fa-eye me-1"></i>View</button>`
            : `<span class="text-muted small">—</span>`;
        const actionBtn = a.resolved
            ? ''
            : `<button class="btn btn-sm btn-outline-success" onclick="openResolveModal(${a.id}, '${escapeHtml(a.device)}', '${escapeHtml(a.issue)}')"><i class="fas fa-check me-1"></i>Resolve</button>`;
        return `<tr data-alert-id="${a.id}">
            <td>${new Date(a.time).toLocaleString()}</td>
            <td>${escapeHtml(a.device)}</td>
            <td>${escapeHtml(a.issue)}</td>
            <td><span class="badge bg-${badgeClass}">${label}</span></td>
            <td>${statusBadge}</td>
            <td>${notesCell}</td>
            <td>${actionBtn}</td>
        </tr>`;
    }).join('');
}

// State for the resolve modal
let _resolveTargetId = null;
let _resolveTargetBtn = null;

function openResolveModal(alertId, deviceName, issue) {
    _resolveTargetId = alertId;
    const infoEl = document.getElementById('resolve-modal-device-info');
    const notesEl = document.getElementById('resolution-notes-input');
    const countEl = document.getElementById('notes-char-count');
    const confirmBtn = document.getElementById('confirm-resolve-btn');
    if (infoEl) infoEl.textContent = `${deviceName} — ${issue}`;
    if (notesEl) { notesEl.value = ''; }
    if (countEl) countEl.textContent = '0';
    if (notesEl && countEl) {
        notesEl.oninput = () => { countEl.textContent = notesEl.value.length; };
    }
    if (confirmBtn) {
        confirmBtn.onclick = () => submitResolve();
    }
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('resolveAlertModal'));
    modal.show();
}

async function submitResolve() {
    const alertId = _resolveTargetId;
    if (!alertId) return;
    const notes = (document.getElementById('resolution-notes-input')?.value || '').trim();
    const confirmBtn = document.getElementById('confirm-resolve-btn');
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving…'; }
    try {
        const res = await fetch(getTopologyApiBase() + `/api/alerts/${alertId}/resolve`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes })
        });
        if (!res.ok) throw new Error('Server error');
        const data = await res.json();
        bootstrap.Modal.getOrCreateInstance(document.getElementById('resolveAlertModal')).hide();
        const row = document.querySelector(`tr[data-alert-id="${alertId}"]`);
        if (row) {
            row.cells[4].innerHTML = `<span class="badge bg-success">Resolved</span>`;
            row.cells[5].innerHTML = data.resolutionNotes
                ? `<button class="btn btn-sm btn-outline-secondary" onclick="viewResolutionNotes(${alertId})"><i class="fas fa-eye me-1"></i>View</button>`
                : `<span class="text-muted small">—</span>`;
            row.cells[6].innerHTML = '';
            const entry = alertsData.find(item => item.id === alertId);
            if (entry) { entry.resolved = true; entry.resolvedAt = data.resolvedAt; entry.resolvedBy = data.resolvedBy; entry.resolutionNotes = data.resolutionNotes; }
        }
    } catch (e) {
        console.error('Failed to resolve alert:', e);
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.innerHTML = '<i class="fas fa-check me-1"></i>Mark as Resolved'; }
    } finally {
        _resolveTargetId = null;
    }
}

function viewResolutionNotes(alertId) {
    const entry = alertsData.find(a => a.id === alertId);
    if (!entry) return;
    const modal = document.getElementById('viewNotesModal');
    if (!modal) return;
    modal.querySelector('#view-notes-device').textContent = `${entry.device} — ${entry.issue}`;
    modal.querySelector('#view-notes-resolver').textContent = entry.resolvedBy || 'Unknown';
    modal.querySelector('#view-notes-body').textContent = entry.resolutionNotes || '';
    bootstrap.Modal.getOrCreateInstance(modal).show();
}

function exportAlertsCSV() {
    if (!alertsData.length) return;
    const headers = ['ID', 'Timestamp', 'Device', 'Issue', 'Severity', 'Status', 'Resolved At', 'Resolved By', 'Resolution Notes'];
    const csvRows = alertsData.map(a => [
        a.id,
        new Date(a.time).toLocaleString(),
        a.device,
        a.issue,
        a.severity === 'danger' ? 'High' : a.severity === 'warning' ? 'Warning' : 'Info',
        a.resolved ? 'Resolved' : 'Open',
        a.resolvedAt ? new Date(a.resolvedAt).toLocaleString() : '',
        a.resolvedBy || '',
        a.resolutionNotes || ''
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
let topologyViewMode = 'buildings';
let topologyTrafficTimer = null;
let topologyPollTimer = null;
let topologySocket = null;

const topologyIconCache = new Map();

let campusDevices = [];

let campusLinks = [];

function getTopologyApiBase() {
    return window.TOPOLOGY_API_BASE || window.MONITOR_API_BASE || window.location.origin;
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

    // Router: WiFi router with 3 antennas, dark body, ethernet ports (matches reference image 1)
    const routerSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><ellipse cx="44" cy="75" rx="26" ry="4" fill="#1a1a1a" opacity="0.25"/><line x1="24" y1="48" x2="21" y2="10" stroke="#111" stroke-width="4.5" stroke-linecap="round"/><circle cx="21" cy="8" r="4.5" fill="#111"/><line x1="40" y1="48" x2="40" y2="6" stroke="#111" stroke-width="4.5" stroke-linecap="round"/><circle cx="40" cy="4" r="4.5" fill="#111"/><line x1="56" y1="48" x2="59" y2="10" stroke="#111" stroke-width="4.5" stroke-linecap="round"/><circle cx="59" cy="8" r="4.5" fill="#111"/><rect x="6" y="48" width="68" height="22" rx="5" fill="#2e2e2e"/><rect x="8" y="50" width="64" height="7" rx="3" fill="#3c3c3c"/><rect x="8" y="57" width="64" height="11" rx="0" fill="#2a2a2a"/><circle cx="16" cy="60" r="5" fill="#1a1a1a" stroke="#555" stroke-width="1.5"/><circle cx="64" cy="60" r="5" fill="#1a1a1a" stroke="#555" stroke-width="1.5"/><rect x="26" y="57" width="5" height="6" rx="1" fill="#666"/><rect x="33" y="57" width="5" height="6" rx="1" fill="#666"/><rect x="40" y="57" width="5" height="6" rx="1" fill="#666"/><rect x="47" y="57" width="5" height="6" rx="1" fill="#666"/></svg>';
    // Switch: silver isometric rack switch with port grid + green LEDs (matches reference image 3)
    const switchSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 52"><defs><linearGradient id="stg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#e2e6f0"/><stop offset="100%" stop-color="#b8bece"/></linearGradient><linearGradient id="sfg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#c8ccd8"/><stop offset="100%" stop-color="#a0a4b0"/></linearGradient></defs><polygon points="5,6 85,6 85,34 5,34" fill="url(#stg)" stroke="#909090" stroke-width="1"/><rect x="5" y="34" width="80" height="12" rx="0" fill="url(#sfg)" stroke="#909090" stroke-width="1"/><polygon points="85,6 90,11 90,39 85,34" fill="#909898" stroke="#808888" stroke-width="1"/><rect x="5" y="6" width="80" height="5" rx="0" fill="#eef0f8"/><rect x="8" y="37" width="5" height="5" rx="0.5" fill="#333"/><rect x="15" y="37" width="5" height="5" rx="0.5" fill="#333"/><rect x="22" y="37" width="5" height="5" rx="0.5" fill="#333"/><rect x="29" y="37" width="5" height="5" rx="0.5" fill="#333"/><rect x="36" y="37" width="5" height="5" rx="0.5" fill="#333"/><rect x="43" y="37" width="5" height="5" rx="0.5" fill="#333"/><rect x="52" y="38" width="5" height="3" rx="0.5" fill="#00dd00"/><rect x="59" y="38" width="5" height="3" rx="0.5" fill="#00dd00"/><rect x="66" y="38" width="5" height="3" rx="0.5" fill="#00dd00"/><rect x="73" y="38" width="5" height="3" rx="0.5" fill="#00dd00"/><rect x="80" y="38" width="3" height="3" rx="0.5" fill="#eecc00"/></svg>';
    // Server: dark navy tower PC/server with 2 drive bays + circular power button (matches reference image 2)
    const serverSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 80"><rect x="4" y="2" width="44" height="76" rx="5" fill="#2d3f5c"/><rect x="4" y="2" width="44" height="76" rx="5" fill="none" stroke="#1a2a40" stroke-width="1.5"/><rect x="10" y="10" width="32" height="16" rx="2" fill="#1c2e44"/><rect x="12" y="12" width="28" height="12" rx="1.5" fill="#243654" stroke="#3a5878" stroke-width="1"/><rect x="10" y="30" width="32" height="9" rx="2" fill="#1c2e44" stroke="#3a5878" stroke-width="1"/><circle cx="26" cy="55" r="10" fill="#1c2e44" stroke="white" stroke-width="2.5"/><circle cx="26" cy="55" r="5" fill="#1c2e44" stroke="white" stroke-width="1.5"/><rect x="10" y="68" width="32" height="6" rx="2" fill="#1c2e44" stroke="#3a5878" stroke-width="1"/></svg>';
    // PC: tower + widescreen monitor (matches reference image 4)
    const pcSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 64"><rect x="2" y="14" width="20" height="46" rx="3" fill="#111"/><rect x="5" y="20" width="14" height="6" rx="1" fill="#222" stroke="#444" stroke-width="1"/><rect x="5" y="29" width="14" height="4" rx="1" fill="#222" stroke="#444" stroke-width="1"/><circle cx="12" cy="50" r="2.5" fill="#222" stroke="#444" stroke-width="1"/><rect x="26" y="6" width="50" height="38" rx="6" fill="#111"/><rect x="30" y="10" width="42" height="30" rx="3" fill="white"/><rect x="44" y="44" width="14" height="6" rx="1" fill="#111"/><rect x="36" y="50" width="30" height="6" rx="2" fill="#111"/></svg>';
    // Access Point / WiFi
    const apSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="38" r="7" fill="#2a7dc9" stroke="#1a5fa8" stroke-width="2"/><circle cx="32" cy="38" r="3" fill="white"/><path d="M18 26 Q32 14 46 26" stroke="#3a8de8" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M23 31 Q32 22 41 31" stroke="#3a8de8" stroke-width="2.5" stroke-linecap="round" fill="none"/><line x1="32" y1="45" x2="32" y2="54" stroke="#2a7dc9" stroke-width="2"/><rect x="22" y="54" width="20" height="4" rx="2" fill="#2a7dc9" stroke="#1a5fa8" stroke-width="1.5"/></svg>';

    // Generic endpoint / unknown device: laptop-style icon
    const endpointSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 52"><rect x="4" y="2" width="56" height="36" rx="4" fill="#1e1e1e"/><rect x="8" y="6" width="48" height="28" rx="2" fill="#2a2a2a"/><rect x="10" y="8" width="44" height="24" rx="1" fill="white"/><rect x="0" y="40" width="64" height="6" rx="3" fill="#2e2e2e"/><rect x="22" y="38" width="20" height="4" rx="1" fill="#1e1e1e"/></svg>';

    let svg = endpointSvg;
    if (key.includes('router') || key.includes('gateway') || key.includes('modem')) {
        svg = routerSvg;
    } else if (key.includes('server')) {
        svg = serverSvg;
    } else if (key.includes('pc') || key.includes('workstation') || key.includes('desktop')) {
        svg = pcSvg;
    } else if (key.includes('ap') || key.includes('wifi') || key.includes('wireless')) {
        svg = apSvg;
    } else if (key.includes('switch')) {
        svg = switchSvg;
    } else if (key.includes('endpoint') || key.includes('laptop') || key.includes('device')) {
        svg = endpointSvg;
    }

    const icon = buildSvgDataUri(svg);
    topologyIconCache.set(key, icon);
    return icon;
}

function getBuildingIcon(status) {
    const key = `bldg-${status}`;
    if (topologyIconCache.has(key)) return topologyIconCache.get(key);
    const fill  = status === 'Online' ? '#3a7bd5' : status === 'Offline' ? '#c0392b' : '#e67e22';
    const roof  = status === 'Online' ? '#1e5bb5' : status === 'Offline' ? '#7b0000' : '#a84300';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
      <ellipse cx="40" cy="76" rx="26" ry="4" fill="#000" opacity="0.12"/>
      <rect x="10" y="28" width="60" height="46" rx="3" fill="${fill}"/>
      <polygon points="5,30 40,7 75,30" fill="${roof}"/>
      <rect x="15" y="35" width="13" height="10" rx="1.5" fill="#c5e0f8" opacity="0.85"/>
      <rect x="34" y="35" width="13" height="10" rx="1.5" fill="#c5e0f8" opacity="0.85"/>
      <rect x="53" y="35" width="13" height="10" rx="1.5" fill="#c5e0f8" opacity="0.85"/>
      <rect x="15" y="50" width="13" height="10" rx="1.5" fill="#c5e0f8" opacity="0.85"/>
      <rect x="53" y="50" width="13" height="10" rx="1.5" fill="#c5e0f8" opacity="0.85"/>
      <rect x="32" y="58" width="16" height="16" rx="2" fill="${roof}"/>
    </svg>`;
    const uri = buildSvgDataUri(svg);
    topologyIconCache.set(key, uri);
    return uri;
}

const BUILDING_IMAGE_MAP = {
    'IC Building': '/images/ic-building.png',
    'Unknown': '/images/unknown.png'
};

function buildBuildingTopologyData() {
    const buildingMap = new Map();
    campusDevices.forEach(device => {
        const name = device.building || 'Unknown';
        if (!buildingMap.has(name)) buildingMap.set(name, []);
        buildingMap.get(name).push(device);
    });

    function aggStatus(devices) {
        if (devices.some(d => d.status === 'Offline')) return 'Offline';
        if (devices.some(d => d.status === 'Warning')) return 'Warning';
        return 'Online';
    }

    // Spread building nodes in a circle so they never overlap
    const buildingNames = [...buildingMap.keys()];
    const total = buildingNames.length;
    const RADIUS = total <= 1 ? 0 : Math.max(280, total * 100);

    function buildingPosition(index) {
        if (total === 1) return { x: 0, y: 0 };
        const angle = (2 * Math.PI * index) / total - Math.PI / 2;
        return { x: Math.round(RADIUS * Math.cos(angle)), y: Math.round(RADIUS * Math.sin(angle)) };
    }

    const nodes = [];
    buildingNames.forEach((name, index) => {
        const devices = buildingMap.get(name);
        const status = aggStatus(devices);
        const online = devices.filter(d => d.status === 'Online').length;
        const image = BUILDING_IMAGE_MAP[name] || getBuildingIcon(status);
        const pos = buildingPosition(index);
        nodes.push({
            id: `bldg::${name}`,
            label: `${name}\n${online}/${devices.length} online`,
            title: `${name} — ${devices.length} device(s), ${online} online`,
            shape: 'image',
            image,
            size: 40,
            x: pos.x,
            y: pos.y,
            fixed: { x: false, y: false },
            borderWidth: 3,
            color: {
                border: statusColor(status),
                background: '#ffffff',
                highlight: { border: '#12b3c7', background: '#ffffff' }
            },
            font: { color: '#0f2338', size: 13, face: 'IBM Plex Sans', align: 'center' },
            shapeProperties: { useBorderWithImage: true },
            _buildingName: name
        });
    });

    const devBuilding = new Map();
    campusDevices.forEach(d => devBuilding.set(d.id, d.building || 'Unknown'));

    const seen = new Set();
    const edges = [];
    campusLinks.forEach(link => {
        const a = devBuilding.get(link.from);
        const b = devBuilding.get(link.to);
        if (!a || !b || a === b) return;
        const key = [a, b].sort().join('||');
        if (seen.has(key)) return;
        seen.add(key);
        edges.push({
            id: `bedge::${key}`,
            from: `bldg::${a}`,
            to: `bldg::${b}`,
            color: { color: '#1f7ae0' },
            width: 2,
            smooth: { type: 'dynamic' }
        });
    });

    return { nodes, edges };
}

function drillIntoBuilding(buildingName) {
    const viewModeSelect = document.getElementById('topology-view-mode');
    const buildingFilter = document.getElementById('building-filter');
    const hasFloorPlan = buildingName === 'IC Building';

    if (hasFloorPlan) {
        if (viewModeSelect) viewModeSelect.value = 'floor';
        topologyViewMode = 'floor';
        _setFloorMapShellVisible(true);
        showBuildingFloorPlan(buildingName);
    } else {
        // No floor plan for this building — show its devices in logical view
        if (buildingFilter) buildingFilter.value = buildingName;
        if (viewModeSelect) viewModeSelect.value = 'logical';
        topologyViewMode = 'logical';
        hideFloorMap();
        applyTopologyLayout('logical');
        loadTopologySnapshot({ fit: true });
    }
}

function buildTopologyLabel(device) {
    const ipLine = device.ip ? `\n${device.ip}` : '';
    return `${device.name}${ipLine}`.trim();
}

function buildTopologyTitle(device) {
    const parts = [device.type, device.building, device.floor].filter(Boolean);
    return parts.join(' | ');
}

const IP_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function deviceHasName(device) {
    return device.name && !IP_PATTERN.test(device.name.trim()) && device.name.trim() !== device.ip;
}

function isKnownDeviceType(type) {
    const t = (type || '').toLowerCase();
    return t.includes('router') || t.includes('modem') || t.includes('gateway') ||
           t.includes('phone') || t.includes('mobile') || t.includes('smartphone') ||
           t.includes('pc') || t.includes('workstation') || t.includes('desktop') || t.includes('computer') ||
           t.includes('switch') ||
           t.includes('ap') || t.includes('wifi') || t.includes('wireless') || t.includes('access');
}

function matchesDeviceTypeFilter(device, filterValue) {
    if (filterValue === 'all') return true;
    const t = (device.type || '').toLowerCase();
    switch (filterValue) {
        case 'router':  return t.includes('router') || t.includes('modem') || t.includes('gateway');
        case 'phone':   return t.includes('phone') || t.includes('mobile') || t.includes('smartphone');
        case 'pc':      return t.includes('pc') || t.includes('workstation') || t.includes('desktop') || t.includes('computer');
        case 'switch':  return t.includes('switch');
        case 'ap':      return t.includes('ap') || t.includes('wifi') || t.includes('wireless') || t.includes('access');
        case 'unknown': return true;
        default:        return true;
    }
}

function getDeviceHierarchyLevel(deviceType) {
    const t = (deviceType || '').toLowerCase();
    if (t.includes('router') || t.includes('modem') || t.includes('gateway')) return 0;
    if (t.includes('switch')) return 1;
    if (t.includes('server') || t.includes('ap') || t.includes('wifi') || t.includes('wireless') || t.includes('access')) return 2;
    return 3;
}

function computeTopologyLevels(devices, links) {
    const adj = new Map();
    devices.forEach(d => adj.set(d.id, []));
    links.forEach(link => {
        if (adj.has(link.from) && adj.has(link.to)) {
            adj.get(link.from).push(link.to);
            adj.get(link.to).push(link.from);
        }
    });

    // Root = router/gateway first; else most-connected device
    let root = devices.find(d => {
        const t = (d.type || '').toLowerCase();
        return t.includes('router') || t.includes('gateway') || t.includes('modem');
    });
    if (!root && devices.length > 0) {
        root = devices.reduce((best, d) =>
            (adj.get(d.id) || []).length > (adj.get(best.id) || []).length ? d : best,
            devices[0]
        );
    }

    const levels = new Map();
    if (root) {
        const queue = [root.id];
        levels.set(root.id, 0);
        while (queue.length) {
            const curr = queue.shift();
            for (const neighbor of (adj.get(curr) || [])) {
                if (!levels.has(neighbor)) {
                    levels.set(neighbor, levels.get(curr) + 1);
                    queue.push(neighbor);
                }
            }
        }
    }

    // Fallback for disconnected nodes: use device-type tier
    devices.forEach(d => {
        if (!levels.has(d.id)) levels.set(d.id, getDeviceHierarchyLevel(d.type));
    });

    return levels;
}

function buildStarPositions(devices, links) {
    if (!devices.length) return new Map();

    const connCount = new Map(devices.map(d => [d.id, 0]));
    links.forEach(l => {
        if (connCount.has(l.from)) connCount.set(l.from, connCount.get(l.from) + 1);
        if (connCount.has(l.to)) connCount.set(l.to, connCount.get(l.to) + 1);
    });

    // Prefer router/gateway as center; fallback to most-connected
    let center = devices.find(d => {
        const t = (d.type || '').toLowerCase();
        return t.includes('router') || t.includes('gateway') || t.includes('modem');
    });
    if (!center) {
        center = [...devices].sort((a, b) => (connCount.get(b.id) || 0) - (connCount.get(a.id) || 0))[0];
    }

    const others = devices.filter(d => d.id !== center.id);

    const positions = new Map();
    positions.set(center.id, { x: 0, y: 0 });

    if (others.length > 0) {
        const radius = Math.max(220, others.length * 42);
        const angleStep = (2 * Math.PI) / others.length;
        others.forEach((d, i) => {
            positions.set(d.id, {
                x: Math.round(radius * Math.cos(i * angleStep - Math.PI / 2)),
                y: Math.round(radius * Math.sin(i * angleStep - Math.PI / 2))
            });
        });
    }

    return positions;
}

function getTopologyFilters() {
    const buildingFilter = document.getElementById('building-filter');
    const statusFilter = document.getElementById('status-filter');
    const deviceTypeFilter = document.getElementById('device-type-filter');

    return {
        building: buildingFilter ? buildingFilter.value : 'all',
        status: statusFilter ? statusFilter.value : 'all',
        deviceType: deviceTypeFilter ? deviceTypeFilter.value : 'all'
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

    if (topologyViewMode === 'realtime') {
        renderRealtimeFloorMap();
    }

    if (topologyViewMode === 'floor' && floorDotsEnabled) {
        renderFloorMapDots();
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

function renderFloorMap() {
    const floor1El = document.getElementById('floor-map-1');
    const floor2El = document.getElementById('floor-map-2');
    if (!floor1El || !floor2El) return;

    floor1El.querySelectorAll('.floor-device-marker').forEach(el => el.remove());
    floor2El.querySelectorAll('.floor-device-marker').forEach(el => el.remove());

    const positions = getFloorPositions();
    const devices = (typeof devicesData !== 'undefined' && devicesData.length) ? devicesData :
                    (typeof topologyDevices !== 'undefined' ? topologyDevices : []);

    devices.forEach((device, idx) => {
        const df = getDeviceFloorNumber(device);
        const targetEl = df === 2 ? floor2El : floor1El;

        const key = typeof getDeviceKey === 'function' ? getDeviceKey(device) : (device.ip || String(idx));
        const floorDevices = devices.filter(d => (df === 2 ? getDeviceFloorNumber(d) === 2 : getDeviceFloorNumber(d) !== 2));
        const pos = positions[key] || defaultFloorPosition(key, idx, floorDevices.length);

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
        targetEl.appendChild(marker);
        makeMarkerDraggable(marker, targetEl, key);
    });
}

let floorDotsEnabled = false;

function _setFloorMapShellVisible(visible) {
    const container = document.getElementById('floor-map-container');
    const network = document.getElementById('network');
    const resetCol = document.getElementById('reset-btn-col');
    const detailCol = document.getElementById('topology-detail-col');
    const mapCol = document.getElementById('topology-map-col');
    if (container) container.style.display = visible ? 'block' : 'none';
    if (network) network.style.display = visible ? 'none' : '';
    if (resetCol) resetCol.style.display = visible ? 'none' : '';
    // When live-dots are on, show the detail panel so clicked dots can display info
    if (detailCol) detailCol.style.display = (visible && !floorDotsEnabled) ? 'none' : '';
    if (mapCol) mapCol.className = (visible && !floorDotsEnabled) ? 'col-12' : 'col-12 col-xl-8';
}

window.toggleFloorDots = function toggleFloorDots() {
    floorDotsEnabled = !floorDotsEnabled;

    // Update button visual
    const btn = document.getElementById('floor-dots-toggle');
    const knob = document.getElementById('floor-dots-knob');
    if (btn) btn.style.background = floorDotsEnabled ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.12)';
    if (btn) btn.style.borderColor = floorDotsEnabled ? '#22c55e' : 'rgba(255,255,255,0.35)';
    if (knob) knob.style.background = floorDotsEnabled ? '#22c55e' : '#aaa';

    // Re-apply layout (shows/hides detail col based on toggle)
    _setFloorMapShellVisible(true);

    const overlayIds = ['floor-dot-overlay-1', 'floor-dot-overlay-2'];
    if (floorDotsEnabled) {
        overlayIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'block';
        });
        requestAnimationFrame(() => requestAnimationFrame(renderFloorMapDots));
    } else {
        overlayIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.innerHTML = ''; el.style.display = 'none'; }
        });
    }
};

function showFloorMap() {
    _setFloorMapShellVisible(true);
    showBuildingPicker();
}

function hideFloorMap() {
    _setFloorMapShellVisible(false);
}

window.showBuildingPicker = function showBuildingPicker() {
    const picker = document.getElementById('building-picker');
    const floorView = document.getElementById('floor-plan-view');
    if (picker) picker.style.display = 'block';
    if (floorView) floorView.style.display = 'none';
    _renderBuildingCards();
};

function _renderBuildingCards() {
    const cardsEl = document.getElementById('building-picker-cards');
    if (!cardsEl) return;

    // Always include IC Building (the only one with floor plans)
    const discovered = [...new Set((campusDevices || []).map(d => d.building).filter(Boolean))];
    const allBuildings = [...new Set(['IC Building', ...discovered])];

    cardsEl.innerHTML = '';
    allBuildings.forEach(bName => {
        const total  = (campusDevices || []).filter(d => d.building === bName).length;
        const online = (campusDevices || []).filter(d => d.building === bName && d.status === 'Online').length;
        const imgSrc = BUILDING_IMAGE_MAP[bName] || '../images/unknown.png';
        const hasFloorPlan = (bName === 'IC Building');

        const card = document.createElement('div');
        card.style.cssText = [
            'width:210px', 'background:white', 'border-radius:12px',
            'overflow:hidden', 'box-shadow:0 2px 12px rgba(0,0,0,0.13)',
            'cursor:' + (hasFloorPlan ? 'pointer' : 'default'),
            'transition:transform 0.15s,box-shadow 0.15s', 'flex-shrink:0'
        ].join(';');

        if (hasFloorPlan) {
            card.addEventListener('mouseenter', () => {
                card.style.transform = 'translateY(-5px)';
                card.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)';
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = '';
                card.style.boxShadow = '0 2px 12px rgba(0,0,0,0.13)';
            });
            card.addEventListener('click', () => showBuildingFloorPlan(bName));
        }

        card.innerHTML = `
            <div style="height:130px;overflow:hidden;background:#dce4ee;">
                <img src="${imgSrc}" alt="${escapeHtml(bName)}"
                     style="width:100%;height:100%;object-fit:cover;"
                     onerror="this.style.display='none'">
            </div>
            <div style="padding:12px 14px;">
                <div style="font-weight:700;font-family:'Sora',sans-serif;font-size:13px;color:#0f2338;margin-bottom:4px;">${escapeHtml(bName)}</div>
                <div style="font-size:11px;color:#6c757d;">${total} device${total !== 1 ? 's' : ''} &nbsp;·&nbsp; ${online} online</div>
                <div style="margin-top:8px;font-size:11px;font-weight:600;color:${hasFloorPlan ? '#1a3a6e' : '#bbb'};">
                    ${hasFloorPlan ? 'View Floor Plan &rarr;' : 'No floor plan available'}
                </div>
            </div>`;
        cardsEl.appendChild(card);
    });
}

window.showBuildingFloorPlan = function showBuildingFloorPlan(bName) {
    const picker  = document.getElementById('building-picker');
    const floorView = document.getElementById('floor-plan-view');
    const nameEl  = document.getElementById('floor-plan-building-name');

    if (picker) picker.style.display = 'none';
    if (floorView) { floorView.style.display = 'flex'; }
    if (nameEl) nameEl.textContent = bName;

    const buildingFilter = document.getElementById('building-filter');
    if (buildingFilter) buildingFilter.value = bName;

    renderFloorMap();

    if (floorDotsEnabled) {
        const overlayIds = ['floor-dot-overlay-1', 'floor-dot-overlay-2'];
        overlayIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'block';
        });
        requestAnimationFrame(() => requestAnimationFrame(renderFloorMapDots));
    }
};

window.switchFloor = function (floorNum) {
    currentFloor = floorNum;
    renderFloorMap();
};

// ---- End Floor Map ----

// ---- Realtime Floor Map ----

// Room registry — SVG-space fractional bounds (x,y,w,h as 0-1 of viewBox)
// 1st floor: viewBox 920x520, 2nd floor: viewBox 1020x520
const REALTIME_ROOMS = [
    // ── 1st Floor ──
    { floor: '1st floor', keys: ['faculty 1','faculty1'], x:30/920, y:30/520, w:315/920, h:185/520 },
    { floor: '1st floor', keys: ['accreditation','accreditation room'], x:345/920, y:30/520, w:265/920, h:185/520 },
    { floor: '1st floor', keys: ['netlab','net lab'], x:610/920, y:30/520, w:280/920, h:185/520 },
    { floor: '1st floor', keys: ['faculty 2','faculty2'], x:30/920, y:275/520, w:270/920, h:195/520 },
    { floor: '1st floor', keys: ['comlab 1','comlab1','computer lab 1'], x:390/920, y:275/520, w:410/920, h:195/520 },
    // ── 2nd Floor ──
    { floor: '2nd floor', keys: ['maclab','mac lab'], x:30/1020, y:30/520, w:330/1020, h:185/520 },
    { floor: '2nd floor', keys: ['aes','aes lab'], x:360/1020, y:30/520, w:230/1020, h:185/520 },
    { floor: '2nd floor', keys: ['gda','gda lab'], x:590/1020, y:30/520, w:200/1020, h:185/520 },
    { floor: '2nd floor', keys: ['server room','server'], x:30/1020, y:275/520, w:240/1020, h:195/520 },
    { floor: '2nd floor', keys: ['comlab 2','comlab2','computer lab 2'], x:360/1020, y:275/520, w:340/1020, h:195/520 },
    { floor: '2nd floor', keys: ['faculty 3','faculty3'], x:790/1020, y:30/520, w:200/1020, h:440/520 },
];

function matchRoomEntry(device) {
    const roomRaw = String(device.room || device.floor || '').toLowerCase().trim();
    const floorRaw = String(device.floor || '').toLowerCase().trim();
    return REALTIME_ROOMS.find(r =>
        r.keys.some(k => roomRaw === k || roomRaw.includes(k)) &&
        (floorRaw === '' || r.floor === floorRaw || floorRaw.includes(r.floor.split(' ')[0]))
    ) || REALTIME_ROOMS.find(r => r.keys.some(k => roomRaw === k || roomRaw.includes(k)));
}

// Calculate the pixel bounds of an object-fit:contain image inside its wrapper
function getContainImageBounds(wrapper, naturalW, naturalH) {
    const cw = wrapper.clientWidth;
    const ch = wrapper.clientHeight;
    if (!cw || !ch) return null;
    const imgRatio = naturalW / naturalH;
    const containerRatio = cw / ch;
    let rw, rh, ox, oy;
    if (imgRatio > containerRatio) {
        rw = cw; rh = cw / imgRatio; ox = 0; oy = (ch - rh) / 2;
    } else {
        rh = ch; rw = ch * imgRatio; oy = 0; ox = (cw - rw) / 2;
    }
    return { x: ox, y: oy, w: rw, h: rh };
}

// Deterministic dot scatter within a room rect (avoids pure overlap)
function dotPositionInRoom(index, total, roomPx) {
    const DOT = 14; // dot diameter px
    const PADDING = DOT * 1.6;
    const usableW = roomPx.w - PADDING * 2;
    const usableH = roomPx.h - PADDING * 2;
    const cols = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(total * (usableW / Math.max(usableH, 1))))));
    const rows = Math.ceil(total / cols);
    const cellW = usableW / cols;
    const cellH = usableH / rows;
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
        x: roomPx.x + PADDING + col * cellW + cellW / 2,
        y: roomPx.y + PADDING + row * cellH + cellH / 2
    };
}

// Generic room-dot renderer — used by both realtime map and floor-based map
function _renderRoomDotsOnConfig(configs) {
    const selectedDeviceId = topologySelectedId;
    configs.forEach(({ floorKey, svgW, svgH, wrapperId, overlayId }) => {
        const overlay = document.getElementById(overlayId);
        const wrapper = document.getElementById(wrapperId);
        if (!overlay || !wrapper) return;

        const bounds = getContainImageBounds(wrapper, svgW, svgH);
        if (!bounds) return;

        const roomGroups = new Map();
        campusDevices.forEach(device => {
            const entry = matchRoomEntry(device);
            if (!entry || entry.floor !== floorKey) return;
            if (!roomGroups.has(entry)) roomGroups.set(entry, []);
            roomGroups.get(entry).push(device);
        });

        let html = '';

        roomGroups.forEach((devices, entry) => {
            const roomPx = {
                x: bounds.x + entry.x * bounds.w,
                y: bounds.y + entry.y * bounds.h,
                w: entry.w * bounds.w,
                h: entry.h * bounds.h
            };

            const online = devices.filter(d => d.status === 'Online').length;
            const offline = devices.filter(d => d.status === 'Offline').length;
            const total = devices.length;

            const badgeX = roomPx.x + roomPx.w - 4;
            const badgeY = roomPx.y + 4;
            const badgeColor = offline > 0 ? '#ef4444' : '#22c55e';
            html += `<div style="position:absolute;left:${badgeX}px;top:${badgeY}px;transform:translateX(-100%);
                background:${badgeColor};color:white;font-size:10px;font-weight:700;font-family:'IBM Plex Sans',sans-serif;
                padding:2px 6px;border-radius:10px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.25);z-index:10;">
                ${online}/${total}
            </div>`;

            devices.forEach((device, idx) => {
                const pos = dotPositionInRoom(idx, total, roomPx);
                const color = device.status === 'Online' ? '#22c55e'
                    : device.status === 'Warning' ? '#f59e0b' : '#ef4444';
                const label = escapeHtml(device.name || device.ip || 'Device');
                const ipLabel = escapeHtml(device.ip || '');
                const devId = escapeHtml(String(device.id || ''));
                html += `<div title="${label}&#10;${ipLabel}&#10;${device.status}"
                    data-rt-device-id="${devId}"
                    style="position:absolute;width:14px;height:14px;border-radius:50%;
                    background:${color};border:2px solid white;
                    box-shadow:0 1px 4px rgba(0,0,0,0.3);
                    left:${pos.x - 7}px;top:${pos.y - 7}px;z-index:5;
                    pointer-events:auto;cursor:pointer;transition:transform 0.15s,outline 0.1s;"
                    onmouseenter="this.style.transform='scale(1.5)'"
                    onmouseleave="if(!this.classList.contains('rt-dot-selected'))this.style.transform='scale(1)'"
                    onclick="selectRealtimeDot(this,'${devId}')">
                </div>`;
            });
        });

        overlay.innerHTML = html;

        if (selectedDeviceId) {
            const sel = overlay.querySelector(`[data-rt-device-id="${selectedDeviceId}"]`);
            if (sel) {
                sel.classList.add('rt-dot-selected');
                sel.style.outline = '3px solid #facc15';
                sel.style.outlineOffset = '2px';
                sel.style.transform = 'scale(1.5)';
            }
        }
    });
}

function renderRealtimeFloorMap() {
    _renderRoomDotsOnConfig([
        { floorKey: '1st floor', svgW: 920, svgH: 520, wrapperId: 'realtime-floor-1-wrap', overlayId: 'realtime-overlay-1' },
        { floorKey: '2nd floor', svgW: 1020, svgH: 520, wrapperId: 'realtime-floor-2-wrap', overlayId: 'realtime-overlay-2' }
    ]);
}

function renderFloorMapDots() {
    _renderRoomDotsOnConfig([
        { floorKey: '1st floor', svgW: 920, svgH: 520, wrapperId: 'floor-map-1', overlayId: 'floor-dot-overlay-1' },
        { floorKey: '2nd floor', svgW: 1020, svgH: 520, wrapperId: 'floor-map-2', overlayId: 'floor-dot-overlay-2' }
    ]);
}

function selectRealtimeDot(dotEl, deviceId) {
    // Clear previous selection highlight
    document.querySelectorAll('.rt-dot-selected').forEach(el => {
        el.classList.remove('rt-dot-selected');
        el.style.outline = '';
        el.style.transform = 'scale(1)';
    });
    dotEl.classList.add('rt-dot-selected');
    dotEl.style.outline = '3px solid #facc15';
    dotEl.style.outlineOffset = '2px';
    dotEl.style.transform = 'scale(1.5)';

    renderSelectedDevice(deviceId);

    // Scroll device detail panel into view on small screens
    const panel = document.getElementById('topology-detail-col');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showRealtimeFloorMap() {
    const network = document.getElementById('network');
    const rtContainer = document.getElementById('realtime-floor-container');
    if (network) network.style.display = 'none';
    if (rtContainer) rtContainer.style.display = 'block';
    // Defer render until after layout paint so clientWidth/Height are correct
    requestAnimationFrame(() => requestAnimationFrame(renderRealtimeFloorMap));
}

function hideRealtimeFloorMap() {
    const network = document.getElementById('network');
    const rtContainer = document.getElementById('realtime-floor-container');
    if (network) network.style.display = 'block';
    if (rtContainer) rtContainer.style.display = 'none';
}

// ---- End Realtime Floor Map ----

function applyTopologyLayout(viewMode) {
    if (viewMode === 'floor') {
        hideRealtimeFloorMap();
        showFloorMap();
        return;
    }

    if (viewMode === 'realtime') {
        hideFloorMap();
        showRealtimeFloorMap();
        return;
    }

    if (!topologyNetwork) return;

    hideFloorMap();
    hideRealtimeFloorMap();

    const deviceTypeEl = document.getElementById('device-type-filter');
    const deviceTypeVal = deviceTypeEl ? deviceTypeEl.value : 'all';
    const isStarMode = deviceTypeVal === 'unknown';
    const isAllDevices = deviceTypeVal === 'all';

    if (isStarMode) {
        topologyNetwork.setOptions({
            layout: { hierarchical: { enabled: false } },
            physics: { enabled: false },
            interaction: { dragNodes: true, dragView: true, zoomView: true }
        });
        return;
    }

    // "All Devices" always renders as a top-down hierarchy regardless of view mode
    if (isAllDevices && viewMode !== 'buildings' && viewMode !== 'floor') {
        topologyNetwork.setOptions({
            layout: {
                hierarchical: {
                    enabled: true,
                    direction: 'UD',
                    sortMethod: 'directed',
                    levelSeparation: 160,
                    nodeSpacing: 140,
                    treeSpacing: 220
                }
            },
            physics: { enabled: false },
            interaction: { dragNodes: true, dragView: true, zoomView: true }
        });
        topologyNetwork.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
        return;
    }

    if (viewMode === 'buildings') {
        topologyNetwork.setOptions({
            layout: { hierarchical: { enabled: false } },
            physics: {
                enabled: true,
                solver: 'repulsion',
                repulsion: {
                    nodeDistance: 350,
                    centralGravity: 0.05,
                    springLength: 300,
                    springConstant: 0.02,
                    damping: 0.9
                },
                stabilization: { iterations: 80 }
            },
            interaction: { dragNodes: true, dragView: true, zoomView: true }
        });
        topologyNetwork.once('stabilized', () => {
            topologyNetwork.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
        });
        return;
    }

    if (viewMode === 'logical') {
        topologyNetwork.setOptions({
            layout: {
                hierarchical: {
                    enabled: true,
                    direction: 'UD',
                    sortMethod: 'directed',
                    levelSeparation: 160,
                    nodeSpacing: 140,
                    treeSpacing: 220
                }
            },
            physics: { enabled: false },
            interaction: { dragNodes: true, dragView: true, zoomView: true }
        });
        topologyNetwork.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
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
            stabilization: { enabled: false }
        },
        interaction: { dragNodes: true, dragView: true, zoomView: true }
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
    if (topologyViewMode === 'buildings') return buildBuildingTopologyData();
    const filters = getTopologyFilters();

    const filteredDevices = campusDevices.filter(device => {
        const passBuilding = filters.building === 'all' || device.building === filters.building;
        const passStatus = filters.status === 'all' || device.status === filters.status;
        const passType = matchesDeviceTypeFilter(device, filters.deviceType);
        return passBuilding && passStatus && passType;
    });

    const visibleIds = new Set(filteredDevices.map(device => device.id));
    const visibleLinks = campusLinks.filter(l => visibleIds.has(l.from) && visibleIds.has(l.to));

    const isStarMode = filters.deviceType === 'unknown';
    const levelMap = isStarMode ? null : computeTopologyLevels(filteredDevices, visibleLinks);
    const starPos = isStarMode ? buildStarPositions(filteredDevices, visibleLinks) : null;

    const nodes = filteredDevices.map(device => {
        const nodeColor = statusColor(device.status);
        const node = {
            id: device.id,
            label: buildTopologyLabel(device),
            title: buildTopologyTitle(device),
            shape: 'image',
            image: getTopologyIcon(device.type),
            size: 26,
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

        if (isStarMode && starPos) {
            const pos = starPos.get(device.id);
            if (pos) { node.x = pos.x; node.y = pos.y; }
        } else {
            node.level = levelMap.get(device.id) ?? getDeviceHierarchyLevel(device.type);
            if (Number.isFinite(device.x) && Number.isFinite(device.y)) {
                node.x = device.x;
                node.y = device.y;
                node.fixed = device.locked === true;
            }
        }

        return node;
    });

    let edges;
    if (isStarMode && starPos) {
        // In star mode: draw a spoke from every outer node to the center
        const centerId = [...starPos.entries()].find(([, pos]) => pos.x === 0 && pos.y === 0)?.[0];
        const existingPairs = new Set(visibleLinks.map(l => `${l.from}|${l.to}`));

        const realEdges = visibleLinks.map(link => {
            const baseColor = linkColor(link.status);
            return {
                id: link.id,
                from: link.from,
                to: link.to,
                color: { color: baseColor },
                width: 2,
                dashes: false,
                smooth: { type: 'curvedCW', roundness: 0.1 },
                arrows: { to: { enabled: false } },
                status: link.status,
                baseColor
            };
        });

        const spokeEdges = centerId
            ? filteredDevices
                .filter(d => d.id !== centerId &&
                    !existingPairs.has(`${d.id}|${centerId}`) &&
                    !existingPairs.has(`${centerId}|${d.id}`))
                .map(d => ({
                    id: `star-spoke-${d.id}`,
                    from: centerId,
                    to: d.id,
                    color: { color: '#90a4ae' },
                    width: 1.5,
                    dashes: false,
                    smooth: { type: 'curvedCW', roundness: 0.1 },
                    arrows: { to: { enabled: false } }
                }))
            : [];

        edges = [...realEdges, ...spokeEdges];
    } else {
        edges = visibleLinks.map(link => {
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
    }

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
    updateTopologyData({ fit: false });
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
            stabilization: { enabled: false }
        }
    });

    topologyNetwork.on('click', params => {
        if (params.nodes && params.nodes.length) {
            const nodeId = String(params.nodes[0]);
            if (topologyViewMode === 'buildings') {
                const node = topologyNodes.get(nodeId);
                if (node && node._buildingName) drillIntoBuilding(node._buildingName);
            } else {
                renderSelectedDevice(nodeId);
            }
        } else {
            renderSelectedDevice(null);
        }
    });

    initTopologyFilters();

    const buildingFilter = document.getElementById('building-filter');
    const statusFilter = document.getElementById('status-filter');
    const deviceTypeFilter = document.getElementById('device-type-filter');
    const resetButton = document.getElementById('reset-topology-btn');
    const viewModeSelect = document.getElementById('topology-view-mode');

    if (buildingFilter) buildingFilter.addEventListener('change', function () {
        if (topologyViewMode === 'floor') {
            const selected = buildingFilter.value;
            if (selected === 'all') {
                showBuildingPicker();
            } else if (selected === 'IC Building') {
                showBuildingFloorPlan(selected);
            } else {
                topologyViewMode = 'logical';
                if (viewModeSelect) viewModeSelect.value = 'logical';
                hideFloorMap();
                applyTopologyLayout('logical');
                loadTopologySnapshot({ fit: true });
            }
        } else {
            refreshTopology();
        }
    });
    if (statusFilter) statusFilter.addEventListener('change', function () {
        if (topologyViewMode === 'floor') {
            renderFloorMap();
        } else {
            refreshTopology();
        }
    });
    if (deviceTypeFilter) deviceTypeFilter.addEventListener('change', function () {
        if (topologyViewMode !== 'floor') {
            applyTopologyLayout(topologyViewMode);
            updateTopologyData({ fit: false });
        }
    });
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
            if (deviceTypeFilter) deviceTypeFilter.value = 'all';
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
    return window.MONITOR_API_BASE || window.location.origin;
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
