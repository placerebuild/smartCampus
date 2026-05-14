const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: true }));
app.use(express.json({ limit: '64kb' }));

const DEFAULT_SUBNET_BASE = process.env.SCAN_SUBNET_BASE || '192.168.254';
const SCAN_RANGE_START = Number(process.env.SCAN_RANGE_START || 1);
const SCAN_RANGE_END = Number(process.env.SCAN_RANGE_END || 254);
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS || 300000);
const SCAN_CONCURRENCY = Number(process.env.SCAN_CONCURRENCY || 50);

const scanState = {
  running: false,
  lastScan: null,
  timer: null,
  devices: new Map(),
  subnetBase: DEFAULT_SUBNET_BASE,
  rangeStart: SCAN_RANGE_START,
  rangeEnd: SCAN_RANGE_END,
  intervalMs: SCAN_INTERVAL_MS,
  concurrency: SCAN_CONCURRENCY
};

function isValidIpAddress(value) {
  if (typeof value !== 'string') return false;
  const parts = value.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (part === '') return false;
    const num = Number(part);
    return Number.isInteger(num) && num >= 0 && num <= 255;
  });
}

function isValidSubnetBase(value) {
  if (typeof value !== 'string') return false;
  const parts = value.trim().split('.');
  if (parts.length !== 3) return false;
  return parts.every((part) => part !== '' && Number.isInteger(Number(part)) && Number(part) >= 0 && Number(part) <= 255);
}

function isPrivateSubnetBase(value) {
  if (!isValidSubnetBase(value)) return false;
  const parts = value.trim().split('.').map((part) => Number(part));
  const [first, second] = parts;

  if (first === 10) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  return false;
}

function normalizeText(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : fallback;
}

function ipToNumber(ip) {
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

function buildSubnetIps(base, start, end) {
  const safeBase = isPrivateSubnetBase(base) ? base : '192.168.254';
  const safeStart = Number.isInteger(start) ? Math.max(1, start) : 1;
  const safeEnd = Number.isInteger(end) ? Math.min(254, end) : 254;
  const ips = [];

  for (let i = safeStart; i <= safeEnd; i += 1) {
    ips.push(`${safeBase}.${i}`);
  }

  return { ips, base: safeBase, rangeStart: safeStart, rangeEnd: safeEnd };
}

function upsertDeviceRecord(device) {
  const existing = scanState.devices.get(device.ip);
  if (existing) {
    scanState.devices.set(device.ip, {
      ...existing,
      ...device,
      name: device.name || existing.name,
      type: device.type || existing.type,
      location: device.location || existing.location
    });
    return;
  }

  scanState.devices.set(device.ip, device);
}

function pingHost(ip) {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const args = isWindows ? ['-n', '1', '-w', '1200', ip] : ['-c', '1', '-W', '1', ip];
    const ping = spawn('ping', args);

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      ping.kill();
      resolve(false);
    }, 1600);

    ping.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(false);
    });

    ping.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(code === 0);
    });
  });
}

async function asyncPool(limit, items, iterator) {
  const ret = [];
  const executing = new Set();

  for (const item of items) {
    const p = Promise.resolve().then(() => iterator(item));
    ret.push(p);
    executing.add(p);

    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(ret);
}

async function runSubnetScan() {
  if (scanState.running) return;
  scanState.running = true;

  const { ips, base, rangeStart, rangeEnd } = buildSubnetIps(
    scanState.subnetBase,
    scanState.rangeStart,
    scanState.rangeEnd
  );

  scanState.subnetBase = base;
  scanState.rangeStart = rangeStart;
  scanState.rangeEnd = rangeEnd;

  const now = new Date().toISOString();
  const results = [];

  await asyncPool(scanState.concurrency, ips, async (ip) => {
    const reachable = await pingHost(ip);
    results.push({ ip, reachable });
  });

  results.forEach((result) => {
    const existing = scanState.devices.get(result.ip);
    const record = {
      id: result.ip,
      ip: result.ip,
      name: existing ? existing.name : `Device ${result.ip}`,
      type: existing ? existing.type : 'Unknown',
      location: existing ? existing.location : 'Unassigned',
      status: result.reachable ? 'Online' : 'Offline',
      lastSeen: now
    };

    upsertDeviceRecord(record);
  });

  scanState.lastScan = now;
  scanState.running = false;
}

function startAutoScan() {
  if (scanState.timer) return;
  runSubnetScan();
  scanState.timer = setInterval(runSubnetScan, scanState.intervalMs);
}

function stopAutoScan() {
  if (!scanState.timer) return;
  clearInterval(scanState.timer);
  scanState.timer = null;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/scan/status', (req, res) => {
  res.json({
    running: scanState.running,
    lastScan: scanState.lastScan,
    subnetBase: scanState.subnetBase,
    rangeStart: scanState.rangeStart,
    rangeEnd: scanState.rangeEnd,
    intervalMs: scanState.intervalMs,
    deviceCount: scanState.devices.size
  });
});

app.get('/api/scan/results', (req, res) => {
  const list = Array.from(scanState.devices.values()).sort((a, b) => ipToNumber(a.ip) - ipToNumber(b.ip));
  res.json(list);
});

app.post('/api/scan/trigger', async (req, res) => {
  await runSubnetScan();
  res.json({ ok: true, lastScan: scanState.lastScan });
});

app.post('/api/scan/start', (req, res) => {
  startAutoScan();
  res.json({ ok: true, intervalMs: scanState.intervalMs });
});

app.post('/api/scan/stop', (req, res) => {
  stopAutoScan();
  res.json({ ok: true });
});

app.post('/api/scan', async (req, res) => {
  const { ip, name, type, location } = req.body || {};

  if (!isValidIpAddress(ip)) {
    return res.status(400).json({ error: 'Invalid IP address.' });
  }

  const reachable = await pingHost(ip);
  const now = new Date().toISOString();

  const deviceRecord = {
    id: ip,
    name: normalizeText(name, `Device ${ip}`),
    type: normalizeText(type, 'Other'),
    ip,
    location: normalizeText(location, 'Unassigned'),
    status: reachable ? 'Online' : 'Offline',
    lastSeen: now
  };

  upsertDeviceRecord(deviceRecord);
  res.json(deviceRecord);
});

app.listen(PORT, () => {
  console.log(`Device scan API running on http://localhost:${PORT}`);
});

startAutoScan();
