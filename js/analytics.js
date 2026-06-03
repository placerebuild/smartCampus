// Analytics module for reports.html — fetches historical data from /api/analytics/* and renders charts/tables.
// Loaded as a plain script (not ES module) so it can share globals with script.js and monitoring.js.
// Guards on #latencyTrendChart existence ensure this is a no-op on all other pages.

(function () {
  if (!document.getElementById('latencyTrendChart')) return;

  const API_BASE = window.MONITOR_API_BASE || `http://${window.location.hostname || 'localhost'}:4000`;

  const REFRESH_INTERVAL_MS = 30000;
  let currentPeriod = '24h';
  let latencyChart = null;
  let alertDoughnutChart = null;
  let refreshTimer = null;
  let lastPerfDevices = [];

  // ── Helpers ─────────────────────────────────────────────────────────────────

  async function apiFetch(path) {
    const res = await fetch(API_BASE + path, { credentials: 'include' });
    if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
    return res.json();
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function latencyColor(ms) {
    if (ms === null || ms === undefined) return '#6c757d';
    if (ms <= 50)  return '#18a368';
    if (ms <= 150) return '#f09a35';
    return '#de5b54';
  }

  // ── API calls ────────────────────────────────────────────────────────────────

  function fetchOverview(period)      { return apiFetch(`/api/analytics/overview?period=${period}`); }
  function fetchLatencyTrend(period)  { return apiFetch(`/api/analytics/latency-trend?period=${period}`); }
  function fetchDeviceUptime(period)  { return apiFetch(`/api/analytics/device-uptime?period=${period}`); }
  function fetchAlertsSummary(period) { return apiFetch(`/api/analytics/alerts-summary?period=${period}`); }

  // ── Render: Summary Cards ────────────────────────────────────────────────────

  function renderSummaryCards(data) {
    // Use DEVICE_LOG count if historical data exists, otherwise fall back to live DEVICE count
    const deviceCount = (data.activeDevices > 0) ? data.activeDevices : (data.currentDevices ?? 0);
    setText('stat-devices', deviceCount > 0 ? deviceCount : '--');

    // Use log-based uptime if available; fall back to live device ratio
    let uptimeDisplay = '--';
    if (data.uptimePct !== null) {
      uptimeDisplay = data.uptimePct + '%';
    } else if (data.currentDevices > 0) {
      const livePct = Number(((data.currentOnline / data.currentDevices) * 100).toFixed(1));
      uptimeDisplay = livePct + '%';
    }
    setText('stat-uptime', uptimeDisplay);

    setText('stat-latency', data.avgLatencyMs !== null ? data.avgLatencyMs + ' ms' : '--');

    const totalAlerts = (data.alertBreakdown.danger || 0)
                      + (data.alertBreakdown.warning || 0)
                      + (data.alertBreakdown.success || 0);
    setText('stat-alerts', totalAlerts);
  }

  // ── Render: Latency Trend Chart ──────────────────────────────────────────────

  function renderLatencyChart(data) {
    const canvas = document.getElementById('latencyTrendChart');
    if (!canvas) return;

    const trend = data.trend || [];

    if (trend.length === 0) {
      if (latencyChart) { latencyChart.destroy(); latencyChart = null; }
      canvas.style.display = 'none';
      const empty = document.getElementById('latency-chart-empty');
      if (empty) empty.style.removeProperty('display');
      return;
    }

    canvas.style.display = '';
    const empty = document.getElementById('latency-chart-empty');
    if (empty) empty.style.setProperty('display', 'none', 'important');

    const labels = trend.map(r => r.bucket);
    const avgData = trend.map(r => r.avgMs);
    const minData = trend.map(r => r.minMs);
    const maxData = trend.map(r => r.maxMs);

    if (latencyChart) {
      latencyChart.data.labels = labels;
      latencyChart.data.datasets[0].data = avgData;
      latencyChart.data.datasets[1].data = minData;
      latencyChart.data.datasets[2].data = maxData;
      latencyChart.update('none');
      return;
    }

    latencyChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Avg Latency (ms)',
            data: avgData,
            borderColor: '#18a368',
            backgroundColor: 'rgba(24,163,104,0.10)',
            borderWidth: 2,
            tension: 0.3,
            fill: true,
            pointRadius: trend.length > 48 ? 0 : 3,
            pointHoverRadius: 5
          },
          {
            label: 'Min (ms)',
            data: minData,
            borderColor: '#6ea8fe',
            borderWidth: 1,
            borderDash: [4, 4],
            tension: 0.3,
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 4
          },
          {
            label: 'Max (ms)',
            data: maxData,
            borderColor: '#de5b54',
            borderWidth: 1,
            borderDash: [4, 4],
            tension: 0.3,
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const v = ctx.parsed.y;
                return v !== null ? ` ${ctx.dataset.label}: ${v} ms` : ` ${ctx.dataset.label}: —`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { maxTicksLimit: 12, font: { size: 11 } },
            grid: { color: 'rgba(0,0,0,0.05)' }
          },
          y: {
            title: { display: true, text: 'Latency (ms)', font: { size: 11 } },
            suggestedMin: 0,
            ticks: { font: { size: 11 } },
            grid: { color: 'rgba(0,0,0,0.05)' }
          }
        }
      }
    });
  }

  // ── Render: Alert Doughnut ───────────────────────────────────────────────────

  function renderAlertDoughnut(data) {
    const canvas = document.getElementById('alertDoughnutChart');
    if (!canvas) return;

    const byType = data.byType || [];
    const totalAlerts = byType.reduce((s, r) => s + r.count, 0);

    if (totalAlerts === 0) {
      if (alertDoughnutChart) { alertDoughnutChart.destroy(); alertDoughnutChart = null; }
      canvas.style.display = 'none';
      const empty = document.getElementById('alert-doughnut-empty');
      if (empty) empty.style.removeProperty('display');
      return;
    }

    canvas.style.display = '';
    const empty = document.getElementById('alert-doughnut-empty');
    if (empty) empty.style.setProperty('display', 'none', 'important');

    // Aggregate counts by severity
    const counts = { danger: 0, warning: 0, success: 0 };
    for (const row of byType) {
      if (Object.prototype.hasOwnProperty.call(counts, row.severity)) {
        counts[row.severity] += row.count;
      }
    }

    if (alertDoughnutChart) {
      alertDoughnutChart.data.datasets[0].data = [counts.danger, counts.warning, counts.success];
      alertDoughnutChart.update('none');
      return;
    }

    alertDoughnutChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Critical (Downtime)', 'Warning (High Latency)', 'Recovery'],
        datasets: [{
          data: [counts.danger, counts.warning, counts.success],
          backgroundColor: ['#de5b54', '#f09a35', '#18a368'],
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${ctx.parsed}`
            }
          }
        },
        cutout: '65%'
      }
    });
  }

  // ── Render: Device Performance Table ────────────────────────────────────────

  function renderDevicePerformanceTable(data) {
    const tbody = document.querySelector('#device-perf-table tbody');
    if (!tbody) return;

    const devices = data.devices || [];
    lastPerfDevices = devices;

    if (devices.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No data available for this period.</td></tr>';
      return;
    }

    tbody.innerHTML = devices.map(d => {
      const uptime = d.uptimePct !== null ? d.uptimePct : null;
      let uptimeBadge;
      if (uptime === null) {
        uptimeBadge = '<span class="badge bg-secondary">—</span>';
      } else if (uptime >= 90) {
        uptimeBadge = `<span class="badge bg-success">${uptime}%</span>`;
      } else if (uptime >= 70) {
        uptimeBadge = `<span class="badge bg-warning text-dark">${uptime}%</span>`;
      } else {
        uptimeBadge = `<span class="badge bg-danger">${uptime}%</span>`;
      }

      const latency = d.avgLatencyMs !== null
        ? `<span style="color:${latencyColor(d.avgLatencyMs)};font-weight:600;">${d.avgLatencyMs} ms</span>`
        : '—';

      const location = [d.building, d.floor].filter(Boolean).join(' / ') || '—';

      const alertBadge = d.alertCount > 0
        ? `<span class="badge bg-danger">${d.alertCount}</span>`
        : '<span class="badge bg-secondary">0</span>';

      return `<tr>
        <td><strong>${escapeHtml(d.name)}</strong><br><small class="text-muted">${escapeHtml(d.ip)}</small></td>
        <td><span class="badge bg-light text-dark border">${escapeHtml(d.type || '—')}</span></td>
        <td>${escapeHtml(location)}</td>
        <td>${uptimeBadge}</td>
        <td>${latency}</td>
        <td>${alertBadge}</td>
      </tr>`;
    }).join('');
  }

  // ── HTML escape helper ───────────────────────────────────────────────────────

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Load all analytics panels ────────────────────────────────────────────────

  async function loadAllAnalytics(period) {
    try {
      const [overview, trend, uptime, alerts] = await Promise.allSettled([
        fetchOverview(period),
        fetchLatencyTrend(period),
        fetchDeviceUptime(period),
        fetchAlertsSummary(period)
      ]);

      if (overview.status === 'fulfilled') {
        renderSummaryCards(overview.value);
      } else {
        console.error('Overview fetch failed:', overview.reason);
      }

      if (trend.status === 'fulfilled') {
        renderLatencyChart(trend.value);
      } else {
        console.error('Latency trend fetch failed:', trend.reason);
      }

      if (alerts.status === 'fulfilled') {
        renderAlertDoughnut(alerts.value);
      } else {
        console.error('Alerts summary fetch failed:', alerts.reason);
      }

      if (uptime.status === 'fulfilled') {
        renderDevicePerformanceTable(uptime.value);
      } else {
        console.error('Device uptime fetch failed:', uptime.reason);
        const tbody = document.querySelector('#device-perf-table tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">Failed to load performance data.</td></tr>';
      }
    } catch (err) {
      console.error('loadAllAnalytics error:', err);
    }
  }

  // ── Period tab handler ───────────────────────────────────────────────────────

  function initPeriodTabs() {
    const tabs = document.querySelectorAll('#period-tabs .nav-link');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPeriod = btn.dataset.period;
        stopAutoRefresh();
        loadAllAnalytics(currentPeriod);
        startAutoRefresh();
      });
    });
  }

  // ── Auto-refresh ─────────────────────────────────────────────────────────────

  function startAutoRefresh() {
    if (refreshTimer) return;
    refreshTimer = setInterval(() => loadAllAnalytics(currentPeriod), REFRESH_INTERVAL_MS);
  }

  function stopAutoRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAutoRefresh();
    } else {
      loadAllAnalytics(currentPeriod);
      startAutoRefresh();
    }
  });

  // ── CSV Export ───────────────────────────────────────────────────────────────

  function exportPerfCSV() {
    if (!lastPerfDevices.length) return;
    const headers = ['Device Name', 'IP Address', 'Type', 'Building', 'Floor', 'Uptime %', 'Avg Latency (ms)', 'Alert Count', 'Period'];
    const csvRows = lastPerfDevices.map(d => [
      d.name || '',
      d.ip || '',
      d.type || '',
      d.building || '',
      d.floor || '',
      d.uptimePct !== null ? d.uptimePct : '',
      d.avgLatencyMs !== null ? d.avgLatencyMs : '',
      d.alertCount || 0,
      currentPeriod
    ]);
    const csv = [headers, ...csvRows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `device_performance_${currentPeriod}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  function initAnalytics() {
    initPeriodTabs();
    loadAllAnalytics(currentPeriod);
    startAutoRefresh();
    const exportBtn = document.getElementById('export-perf-csv-btn');
    if (exportBtn) exportBtn.addEventListener('click', exportPerfCSV);
  }

  // Run after all resources and deferred module scripts (including auth.js) have loaded
  if (document.readyState === 'complete') {
    initAnalytics();
  } else {
    window.addEventListener('load', initAnalytics);
  }
})();
