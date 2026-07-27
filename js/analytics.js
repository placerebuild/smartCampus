// Analytics module for reports.html — fetches historical data from /api/analytics/* and renders charts/tables.
// Loaded as a plain script (not ES module) so it can share globals with script.js and monitoring.js.
// Guards on #latencyTrendChart existence ensure this is a no-op on all other pages.

(function () {
  if (!document.getElementById('latencyTrendChart')) return;

  const API_BASE = window.MONITOR_API_BASE || window.location.origin;

  const REFRESH_INTERVAL_MS = 30000;
  let currentPeriod = '24h';
  let latencyChart = null;
  let alertDoughnutChart = null;
  let uptimeBarChart = null;
  let incidentTrendChart = null;
  let peakHoursChart     = null;
  let topDevicesChart    = null;
  let locationChart      = null;
  let refreshTimer = null;
  let lastPerfDevices = [];

  // ── Helpers ─────────────────────────────────────────────────────────────────

  async function apiFetch(path) {
    const res = await fetch(API_BASE + path, { credentials: 'include' });
    if (!res.ok) {
      let msg = `API ${path} returned ${res.status}`;
      try { const body = await res.json(); if (body?.error) msg = body.error; } catch (_) {}
      throw new Error(msg);
    }
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
  function fetchAiInsights(period)         { return apiFetch(`/api/analytics/ai-insights?period=${period}`); }
  function fetchIncidentTrend(period)      { return apiFetch(`/api/analytics/incident-trend?period=${period}`); }
  function fetchPeakHours(period)          { return apiFetch(`/api/analytics/peak-hours?period=${period}`); }
  function fetchTopProblemDevices(period)  { return apiFetch(`/api/analytics/top-problem-devices?period=${period}`); }
  function fetchLocationHealth(period)     { return apiFetch(`/api/analytics/location-health?period=${period}`); }

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

  // ── Render: Trend KPI Cards ──────────────────────────────────────────────────

  function renderTrendKpis(incidentData, topDevicesData, peakHoursData) {
    // Mean Time to Resolution
    const mttr = incidentData && incidentData.mttr;
    if (mttr && mttr.avgMin !== null) {
      const fmt = mttr.avgMin < 60
        ? Math.round(mttr.avgMin) + ' min'
        : Math.floor(mttr.avgMin / 60) + 'h ' + Math.round(mttr.avgMin % 60) + 'm';
      setText('trend-mttr', fmt);
    } else {
      setText('trend-mttr', '--');
    }

    // Resolution rate
    if (mttr && mttr.totalCount > 0) {
      setText('trend-resolution-rate', Math.round((mttr.resolvedCount / mttr.totalCount) * 100) + '%');
    } else {
      setText('trend-resolution-rate', '--');
    }

    // Most problematic device
    const worst = topDevicesData && topDevicesData.devices && topDevicesData.devices[0];
    setText('trend-worst-device', worst ? worst.name : '--');
    setText('trend-worst-device-count', worst ? worst.alertCount + ' alerts in period' : 'Highest alert count');

    // Peak failure hour
    const hours = peakHoursData && peakHoursData.hours;
    if (hours) {
      const peak = hours.reduce((m, h) => h.total > (m ? m.total : -1) ? h : m, null);
      if (peak && peak.total > 0) {
        const h = peak.hour;
        setText('trend-peak-hour', h === 0 ? '12 AM' : h < 12 ? h + ' AM' : h === 12 ? '12 PM' : (h - 12) + ' PM');
      } else {
        setText('trend-peak-hour', '--');
      }
    }
  }

  // ── Render: Incident Frequency Chart ─────────────────────────────────────────

  function renderIncidentTrend(data) {
    const canvas = document.getElementById('incidentTrendChart');
    if (!canvas) return;
    const buckets = data.buckets || [];
    const hasData = buckets.some(b => b.total > 0);

    if (!hasData) {
      if (incidentTrendChart) { incidentTrendChart.destroy(); incidentTrendChart = null; }
      canvas.style.display = 'none';
      const empty = document.getElementById('incident-trend-empty');
      if (empty) empty.style.removeProperty('display');
      return;
    }
    canvas.style.display = '';
    const empty = document.getElementById('incident-trend-empty');
    if (empty) empty.style.setProperty('display', 'none', 'important');

    const labels   = buckets.map(b => b.bucket);
    const downtime = buckets.map(b => b.downtime);
    const abnormal = buckets.map(b => b.abnormal);
    const recovery = buckets.map(b => b.recovery);

    if (incidentTrendChart) {
      incidentTrendChart.data.labels = labels;
      incidentTrendChart.data.datasets[0].data = downtime;
      incidentTrendChart.data.datasets[1].data = abnormal;
      incidentTrendChart.data.datasets[2].data = recovery;
      incidentTrendChart.update('none');
      return;
    }

    incidentTrendChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Downtime',     data: downtime, backgroundColor: 'rgba(222,91,84,0.85)',  borderRadius: 3 },
          { label: 'High Latency', data: abnormal, backgroundColor: 'rgba(240,154,53,0.80)', borderRadius: 3 },
          { label: 'Recovery',     data: recovery, backgroundColor: 'rgba(24,163,104,0.70)', borderRadius: 3 }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: 'index' },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } }
        },
        scales: {
          x: { stacked: true, ticks: { font: { size: 11 }, maxTicksLimit: 14 }, grid: { color: 'rgba(0,0,0,0.04)' } },
          y: { stacked: true, beginAtZero: true, ticks: { font: { size: 11 }, precision: 0 }, grid: { color: 'rgba(0,0,0,0.04)' } }
        }
      }
    });
  }

  // ── Render: Peak Failure Hours Chart ─────────────────────────────────────────

  function renderPeakHours(data) {
    const canvas = document.getElementById('peakHoursChart');
    if (!canvas) return;
    const hours  = data.hours || [];
    const hasData = hours.some(h => h.total > 0);

    if (!hasData) {
      if (peakHoursChart) { peakHoursChart.destroy(); peakHoursChart = null; }
      canvas.style.display = 'none';
      const empty = document.getElementById('peak-hours-empty');
      if (empty) empty.style.removeProperty('display');
      return;
    }
    canvas.style.display = '';
    const empty = document.getElementById('peak-hours-empty');
    if (empty) empty.style.setProperty('display', 'none', 'important');

    const labels = hours.map(h => h.hour === 0 ? '12a' : h.hour < 12 ? h.hour + 'a' : h.hour === 12 ? '12p' : (h.hour - 12) + 'p');
    const totals = hours.map(h => h.total);
    const maxVal = Math.max(...totals, 1);
    const bgColors = totals.map(v => {
      if (v === 0)             return 'rgba(200,212,226,0.35)';
      const r = v / maxVal;
      if (r < 0.34)            return 'rgba(240,154,53,0.65)';
      if (r < 0.67)            return 'rgba(222,91,84,0.80)';
      return '#de5b54';
    });

    if (peakHoursChart) {
      peakHoursChart.data.labels = labels;
      peakHoursChart.data.datasets[0].data = totals;
      peakHoursChart.data.datasets[0].backgroundColor = bgColors;
      peakHoursChart.update('none');
      return;
    }

    peakHoursChart = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Incidents', data: totals, backgroundColor: bgColors, borderRadius: 4 }] },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: ctx => {
                const h = hours[ctx[0].dataIndex].hour;
                return h === 0 ? '12:00 AM' : h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h - 12}:00 PM`;
              },
              label: ctx => ` ${ctx.parsed.y} incident${ctx.parsed.y !== 1 ? 's' : ''}`
            }
          }
        },
        scales: {
          x: { ticks: { font: { size: 10 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { font: { size: 11 }, precision: 0 }, grid: { color: 'rgba(0,0,0,0.04)' } }
        }
      }
    });
  }

  // ── Render: Top Problem Devices Chart ────────────────────────────────────────

  function renderTopProblemDevices(data) {
    const canvas = document.getElementById('topDevicesChart');
    if (!canvas) return;
    const devices = (data.devices || []).filter(d => d.alertCount > 0).slice(0, 8);

    if (devices.length === 0) {
      if (topDevicesChart) { topDevicesChart.destroy(); topDevicesChart = null; }
      canvas.style.display = 'none';
      const empty = document.getElementById('top-devices-empty');
      if (empty) empty.style.removeProperty('display');
      return;
    }
    canvas.style.display = '';
    const empty = document.getElementById('top-devices-empty');
    if (empty) empty.style.setProperty('display', 'none', 'important');

    const labels      = devices.map(d => d.name);
    const alertCounts = devices.map(d => d.alertCount);
    const bgColors    = devices.map(d => {
      const ratio = d.alertCount > 0 ? d.downtimeCount / d.alertCount : 0;
      if (ratio >= 0.6) return 'rgba(222,91,84,0.85)';
      if (ratio >= 0.3) return 'rgba(240,154,53,0.80)';
      return 'rgba(31,122,224,0.75)';
    });

    const barThickness = Math.max(18, Math.min(32, Math.floor(280 / devices.length)));
    canvas.height = devices.length * (barThickness + 14) + 52;

    if (topDevicesChart) {
      topDevicesChart.data.labels = labels;
      topDevicesChart.data.datasets[0].data = alertCounts;
      topDevicesChart.data.datasets[0].backgroundColor = bgColors;
      topDevicesChart.update('none');
      return;
    }

    topDevicesChart = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Total Alerts', data: alertCounts, backgroundColor: bgColors, borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: false, barThickness }] },
      options: {
        indexAxis: 'y',
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: ctx => devices[ctx[0].dataIndex].name,
              label: ctx => ` Total alerts: ${ctx.parsed.x}`,
              afterBody: ctx => {
                const d = devices[ctx[0].dataIndex];
                const lines = [` Downtime incidents: ${d.downtimeCount}`];
                if (d.avgResolutionMin !== null) {
                  const t = d.avgResolutionMin;
                  lines.push(` Avg resolution: ${t < 60 ? Math.round(t) + ' min' : Math.floor(t / 60) + 'h ' + Math.round(t % 60) + 'm'}`);
                }
                if (d.building) lines.push(` Location: ${d.building}${d.floor ? ' / ' + d.floor : ''}`);
                return lines;
              }
            }
          }
        },
        scales: {
          x: { beginAtZero: true, ticks: { font: { size: 11 }, precision: 0 }, grid: { color: 'rgba(0,0,0,0.05)' } },
          y: { ticks: { font: { size: 11 } }, grid: { display: false } }
        }
      }
    });
  }

  // ── Render: Location Health Chart ────────────────────────────────────────────

  function renderLocationHealth(data) {
    const canvas = document.getElementById('locationHealthChart');
    if (!canvas) return;
    const locs = (data.locations || []).filter(l => l.uptimePct !== null);

    if (locs.length === 0) {
      if (locationChart) { locationChart.destroy(); locationChart = null; }
      canvas.style.display = 'none';
      const empty = document.getElementById('location-health-empty');
      if (empty) empty.style.removeProperty('display');
      return;
    }
    canvas.style.display = '';
    const empty = document.getElementById('location-health-empty');
    if (empty) empty.style.setProperty('display', 'none', 'important');

    const labels       = locs.map(l => l.building);
    const uptimes      = locs.map(l => l.uptimePct);
    const downtimes    = locs.map(l => Number((100 - l.uptimePct).toFixed(1)));
    const uptimeColors = uptimes.map(v => v >= 90 ? '#18a368' : v >= 70 ? '#f09a35' : '#de5b54');

    const barThickness = Math.max(22, Math.min(36, Math.floor(300 / locs.length)));
    canvas.height = locs.length * (barThickness + 14) + 56;

    if (locationChart) {
      locationChart.data.labels = labels;
      locationChart.data.datasets[0].data = uptimes;
      locationChart.data.datasets[0].backgroundColor = uptimeColors;
      locationChart.data.datasets[1].data = downtimes;
      locationChart.update('none');
      return;
    }

    locationChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Uptime', data: uptimes, backgroundColor: uptimeColors, borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: false, barThickness },
          { label: 'Downtime', data: downtimes, backgroundColor: 'rgba(222,91,84,0.22)', borderWidth: 0, borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: false, barThickness }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: {
              boxWidth: 12, font: { size: 11 },
              generateLabels: () => [
                { text: 'Uptime',   fillStyle: '#18a368',              strokeStyle: 'transparent', lineWidth: 0 },
                { text: 'Downtime', fillStyle: 'rgba(222,91,84,0.35)', strokeStyle: 'transparent', lineWidth: 0 }
              ]
            }
          },
          tooltip: {
            callbacks: {
              title: ctx => locs[ctx[0].dataIndex].building,
              label: ctx => {
                const l = locs[ctx[0].dataIndex];
                return ctx.datasetIndex === 0 ? ` Uptime: ${l.uptimePct}%` : ` Downtime: ${(100 - l.uptimePct).toFixed(1)}%`;
              },
              afterBody: ctx => {
                const l = locs[ctx[0].dataIndex];
                const lines = [` Devices: ${l.deviceCount}`];
                if (l.alertCount > 0) lines.push(` Downtime alerts: ${l.alertCount}`);
                return lines;
              }
            }
          }
        },
        scales: {
          x: { stacked: true, min: 0, max: 100, ticks: { font: { size: 11 }, callback: v => v + '%', maxTicksLimit: 6 }, grid: { color: 'rgba(0,0,0,0.05)' } },
          y: { stacked: true, ticks: { font: { size: 11 } }, grid: { display: false } }
        }
      }
    });
  }

  // ── Load Trend Analytics ──────────────────────────────────────────────────────

  async function loadTrendAnalytics(period) {
    const [incidentRes, peakRes, topDevRes, locRes] = await Promise.allSettled([
      fetchIncidentTrend(period),
      fetchPeakHours(period),
      fetchTopProblemDevices(period),
      fetchLocationHealth(period)
    ]);

    // Always fall back to empty shapes so render functions always run and
    // show the "no data" empty-state instead of a blank white panel on API errors.
    const incidentData = incidentRes.status  === 'fulfilled' ? incidentRes.value  : { buckets: [], mttr: { avgMin: null, resolvedCount: 0, totalCount: 0 } };
    const peakData     = peakRes.status      === 'fulfilled' ? peakRes.value      : { hours: [] };
    const topDevData   = topDevRes.status    === 'fulfilled' ? topDevRes.value    : { devices: [] };
    const locData      = locRes.status       === 'fulfilled' ? locRes.value       : { locations: [] };

    if (incidentRes.status  !== 'fulfilled') console.error('incident-trend failed:', incidentRes.reason);
    if (peakRes.status      !== 'fulfilled') console.error('peak-hours failed:',     peakRes.reason);
    if (topDevRes.status    !== 'fulfilled') console.error('top-problem-devices failed:', topDevRes.reason);
    if (locRes.status       !== 'fulfilled') console.error('location-health failed:', locRes.reason);

    renderTrendKpis(incidentData, topDevData, peakData);
    renderIncidentTrend(incidentData);
    renderPeakHours(peakData);
    renderTopProblemDevices(topDevData);
    renderLocationHealth(locData);
  }

  // ── Render: AI Insights ──────────────────────────────────────────────────────

  function setAiInsightsState(state, payload) {
    const loading   = document.getElementById('ai-insights-loading');
    const empty     = document.getElementById('ai-insights-empty');
    const error     = document.getElementById('ai-insights-error');
    const content   = document.getElementById('ai-insights-content');
    const refreshBtn = document.getElementById('refresh-ai-insights-btn');

    [loading, empty, error, content].forEach(el => { if (el) el.style.display = 'none'; });

    if (state === 'loading') {
      if (loading) loading.style.display = '';
      if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin me-1"></i>Analyzing…'; }
    } else if (state === 'empty') {
      if (empty) empty.style.display = '';
      if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Generate Insights'; }
    } else if (state === 'error') {
      if (error) {
        error.style.display = '';
        const msg = document.getElementById('ai-insights-error-msg');
        if (msg) msg.textContent = payload || 'Unable to load AI insights.';
      }
      if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Retry'; }
    } else if (state === 'done') {
      if (content) content.style.display = '';
      const textEl = document.getElementById('ai-insights-text');
      if (textEl) textEl.innerHTML = formatInsightsHtml(payload.insights || '');
      const tsEl = document.getElementById('ai-insights-timestamp');
      if (tsEl && payload.generatedAt) {
        tsEl.textContent = 'Generated ' + new Date(payload.generatedAt).toLocaleString();
      }
      if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Refresh Insights'; }
    }
  }

  function formatInsightsHtml(text) {
    // Convert markdown bold (**text**) and bullet points to HTML
    return escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^• (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul class="mb-2 ps-3">${m}</ul>`)
      .replace(/\n{2,}/g, '</p><p class="mb-2">')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p class="mb-2">')
      .replace(/$/, '</p>');
  }

  async function loadAiInsights(period) {
    setAiInsightsState('loading');
    try {
      const data = await fetchAiInsights(period);
      setAiInsightsState('done', data);
    } catch (err) {
      setAiInsightsState('error', err.message || 'Failed to generate insights. Try again later.');
    }
  }

  // ── Render: Uptime / Downtime Bar Chart ─────────────────────────────────────

  function renderUptimeBarChart(data) {
    const canvas = document.getElementById('uptimeBarChart');
    if (!canvas) return;

    // Use up to 15 devices, already sorted worst-uptime first by the API
    const devices = (data.devices || []).filter(d => d.uptimePct !== null).slice(0, 15);

    if (devices.length === 0) {
      if (uptimeBarChart) { uptimeBarChart.destroy(); uptimeBarChart = null; }
      canvas.style.display = 'none';
      const empty = document.getElementById('uptime-bar-empty');
      if (empty) empty.style.removeProperty('display');
      return;
    }

    canvas.style.display = '';
    const empty = document.getElementById('uptime-bar-empty');
    if (empty) empty.style.setProperty('display', 'none', 'important');

    // Reverse so worst device is at the bottom (natural reading order for bar charts)
    const sorted = [...devices].reverse();
    const labels  = sorted.map(d => d.name || d.ip);
    const uptimes  = sorted.map(d => d.uptimePct);
    const downtimes = sorted.map(d => Number((100 - d.uptimePct).toFixed(1)));

    // Derive per-bar uptime colors: green ≥90, orange ≥70, red <70
    const uptimeColors  = uptimes.map(v => v >= 90 ? '#18a368' : v >= 70 ? '#f09a35' : '#de5b54');
    const downtimeColors = downtimes.map(() => 'rgba(222,91,84,0.25)');

    const barThickness = Math.max(16, Math.min(32, Math.floor(320 / sorted.length)));
    canvas.height = sorted.length * (barThickness + 12) + 60;

    if (uptimeBarChart) {
      uptimeBarChart.data.labels = labels;
      uptimeBarChart.data.datasets[0].data = uptimes;
      uptimeBarChart.data.datasets[0].backgroundColor = uptimeColors;
      uptimeBarChart.data.datasets[1].data = downtimes;
      uptimeBarChart.data.datasets[1].backgroundColor = downtimeColors;
      uptimeBarChart.update('none');
      return;
    }

    uptimeBarChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Uptime',
            data: uptimes,
            backgroundColor: uptimeColors,
            borderRadius: { topRight: 4, bottomRight: 4 },
            borderSkipped: false,
            barThickness
          },
          {
            label: 'Downtime',
            data: downtimes,
            backgroundColor: downtimeColors,
            borderWidth: 0,
            borderRadius: { topRight: 4, bottomRight: 4 },
            borderSkipped: false,
            barThickness
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: {
              boxWidth: 12,
              font: { size: 11 },
              generateLabels: chart => [
                { text: 'Uptime',   fillStyle: '#18a368', strokeStyle: 'transparent', lineWidth: 0, hidden: false, datasetIndex: 0 },
                { text: 'Downtime', fillStyle: 'rgba(222,91,84,0.4)', strokeStyle: 'transparent', lineWidth: 0, hidden: false, datasetIndex: 1 }
              ]
            }
          },
          tooltip: {
            callbacks: {
              title: ctx => ctx[0].label,
              label: ctx => {
                const d = sorted[ctx.dataIndex];
                if (ctx.datasetIndex === 0) return ` Uptime: ${d.uptimePct}%`;
                return ` Downtime: ${(100 - d.uptimePct).toFixed(1)}%`;
              },
              afterBody: ctx => {
                const d = sorted[ctx[0].dataIndex];
                const lines = [];
                if (d.avgLatencyMs !== null) lines.push(` Avg latency: ${d.avgLatencyMs} ms`);
                if (d.alertCount > 0) lines.push(` Alerts: ${d.alertCount}`);
                return lines;
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            min: 0,
            max: 100,
            ticks: { font: { size: 11 }, callback: v => v + '%', maxTicksLimit: 6 },
            grid: { color: 'rgba(0,0,0,0.05)' }
          },
          y: {
            stacked: true,
            ticks: { font: { size: 11 } },
            grid: { display: false }
          }
        }
      }
    });
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
        renderUptimeBarChart(uptime.value);
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
        if (uptimeBarChart)     { uptimeBarChart.destroy();     uptimeBarChart = null; }
        if (incidentTrendChart) { incidentTrendChart.destroy(); incidentTrendChart = null; }
        if (peakHoursChart)     { peakHoursChart.destroy();     peakHoursChart = null; }
        if (topDevicesChart)    { topDevicesChart.destroy();    topDevicesChart = null; }
        if (locationChart)      { locationChart.destroy();      locationChart = null; }
        loadTrendAnalytics(currentPeriod);
        setAiInsightsState('empty');
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
    loadTrendAnalytics(currentPeriod);
    startAutoRefresh();
    const exportBtn = document.getElementById('export-perf-csv-btn');
    if (exportBtn) exportBtn.addEventListener('click', exportPerfCSV);
    const refreshInsightsBtn = document.getElementById('refresh-ai-insights-btn');
    if (refreshInsightsBtn) refreshInsightsBtn.addEventListener('click', () => loadAiInsights(currentPeriod));
  }

  // Run after all resources and deferred module scripts (including auth.js) have loaded
  if (document.readyState === 'complete') {
    initAnalytics();
  } else {
    window.addEventListener('load', initAnalytics);
  }
})();
