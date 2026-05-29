const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const http = require('http');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const ping = require('ping');
const snmp = require('net-snmp');
const { Server } = require('socket.io');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 4000;
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: true,
    credentials: true
  }
});

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'smartcampus_networkmonitoring';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_secret';
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS || 1000 * 60 * 60 * 8);
const SESSION_COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE === 'true';
const ROUTER_IP = process.env.ROUTER_IP || '192.168.1.1'; //  fallback IP
const SNMP_COMMUNITY = process.env.SNMP_COMMUNITY || 'public';
const SNMP_VERSION = process.env.SNMP_VERSION || '2c';
const SNMP_PORT = Number(process.env.SNMP_PORT || 161);
const SNMP_TIMEOUT_MS = Number(process.env.SNMP_TIMEOUT_MS || 1500);
const SNMP_RETRIES = Number(process.env.SNMP_RETRIES || 1);
const SNMP_ENABLED = parseBoolean(process.env.SNMP_ENABLED, true);
const DEFAULT_DEVICE_NAME = process.env.DEFAULT_DEVICE_NAME || 'Router';
const DEFAULT_DEVICE_TYPE = process.env.DEFAULT_DEVICE_TYPE || 'Modem/Router';
const DEFAULT_DEVICE_MANUFACTURER = process.env.DEFAULT_DEVICE_MANUFACTURER || '';
const DEFAULT_DEVICE_MODEL = process.env.DEFAULT_DEVICE_MODEL || '';
const DEFAULT_ENDPOINT_TYPE = process.env.DEFAULT_ENDPOINT_TYPE || 'Endpoint';
const NETWORK_CIDR = process.env.NETWORK_CIDR || '';
const DISCOVERY_MAX_HOSTS = Number(process.env.DISCOVERY_MAX_HOSTS || 512);
const DISCOVERY_CONCURRENCY = Number(process.env.DISCOVERY_CONCURRENCY || 30);
const DISCOVERY_PING_TIMEOUT_SEC = Number(process.env.DISCOVERY_PING_TIMEOUT_SEC || 1);

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

io.on('connection', (socket) => {
  socket.emit('topology:hello', { ok: true, time: new Date().toISOString() });
});

const NAME_REGEX = /^[A-Za-z\s]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeOptional(value) {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  if (trimmed === undefined || trimmed === null || trimmed === '') return null;
  return trimmed;
}

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

const IP_V4_REGEX = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const SNMP_OIDS = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  sysLocation: '1.3.6.1.2.1.1.6.0'
};
const SNMP_OID_LIST = Object.values(SNMP_OIDS);
const SNMP_OID_TO_KEY = Object.entries(SNMP_OIDS).reduce((acc, [key, oid]) => {
  acc[oid] = key;
  return acc;
}, {});

function isValidIp(value) {
  return typeof value === 'string' && IP_V4_REGEX.test(value.trim());
}

function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function intToIp(intValue) {
  return [
    (intValue >>> 24) & 255,
    (intValue >>> 16) & 255,
    (intValue >>> 8) & 255,
    intValue & 255
  ].join('.');
}

function countBits(value) {
  let count = 0;
  let num = value >>> 0;
  while (num) {
    count += num & 1;
    num >>>= 1;
  }
  return count;
}

function netmaskToPrefix(netmask) {
  if (!isValidIp(netmask)) return null;
  return netmask.split('.').reduce((acc, octet) => acc + countBits(Number(octet)), 0);
}

function buildCidrFromIpNetmask(ip, netmask) {
  const prefix = netmaskToPrefix(netmask);
  if (prefix === null || !isValidIp(ip)) return null;
  const networkInt = ipToInt(ip) & ipToInt(netmask);
  return `${intToIp(networkInt)}/${prefix}`;
}

function getLocalNetworkInfo() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) {
        return { ip: info.address, netmask: info.netmask };
      }
    }
  }
  return null;
}

function resolveDiscoveryCidr() {
  if (NETWORK_CIDR) return NETWORK_CIDR;

  const local = getLocalNetworkInfo();
  if (local) {
    const cidr = buildCidrFromIpNetmask(local.ip, local.netmask);
    if (cidr) return cidr;
  }

  if (isValidIp(ROUTER_IP)) {
    const parts = ROUTER_IP.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }

  return null;
}

function parseCidr(cidr) {
  const [baseIp, prefixValue] = String(cidr || '').split('/');
  const prefix = Number(prefixValue);
  if (!isValidIp(baseIp) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return null;
  }

  const baseInt = ipToInt(baseIp);
  const hostBits = 32 - prefix;
  const totalHosts = hostBits === 32 ? 0 : Math.max(0, Math.pow(2, hostBits) - 2);
  const networkInt = baseInt & (hostBits === 32 ? 0 : (0xffffffff << hostBits) >>> 0);

  return { baseIp, prefix, baseInt, networkInt, totalHosts };
}

function expandCidr(cidr, maxHosts) {
  const parsed = parseCidr(cidr);
  if (!parsed) return [];
  if (parsed.totalHosts > maxHosts) {
    return [];
  }

  const hosts = [];
  const start = parsed.networkInt + 1;
  const end = parsed.networkInt + parsed.totalHosts;
  for (let current = start; current <= end; current += 1) {
    hosts.push(intToIp(current >>> 0));
  }

  return hosts;
}

function resolveTargetIp(req) {
  const rawTarget = typeof req.query.target === 'string' ? req.query.target.trim() : '';
  if (rawTarget) {
    return isValidIp(rawTarget) ? rawTarget : null;
  }

  return isValidIp(ROUTER_IP) ? ROUTER_IP : null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSnmpValue(value) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value.toString();
  if (typeof value === 'object' && typeof value.toString === 'function') {
    return value.toString();
  }
  return String(value);
}

function resolveStatus(snapshot) {
  if (snapshot && snapshot.icmp && snapshot.icmp.ok) {
    return snapshot.icmp.alive ? 'Online' : 'Offline';
  }
  return 'Warning';
}

function deriveScanMethod(snapshot) {
  if (snapshot && snapshot.snmp && snapshot.snmp.ok) return 'SNMP';
  if (snapshot && snapshot.icmp && snapshot.icmp.ok) return 'PING';
  if (snapshot && snapshot.arp && snapshot.arp.ok) return 'ARP';
  return 'Other';
}

function buildConnectivityDetails(snapshot) {
  const parts = [];

  if (snapshot && snapshot.icmp && snapshot.icmp.ok) {
    const time = Number.isFinite(Number(snapshot.icmp.timeMs)) ? ` ${snapshot.icmp.timeMs}ms` : '';
    parts.push(`icmp=${snapshot.icmp.alive ? 'alive' : 'down'}${time}`);
  }

  if (snapshot && snapshot.arp && snapshot.arp.ok) {
    const mac = snapshot.arp.entry && snapshot.arp.entry.mac ? snapshot.arp.entry.mac : '';
    parts.push(mac ? `mac=${mac}` : 'arp=ok');
  }

  if (snapshot && snapshot.snmp && snapshot.snmp.ok) {
    const label = snapshot.snmp.sysName ? `snmp=${snapshot.snmp.sysName}` : 'snmp=ok';
    parts.push(label);
  }

  const details = parts.join('; ');
  if (details.length <= 255) return details;
  return `${details.slice(0, 252)}...`;
}

async function findDeviceByIpOrMac(ip, mac) {
  const [byIp] = await dbPool.execute(
    'SELECT * FROM DEVICE WHERE IPAddress = ? LIMIT 1',
    [ip]
  );

  if (Array.isArray(byIp) && byIp.length > 0) {
    return byIp[0];
  }

  if (mac) {
    const [byMac] = await dbPool.execute(
      'SELECT * FROM DEVICE WHERE MACAddress = ? LIMIT 1',
      [mac]
    );

    if (Array.isArray(byMac) && byMac.length > 0) {
      return byMac[0];
    }
  }

  return null;
}

async function insertDeviceLog(deviceId, snapshot, status, ipAddress) {
  const details = buildConnectivityDetails(snapshot);
  const scanMethod = deriveScanMethod(snapshot);

  await dbPool.execute(
    'INSERT INTO DEVICE_LOG (DeviceID, Status, IPAddress, ConnectivityDetails, ScanMethod) VALUES (?, ?, ?, ?, ?)',
    [deviceId, status, ipAddress, normalizeOptional(details), scanMethod]
  );
}

async function upsertDeviceSnapshot(snapshot) {
  if (!snapshot || !snapshot.target) return null;

  const ipAddress = snapshot.target;
  const macAddress = snapshot.arp && snapshot.arp.ok && snapshot.arp.entry
    ? snapshot.arp.entry.mac
    : null;

  const existing = await findDeviceByIpOrMac(ipAddress, macAddress);
  const status = resolveStatus(snapshot);
  const now = new Date();
  const lastSeen = status === 'Online' ? now : (existing ? existing.LastSeen : null);

  const snmpName = snapshot.snmp && snapshot.snmp.ok ? snapshot.snmp.sysName : '';
  const deviceName = existing && existing.DeviceName
    ? existing.DeviceName
    : (snmpName || DEFAULT_DEVICE_NAME);
  const deviceType = existing && existing.DeviceType ? existing.DeviceType : DEFAULT_DEVICE_TYPE;
  const manufacturer = existing && existing.Manufacturer
    ? existing.Manufacturer
    : normalizeOptional(DEFAULT_DEVICE_MANUFACTURER);
  const model = existing && existing.Model
    ? existing.Model
    : normalizeOptional(DEFAULT_DEVICE_MODEL);
  const locationId = existing && existing.LocationID ? existing.LocationID : null;

  if (existing) {
    await dbPool.execute(
      'UPDATE DEVICE SET DeviceName = ?, DeviceType = ?, IPAddress = ?, MACAddress = ?, Manufacturer = ?, Model = ?, Status = ?, LastSeen = ?, LocationID = ? WHERE DeviceID = ?',
      [
        deviceName,
        deviceType,
        ipAddress,
        normalizeOptional(macAddress) || existing.MACAddress,
        manufacturer,
        model,
        status,
        lastSeen,
        locationId,
        existing.DeviceID
      ]
    );

    await insertDeviceLog(existing.DeviceID, snapshot, status, ipAddress);
    return existing.DeviceID;
  }

  const [result] = await dbPool.execute(
    'INSERT INTO DEVICE (DeviceName, DeviceType, IPAddress, MACAddress, Manufacturer, Model, Status, LastSeen, LocationID) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      deviceName,
      deviceType,
      ipAddress,
      normalizeOptional(macAddress),
      manufacturer,
      model,
      status,
      lastSeen,
      locationId
    ]
  );

  await insertDeviceLog(result.insertId, snapshot, status, ipAddress);
  return result.insertId;
}

async function upsertDiscoveredDevice(entry) {
  if (!entry || !entry.ip) return null;

  const existing = await findDeviceByIpOrMac(entry.ip, entry.mac);
  const status = entry.alive === false ? 'Warning' : 'Online';
  const now = new Date();
  const lastSeen = status === 'Online' ? now : (existing ? existing.LastSeen : null);

  const deviceName = existing && existing.DeviceName ? existing.DeviceName : entry.ip;
  const deviceType = existing && existing.DeviceType ? existing.DeviceType : DEFAULT_ENDPOINT_TYPE;
  const manufacturer = existing && existing.Manufacturer
    ? existing.Manufacturer
    : normalizeOptional(DEFAULT_DEVICE_MANUFACTURER);
  const model = existing && existing.Model ? existing.Model : normalizeOptional(DEFAULT_DEVICE_MODEL);
  const locationId = existing && existing.LocationID ? existing.LocationID : null;

  const snapshot = {
    icmp: { ok: true, alive: status === 'Online' },
    arp: entry.mac ? { ok: true, entry: { mac: entry.mac } } : { ok: false },
    snmp: { ok: false }
  };

  if (existing) {
    await dbPool.execute(
      'UPDATE DEVICE SET DeviceName = ?, DeviceType = ?, IPAddress = ?, MACAddress = ?, Manufacturer = ?, Model = ?, Status = ?, LastSeen = ?, LocationID = ? WHERE DeviceID = ?',
      [
        deviceName,
        deviceType,
        entry.ip,
        normalizeOptional(entry.mac) || existing.MACAddress,
        manufacturer,
        model,
        status,
        lastSeen,
        locationId,
        existing.DeviceID
      ]
    );

    await insertDeviceLog(existing.DeviceID, snapshot, status, entry.ip);
    return existing.DeviceID;
  }

  const [result] = await dbPool.execute(
    'INSERT INTO DEVICE (DeviceName, DeviceType, IPAddress, MACAddress, Manufacturer, Model, Status, LastSeen, LocationID) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      deviceName,
      deviceType,
      entry.ip,
      normalizeOptional(entry.mac),
      manufacturer,
      model,
      status,
      lastSeen,
      locationId
    ]
  );

  await insertDeviceLog(result.insertId, snapshot, status, entry.ip);
  return result.insertId;
}

function formatLocationLabel(row) {
  const parts = [row.BuildingName, row.Floor, row.Room].filter(Boolean);
  return parts.length ? parts.join(' / ') : '';
}

function mapDeviceRow(row) {
  return {
    id: row.DeviceID,
    name: row.DeviceName,
    type: row.DeviceType,
    ip: row.IPAddress,
    mac: row.MACAddress,
    status: row.Status,
    lastSeen: row.LastSeen,
    location: formatLocationLabel(row),
    building: row.BuildingName || '',
    floor: row.Floor || '',
    room: row.Room || ''
  };
}

function mapTopologyRow(row) {
  return {
    id: row.IPAddress,
    name: row.DeviceName || row.IPAddress,
    type: row.DeviceType || DEFAULT_ENDPOINT_TYPE,
    ip: row.IPAddress,
    mac: row.MACAddress,
    status: row.Status,
    lastSeen: row.LastSeen,
    location: formatLocationLabel(row),
    building: row.BuildingName || '',
    floor: row.Floor || '',
    room: row.Room || ''
  };
}

function mergeTopologyDevices(primary, extras) {
  const map = new Map();
  (primary || []).forEach(device => {
    if (device && device.id) {
      map.set(String(device.id), device);
    }
  });
  (extras || []).forEach(device => {
    if (device && device.id && !map.has(String(device.id))) {
      map.set(String(device.id), device);
    }
  });
  return Array.from(map.values());
}

function buildDiscoveredDevice(entry) {
  const status = entry && entry.alive === false ? 'Warning' : 'Online';
  return {
    id: entry.ip,
    name: entry.ip,
    type: DEFAULT_ENDPOINT_TYPE,
    ip: entry.ip,
    mac: entry.mac,
    status,
    lastSeen: new Date().toISOString(),
    location: '',
    building: '',
    floor: '',
    room: ''
  };
}

function resolveRouterIp(devices) {
  if (isValidIp(ROUTER_IP)) return ROUTER_IP;
  const router = (devices || []).find(device =>
    String(device.type || '').toLowerCase().includes('router')
  );
  return router ? router.ip : null;
}

function buildRouterDevice(routerIp, connectedEntries) {
  const connectedIps = new Set((connectedEntries || []).map(entry => entry.ip));
  const status = connectedIps.has(routerIp) ? 'Online' : 'Warning';
  return {
    id: routerIp,
    name: DEFAULT_DEVICE_NAME || 'Router',
    type: DEFAULT_DEVICE_TYPE || 'Router',
    ip: routerIp,
    mac: null,
    status,
    lastSeen: new Date().toISOString(),
    location: '',
    building: '',
    floor: '',
    room: ''
  };
}

function buildRouterLinks(routerIp, connectedEntries, devices) {
  if (!routerIp) return [];
  const deviceMap = new Map((devices || []).map(device => [String(device.id), device]));
  const connectedIps = new Set((connectedEntries || []).map(entry => entry.ip));
  connectedIps.delete(routerIp);

  const links = [];
  connectedIps.forEach(ip => {
    if (!deviceMap.has(ip)) return;
    const device = deviceMap.get(ip);
    links.push({
      id: `link-${routerIp}-${ip}`,
      from: routerIp,
      to: ip,
      medium: '',
      bandwidth: '',
      status: device.status || 'Online'
    });
  });

  return links;
}

async function getConnectedArpEntries() {
  const table = await readArpTable();
  if (!table.ok) return [];
  return parseArpEntries(table.output);
}

async function fetchTopologyPayload(connectedEntries) {
  const [rows] = await dbPool.execute(`
    SELECT
      d.DeviceID,
      d.DeviceName,
      d.DeviceType,
      d.IPAddress,
      d.MACAddress,
      d.Status,
      d.LastSeen,
      l.BuildingName,
      l.Floor,
      l.Room
    FROM DEVICE d
    LEFT JOIN LOCATION l ON l.LocationID = d.LocationID
    ORDER BY d.LastSeen DESC, d.DeviceID DESC
  `);

  const baseDevices = rows.map(mapTopologyRow);
  const arpEntries = Array.isArray(connectedEntries) ? connectedEntries : await getConnectedArpEntries();
  const discoveredDevices = arpEntries.map(buildDiscoveredDevice);
  let devices = mergeTopologyDevices(baseDevices, discoveredDevices);

  const routerIp = resolveRouterIp(devices);
  if (routerIp && !devices.some(device => device.id === routerIp)) {
    devices = mergeTopologyDevices(devices, [buildRouterDevice(routerIp, arpEntries)]);
  }

  const links = buildRouterLinks(routerIp, arpEntries, devices);

  return { devices, links };
}

async function emitTopologyUpdate(reason, connectedEntries) {
  try {
    const payload = await fetchTopologyPayload(connectedEntries);
    io.emit('topology:update', {
      ...payload,
      reason,
      time: new Date().toISOString()
    });
  } catch (error) {
    console.error('Topology broadcast error:', error);
  }
}

function getSnmpVersion() {
  if (SNMP_VERSION === '1') return snmp.Version1;
  return snmp.Version2c;
}

function fetchSnmpSnapshot(targetIp) {
  return new Promise((resolve) => {
    if (!SNMP_ENABLED) {
      resolve({ ok: false, disabled: true, error: 'SNMP disabled by server config.' });
      return;
    }

    const session = snmp.createSession(targetIp, SNMP_COMMUNITY, {
      version: getSnmpVersion(),
      port: SNMP_PORT,
      timeout: SNMP_TIMEOUT_MS,
      retries: SNMP_RETRIES
    });

    session.get(SNMP_OID_LIST, (error, varbinds) => {
      session.close();

      if (error) {
        resolve({ ok: false, error: error.message || 'SNMP request failed.' });
        return;
      }

      const payload = {};
      for (const varbind of varbinds || []) {
        if (snmp.isVarbindError(varbind)) {
          continue;
        }
        const key = SNMP_OID_TO_KEY[varbind.oid];
        if (key) {
          payload[key] = normalizeSnmpValue(varbind.value);
        }
      }

      resolve({ ok: true, ...payload });
    });
  });
}

async function fetchIcmpSnapshot(targetIp) {
  try {
    const result = await ping.promise.probe(targetIp, {
      timeout: 2,
      min_reply: 1
    });

    const timeValue = Number(result.time);
    return {
      ok: true,
      alive: Boolean(result.alive),
      timeMs: Number.isFinite(timeValue) ? timeValue : null
    };
  } catch (error) {
    return { ok: false, error: error.message || 'ICMP request failed.' };
  }
}

function readArpTable() {
  return new Promise((resolve) => {
    exec('arp -a', { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve({ ok: false, error: error.message || 'Unable to read ARP table.' });
        return;
      }
      resolve({ ok: true, output: stdout || '' });
    });
  });
}

function parseArpEntry(output, targetIp) {
  const pattern = new RegExp(`^\\s*${escapeRegex(targetIp)}\\s+([0-9a-f:-]{11,})\\s+\\w+`, 'im');
  const match = output.match(pattern);
  if (!match) return null;
  return { ip: targetIp, mac: match[1].toLowerCase() };
}

function parseArpEntries(output) {
  const entries = [];
  const pattern = /^\s*([0-9.]+)\s+([0-9a-f:-]{11,})\s+\w+/gim;
  let match;

  while ((match = pattern.exec(output)) !== null) {
    const ip = match[1];
    const mac = match[2].toLowerCase();
    if (isValidIp(ip)) {
      entries.push({ ip, mac });
    }
  }

  return entries;
}

async function fetchArpSnapshot(targetIp) {
  try {
    const table = await readArpTable();
    if (!table.ok) return { ok: false, error: table.error };
    const entry = parseArpEntry(table.output, targetIp);
    return { ok: true, entry };
  } catch (error) {
    return { ok: false, error: error.message || 'ARP lookup failed.' };
  }
}

async function runWithConcurrency(items, limit, worker) {
  let index = 0;
  const results = [];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  });

  await Promise.all(workers);
  return results;
}

async function pingHost(ip) {
  try {
    const result = await ping.promise.probe(ip, {
      timeout: DISCOVERY_PING_TIMEOUT_SEC,
      min_reply: 1
    });
    return Boolean(result.alive);
  } catch (error) {
    return false;
  }
}

async function discoverNetworkDevices(cidrOverride) {
  const cidr = cidrOverride || resolveDiscoveryCidr();
  if (!cidr) {
    return { ok: false, error: 'Unable to resolve discovery subnet.' };
  }

  const hosts = expandCidr(cidr, DISCOVERY_MAX_HOSTS);
  if (!hosts.length) {
    return { ok: false, error: 'Subnet too large or no hosts resolved.' };
  }

  const aliveSet = new Set();
  await runWithConcurrency(hosts, DISCOVERY_CONCURRENCY, async (ip) => {
    const alive = await pingHost(ip);
    if (alive) aliveSet.add(ip);
    return alive;
  });

  const table = await readArpTable();
  if (!table.ok) {
    return { ok: false, error: table.error || 'Unable to read ARP table.' };
  }

  const entries = parseArpEntries(table.output).map(entry => ({
    ...entry,
    alive: aliveSet.has(entry.ip)
  }));

  for (const entry of entries) {
    await upsertDiscoveredDevice(entry);
  }

  return {
    ok: true,
    cidr,
    discovered: entries,
    aliveCount: aliveSet.size
  };
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

app.get('/api/devices', requireAuth, async (req, res) => {
  try {
    const [rows] = await dbPool.execute(`
      SELECT
        d.DeviceID,
        d.DeviceName,
        d.DeviceType,
        d.IPAddress,
        d.MACAddress,
        d.Status,
        d.LastSeen,
        l.BuildingName,
        l.Floor,
        l.Room
      FROM DEVICE d
      LEFT JOIN LOCATION l ON l.LocationID = d.LocationID
      ORDER BY d.LastSeen DESC, d.DeviceID DESC
    `);

    return res.json(rows.map(mapDeviceRow));
  } catch (error) {
    console.error('Devices load error:', error);
    return res.status(500).json({ error: 'Unable to load devices right now.' });
  }
});

app.get('/api/topology', requireAuth, async (req, res) => {
  try {
    const payload = await fetchTopologyPayload();
    return res.json(payload);
  } catch (error) {
    console.error('Topology load error:', error);
    return res.status(500).json({ error: 'Unable to load topology right now.' });
  }
});

app.post('/api/monitor/discover', requireAuth, async (req, res) => {
  const cidrOverride = typeof req.body?.cidr === 'string' ? req.body.cidr.trim() : '';

  try {
    const result = await discoverNetworkDevices(cidrOverride || undefined);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || 'Discovery failed.' });
    }

    emitTopologyUpdate('network-discovery', result.discovered);
    return res.json(result);
  } catch (error) {
    console.error('Discovery error:', error);
    return res.status(500).json({ error: 'Unable to scan network right now.' });
  }
});

app.get('/api/monitor/router', requireAuth, async (req, res) => {
  const target = resolveTargetIp(req);
  if (!target) {
    return res.status(400).json({ error: 'Invalid target IP address.' });
  }

  const icmp = await fetchIcmpSnapshot(target);
  const arp = await fetchArpSnapshot(target);
  const snmpSnapshot = await fetchSnmpSnapshot(target);

  const snapshot = {
    target,
    scannedAt: new Date().toISOString(),
    icmp,
    arp,
    snmp: snmpSnapshot
  };

  try {
    await upsertDeviceSnapshot(snapshot);
    emitTopologyUpdate('router-scan');
  } catch (error) {
    console.error('Device upsert error:', error);
    return res.status(500).json({ error: 'Unable to store device scan.' });
  }

  return res.json(snapshot);
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

httpServer.listen(PORT, () => {
  console.log(`SmartCampus API running on http://localhost:${PORT}`);
});
