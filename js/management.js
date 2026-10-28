(() => {
  'use strict';

  const DEFAULT_LIMIT = 10;

  let _allDevices  = [];   // full list from API, newest-first
  let _filtered    = [];   // after search/type/area filters
  let _showAll     = false;
  let _editDevice  = null;

  const $   = id => document.getElementById(id);
  const API = (window.MONITOR_API_BASE || '') + '/api/devices';

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtLocation(d) {
    const parts = [d.building, d.floor, d.room].filter(Boolean);
    return parts.length ? parts.join(' / ') : 'N/A';
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  function updateStats() {
    const assigned   = _allDevices.filter(d => d.building || d.floor || d.room).length;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('mg-total',      _allDevices.length);
    set('mg-assigned',   assigned);
    set('mg-unassigned', _allDevices.length - assigned);
  }

  // ── Dropdown population ───────────────────────────────────────────────────────

  function populateDropdowns() {
    const types = [...new Set(_allDevices.map(d => d.type).filter(Boolean))].sort();
    const typeEl = $('mgmt-type-filter');
    const savedType = typeEl.value;
    typeEl.innerHTML = '<option value="">All Types</option>' +
      types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    if (savedType && types.includes(savedType)) typeEl.value = savedType;

    // Build topology areas: unique "building / floor / room" labels
    const areaMap = new Map();
    _allDevices.forEach(d => {
      const key = fmtLocation(d);
      if (key !== 'N/A' && !areaMap.has(key)) areaMap.set(key, key);
    });
    const areas = [...areaMap.keys()].sort();
    const areaEl = $('mgmt-area-filter');
    const savedArea = areaEl.value;
    areaEl.innerHTML = '<option value="">All Areas</option>' +
      areas.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
    if (savedArea && areas.includes(savedArea)) areaEl.value = savedArea;
  }

  // ── Filtering ─────────────────────────────────────────────────────────────────

  function applyFilters() {
    const q    = ($('mgmt-search').value || '').trim().toLowerCase();
    const type = $('mgmt-type-filter').value;
    const area = $('mgmt-area-filter').value;

    _filtered = _allDevices.filter(d => {
      if (type && d.type !== type) return false;
      if (area && fmtLocation(d) !== area) return false;
      if (q) {
        const name = (d.name || '').toLowerCase();
        const ip   = (d.ip   || '').toLowerCase();
        if (!name.includes(q) && !ip.includes(q)) return false;
      }
      return true;
    });

    // Reset see-all when filters change
    _showAll = false;
    renderTable();
  }

  // ── Table rendering ───────────────────────────────────────────────────────────

  function renderTable() {
    const displayed  = _showAll ? _filtered : _filtered.slice(0, DEFAULT_LIMIT);
    const total      = _filtered.length;
    const showing    = displayed.length;
    const toggleBtn  = $('mgmt-toggle-btn');
    const countLabel = $('mgmt-count-label');

    // Count label
    countLabel.textContent = total === 0
      ? 'No devices match the current filters.'
      : `Showing ${showing} of ${total} device${total !== 1 ? 's' : ''}`;

    // Toggle button
    if (total > DEFAULT_LIMIT) {
      toggleBtn.style.display = '';
      const textEl = document.getElementById('mgmt-toggle-text');
      const iconEl = document.getElementById('mgmt-toggle-icon');
      if (textEl) textEl.textContent = _showAll ? `Show latest ${DEFAULT_LIMIT}` : `See all ${total} devices`;
      if (iconEl) {
        iconEl.className   = _showAll ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
        iconEl.style.fontSize = '0.65rem';
      }
    } else {
      toggleBtn.style.display = 'none';
    }

    const tbody = document.querySelector('#mgmt-table tbody');

    if (!displayed.length) {
      const msg = _allDevices.length === 0
        ? 'No devices found.'
        : 'No devices match the current filters.';
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">${msg}</td></tr>`;
      return;
    }

    tbody.innerHTML = displayed.map(d => {
      const loc      = fmtLocation(d);
      const ipBadge  = `<span class="badge bg-light text-primary border" style="font-family:monospace;font-size:0.78rem;">${esc(d.ip || '—')}</span>`;
      const macBadge = d.mac && d.mac !== 'N/A'
        ? `<span class="badge bg-light text-secondary border" style="font-family:monospace;font-size:0.78rem;">${esc(d.mac)}</span>`
        : '<span class="text-muted">N/A</span>';
      return `<tr>
        <td><strong>${esc(d.name || d.ip)}</strong></td>
        <td>${esc(d.type || 'Endpoint')}</td>
        <td>${ipBadge}</td>
        <td>${macBadge}</td>
        <td>${esc(loc)}</td>
        <td><button class="btn btn-sm btn-outline-primary" onclick="mgmt.openDetail(${d.id})">View</button></td>
      </tr>`;
    }).join('');
  }

  function toggleSeeAll() {
    _showAll = !_showAll;
    renderTable();
  }

  // ── Load ──────────────────────────────────────────────────────────────────────

  async function load() {
    $('mgmt-error').classList.add('d-none');
    try {
      const res = await fetch(API, { credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      _allDevices = await res.json(); // already newest-first from server
      updateStats();
      populateDropdowns();
      applyFilters();
    } catch (err) {
      $('mgmt-error').textContent = 'Failed to load devices: ' + err.message;
      $('mgmt-error').classList.remove('d-none');
      document.querySelector('#mgmt-table tbody').innerHTML =
        '<tr><td colspan="6" class="text-center text-danger py-4">Could not load devices.</td></tr>';
    }
  }

  // ── Detail modal ──────────────────────────────────────────────────────────────

  function openDetail(id) {
    const d = _allDevices.find(x => x.id === id);
    if (!d) return;
    _editDevice = d;

    $('mgmt-modal-device-name').textContent = d.name || d.ip || '—';
    $('mgmt-modal-device-meta').textContent = `${d.type || 'Endpoint'} · ${d.ip || '—'}`;

    $('vw-name').textContent     = d.name     || '—';
    $('vw-type').textContent     = d.type     || '—';
    $('vw-ip').textContent       = d.ip       || '—';
    $('vw-mac').textContent      = (d.mac && d.mac !== 'N/A') ? d.mac : 'N/A';
    $('vw-location').textContent = fmtLocation(d);
    $('vw-building').textContent = d.building || 'N/A';
    $('vw-floor').textContent    = d.floor    || 'N/A';
    $('vw-room').textContent     = d.room     || 'N/A';
    $('vw-lastseen').textContent = d.lastSeen ? new Date(d.lastSeen).toLocaleString() : 'N/A';

    showViewMode();
    $('mgmt-modal-error').classList.add('d-none');
    bootstrap.Modal.getOrCreateInstance($('mgmtEditModal')).show();
  }

  function showViewMode() {
    $('mgmt-view-mode').style.display = '';
    $('mgmt-edit-mode').style.display = 'none';
  }

  function startEdit() {
    if (!_editDevice) return;
    $('edit-name').value     = _editDevice.name     || '';
    $('edit-type').value     = _editDevice.type     || '';
    $('edit-building').value = _editDevice.building || '';
    $('edit-floor').value    = _editDevice.floor    || '';
    $('edit-room').value     = _editDevice.room     || '';
    $('mgmt-modal-error').classList.add('d-none');
    $('mgmt-view-mode').style.display = 'none';
    $('mgmt-edit-mode').style.display = '';
    setTimeout(() => $('edit-name').focus(), 50);
  }

  function cancelEdit() {
    $('mgmt-modal-error').classList.add('d-none');
    showViewMode();
  }

  async function save() {
    const name     = $('edit-name').value.trim();
    const type     = $('edit-type').value.trim();
    const building = $('edit-building').value.trim();
    const floor    = $('edit-floor').value.trim();
    const room     = $('edit-room').value.trim();
    const errEl    = $('mgmt-modal-error');

    if (!name || !type) {
      errEl.textContent = 'Device name and type are required.';
      errEl.classList.remove('d-none');
      (!name ? $('edit-name') : $('edit-type')).focus();
      return;
    }
    errEl.classList.add('d-none');

    const btn = $('mgmt-save-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving…';

    try {
      const res = await fetch(`${API}/${_editDevice.id}/location`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, building, floor, room }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);

      bootstrap.Modal.getOrCreateInstance($('mgmtEditModal')).hide();

      const successEl = $('mgmt-success');
      successEl.textContent = `${name} updated successfully.`;
      successEl.classList.remove('d-none');
      setTimeout(() => successEl.classList.add('d-none'), 3000);

      await load();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('d-none');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-save me-1"></i>Save Changes';
    }
  }

  function resetFilters() {
    $('mgmt-search').value = '';
    $('mgmt-type-filter').value = '';
    $('mgmt-area-filter').value = '';
    _showAll = false;
    applyFilters();
  }

  // ── Tab switching ─────────────────────────────────────────────────────────────

  let _activeTab = 'devices';

  function switchTab(tab) {
    _activeTab = tab;
    const fpPanel  = document.getElementById('mgmt-floorplans-panel');
    const filterCard = document.querySelector('.mgmt-filter-card');
    const countRow   = document.querySelector('.mgmt-count-row');
    const tableCard  = document.querySelector('.panel-card');
    const devBtn  = $('tab-devices-btn');
    const fpBtn   = $('tab-floorplans-btn');

    if (tab === 'devices') {
      if (filterCard) filterCard.style.display = '';
      if (countRow)   countRow.style.display   = '';
      if (tableCard)  tableCard.style.display  = '';
      if (fpPanel)    fpPanel.style.display    = 'none';
      if (devBtn) { devBtn.classList.add('active'); }
      if (fpBtn)  { fpBtn.classList.remove('active'); }
    } else {
      if (filterCard) filterCard.style.display = 'none';
      if (countRow)   countRow.style.display   = 'none';
      if (tableCard)  tableCard.style.display  = 'none';
      if (fpPanel)    fpPanel.style.display    = '';
      if (devBtn) { devBtn.classList.remove('active'); }
      if (fpBtn)  { fpBtn.classList.add('active'); }
      loadFloorPlanGrid();
    }
  }

  // ── Floor plan grid ───────────────────────────────────────────────────────────

  let _fpData = {};

  async function loadFloorPlanGrid() {
    const grid = $('fp-building-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="col-12 text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading…</div>';
    try {
      const res = await fetch((window.MONITOR_API_BASE || '') + '/api/floor-plans', { credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      _fpData = await res.json();

      // Collect all buildings: from devices + floor plans
      const fromDevices = [...new Set(_allDevices.map(d => d.building).filter(Boolean))];
      const fromPlans   = Object.keys(_fpData);
      const buildings   = [...new Set(['IC Building', ...fromDevices, ...fromPlans])].sort();

      grid.innerHTML = buildings.map(b => {
        const plans     = _fpData[b] || {};
        const floorNums = Object.keys(plans).map(Number).sort((a, b) => a - b);
        const hasAny    = floorNums.length > 0;
        const badge     = hasAny
          ? `<span class="badge bg-success-subtle text-success border border-success-subtle" style="font-size:0.7rem;">${floorNums.length} floor${floorNums.length !== 1 ? 's' : ''} assigned</span>`
          : `<span class="badge bg-light text-muted border" style="font-size:0.7rem;">No floor plans</span>`;
        const isBuiltIn = (b === 'IC Building');
        // Thumbnails: one per assigned floor
        const thumbs = hasAny
          ? `<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;">${floorNums.map(n => {
              const ordSuffix = ['th','st','nd','rd'];
              const v = n % 100;
              const ord = `${n}${ordSuffix[(v-20)%10]||ordSuffix[v]||ordSuffix[0]} Floor`;
              return `<div style="flex-shrink:0;text-align:center;width:80px;">
                <img src="${esc(plans[n])}" alt="${esc(ord)}" style="width:80px;height:60px;object-fit:contain;border-radius:6px;background:#f4f8fd;border:1px solid #e0eaf5;display:block;">
                <div style="font-size:0.68rem;color:#5e7692;margin-top:2px;">${esc(ord)}</div>
              </div>`;
            }).join('')}</div>`
          : `<div style="height:60px;border-radius:6px;background:#f4f8fd;border:1px dashed #c8d9ee;display:flex;align-items:center;justify-content:center;color:#9ab0c6;font-size:0.72rem;">No floor plans yet</div>`;
        const delBtns = isBuiltIn ? '' : floorNums.map(n =>
          `<button class="btn btn-xs btn-outline-danger" style="font-size:0.7rem;padding:1px 7px;" onclick="mgmt.deleteFloorPlan('${esc(b)}',${n})">Remove F${n}</button>`
        ).join(' ');
        return `<div class="col-12 col-sm-6 col-lg-4">
          <div class="card p-3 h-100" style="border-radius:14px;">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <strong style="font-size:0.9rem;">${esc(b)}</strong>${badge}
            </div>
            <div class="mb-2">${thumbs}</div>
            <div class="d-flex gap-1 flex-wrap">
              <button class="btn btn-sm btn-outline-primary" style="font-size:0.75rem;" onclick="mgmt.openUpload('${esc(b)}')">
                <i class="fas fa-upload me-1"></i>Upload
              </button>
              ${delBtns}
            </div>
          </div>
        </div>`;
      }).join('');
    } catch (err) {
      grid.innerHTML = `<div class="col-12"><div class="alert alert-danger">${esc(err.message)}</div></div>`;
    }
  }

  // ── Floor plan upload ─────────────────────────────────────────────────────────

  function openUpload(preselect) {
    // Populate building dropdown
    const sel = $('fp-building');
    const fromDevices = [...new Set(_allDevices.map(d => d.building).filter(Boolean))];
    const fromPlans   = Object.keys(_fpData || {});
    const buildings   = [...new Set(['IC Building', ...fromDevices, ...fromPlans])].sort();
    sel.innerHTML = '<option value="">— Select building —</option>' +
      buildings.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('') +
      '<option value="__new__">＋ Add new building…</option>';
    if (preselect) sel.value = preselect;

    // Reset fields
    const fpFloor = $('fp-floor');
    if (fpFloor) fpFloor.value = '1';
    $('fp-file').value  = '';
    $('fp-new-building').value = '';
    $('fp-new-building-wrap').style.display = 'none';
    $('fp-preview-wrap').style.display = 'none';
    $('fp-upload-error').classList.add('d-none');
    bootstrap.Modal.getOrCreateInstance($('fpUploadModal')).show();
  }

  function onBuildingSelectChange() {
    const sel  = $('fp-building');
    const wrap = $('fp-new-building-wrap');
    if (!sel || !wrap) return;
    if (sel.value === '__new__') {
      wrap.style.display = '';
      $('fp-new-building').focus();
    } else {
      wrap.style.display = 'none';
    }
  }

  // File preview
  document.addEventListener('DOMContentLoaded', () => {
    const fileInput = $('fp-file');
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) { $('fp-preview-wrap').style.display = 'none'; return; }
        const reader = new FileReader();
        reader.onload = e => {
          $('fp-preview').src = e.target.result;
          $('fp-preview-wrap').style.display = '';
        };
        reader.readAsDataURL(file);
      });
    }
  });

  async function saveFloorPlan() {
    const selVal   = $('fp-building').value;
    const building = selVal === '__new__'
      ? ($('fp-new-building').value || '').trim()
      : selVal;
    const floor    = parseInt($('fp-floor').value, 10);
    const file     = $('fp-file').files[0];
    const errEl    = $('fp-upload-error');
    errEl.classList.add('d-none');

    if (!selVal) { errEl.textContent = 'Please select a building.'; errEl.classList.remove('d-none'); return; }
    if (selVal === '__new__' && !building) { errEl.textContent = 'Please enter the new building name.'; errEl.classList.remove('d-none'); $('fp-new-building').focus(); return; }
    if (selVal === '__new__' && building.length < 2) { errEl.textContent = 'Building name must be at least 2 characters.'; errEl.classList.remove('d-none'); $('fp-new-building').focus(); return; }
    if (!floor || floor < 1 || floor > 99) { errEl.textContent = 'Enter a valid floor number (1–99).'; errEl.classList.remove('d-none'); return; }
    if (!file)     { errEl.textContent = 'Please choose a floor plan image.'; errEl.classList.remove('d-none'); return; }
    if (file.size > 10 * 1024 * 1024) { errEl.textContent = 'File is too large (max 10 MB).'; errEl.classList.remove('d-none'); return; }

    const allowed = ['image/jpeg','image/png','image/svg+xml','image/webp'];
    if (!allowed.includes(file.type)) {
      errEl.textContent = 'Unsupported file type. Use JPG, PNG, SVG, or WebP.';
      errEl.classList.remove('d-none');
      return;
    }

    const btn = $('fp-save-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Uploading…';

    try {
      const imageData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = e => resolve(e.target.result.split(',')[1]); // base64 only
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const imageExt = file.name.split('.').pop();
      const res = await fetch((window.MONITOR_API_BASE || '') + '/api/floor-plans', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ building, floor, imageData, imageExt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);

      bootstrap.Modal.getOrCreateInstance($('fpUploadModal')).hide();
      const s = $('mgmt-success');
      s.textContent = `Floor plan for ${building} (Floor ${floor}) uploaded successfully.`;
      s.classList.remove('d-none');
      setTimeout(() => s.classList.add('d-none'), 4000);
      loadFloorPlanGrid();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('d-none');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-upload me-1"></i>Upload';
    }
  }

  async function deleteFloorPlan(building, floor) {
    if (!confirm(`Remove floor ${floor} plan for ${building}?`)) return;
    try {
      const res = await fetch(
        `${(window.MONITOR_API_BASE || '')}/api/floor-plans/${encodeURIComponent(building)}/${floor}`,
        { method: 'DELETE', credentials: 'include' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      loadFloorPlanGrid();
    } catch (err) {
      $('mgmt-error').textContent = err.message;
      $('mgmt-error').classList.remove('d-none');
    }
  }

  window.mgmt = { applyFilters, toggleSeeAll, resetFilters, switchTab,
    openDetail, startEdit, cancelEdit, save,
    openUpload, onBuildingSelectChange, saveFloorPlan, deleteFloorPlan };

  document.addEventListener('DOMContentLoaded', load);
})();
