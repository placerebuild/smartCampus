const path = require('path');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { spawn } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 4000;

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'smartcampus_networkmonitoring';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_secret';
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS || 1000 * 60 * 60 * 8);
const SESSION_COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE === 'true';

const dbPool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '64kb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: SESSION_COOKIE_SECURE,
    maxAge: SESSION_MAX_AGE_MS
  }
}));

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

const NAME_REGEX = /^[A-Za-z\s]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function normalizeName(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function buildFullName(firstName, lastName) {
  const safeFirst = normalizeName(firstName);
  const safeLast = normalizeName(lastName);
  return `${safeFirst} ${safeLast}`.trim();
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  return next();
}

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

app.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  return res.json(req.session.user);
});

app.post('/api/auth/register', async (req, res) => {
  const { firstName, lastName, email, password } = req.body || {};
  const safeEmail = normalizeEmail(email);
  const safeFirstName = normalizeName(firstName);
  const safeLastName = normalizeName(lastName);

  if (!safeFirstName || !safeLastName || !NAME_REGEX.test(safeFirstName) || !NAME_REGEX.test(safeLastName)) {
    return res.status(400).json({ error: 'Invalid name format.' });
  }

  if (!safeEmail || !EMAIL_REGEX.test(safeEmail)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  if (!password || !PASSWORD_REGEX.test(password)) {
    return res.status(400).json({
      error: 'Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.'
    });
  }

  try {
    const [existing] = await dbPool.execute('SELECT UserID FROM USERS WHERE Email = ? LIMIT 1', [safeEmail]);
    if (Array.isArray(existing) && existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const fullName = buildFullName(safeFirstName, safeLastName);
    const username = safeEmail;
    const role = 'ITStaff';
    const contactNumber = '';

    const [result] = await dbPool.execute(
      'INSERT INTO USERS (Username, PasswordHash, FullName, Email, Role, CreatedAt, ContactNumber) VALUES (?, ?, ?, ?, ?, NOW(), ?)',
      [username, passwordHash, fullName, safeEmail, role, contactNumber]
    );

    const sessionUser = {
      userId: result.insertId,
      fullName,
      email: safeEmail,
      role,
      contactNumber
    };

    req.session.user = sessionUser;
    return res.json(sessionUser);
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Unable to register right now.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const safeEmail = normalizeEmail(email);

  if (!safeEmail || !EMAIL_REGEX.test(safeEmail)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  if (!password) {
    return res.status(400).json({ error: 'Password is required.' });
  }

  try {
      const [rows] = await dbPool.execute(
        'SELECT UserID, PasswordHash, FullName, Email, Role FROM USERS WHERE Email = ? LIMIT 1',
        [safeEmail]
      );

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.PasswordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const sessionUser = {
      userId: user.UserID,
      fullName: user.FullName,
      email: user.Email,
      role: user.Role,
        contactNumber: ''
    };

    req.session.user = sessionUser;
    return res.json(sessionUser);
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Unable to sign in right now.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  if (!req.session) {
    return res.json({ ok: true });
  }

  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Unable to log out.' });
    }

    res.clearCookie('connect.sid');
    return res.json({ ok: true });
  });
});

app.put('/api/auth/profile', requireAuth, async (req, res) => {
  const { firstName, lastName, contactNumber } = req.body || {};
  const safeFirstName = normalizeName(firstName);
  const safeLastName = normalizeName(lastName);

  if (!safeFirstName || !safeLastName || !NAME_REGEX.test(safeFirstName) || !NAME_REGEX.test(safeLastName)) {
    return res.status(400).json({ error: 'Invalid name format.' });
  }

  const fullName = buildFullName(safeFirstName, safeLastName);
  const safeContact = contactNumber ? String(contactNumber).trim() : '';

  try {
    await dbPool.execute(
      'UPDATE USERS SET FullName = ?, ContactNumber = ? WHERE UserID = ?',
      [fullName, safeContact, req.session.user.userId]
    );

    req.session.user = {
      ...req.session.user,
      fullName,
      contactNumber: safeContact
    };

    return res.json(req.session.user);
  } catch (error) {
    console.error('Profile update error:', error);
    return res.status(500).json({ error: 'Unable to update profile right now.' });
  }
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
