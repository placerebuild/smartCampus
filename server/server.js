// Core modules and third-party dependencies
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
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load environment variables from server/.env
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Express app and HTTP server wiring
const app = express();
const PORT = process.env.PORT || 4000;
const httpServer = http.createServer(app);

// Allowed origins for CORS — comma-separated env var, or localhost fallback
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',').map(o => o.trim()).filter(Boolean);

// Socket.IO server for real-time topology updates
const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    credentials: true
  }
});

// Runtime configuration from environment
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
const DISCOVERY_PING_TIMEOUT_SEC = Number(process.env.DISCOVERY_PING_TIMEOUT_SEC || 2);

// Email alert configuration
const SMTP_HOST        = process.env.SMTP_HOST        || '';
const SMTP_PORT        = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_SECURE      = process.env.SMTP_SECURE      === 'true';
const SMTP_USER        = process.env.SMTP_USER        || '';
const SMTP_PASS        = process.env.SMTP_PASS        || '';
const ALERT_EMAIL_FROM = process.env.ALERT_EMAIL_FROM || 'CampusNet Monitor';
const ALERT_EMAIL_TO   = process.env.ALERT_EMAIL_TO   || '';
let emailAlertsEnabled = process.env.ALERT_EMAIL_ENABLED === 'true';

// Scheduler settings for automated data collection
const SCHEDULED_SCANS_ENABLED = parseBoolean(process.env.SCHEDULED_SCANS_ENABLED, true);
const ROUTER_SCAN_INTERVAL_MS = Number(process.env.ROUTER_SCAN_INTERVAL_MS || 15000);
const DISCOVERY_SCAN_INTERVAL_MS = Number(process.env.DISCOVERY_SCAN_INTERVAL_MS || 5 * 60 * 1000);

// MySQL connection pool
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

// Nodemailer transporter — null if SMTP not configured
const mailer = (SMTP_HOST && SMTP_USER && SMTP_PASS)
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    })
  : null;

// Per-device cooldown for 'abnormal' emails to prevent spam
const abnormalEmailCooldowns = new Map();
const ABNORMAL_EMAIL_COOLDOWN_MS = 5 * 60 * 1000;

// HTTP middleware and session configuration
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '64kb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: SESSION_COOKIE_SECURE,
    maxAge: SESSION_MAX_AGE_MS
  }
}));

// Serve frontend static files (html/, js/, css/, images/, components/) from project root
app.use(express.static(path.join(__dirname, '..')));

// Initial socket handshake
io.on('connection', (socket) => {
  socket.emit('topology:hello', { ok: true, time: new Date().toISOString() });
});

// Input validation patterns
const NAME_REGEX = /^[A-Za-z\s]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

// Parse boolean-like strings with a default fallback
function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parseRequiredBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

// Convert empty strings to null for DB storage
function normalizeOptional(value) {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  if (trimmed === undefined || trimmed === null || trimmed === '') return null;
  return trimmed;
}

// Normalize email values for comparisons
function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

// Trim name values and guard against non-strings
function normalizeName(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

// Build a full name string from first/last values
function buildFullName(firstName, lastName) {
  const safeFirst = normalizeName(firstName);
  const safeLast = normalizeName(lastName);
  return `${safeFirst} ${safeLast}`.trim();
}

// Enforce session authentication on protected routes
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  return next();
}

// Enforce role-based access — call after requireAuth
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }
    return next();
  };
}

// Fire-and-forget activity log insert
function logActivity(req, action, details = null) {
  const user = req.session && req.session.user;
  dbPool.execute(
    'INSERT INTO activity_logs (UserID, FullName, Action, Details, IPAddress) VALUES (?,?,?,?,?)',
    [user ? user.userId : null, user ? user.fullName : 'System', action, details, req.ip]
  ).catch(err => console.error('Activity log error:', err.message));
}

// Network helpers and SNMP OID mapping
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

// Validate IPv4 address strings
function isValidIp(value) {
  return typeof value === 'string' && IP_V4_REGEX.test(value.trim());
}

// ---- IP Blacklist ----
// Manually blacklisted IPs from environment (comma-separated)
const MANUAL_BLACKLIST = (process.env.BLACKLISTED_IPS || '')
  .split(',')
  .map(ip => ip.trim())
  .filter(Boolean);

// Check if an IP should be excluded from scanning/discovery
function isBlacklistedIp(ip) {
  if (!ip) return true;
  const trimmed = ip.trim();

  // Multicast range (224.0.0.0 – 239.255.255.255)
  const firstOctet = parseInt(trimmed.split('.')[0], 10);
  if (firstOctet >= 224 && firstOctet <= 239) return true;

  // Broadcast
  if (trimmed === '255.255.255.255') return true;

  // Link-local (169.254.x.x)
  if (trimmed.startsWith('169.254.')) return true;

  // Loopback (127.x.x.x)
  if (trimmed.startsWith('127.')) return true;

  // APIPA / zero-network
  if (trimmed.startsWith('0.')) return true;

  // Class E reserved (240-255, except broadcast already caught)
  if (firstOctet >= 240) return true;

  // Very broad subnets that are clearly noise (e.g. 10.241.255.255, 25.255.255.254)
  const octets = trimmed.split('.').map(Number);
  // Subnet broadcast addresses (anything ending in .255.255 or .255.254)
  if (octets[2] === 255 && octets[3] >= 254) return true;
  // Also catch x.x.x.255 (common /24 broadcasts)
  if (octets[3] === 255) return true;

  // Manual blacklist from .env
  if (MANUAL_BLACKLIST.includes(trimmed)) return true;

  return false;
}

// Convert dotted IPv4 string to integer
function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

// Convert integer to dotted IPv4 string
function intToIp(intValue) {
  return [
    (intValue >>> 24) & 255,
    (intValue >>> 16) & 255,
    (intValue >>> 8) & 255,
    intValue & 255
  ].join('.');
}

// Count set bits for netmask conversion
function countBits(value) {
  let count = 0;
  let num = value >>> 0;
  while (num) {
    count += num & 1;
    num >>>= 1;
  }
  return count;
}

// Convert dotted netmask to CIDR prefix
function netmaskToPrefix(netmask) {
  if (!isValidIp(netmask)) return null;
  return netmask.split('.').reduce((acc, octet) => acc + countBits(Number(octet)), 0);
}

// Build a CIDR string from local IP and netmask
function buildCidrFromIpNetmask(ip, netmask) {
  const prefix = netmaskToPrefix(netmask);
  if (prefix === null || !isValidIp(ip)) return null;
  const networkInt = ipToInt(ip) & ipToInt(netmask);
  return `${intToIp(networkInt)}/${prefix}`;
}

// Read local IPv4 address and netmask
function getLocalNetworkInfo(preferredGatewayIp) {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const info of addrs || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      const prefix = netmaskToPrefix(info.netmask);
      candidates.push({ name, ip: info.address, netmask: info.netmask, prefix });
    }
  }

  // When a preferred gateway IP is given, return the interface on the same subnet
  if (preferredGatewayIp && isValidIp(preferredGatewayIp)) {
    const gatewayInt = ipToInt(preferredGatewayIp);
    for (const c of candidates) {
      if (c.prefix === null) continue;
      const hostBits = 32 - c.prefix;
      const mask = hostBits === 32 ? 0 : (0xffffffff << hostBits) >>> 0;
      const networkInt = ipToInt(c.ip) & mask;
      if (((gatewayInt & mask) >>> 0) === networkInt) {
        return { ip: c.ip, netmask: c.netmask, interfaceName: c.name };
      }
    }
  }

  // Fallback: first non-internal IPv4 interface (original behaviour)
  return candidates.length
    ? { ip: candidates[0].ip, netmask: candidates[0].netmask, interfaceName: candidates[0].name }
    : null;
}

// Resolve the CIDR used for discovery scans
function resolveDiscoveryCidr() {
  if (NETWORK_CIDR) return NETWORK_CIDR;

  const gatewayIp = detectedGatewayIp || ROUTER_IP;
  const local = getLocalNetworkInfo(isValidIp(gatewayIp) ? gatewayIp : undefined);
  if (local) {
    const cidr = buildCidrFromIpNetmask(local.ip, local.netmask);
    if (cidr) return cidr;
  }

  if (isValidIp(gatewayIp)) {
    const parts = gatewayIp.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }

  return null;
}

// Cached default gateway IP and expiry for detectDefaultGateway()
let detectedGatewayIp = null;
let gatewayDetectedAt = 0;
const GATEWAY_CACHE_TTL_MS = 60000;

// Detect the OS default gateway IP (router) from the system routing table.
// On Windows with multiple adapters (Ethernet + WiFi), collects every listed gateway
// and picks the one whose subnet matches a connected local interface.
function detectDefaultGateway() {
  const now = Date.now();
  if (detectedGatewayIp && (now - gatewayDetectedAt) < GATEWAY_CACHE_TTL_MS) {
    return Promise.resolve(detectedGatewayIp);
  }

  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'ipconfig' : 'ip route show default';

    exec(cmd, { windowsHide: true }, (error, stdout) => {
      if (error || !stdout) {
        resolve(isValidIp(ROUTER_IP) ? ROUTER_IP : null);
        return;
      }

      let ip = null;

      if (isWindows) {
        // Collect every "Default Gateway" IP listed across all adapters
        const GW_REGEX = /Default Gateway[\s.]+:\s*([\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3})/gi;
        const candidates = [];
        for (const m of stdout.matchAll(GW_REGEX)) {
          const candidate = m[1];
          if (isValidIp(candidate) && !candidate.startsWith('0.')) {
            candidates.push(candidate);
          }
        }

        if (candidates.length === 1) {
          ip = candidates[0];
        } else if (candidates.length > 1) {
          // Pick the gateway that shares a subnet with a local interface
          const ifaces = os.networkInterfaces();
          outer: for (const candidate of candidates) {
            const gatewayInt = ipToInt(candidate);
            for (const addrs of Object.values(ifaces)) {
              for (const info of addrs || []) {
                if (info.family !== 'IPv4' || info.internal) continue;
                const prefix = netmaskToPrefix(info.netmask);
                if (prefix === null) continue;
                const hostBits = 32 - prefix;
                const mask = hostBits === 32 ? 0 : (0xffffffff << hostBits) >>> 0;
                const networkInt = ipToInt(info.address) & mask;
                if (((gatewayInt & mask) >>> 0) === networkInt) {
                  ip = candidate;
                  break outer;
                }
              }
            }
          }
          // No subnet match found — take the first valid candidate
          if (!ip) ip = candidates[0];
        }
      } else {
        // "default via 192.168.x.x dev eth0"
        const match = stdout.match(/default via\s+([\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3})/i);
        if (match && isValidIp(match[1])) ip = match[1];
      }

      if (!ip) {
        resolve(isValidIp(ROUTER_IP) ? ROUTER_IP : null);
        return;
      }

      detectedGatewayIp = ip;
      gatewayDetectedAt = Date.now();
      resolve(ip);
    });
  });
}

// Parse CIDR into numeric network details
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

// Expand CIDR into a list of host IPs
function expandCidr(cidr, maxHosts) {
  const parsed = parseCidr(cidr);
  if (!parsed) return [];

  const hosts = [];
  const start = parsed.networkInt + 1;
  const limit = Math.min(parsed.totalHosts, maxHosts);
  const end = parsed.networkInt + limit;
  for (let current = start; current <= end; current += 1) {
    hosts.push(intToIp(current >>> 0));
  }

  return hosts;
}

// Resolve router target IP from query, detected gateway, or config fallback
function resolveTargetIp(req) {
  const rawTarget = typeof req.query.target === 'string' ? req.query.target.trim() : '';
  if (rawTarget) {
    return isValidIp(rawTarget) ? rawTarget : null;
  }

  if (detectedGatewayIp && isValidIp(detectedGatewayIp)) return detectedGatewayIp;
  return isValidIp(ROUTER_IP) ? ROUTER_IP : null;
}

// Escape regex characters in string literals
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Normalize SNMP values to strings or null
function normalizeSnmpValue(value) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value.toString();
  if (typeof value === 'object' && typeof value.toString === 'function') {
    return value.toString();
  }
  return String(value);
}

// Resolve device status from a scan snapshot
function resolveStatus(snapshot) {
  if (snapshot && snapshot.icmp && snapshot.icmp.ok) {
    return snapshot.icmp.alive ? 'Online' : 'Offline';
  }
  return 'Warning';
}

// Infer which scan method produced a snapshot
function deriveScanMethod(snapshot) {
  if (snapshot && snapshot.snmp && snapshot.snmp.ok) return 'SNMP';
  if (snapshot && snapshot.icmp && snapshot.icmp.ok) return 'PING';
  if (snapshot && snapshot.arp && snapshot.arp.ok) return 'ARP';
  return 'Other';
}

// Build a compact connectivity summary for logging
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

// Find an existing device by IP or MAC address
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

// Insert a device scan event into DEVICE_LOG
async function insertDeviceLog(deviceId, snapshot, status, ipAddress) {
  const details = buildConnectivityDetails(snapshot);
  const scanMethod = deriveScanMethod(snapshot);
  const latencyMs = (snapshot && snapshot.icmp && snapshot.icmp.ok && Number.isFinite(Number(snapshot.icmp.timeMs)))
    ? Number(snapshot.icmp.timeMs)
    : null;

  await dbPool.execute(
    'INSERT INTO DEVICE_LOG (DeviceID, Status, IPAddress, ConnectivityDetails, ScanMethod, LatencyMs) VALUES (?, ?, ?, ?, ?, ?)',
    [deviceId, status, ipAddress, normalizeOptional(details), scanMethod, latencyMs]
  );
}

// Upsert a router scan snapshot into DEVICE
async function upsertDeviceSnapshot(snapshot) {
  if (!snapshot || !snapshot.target) return null;
  if (isBlacklistedIp(snapshot.target)) return null;

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
  const deviceType = existing && existing.DeviceType ? existing.DeviceType : 'Router';
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

// Upsert a discovered endpoint into DEVICE
async function upsertDiscoveredDevice(entry) {
  if (!entry || !entry.ip) return null;
  if (isBlacklistedIp(entry.ip)) return null;

  const existing = await findDeviceByIpOrMac(entry.ip, entry.mac);
  const status = entry.alive === false ? 'Offline' : 'Online';
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
    icmp: { ok: true, alive: status === 'Online', timeMs: entry.timeMs !== undefined ? entry.timeMs : null },
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

// Persist or re-activate a router → endpoint link in DEVICE_CONNECTION
async function upsertDeviceConnection(routerDeviceId, endpointDeviceId) {
  if (!routerDeviceId || !endpointDeviceId || routerDeviceId === endpointDeviceId) return;
  try {
    await dbPool.execute(
      `INSERT INTO DEVICE_CONNECTION (SourceDeviceID, TargetDeviceID, ConnectionType, IsActive)
       VALUES (?, ?, 'WiFi', 1)
       ON DUPLICATE KEY UPDATE IsActive = 1`,
      [routerDeviceId, endpointDeviceId]
    );
  } catch (error) {
    console.error('upsertDeviceConnection error:', error);
  }
}

// Format location labels for UI output
function formatLocationLabel(row) {
  const parts = [row.BuildingName, row.Floor, row.Room].filter(Boolean);
  return parts.length ? parts.join(' / ') : '';
}

// Find or insert a LOCATION row for the provided building/floor/room
async function findOrCreateLocationId(buildingName, floor, room) {
  const safeBuilding = normalizeOptional(buildingName);
  const safeFloor = normalizeOptional(floor);
  const safeRoom = normalizeOptional(room);

  if (!safeBuilding && !safeFloor && !safeRoom) return null;

  const [existing] = await dbPool.execute(
    'SELECT LocationID FROM LOCATION WHERE BuildingName <=> ? AND Floor <=> ? AND Room <=> ? LIMIT 1',
    [safeBuilding, safeFloor, safeRoom]
  );

  if (Array.isArray(existing) && existing.length > 0) {
    return existing[0].LocationID;
  }

  const [result] = await dbPool.execute(
    'INSERT INTO LOCATION (BuildingName, Floor, Room) VALUES (?, ?, ?)',
    [safeBuilding, safeFloor, safeRoom]
  );

  return result.insertId;
}

// Map DB rows into device API payloads
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

// Map DB rows into topology payloads
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

// Merge two device arrays without duplicate IDs
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

// Convert ARP discovery entries to device objects
function buildDiscoveredDevice(entry) {
  const status = entry && entry.alive === false ? 'Offline' : 'Online';
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

// Resolve router IP from detected gateway, config, or device list
function resolveRouterIp(devices) {
  if (detectedGatewayIp && isValidIp(detectedGatewayIp)) return detectedGatewayIp;
  if (isValidIp(ROUTER_IP)) return ROUTER_IP;
  const router = (devices || []).find(device =>
    String(device.type || '').toLowerCase().includes('router')
  );
  return router ? router.ip : null;
}

// Build a router device object for topology
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

// Build topology links between router and devices
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

// Read the current ARP table entries
async function getConnectedArpEntries() {
  const table = await readArpTable();
  if (!table.ok) return [];
  return parseArpEntries(table.output);
}

// Build the topology payload from DB and ARP data
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

  // Build links from persisted DEVICE_CONNECTION rows; fall back to synthetic ARP links
  let links = [];
  const deviceIds = rows.map(r => r.DeviceID);
  if (deviceIds.length > 0) {
    const placeholders = deviceIds.map(() => '?').join(', ');
    const [connRows] = await dbPool.execute(
      `SELECT dc.SourceDeviceID, dc.TargetDeviceID, dc.ConnectionType,
              src.IPAddress AS sourceIp, tgt.IPAddress AS targetIp
       FROM DEVICE_CONNECTION dc
       JOIN DEVICE src ON src.DeviceID = dc.SourceDeviceID
       JOIN DEVICE tgt ON tgt.DeviceID = dc.TargetDeviceID
       WHERE dc.IsActive = 1
         AND dc.SourceDeviceID IN (${placeholders})`,
      deviceIds
    );

    if (connRows.length > 0) {
      links = connRows.map(row => ({
        id: `link-${row.sourceIp}-${row.targetIp}`,
        from: row.sourceIp,
        to: row.targetIp,
        medium: row.ConnectionType || '',
        bandwidth: '',
        status: 'Online'
      }));
    }
  }

  if (links.length === 0) {
    links = buildRouterLinks(routerIp, arpEntries, devices);
  }

  return { devices, links };
}

// Broadcast topology updates over Socket.IO
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

// Broadcast the full device list so the Device Inventory table refreshes in real time
async function emitDevicesUpdate() {
  try {
    const [rows] = await dbPool.execute(
      `SELECT d.DeviceID, d.DeviceName, d.DeviceType, d.IPAddress, d.MACAddress,
              d.Status, d.LastSeen, l.BuildingName, l.Floor, l.Room
       FROM DEVICE d
       LEFT JOIN LOCATION l ON l.LocationID = d.LocationID
       ORDER BY d.LastSeen DESC, d.DeviceID DESC`
    );
    io.emit('devices:update', rows.map(mapDeviceRow));
  } catch (err) {
    console.error('emitDevicesUpdate error:', err);
  }
}

// Map frontend severity tokens to the DB enum values used by the ALERT table
function mapSeverityToDb(severity) {
  if (severity === 'danger')  return 'High';
  if (severity === 'warning') return 'Warning';
  if (severity === 'success') return 'Low';
  return 'Medium';
}

// Map DB enum severity values back to frontend Bootstrap tokens
function mapSeverityFromDb(severity) {
  if (severity === 'High' || severity === 'Critical') return 'danger';
  if (severity === 'Warning' || severity === 'Medium') return 'warning';
  if (severity === 'Low') return 'success';
  return 'warning';
}

// Persist an alert to the ALERT table
async function insertAlert(type, severity, message, deviceId) {
  try {
    await dbPool.execute(
      `INSERT INTO ALERT (DeviceID, AlertType, Severity, Issue)
       VALUES (?, ?, ?, ?)`,
      [deviceId || null, type, mapSeverityToDb(severity), message]
    );
  } catch (err) {
    console.error('insertAlert error:', err.message);
  }
}

// Send an email notification for an alert event
async function sendAlertEmail(type, severity, message, deviceName, deviceId) {
  if (!emailAlertsEnabled || !mailer || !ALERT_EMAIL_TO) return;
  if (type === 'abnormal') {
    const last = abnormalEmailCooldowns.get(deviceId);
    if (last && Date.now() - last < ABNORMAL_EMAIL_COOLDOWN_MS) return;
    abnormalEmailCooldowns.set(deviceId, Date.now());
  }
  const subjectPrefix = severity === 'danger' ? '[CRITICAL]' : severity === 'warning' ? '[WARNING]' : '[INFO]';
  const subject = `${subjectPrefix} SmartCampus SecureNet Alert — ${deviceName || 'Unknown Device'}`;
  const color = severity === 'danger' ? '#de5b54' : severity === 'warning' ? '#f09a35' : '#18a368';
  const html = `
    <div style="font-family:sans-serif;max-width:480px">
      <h3 style="color:${color};margin-bottom:8px">${subjectPrefix} ${type.toUpperCase()}</h3>
      <p><strong>Device:</strong> ${deviceName || 'N/A'}</p>
      <p><strong>Message:</strong> ${message}</p>
      <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
      <hr style="border:none;border-top:1px solid #eee">
      <small style="color:#888">SmartCampus SecureNet — Network Monitoring System</small>
    </div>
  `;
  try {
    await mailer.sendMail({ from: ALERT_EMAIL_FROM, to: ALERT_EMAIL_TO, subject, html });
    console.log(`Alert email sent: ${subject}`);
  } catch (err) {
    console.error('sendAlertEmail error:', err.message);
  }
}

// Resolve SNMP version enum for net-snmp
function getSnmpVersion() {
  if (SNMP_VERSION === '1') return snmp.Version1;
  return snmp.Version2c;
}

// Query SNMP OIDs for device metadata
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

// Ping a host with ICMP to get reachability, latency, and packet loss
async function fetchIcmpSnapshot(targetIp) {
  const probeCount = 4;
  try {
    const result = await ping.promise.probe(targetIp, {
      timeout: 2,
      min_reply: probeCount
    });

    const timeValue = Number(result.time);
    const alive = Boolean(result.alive);

    // Parse packet loss from the ping result
    let packetLoss = null;
    if (result.packetLoss !== undefined && result.packetLoss !== null) {
      const lossValue = Number(result.packetLoss);
      packetLoss = Number.isFinite(lossValue) ? lossValue : null;
    }

    // Parse min/max/avg from the result when available
    let minMs = null;
    let maxMs = null;
    let avgMs = Number.isFinite(timeValue) ? timeValue : null;

    if (result.min !== undefined && result.min !== 'unknown') {
      const minValue = Number(result.min);
      if (Number.isFinite(minValue)) minMs = minValue;
    }
    if (result.max !== undefined && result.max !== 'unknown') {
      const maxValue = Number(result.max);
      if (Number.isFinite(maxValue)) maxMs = maxValue;
    }
    if (result.avg !== undefined && result.avg !== 'unknown') {
      const avgValue = Number(result.avg);
      if (Number.isFinite(avgValue)) avgMs = avgValue;
    }

    return {
      ok: true,
      alive,
      timeMs: Number.isFinite(timeValue) ? timeValue : null,
      avgMs,
      minMs,
      maxMs,
      packetLoss,
      probes: probeCount
    };
  } catch (error) {
    return { ok: false, error: error.message || 'ICMP request failed.' };
  }
}

// Fast ICMP ping for real-time monitoring (1 probe, 1s timeout)
async function fetchFastIcmpSnapshot(targetIp) {
  try {
    const result = await ping.promise.probe(targetIp, {
      timeout: 1,
      min_reply: 1
    });

    const timeValue = Number(result.time);
    return {
      ok: true,
      alive: Boolean(result.alive),
      timeMs: Number.isFinite(timeValue) ? timeValue : null,
      packetLoss: result.alive ? 0 : 100
    };
  } catch (error) {
    return { ok: false, error: error.message || 'Fast ICMP failed.', alive: false };
  }
}

// Read the system ARP table via CLI
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

// Parse a single ARP entry for a target IP
function parseArpEntry(output, targetIp) {
  const pattern = new RegExp(`^\\s*${escapeRegex(targetIp)}\\s+([0-9a-f:-]{11,})\\s+\\w+`, 'im');
  const match = output.match(pattern);
  if (!match) return null;
  return { ip: targetIp, mac: match[1].toLowerCase() };
}

// Parse all ARP entries from CLI output
function parseArpEntries(output) {
  const entries = [];
  const pattern = /^\s*([0-9.]+)\s+([0-9a-f:-]{11,})\s+\w+/gim;
  let match;

  while ((match = pattern.exec(output)) !== null) {
    const ip = match[1];
    const mac = match[2].toLowerCase();
    if (isValidIp(ip) && !isBlacklistedIp(ip)) {
      entries.push({ ip, mac });
    }
  }

  return entries;
}

// Read ARP and extract the entry for target IP
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

// Run async workers with concurrency limits
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

// ICMP ping wrapper for discovery scans
async function pingHost(ip) {
  try {
    const result = await ping.promise.probe(ip, {
      timeout: DISCOVERY_PING_TIMEOUT_SEC,
      min_reply: 1
    });
    const timeValue = Number(result.time);
    return {
      alive: Boolean(result.alive),
      timeMs: Number.isFinite(timeValue) ? timeValue : null
    };
  } catch (error) {
    return { alive: false, timeMs: null };
  }
}

// Discover devices in the target subnet
async function discoverNetworkDevices(cidrOverride) {
  const cidr = cidrOverride || resolveDiscoveryCidr();
  if (!cidr) {
    return { ok: false, error: 'Unable to resolve discovery subnet.' };
  }

  const hosts = expandCidr(cidr, DISCOVERY_MAX_HOSTS);
  if (!hosts.length) {
    return { ok: false, error: 'Subnet too large or no hosts resolved.' };
  }

  const aliveMap = new Map();
  await runWithConcurrency(hosts, DISCOVERY_CONCURRENCY, async (ip) => {
    const res = await pingHost(ip);
    if (res.alive) aliveMap.set(ip, res.timeMs);
    return res.alive;
  });

  const table = await readArpTable();
  if (!table.ok) {
    return { ok: false, error: table.error || 'Unable to read ARP table.' };
  }

  const arpEntries = parseArpEntries(table.output);
  const arpIpSet = new Set(arpEntries.map(e => e.ip));
  // Add hosts that responded to ping but weren't captured in the ARP table
  // (can happen if ARP cache expired, AP isolation partially blocks, or parsing missed them)
  for (const [ip, timeMs] of aliveMap) {
    if (!arpIpSet.has(ip)) {
      arpEntries.push({ ip, mac: '', alive: true, timeMs });
    }
  }

  const entries = arpEntries.map(entry => ({
    ...entry,
    alive: aliveMap.has(entry.ip),
    timeMs: aliveMap.has(entry.ip) ? aliveMap.get(entry.ip) : null
  }));

  // Look up the router's DeviceID so we can persist DEVICE_CONNECTION links
  const routerIp = await detectDefaultGateway();
  let routerDeviceId = null;
  if (routerIp) {
    const [[routerRow]] = await dbPool.execute(
      'SELECT DeviceID FROM DEVICE WHERE IPAddress = ? LIMIT 1',
      [routerIp]
    );
    routerDeviceId = routerRow ? routerRow.DeviceID : null;
  }

  // Discovery state update — 3-phase process:
  //   Phase 1: Upsert every device found in this scan and record its DeviceID.
  //   Phase 2: Mark router→endpoint connections as inactive if the endpoint
  //            was NOT seen in this scan (it may have left the network).
  //   Phase 3: Mark those same endpoint devices as Offline in the DEVICE table.
  // Separating connection state from device state ensures the topology map
  // reflects both the link loss and the device status independently.
  const seenEndpointIds = [];
  for (const entry of entries) {
    const deviceId = await upsertDiscoveredDevice(entry);
    if (deviceId && routerDeviceId && deviceId !== routerDeviceId) {
      await upsertDeviceConnection(routerDeviceId, deviceId);
      seenEndpointIds.push(deviceId);
    }
  }

  // Fetch previously-active endpoint IDs before marking any stale
  let previousActiveIds = [];
  if (routerDeviceId) {
    const [activeRows] = await dbPool.execute(
      'SELECT TargetDeviceID FROM DEVICE_CONNECTION WHERE SourceDeviceID = ? AND IsActive = 1',
      [routerDeviceId]
    );
    previousActiveIds = activeRows.map(r => r.TargetDeviceID);
  }

  // Mark router→endpoint connections not seen in this scan as inactive
  if (routerDeviceId) {
    if (seenEndpointIds.length > 0) {
      const placeholders = seenEndpointIds.map(() => '?').join(', ');
      await dbPool.execute(
        `UPDATE DEVICE_CONNECTION SET IsActive = 0 WHERE SourceDeviceID = ? AND TargetDeviceID NOT IN (${placeholders}) AND IsActive = 1`,
        [routerDeviceId, ...seenEndpointIds]
      );
    } else {
      await dbPool.execute(
        'UPDATE DEVICE_CONNECTION SET IsActive = 0 WHERE SourceDeviceID = ? AND IsActive = 1',
        [routerDeviceId]
      );
    }
  }

  // Mark devices that dropped off the ARP table as Offline in DEVICE table
  const staleIds = previousActiveIds.filter(id => !seenEndpointIds.includes(id));
  if (staleIds.length > 0) {
    const ph = staleIds.map(() => '?').join(', ');
    await dbPool.execute(
      `UPDATE DEVICE SET Status = 'Offline' WHERE DeviceID IN (${ph})`,
      staleIds
    );
  }

  // Push fresh device list to all connected frontends
  await emitDevicesUpdate();

  return {
    ok: true,
    cidr,
    discovered: entries,
    aliveCount: aliveMap.size
  };
}

// ================== Automated Monitoring Scheduler ==================
// Scheduler state to prevent overlapping scans
let scheduledRouterScanTimer = null;
let scheduledDiscoveryScanTimer = null;
let scheduledDevicePingTimer = null;
let continuousPingTimer = null;
let scheduledRouterInFlight = false;
let scheduledDiscoveryInFlight = false;
let scheduledDevicePingInFlight = false;
let continuousPingInFlight = false;
let scanningEnabled = SCHEDULED_SCANS_ENABLED;
const CONTINUOUS_PING_INTERVAL_MS = 2000;
const DEVICE_PING_LOG_INTERVAL_MS = Number(process.env.DEVICE_PING_LOG_INTERVAL_MS || ROUTER_SCAN_INTERVAL_MS);

// ── Alert staging thresholds ────────────────────────────────────────────────
// All counts are consecutive ping failures/successes; each ping = 2 s.
//
// Downtime pipeline:
//   Stage 0 → Stage 1 (Silent)   : OFFLINE_THRESHOLD  failures  →  ~6 s   — internal only
//   Stage 1 → Stage 2 (Warning)  : OFFLINE_WARN       failures  →  ~30 s  — socket + DB, no email
//   Stage 2 → Stage 3 (Critical) : OFFLINE_CRIT       failures  →  ~5 min — socket + DB + email
//   Fast-track to Critical       : OFFLINE_FREQ_COUNT incidents in OFFLINE_FREQ_WINDOW_MS
//
// Latency pipeline:
//   Warning  : LATENCY_WARN_PINGS consecutive ≥ LATENCY_WARN_MS             → ~10 s  — socket + DB
//   Critical : LATENCY_CRIT_PINGS consecutive  OR  any ping ≥ LATENCY_CRIT_MS → ~60 s  — socket + DB + email
const OFFLINE_THRESHOLD     = 3;               // ~6 s  — internal state change
const OFFLINE_WARN          = 15;              // ~30 s — Warning alert
const OFFLINE_CRIT          = 150;             // ~5 min — Critical alert + email
const OFFLINE_FREQ_WINDOW_MS = 30 * 60 * 1000; // 30-minute window for frequency check
const OFFLINE_FREQ_COUNT    = 3;               // incidents in window → immediate Critical
const RECOVERY_THRESHOLD    = 2;               // consecutive successes before declaring recovered
const LATENCY_WARN_MS       = 200;             // ms threshold for high-latency watch
const LATENCY_CRIT_MS       = 500;             // ms threshold for immediate Critical
const LATENCY_WARN_PINGS    = 5;               // ~10 s consecutive → Warning
const LATENCY_CRIT_PINGS    = 30;              // ~60 s consecutive → Critical

const realtimeDeviceStates = new Map(); // In-memory map for real-time alerting

function setScanningEnabled(enabled) {
  scanningEnabled = Boolean(enabled);
  if (scanningEnabled) {
    startScheduledScans();
  } else {
    stopScheduledScans();
  }
  return scanningEnabled;
}

// Resolve the default router IP for scheduled scans (detects live gateway)
async function resolveRouterTarget() {
  const ip = await detectDefaultGateway();
  return isValidIp(ip) ? ip : null;
}

// Run a scheduled router scan using ICMP, ARP, and SNMP
async function runScheduledRouterScan() {
  if (!scanningEnabled) return;
  // Avoid overlapping router scans
  if (scheduledRouterInFlight) return;
  scheduledRouterInFlight = true;

  try {
    // Resolve the router IP target
    const target = await resolveRouterTarget();
    if (!target) {
      console.warn('Scheduled router scan skipped: invalid router IP.');
      return;
    }

    // Collect ICMP, ARP, and SNMP (unavailable pa snmp sa IC building)
    const icmp = await fetchIcmpSnapshot(target);
    const arp = await fetchArpSnapshot(target);
    const snmpSnapshot = await fetchSnmpSnapshot(target);

    // Build the scan
    const snapshot = {
      target,
      scannedAt: new Date().toISOString(),
      icmp,
      arp,
      snmp: snmpSnapshot
    };

    // Persist the scan and broadcast topology updates
    await upsertDeviceSnapshot(snapshot);
    emitTopologyUpdate('router-scan-scheduled');
  } catch (error) {
    console.error('Scheduled router scan error:', error);
  } finally {
    scheduledRouterInFlight = false;
  }
}

// Run a scheduled network discovery scan using ICMP and ARP
async function runScheduledDiscoveryScan() {
  if (!scanningEnabled) return;
  // Avoid overlapping discovery scans
  if (scheduledDiscoveryInFlight) return;
  scheduledDiscoveryInFlight = true;

  try {
    // Execute discovery across the resolved subnet
    const result = await discoverNetworkDevices();
    if (!result.ok) {
      console.warn('Scheduled discovery scan failed:', result.error || 'Unknown error');
      return;
    }

    // Broadcast the discovery update to the topology view
    emitTopologyUpdate('network-discovery-scheduled', result.discovered);
  } catch (error) {
    console.error('Scheduled discovery scan error:', error);
  } finally {
    scheduledDiscoveryInFlight = false;
  }
}

// Run a continuous fast ping sweep to populate real-time monitoring graphs
async function runContinuousPingSweep() {
  if (!scanningEnabled) return;
  if (continuousPingInFlight) return;
  continuousPingInFlight = true;

  try {
    const [rows] = await dbPool.execute('SELECT DeviceID, IPAddress, DeviceName, Status FROM DEVICE');
    if (!rows || rows.length === 0) return;

    // Three-stage alert pipeline — prevents false TSSU notifications from transient outages:
    //
    //   Stage 1 (Silent, ~6 s)   — device declared Offline internally; no external alert.
    //                               Handles brief power blips, single packet drops, reboots.
    //   Stage 2 (Warning, ~30 s) — outage confirmed as non-transient; dashboard notified,
    //                               TSSU is NOT yet emailed. Staff can see it but no action required.
    //   Stage 3 (Critical, 5 min or 3× in 30 min) — email sent to TSSU. Downstream impact
    //                               is assessed and included in the message.
    //
    //   Latency follows the same philosophy: a single spike is ignored; sustained degradation
    //   (≥10 s) warns the dashboard; prolonged (≥60 s) or severe (≥500 ms) emails TSSU.
    //
    //   Recovery is silent if the incident never left Stage 1. If Stage 2+ was reached,
    //   recovery includes how long the device was offline.
    const results = await runWithConcurrency(rows, 20, async (device) => {
      const target = device.IPAddress;
      if (!isValidIp(target)) return null;
      if (isBlacklistedIp(target)) return null;

      const icmp = await fetchFastIcmpSnapshot(target);
      const alive = icmp.ok && icmp.alive;
      const latency = icmp.ok ? icmp.timeMs : null;

      // Get or initialize per-device alert state
      const prevState = realtimeDeviceStates.get(device.DeviceID) || {
        status: device.Status || 'Online',
        latency: null,
        failCount: 0,
        successCount: 0,
        alertStage: 0,        // 0=none 1=silent 2=warned 3=critical
        highLatencyCount: 0,  // consecutive pings above LATENCY_WARN_MS
        latencyAlertStage: 0, // 0=none 1=warned 2=critical
        incidentLog: [],      // timestamps of recent downtime starts
        downtimeStart: null   // when the current outage began
      };

      let failCount         = prevState.failCount         || 0;
      let successCount      = prevState.successCount      || 0;
      let confirmedStatus   = prevState.status            || 'Online';
      let alertStage        = prevState.alertStage        || 0;
      let highLatencyCount  = prevState.highLatencyCount  || 0;
      let latencyAlertStage = prevState.latencyAlertStage || 0;
      let incidentLog       = prevState.incidentLog       || [];
      let downtimeStart     = prevState.downtimeStart     || null;

      const now = Date.now();

      if (alive) {
        failCount    = 0;
        successCount += 1;

        // ── Latency staging (only while confirmed online) ───────────────────
        if (confirmedStatus === 'Online' && latency !== null) {
          if (latency >= LATENCY_WARN_MS) {
            highLatencyCount += 1;

            // Warning: sustained high latency (~10 s)
            if (highLatencyCount === LATENCY_WARN_PINGS && latencyAlertStage < 1) {
              latencyAlertStage = 1;
              const warnLatMsg = `Sustained high latency (${latency} ms) on ${device.DeviceName || target} — persisting for ~10 seconds.`;
              io.emit('alert:new', {
                type: 'abnormal', severity: 'warning', stage: 'warn',
                message: warnLatMsg, deviceId: device.DeviceID,
                deviceName: device.DeviceName || target, time: new Date().toISOString()
              });
              insertAlert('abnormal', 'warning', warnLatMsg, device.DeviceID);
            }

            // Critical: very long (~60 s) OR severe single spike (≥500 ms)
            if ((highLatencyCount >= LATENCY_CRIT_PINGS || latency >= LATENCY_CRIT_MS) && latencyAlertStage < 2) {
              latencyAlertStage = 2;
              const critLatMsg = latency >= LATENCY_CRIT_MS
                ? `Critical latency (${latency} ms) on ${device.DeviceName || target} — exceeds acceptable threshold.`
                : `Prolonged high latency on ${device.DeviceName || target} (${latency} ms) — degraded for ~1 minute.`;
              io.emit('alert:new', {
                type: 'abnormal', severity: 'danger', stage: 'critical',
                message: critLatMsg, deviceId: device.DeviceID,
                deviceName: device.DeviceName || target, time: new Date().toISOString()
              });
              insertAlert('abnormal', 'danger', critLatMsg, device.DeviceID);
              sendAlertEmail('abnormal', 'danger', critLatMsg, device.DeviceName || target, device.DeviceID);
            }
          } else {
            // Latency back to normal — reset counters
            highLatencyCount  = 0;
            latencyAlertStage = 0;
          }
        }

        // ── Recovery from offline ───────────────────────────────────────────
        if (confirmedStatus !== 'Online' && successCount >= RECOVERY_THRESHOLD) {
          const prevAlertStage = alertStage;
          confirmedStatus   = 'Online';
          alertStage        = 0;
          highLatencyCount  = 0;
          latencyAlertStage = 0;

          // Only notify if the incident reached Warning or Critical (Stage ≥ 2);
          // silent incidents (Stage 1) need no recovery message.
          if (prevAlertStage >= 2) {
            const offlineSec = downtimeStart ? Math.round((now - downtimeStart) / 1000) : null;
            const durationStr = offlineSec !== null
              ? (offlineSec >= 60
                  ? ` (offline for ${Math.floor(offlineSec / 60)}m ${offlineSec % 60}s)`
                  : ` (offline for ${offlineSec}s)`)
              : '';
            const recoveryMsg = `Device ${device.DeviceName || target} is back online${durationStr}.`;
            io.emit('alert:new', {
              type: 'recovery', severity: 'success', stage: 'resolved',
              message: recoveryMsg, deviceId: device.DeviceID,
              deviceName: device.DeviceName || target, time: new Date().toISOString()
            });
            insertAlert('recovery', 'success', recoveryMsg, device.DeviceID);
            sendAlertEmail('recovery', 'success', recoveryMsg, device.DeviceName || target, device.DeviceID);
          }
          downtimeStart = null;
        }
      } else {
        successCount = 0;
        failCount   += 1;

        // Purge incident history outside the frequency window to keep memory bounded
        incidentLog = incidentLog.filter(t => now - t < OFFLINE_FREQ_WINDOW_MS);

        // ── Stage 1 — Silent (~6 s): internal state change, no external alert ──
        if (alertStage === 0 && failCount >= OFFLINE_THRESHOLD) {
          alertStage      = 1;
          confirmedStatus = 'Offline';
          downtimeStart   = now;
          incidentLog     = [...incidentLog, now]; // record this incident start
        }

        // ── Stage 2 — Warning (~30 s): dashboard alert, TSSU not emailed ──────
        if (alertStage === 1 && failCount >= OFFLINE_WARN) {
          alertStage = 2;
          const warnMsg = `Device ${device.DeviceName || target} has been offline for ~30 seconds.`;
          io.emit('alert:new', {
            type: 'downtime', severity: 'warning', stage: 'warn',
            message: warnMsg, deviceId: device.DeviceID,
            deviceName: device.DeviceName || target, time: new Date().toISOString()
          });
          insertAlert('downtime', 'warning', warnMsg, device.DeviceID);
        }

        // ── Stage 3 — Critical (5 min or repeat flapping): email TSSU ─────────
        if (alertStage === 2) {
          const isLongOutage = failCount >= OFFLINE_CRIT;
          const isFrequent   = incidentLog.length >= OFFLINE_FREQ_COUNT;

          if (isLongOutage || isFrequent) {
            alertStage = 3;

            let critMsg = isFrequent
              ? `Device ${device.DeviceName || target} has gone offline ${incidentLog.length} times in the last 30 minutes — possible hardware or connectivity instability.`
              : `Device ${device.DeviceName || target} has been offline for 5+ minutes. Immediate attention required.`;

            // Assess downstream impact and append to message
            try {
              const [connRows] = await dbPool.execute(
                'SELECT COUNT(*) AS downstreamCount FROM DEVICE_CONNECTION WHERE SourceDeviceID = ? AND IsActive = 1',
                [device.DeviceID]
              );
              const count = Number(connRows[0].downstreamCount);
              if (count > 0) critMsg += ` ${count} downstream device(s) may be affected.`;
            } catch (err) {
              console.error('Impact assessment error:', err);
            }

            io.emit('alert:new', {
              type: 'downtime', severity: 'danger', stage: 'critical',
              message: critMsg, deviceId: device.DeviceID,
              deviceName: device.DeviceName || target, time: new Date().toISOString()
            });
            insertAlert('downtime', 'danger', critMsg, device.DeviceID);
            sendAlertEmail('downtime', 'danger', critMsg, device.DeviceName || target, device.DeviceID);
          }
        }
      }

      realtimeDeviceStates.set(device.DeviceID, {
        status: confirmedStatus,
        latency,
        failCount,
        successCount,
        alertStage,
        highLatencyCount,
        latencyAlertStage,
        incidentLog,
        downtimeStart
      });

      return {
        deviceId: device.DeviceID,
        ip: target,
        name: device.DeviceName,
        alive,
        status: confirmedStatus,
        latencyMs: latency,
        packetLoss: icmp.ok ? icmp.packetLoss : null,
        time: new Date().toISOString()
      };
    });

    const validResults = results.filter(r => r !== null);
    io.emit('devices:ping_stream', validResults);
  } catch (error) {
    console.error('Continuous ping sweep error:', error);
  } finally {
    continuousPingInFlight = false;
  }
}

// Scheduled device ping sweep — logs latency to DB for all connected devices
// Runs at the same interval as the router scan so every device gets a DB entry
async function runScheduledDevicePingSweep() {
  if (!scanningEnabled) return;
  if (scheduledDevicePingInFlight) return;
  scheduledDevicePingInFlight = true;

  try {
    const [rows] = await dbPool.execute('SELECT DeviceID, IPAddress, DeviceName, Status FROM DEVICE');
    if (!rows || rows.length === 0) return;

    // Skip the router IP since the router scan already logs it
    const routerTarget = await resolveRouterTarget();

    await runWithConcurrency(rows, 20, async (device) => {
      const target = device.IPAddress;
      if (!isValidIp(target)) return;
      if (isBlacklistedIp(target)) return;
      if (routerTarget && target === routerTarget) return; // already logged by router scan

      const icmp = await fetchFastIcmpSnapshot(target);
      const alive = icmp.ok && icmp.alive;
      const now = new Date();
      const lastSeen = alive ? now : null;

      // Use the debounced status from real-time state if available,
      // otherwise fall back to the raw ping result
      const realtimeState = realtimeDeviceStates.get(device.DeviceID);
      const status = realtimeState ? realtimeState.status : (alive ? 'Online' : 'Offline');

      // Build a snapshot object matching the shape that insertDeviceLog expects
      const snapshot = {
        icmp: { ok: icmp.ok, alive, timeMs: icmp.ok ? icmp.timeMs : null },
        arp: { ok: false },
        snmp: { ok: false }
      };

      // Update DEVICE status and LastSeen
      if (lastSeen) {
        await dbPool.execute(
          'UPDATE DEVICE SET Status = ?, LastSeen = ? WHERE DeviceID = ?',
          [status, lastSeen, device.DeviceID]
        );
      } else {
        await dbPool.execute(
          'UPDATE DEVICE SET Status = ? WHERE DeviceID = ?',
          [status, device.DeviceID]
        );
      }

      // Log to DEVICE_LOG with latency
      await insertDeviceLog(device.DeviceID, snapshot, status, target);
    });
  } catch (error) {
    console.error('Scheduled device ping sweep error:', error);
  } finally {
    scheduledDevicePingInFlight = false;
  }
}

// Start the automated monitoring schedules
function startScheduledScans() {
  // Stop existing timers before restarting
  stopScheduledScans();

  if (!scanningEnabled) {
    console.log('Scheduled scans disabled by settings.');
    return;
  }

  // Kick off immediate scans for initial data
  runScheduledRouterScan();
  runScheduledDiscoveryScan();

  // Schedule periodic router scans
  scheduledRouterScanTimer = setInterval(runScheduledRouterScan, ROUTER_SCAN_INTERVAL_MS);

  // Schedule periodic discovery scans
  scheduledDiscoveryScanTimer = setInterval(runScheduledDiscoveryScan, DISCOVERY_SCAN_INTERVAL_MS);

  // Schedule device ping sweep (logs latency to DB at the same rate as router)
  scheduledDevicePingTimer = setInterval(runScheduledDevicePingSweep, DEVICE_PING_LOG_INTERVAL_MS);

  // Schedule continuous ping stream (real-time UI, no DB log)
  continuousPingTimer = setInterval(runContinuousPingSweep, CONTINUOUS_PING_INTERVAL_MS);
}

// Stop the automated monitoring schedules
function stopScheduledScans() {
  if (scheduledRouterScanTimer) {
    clearInterval(scheduledRouterScanTimer);
    scheduledRouterScanTimer = null;
  }

  if (scheduledDiscoveryScanTimer) {
    clearInterval(scheduledDiscoveryScanTimer);
    scheduledDiscoveryScanTimer = null;
  }

  if (scheduledDevicePingTimer) {
    clearInterval(scheduledDevicePingTimer);
    scheduledDevicePingTimer = null;
  }

  if (continuousPingTimer) {
    clearInterval(continuousPingTimer);
    continuousPingTimer = null;
  }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Return the authenticated session user
app.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  return res.json(req.session.user);
});

// Rate limiter: 5 attempts per 15 minutes for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' }
});

// Register a new user account
app.post('/api/auth/register', authLimiter, async (req, res) => {
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

    const passwordHash = await bcrypt.hash(password, 12);
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
    logActivity(req, 'user_registered', `Email: ${safeEmail}`);
    return res.json(sessionUser);
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Unable to register right now.' });
  }
});

// Authenticate a user and create a session
app.post('/api/auth/login', authLimiter, async (req, res) => {
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
    logActivity(req, 'login', `Email: ${safeEmail}`);
    return res.json(sessionUser);
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Unable to sign in right now.' });
  }
});

// End the current session
app.post('/api/auth/logout', (req, res) => {
  if (!req.session) {
    return res.json({ ok: true });
  }

  logActivity(req, 'logout', null);
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Unable to log out.' });
    }

    res.clearCookie('connect.sid');
    return res.json({ ok: true });
  });
});

// List devices for dashboard and inventory views
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
// Alert history — last 100 alerts joined with device name and resolver
app.get('/api/alerts', requireAuth, async (req, res) => {
  try {
    const [rows] = await dbPool.execute(
      `SELECT a.AlertID, a.AlertType, a.Severity, a.Issue, a.Timestamp,
              a.IsResolved, a.ResolvedAt, a.ResolutionNotes,
              d.DeviceName, d.IPAddress,
              u.FullName AS ResolvedBy
       FROM ALERT a
       LEFT JOIN DEVICE d ON d.DeviceID = a.DeviceID
       LEFT JOIN USERS u ON u.UserID = a.ResolvedByUserID
       ORDER BY a.Timestamp DESC
       LIMIT 100`
    );
    return res.json(rows.map(r => ({
      id: r.AlertID,
      type: r.AlertType,
      severity: mapSeverityFromDb(r.Severity),
      device: r.DeviceName || r.IPAddress || 'Unknown',
      issue: r.Issue,
      time: r.Timestamp,
      resolved: Boolean(r.IsResolved),
      resolvedAt: r.ResolvedAt || null,
      resolvedBy: r.ResolvedBy || null,
      resolutionNotes: r.ResolutionNotes || null
    })));
  } catch (error) {
    console.error('Alerts load error:', error);
    return res.status(500).json({ error: 'Unable to load alerts.' });
  }
});

// Mark an alert as resolved with optional maintenance notes
app.put('/api/alerts/:id/resolve', requireAuth, async (req, res) => {
  const alertId = parseInt(req.params.id, 10);
  if (!Number.isFinite(alertId) || alertId < 1) {
    return res.status(400).json({ error: 'Invalid alert ID.' });
  }
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim().slice(0, 2000) : null;
  try {
    const [result] = await dbPool.execute(
      `UPDATE ALERT SET IsResolved = 1, ResolvedByUserID = ?, ResolvedAt = NOW(), ResolutionNotes = ?
       WHERE AlertID = ? AND IsResolved = 0`,
      [req.session.user.userId, notes || null, alertId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Alert not found or already resolved.' });
    }
    const [rows] = await dbPool.execute(
      `SELECT a.ResolvedAt, a.ResolutionNotes, u.FullName AS ResolvedBy
       FROM ALERT a LEFT JOIN USERS u ON u.UserID = a.ResolvedByUserID
       WHERE a.AlertID = ?`,
      [alertId]
    );
    const r = rows[0];
    logActivity(req, 'alert_resolved', `AlertID: ${alertId}${notes ? ` — ${notes.slice(0, 80)}` : ''}`);
    return res.json({ ok: true, resolved: true, resolvedAt: r.ResolvedAt, resolvedBy: r.ResolvedBy, resolutionNotes: r.ResolutionNotes || null });
  } catch (error) {
    console.error('Alert resolve error:', error);
    return res.status(500).json({ error: 'Unable to resolve alert.' });
  }
});

// Email alert toggle — read current state (Admin only)
app.get('/api/settings/email-alerts', requireAuth, requireRole('Admin'), (req, res) => {
  res.json({ emailAlertsEnabled, smtpConfigured: Boolean(mailer) });
});

// Email alert toggle — update state at runtime without restart (Admin only)
app.post('/api/settings/email-alerts', requireAuth, requireRole('Admin'), (req, res) => {
  if (typeof req.body.enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean.' });
  }
  emailAlertsEnabled = req.body.enabled;
  logActivity(req, 'settings_changed', `emailAlerts: ${req.body.enabled}`);
  return res.json({ ok: true, emailAlertsEnabled });
});

// Update a device details (name, type, building, floor, room)

// Delete a single device by ID (Admin only)
app.delete('/api/devices/:deviceId', requireAuth, requireRole('Admin'), async (req, res) => {
  const deviceId = Number(req.params.deviceId);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return res.status(400).json({ error: 'Invalid device ID.' });
  }

  try {
    const [deviceRows] = await dbPool.execute('SELECT DeviceName, IPAddress FROM DEVICE WHERE DeviceID = ? LIMIT 1', [deviceId]);
    const deviceLabel = deviceRows[0] ? `${deviceRows[0].DeviceName} (${deviceRows[0].IPAddress})` : `ID:${deviceId}`;

    // ON DELETE CASCADE on fk_log_device, fk_connection_source/target, fk_alert_device
    // handles child-row cleanup automatically when DEVICE is deleted.
    const [result] = await dbPool.execute('DELETE FROM DEVICE WHERE DeviceID = ?', [deviceId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Device not found.' });
    }
    logActivity(req, 'device_deleted', deviceLabel);
    return res.json({ ok: true, message: 'Device deleted.' });
  } catch (error) {
    console.error('Device delete error:', error);
    return res.status(500).json({ error: 'Unable to delete device.' });
  }
});

// Bulk-remove all devices whose IPs match the blacklist (multicast IPs from Windows ARP table)
app.post('/api/devices/cleanup-blacklisted', requireAuth, async (req, res) => {
  try {
    const [allDevices] = await dbPool.execute('SELECT DeviceID, IPAddress FROM DEVICE');
    const toDelete = allDevices.filter(d => isBlacklistedIp(d.IPAddress));

    for (const device of toDelete) {
      await dbPool.execute('DELETE FROM DEVICE_LOG WHERE DeviceID = ?', [device.DeviceID]);
      await dbPool.execute('DELETE FROM DEVICE WHERE DeviceID = ?', [device.DeviceID]);
    }

    console.log(`Blacklist cleanup: removed ${toDelete.length} device(s).`);
    return res.json({
      ok: true,
      removedCount: toDelete.length,
      removedIps: toDelete.map(d => d.IPAddress)
    });
  } catch (error) {
    console.error('Blacklist cleanup error:', error);
    return res.status(500).json({ error: 'Unable to clean up blacklisted devices.' });
  }
});

// Update a device details (name, type, building, floor, room)
app.put('/api/devices/:deviceId/location', requireAuth, async (req, res) => {
  const deviceId = Number(req.params.deviceId);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return res.status(400).json({ error: 'Invalid device ID.' });
  }

  const nameRaw = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const typeRaw = typeof req.body?.type === 'string' ? req.body.type.trim() : '';
  const buildingRaw = typeof req.body?.building === 'string' ? req.body.building.trim() : '';
  const floorRaw = typeof req.body?.floor === 'string' ? req.body.floor.trim() : '';
  const roomRaw = typeof req.body?.room === 'string' ? req.body.room.trim() : '';

  if (!nameRaw || !typeRaw) {
    return res.status(400).json({ error: 'Device name and type are required.' });
  }

  if (nameRaw.length > 120) {
    return res.status(400).json({ error: 'Device name is too long.' });
  }

  if (typeRaw.length > 60) {
    return res.status(400).json({ error: 'Device type is too long.' });
  }

  if (buildingRaw.length > 120) {
    return res.status(400).json({ error: 'Building name is too long.' });
  }

  if (floorRaw.length > 50) {
    return res.status(400).json({ error: 'Floor value is too long.' });
  }

  if (roomRaw.length > 80) {
    return res.status(400).json({ error: 'Room/area value is too long.' });
  }

  try {
    const [deviceRows] = await dbPool.execute(
      'SELECT DeviceID FROM DEVICE WHERE DeviceID = ? LIMIT 1',
      [deviceId]
    );

    if (!Array.isArray(deviceRows) || deviceRows.length === 0) {
      return res.status(404).json({ error: 'Device not found.' });
    }

    const roomValue = roomRaw ? roomRaw : null;
    const locationId = await findOrCreateLocationId(buildingRaw, floorRaw, roomValue);

    await dbPool.execute(
      'UPDATE DEVICE SET DeviceName = ?, DeviceType = ?, LocationID = ? WHERE DeviceID = ?',
      [nameRaw, typeRaw, locationId, deviceId]
    );

    logActivity(req, 'device_updated', `DeviceID: ${deviceId}, Name: ${nameRaw}`);
    return res.json({
      locationId,
      location: formatLocationLabel({
        BuildingName: buildingRaw,
        Floor: floorRaw,
        Room: roomValue
      }),
      name: nameRaw,
      type: typeRaw,
      building: buildingRaw,
      floor: floorRaw,
      room: roomValue
    });
  } catch (error) {
    console.error('Device details update error:', error);
    return res.status(500).json({ error: 'Unable to update device details.' });
  }
});

// Live ICMP ping for a specific device (latency and packet loss)
app.get('/api/devices/:deviceId/ping', requireAuth, async (req, res) => {
  const deviceId = Number(req.params.deviceId);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return res.status(400).json({ error: 'Invalid device ID.' });
  }

  try {
    const [rows] = await dbPool.execute(
      'SELECT DeviceID, IPAddress FROM DEVICE WHERE DeviceID = ? LIMIT 1',
      [deviceId]
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ error: 'Device not found.' });
    }

    const targetIp = rows[0].IPAddress;
    if (!isValidIp(targetIp)) {
      return res.status(400).json({ error: 'Device has no valid IP address.' });
    }

    const icmp = await fetchIcmpSnapshot(targetIp);
    return res.json({
      deviceId,
      ip: targetIp,
      alive: icmp.ok && icmp.alive,
      latencyMs: icmp.ok ? icmp.timeMs : null,
      avgMs: icmp.ok ? icmp.avgMs : null,
      minMs: icmp.ok ? icmp.minMs : null,
      maxMs: icmp.ok ? icmp.maxMs : null,
      packetLoss: icmp.ok ? icmp.packetLoss : null,
      probes: icmp.ok ? icmp.probes : null,
      error: icmp.ok ? null : (icmp.error || 'ICMP probe failed.')
    });
  } catch (error) {
    console.error('Device ping error:', error);
    return res.status(500).json({ error: 'Unable to ping device right now.' });
  }
});

// Live ICMP ping by IP address (for devices without a DB ID)
app.get('/api/ping', requireAuth, async (req, res) => {
  const targetIp = typeof req.query.target === 'string' ? req.query.target.trim() : '';
  if (!isValidIp(targetIp)) {
    return res.status(400).json({ error: 'Invalid target IP address.' });
  }

  try {
    const icmp = await fetchIcmpSnapshot(targetIp);
    return res.json({
      ip: targetIp,
      alive: icmp.ok && icmp.alive,
      latencyMs: icmp.ok ? icmp.timeMs : null,
      avgMs: icmp.ok ? icmp.avgMs : null,
      minMs: icmp.ok ? icmp.minMs : null,
      maxMs: icmp.ok ? icmp.maxMs : null,
      packetLoss: icmp.ok ? icmp.packetLoss : null,
      probes: icmp.ok ? icmp.probes : null,
      error: icmp.ok ? null : (icmp.error || 'ICMP probe failed.')
    });
  } catch (error) {
    console.error('Ping error:', error);
    return res.status(500).json({ error: 'Unable to ping target right now.' });
  }
});

// Return topology for the map view
app.get('/api/topology', requireAuth, async (req, res) => {
  try {
    const payload = await fetchTopologyPayload();
    return res.json(payload);
  } catch (error) {
    console.error('Topology load error:', error);
    return res.status(500).json({ error: 'Unable to load topology right now.' });
  }
});

// Get current scanning status (Admin only)
app.get('/api/settings/scanning', requireAuth, requireRole('Admin'), (req, res) => {
  return res.json({ enabled: scanningEnabled });
});

// Update scanning status (Admin only)
app.put('/api/settings/scanning', requireAuth, requireRole('Admin'), (req, res) => {
  const parsed = parseRequiredBoolean(req.body?.enabled);
  if (parsed === null) {
    return res.status(400).json({ error: 'Enabled must be a boolean.' });
  }

  const enabled = setScanningEnabled(parsed);
  logActivity(req, 'settings_changed', `scanning: ${enabled}`);
  return res.json({ enabled });
});

// Trigger an on-demand discovery scan (Admin only)
app.post('/api/monitor/discover', requireAuth, requireRole('Admin'), async (req, res) => {
  if (!scanningEnabled) {
    return res.status(409).json({ error: 'Scanning is disabled in settings.' });
  }
  const cidrOverride = typeof req.body?.cidr === 'string' ? req.body.cidr.trim() : '';

  try {
    const result = await discoverNetworkDevices(cidrOverride || undefined);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || 'Discovery failed.' });
    }

    logActivity(req, 'discovery_scan', `Found: ${result.discovered ? result.discovered.length : 0} devices`);
    emitTopologyUpdate('network-discovery', result.discovered);
    return res.json(result);
  } catch (error) {
    console.error('Discovery error:', error);
    return res.status(500).json({ error: 'Unable to scan network right now.' });
  }
});

// Trigger an on-demand router scan
app.get('/api/monitor/router', requireAuth, async (req, res) => {
  if (!scanningEnabled) {
    return res.status(409).json({ error: 'Scanning is disabled in settings.' });
  }
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

// Diagnostic endpoint — returns the currently detected gateway and matching local interface
app.get('/api/monitor/gateway-info', requireAuth, async (req, res) => {
  try {
    const gatewayIp = await detectDefaultGateway();
    const local = gatewayIp ? getLocalNetworkInfo(gatewayIp) : getLocalNetworkInfo();
    const cidr = local ? buildCidrFromIpNetmask(local.ip, local.netmask) : null;
    return res.json({
      gatewayIp: gatewayIp || null,
      localIp: local ? local.ip : null,
      cidr: cidr || null,
      interfaceName: local ? (local.interfaceName || null) : null
    });
  } catch (error) {
    console.error('gateway-info error:', error);
    return res.status(500).json({ error: 'Unable to resolve gateway info.' });
  }
});

// ================== Analytics Endpoints ==================

// Maps period query param to day count and bucket granularity
function parsePeriod(raw) {
  const map = { '24h': 1, '7d': 7, '30d': 30 };
  const key = typeof raw === 'string' ? raw.trim() : '24h';
  const days = map[key];
  if (!days) return null;
  return { label: key, days };
}

// Analytics overview: counts, avg latency, uptime %, alert breakdown
app.get('/api/analytics/overview', requireAuth, async (req, res) => {
  const period = parsePeriod(req.query.period);
  if (!period) return res.status(400).json({ error: 'Invalid period. Use 24h, 7d, or 30d.' });

  try {
    // Four separate queries are used because they aggregate different tables and scopes:
    //   Query 1 (logStats):    Reads DEVICE_LOG to compute uptime % and avg latency for the period.
    //                          SUM(Status = 'Online') uses MySQL boolean arithmetic — the comparison
    //                          returns 1 (true) or 0 (false), so SUM effectively counts matching rows.
    //   Query 2 (deviceStats): Counts distinct devices that generated logs in the period
    //                          (i.e., actively scanned devices — not just all registered ones).
    //   Query 3 (liveStats):   Live snapshot from the DEVICE table — used as a fallback when
    //                          no historical logs exist yet (e.g., the system just started).
    //   Query 4 (alertRows):   Counts alerts grouped by severity for the doughnut breakdown chart.
    const [[logStats]] = await dbPool.execute(
      `SELECT
         COUNT(*) AS totalLogs,
         SUM(Status = 'Online')  AS onlineLogs,
         AVG(CASE WHEN LatencyMs IS NOT NULL AND Status = 'Online' THEN LatencyMs END) AS avgLatencyMs
       FROM DEVICE_LOG
       WHERE CreatedAt >= NOW() - INTERVAL ? DAY`,
      [period.days]
    );

    const [[deviceStats]] = await dbPool.execute(
      `SELECT COUNT(DISTINCT DeviceID) AS activeDevices
       FROM DEVICE_LOG
       WHERE CreatedAt >= NOW() - INTERVAL ? DAY`,
      [period.days]
    );

    // Live device counts from DEVICE table — always available as a fallback
    const [[liveStats]] = await dbPool.execute(
      `SELECT COUNT(*) AS total, SUM(Status = 'Online') AS online FROM DEVICE`
    );

    const [alertRows] = await dbPool.execute(
      `SELECT Severity, COUNT(*) AS cnt
       FROM ALERT
       WHERE Timestamp >= NOW() - INTERVAL ? DAY
       GROUP BY Severity`,
      [period.days]
    );

    const alertBreakdown = { danger: 0, warning: 0, success: 0 };
    for (const row of alertRows) {
      if (Object.prototype.hasOwnProperty.call(alertBreakdown, row.Severity)) {
        alertBreakdown[row.Severity] = Number(row.cnt);
      }
    }

    const totalLogs = Number(logStats.totalLogs) || 0;
    const onlineLogs = Number(logStats.onlineLogs) || 0;
    const uptimePct = totalLogs > 0 ? Number(((onlineLogs / totalLogs) * 100).toFixed(1)) : null;

    return res.json({
      period: period.label,
      activeDevices: Number(deviceStats.activeDevices) || 0,
      avgLatencyMs: logStats.avgLatencyMs !== null ? Number(Number(logStats.avgLatencyMs).toFixed(2)) : null,
      uptimePct,
      totalLogEntries: totalLogs,
      alertBreakdown,
      currentDevices: Number(liveStats.total) || 0,
      currentOnline: Number(liveStats.online) || 0
    });
  } catch (error) {
    console.error('analytics/overview error:', error);
    return res.status(500).json({ error: 'Unable to load analytics overview.' });
  }
});

// Historical latency time-series, optionally filtered to a single device
app.get('/api/analytics/latency-trend', requireAuth, async (req, res) => {
  const period = parsePeriod(req.query.period);
  if (!period) return res.status(400).json({ error: 'Invalid period. Use 24h, 7d, or 30d.' });

  const rawDeviceId = req.query.deviceId;
  const deviceId = rawDeviceId ? Number(rawDeviceId) : null;
  if (rawDeviceId && (!Number.isInteger(deviceId) || deviceId <= 0)) {
    return res.status(400).json({ error: 'Invalid deviceId.' });
  }

  // Bucket format: hourly for 24h, daily for 7d/30d (validated — not from user input)
  const bucketFmt = period.days === 1 ? '%Y-%m-%d %H:00' : '%Y-%m-%d';

  try {
    const params = [];
    let deviceFilter = '';
    if (deviceId) {
      deviceFilter = 'AND DeviceID = ?';
      params.push(deviceId);
    }
    params.push(period.days);

    // Groups log entries into time buckets (hourly for 24h, daily for 7d/30d) and
    // computes avg/min/max latency per bucket. Only Online entries with a recorded
    // LatencyMs are included — offline pings report null latency and are excluded.
    const [rows] = await dbPool.execute(
      `SELECT
         DATE_FORMAT(CreatedAt, '${bucketFmt}') AS bucket,
         AVG(LatencyMs) AS avgMs,
         MIN(LatencyMs) AS minMs,
         MAX(LatencyMs) AS maxMs,
         COUNT(*) AS sampleCount
       FROM DEVICE_LOG
       WHERE LatencyMs IS NOT NULL
         AND Status = 'Online'
         ${deviceFilter}
         AND CreatedAt >= NOW() - INTERVAL ? DAY
       GROUP BY bucket
       ORDER BY bucket ASC`,
      params
    );

    return res.json({
      period: period.label,
      deviceId: deviceId || null,
      trend: rows.map(r => ({
        bucket: r.bucket,
        avgMs: r.avgMs !== null ? Number(Number(r.avgMs).toFixed(2)) : null,
        minMs: r.minMs !== null ? Number(r.minMs) : null,
        maxMs: r.maxMs !== null ? Number(r.maxMs) : null,
        sampleCount: Number(r.sampleCount)
      }))
    });
  } catch (error) {
    console.error('analytics/latency-trend error:', error);
    return res.status(500).json({ error: 'Unable to load latency trend.' });
  }
});

// Per-device uptime percentage, avg latency, and alert count
app.get('/api/analytics/device-uptime', requireAuth, async (req, res) => {
  const period = parsePeriod(req.query.period);
  if (!period) return res.status(400).json({ error: 'Invalid period. Use 24h, 7d, or 30d.' });

  try {
    // Single query joining DEVICE_LOG, DEVICE, and LOCATION to compute per-device stats.
    // SUM(dl.Status = 'Online') / COUNT(*) gives the online ratio (uptime %) per device,
    // again using MySQL boolean arithmetic where the comparison evaluates to 1 or 0.
    // The correlated subquery counts alerts per device within the same time period,
    // avoiding a separate query and keeping the result set to one row per device.
    // ORDER BY the online ratio ASC so the worst-performing devices appear first in the table.
    // period.days is bound twice: once for the correlated ALERT subquery, once for the main WHERE.
    const [rows] = await dbPool.execute(
      `SELECT
         dl.DeviceID,
         d.DeviceName,
         d.DeviceType,
         d.IPAddress,
         l.BuildingName,
         l.Floor,
         COUNT(*)                                                                         AS totalLogs,
         SUM(dl.Status = 'Online')                                                        AS onlineLogs,
         AVG(CASE WHEN dl.LatencyMs IS NOT NULL AND dl.Status = 'Online' THEN dl.LatencyMs END) AS avgLatencyMs,
         (SELECT COUNT(*) FROM ALERT a
          WHERE a.DeviceID = dl.DeviceID
            AND a.Timestamp >= NOW() - INTERVAL ? DAY)                                   AS alertCount
       FROM DEVICE_LOG dl
       JOIN DEVICE d ON d.DeviceID = dl.DeviceID
       LEFT JOIN LOCATION l ON l.LocationID = d.LocationID
       WHERE dl.CreatedAt >= NOW() - INTERVAL ? DAY
       GROUP BY dl.DeviceID, d.DeviceName, d.DeviceType, d.IPAddress, l.BuildingName, l.Floor
       ORDER BY (SUM(dl.Status = 'Online') / COUNT(*)) ASC`,
      [period.days, period.days]
    );

    return res.json({
      period: period.label,
      devices: rows.map(r => {
        const totalLogs = Number(r.totalLogs) || 0;
        const onlineLogs = Number(r.onlineLogs) || 0;
        const uptimePct = totalLogs > 0 ? Number(((onlineLogs / totalLogs) * 100).toFixed(1)) : null;
        return {
          deviceId: r.DeviceID,
          name: r.DeviceName || r.IPAddress,
          type: r.DeviceType || '',
          ip: r.IPAddress,
          building: r.BuildingName || '',
          floor: r.Floor || '',
          uptimePct,
          avgLatencyMs: r.avgLatencyMs !== null ? Number(Number(r.avgLatencyMs).toFixed(2)) : null,
          alertCount: Number(r.alertCount) || 0,
          totalLogs
        };
      })
    });
  } catch (error) {
    console.error('analytics/device-uptime error:', error);
    return res.status(500).json({ error: 'Unable to load device uptime stats.' });
  }
});

// Alert frequency by type and top 5 most-alerted devices
app.get('/api/analytics/alerts-summary', requireAuth, async (req, res) => {
  const period = parsePeriod(req.query.period);
  if (!period) return res.status(400).json({ error: 'Invalid period. Use 24h, 7d, or 30d.' });

  try {
    // Query 1: Count alerts grouped by type and severity — powers the breakdown chart.
    const [byType] = await dbPool.execute(
      `SELECT AlertType, Severity, COUNT(*) AS cnt
       FROM ALERT
       WHERE Timestamp >= NOW() - INTERVAL ? DAY
       GROUP BY AlertType, Severity
       ORDER BY cnt DESC`,
      [period.days]
    );

    // Query 2: Rank the top 5 devices by alert frequency to highlight problem nodes.
    const [topDevices] = await dbPool.execute(
      `SELECT a.DeviceID, d.DeviceName, d.IPAddress, COUNT(*) AS alertCount
       FROM ALERT a
       LEFT JOIN DEVICE d ON d.DeviceID = a.DeviceID
       WHERE a.Timestamp >= NOW() - INTERVAL ? DAY
         AND a.DeviceID IS NOT NULL
       GROUP BY a.DeviceID, d.DeviceName, d.IPAddress
       ORDER BY alertCount DESC
       LIMIT 5`,
      [period.days]
    );

    return res.json({
      period: period.label,
      byType: byType.map(r => ({
        type: r.AlertType,
        severity: mapSeverityFromDb(r.Severity),
        count: Number(r.cnt)
      })),
      topDevices: topDevices.map(r => ({
        deviceId: r.DeviceID,
        name: r.DeviceName || r.IPAddress || 'Unknown',
        ip: r.IPAddress,
        alertCount: Number(r.alertCount)
      }))
    });
  } catch (error) {
    console.error('analytics/alerts-summary error:', error);
    return res.status(500).json({ error: 'Unable to load alerts summary.' });
  }
});

// AI-powered network insights using Google Gemini
app.get('/api/analytics/ai-insights', requireAuth, async (req, res) => {
  const period = parsePeriod(req.query.period);
  if (!period) return res.status(400).json({ error: 'Invalid period. Use 24h, 7d, or 30d.' });

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'AI insights are not configured. Add GEMINI_API_KEY to server/.env.' });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Gather all analytics data in parallel
    const [
      [overviewRows],
      [latencyRows],
      [uptimeRows],
      [alertSevRows],
      [topAlertRows]
    ] = await Promise.all([
      dbPool.execute(`
        SELECT
          COUNT(DISTINCT DeviceID)                                               AS activeDevices,
          ROUND(AVG(CASE WHEN Status = 'Online' THEN 1.0 ELSE 0 END) * 100, 1) AS uptimePct,
          ROUND(AVG(LatencyMs), 1)                                               AS avgLatencyMs
        FROM DEVICE_LOG
        WHERE CreatedAt >= NOW() - INTERVAL ? DAY
      `, [period.days]),
      dbPool.execute(`
        SELECT
          MIN(LatencyMs) AS minMs,
          MAX(LatencyMs) AS maxMs,
          ROUND(AVG(LatencyMs), 1) AS avgMs
        FROM DEVICE_LOG
        WHERE CreatedAt >= NOW() - INTERVAL ? DAY
          AND LatencyMs IS NOT NULL
      `, [period.days]),
      dbPool.execute(`
        SELECT d.DeviceName, d.IPAddress,
          ROUND(AVG(CASE WHEN dl.Status = 'Online' THEN 1.0 ELSE 0 END) * 100, 1) AS uptimePct,
          ROUND(AVG(dl.LatencyMs), 1) AS avgLatencyMs
        FROM DEVICE d
        LEFT JOIN DEVICE_LOG dl ON dl.DeviceID = d.DeviceID
          AND dl.CreatedAt >= NOW() - INTERVAL ? DAY
        GROUP BY d.DeviceID, d.DeviceName, d.IPAddress
        HAVING uptimePct IS NOT NULL AND uptimePct < 90
        ORDER BY uptimePct ASC
        LIMIT 5
      `, [period.days]),
      dbPool.execute(`
        SELECT Severity, COUNT(*) AS cnt
        FROM ALERT
        WHERE Timestamp >= NOW() - INTERVAL ? DAY
        GROUP BY Severity
      `, [period.days]),
      dbPool.execute(`
        SELECT d.DeviceName, d.IPAddress, COUNT(*) AS alertCount
        FROM ALERT a
        LEFT JOIN DEVICE d ON d.DeviceID = a.DeviceID
        WHERE a.Timestamp >= NOW() - INTERVAL ? DAY
        GROUP BY a.DeviceID, d.DeviceName, d.IPAddress
        ORDER BY alertCount DESC
        LIMIT 5
      `, [period.days])
    ]);

    // Tally alert severity counts
    const alertCounts = { danger: 0, warning: 0, success: 0 };
    for (const r of alertSevRows) {
      const sev = mapSeverityFromDb(r.Severity);
      if (Object.prototype.hasOwnProperty.call(alertCounts, sev)) alertCounts[sev] += Number(r.cnt);
    }
    const totalAlerts = alertCounts.danger + alertCounts.warning + alertCounts.success;

    const ov = overviewRows[0] || {};
    const lt = latencyRows[0] || {};

    const problemDevText = uptimeRows.length > 0
      ? uptimeRows.map((d, i) =>
          `  ${i + 1}. ${d.DeviceName || d.IPAddress || 'Unknown'} (${d.IPAddress || '?'}): uptime ${d.uptimePct ?? '?'}%, avg latency ${d.avgLatencyMs ?? '?'} ms`
        ).join('\n')
      : '  None — all devices have ≥90% uptime';

    const topAlertersText = topAlertRows.length > 0
      ? topAlertRows.map((d, i) =>
          `  ${i + 1}. ${d.DeviceName || d.IPAddress || 'Unknown'} (${d.IPAddress || '?'}): ${d.alertCount} alerts`
        ).join('\n')
      : '  None';

    const prompt = `You are a network operations analyst for a campus network monitoring system.
Analyze the following telemetry data and provide a concise health assessment.

Period: ${period.label}

Network Summary:
- Active devices: ${ov.activeDevices ?? 0}
- Average uptime: ${ov.uptimePct ?? 'N/A'}%
- Average latency: ${ov.avgLatencyMs ?? 'N/A'} ms
- Total alerts: ${totalAlerts} (Critical: ${alertCounts.danger}, Warning: ${alertCounts.warning}, Recovery: ${alertCounts.success})

Latency Range:
- Min: ${lt.minMs ?? 'N/A'} ms, Max: ${lt.maxMs ?? 'N/A'} ms, Avg: ${lt.avgMs ?? 'N/A'} ms

Devices with Uptime Below 90%:
${problemDevText}

Top Alerting Devices:
${topAlertersText}

Respond with exactly this structure:
**Network Health:** [Healthy / Warning / Critical] — one sentence summary

**Key Observations:**
• [observation 1]
• [observation 2]
• [observation 3 if warranted]

**Recommendations:**
• [action 1]
• [action 2]
• [action 3 if warranted]

Keep each bullet under 25 words. Focus on actionable network operations insights.`;

    const result = await model.generateContent(prompt);
    const insights = result.response.text() || 'Unable to generate insights.';

    return res.json({
      period: period.label,
      insights,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('analytics/ai-insights error:', error);
    const msg = error?.message || 'Unable to generate AI insights.';
    return res.status(500).json({ error: msg });
  }
});

// ── Trend Analytics Endpoints ───────────────────────────────────────────────

// Incident frequency per time bucket + overall MTTR for the period
app.get('/api/analytics/incident-trend', requireAuth, async (req, res) => {
  const period = parsePeriod(req.query.period);
  if (!period) return res.status(400).json({ error: 'Invalid period.' });

  try {
    const bucketFmt = period.days === 1 ? '%H:00' : '%m/%d';

    const [[buckets], [mttrRows]] = await Promise.all([
      dbPool.execute(
        `SELECT
           DATE_FORMAT(Timestamp, ?)       AS bucket,
           SUM(AlertType = 'downtime')     AS downtime,
           SUM(AlertType = 'abnormal')     AS abnormal,
           SUM(AlertType = 'recovery')     AS recovery,
           COUNT(*)                        AS total
         FROM ALERT
         WHERE Timestamp >= NOW() - INTERVAL ? DAY
         GROUP BY bucket
         ORDER BY MIN(Timestamp) ASC`,
        [bucketFmt, period.days]
      ),
      dbPool.execute(
        `SELECT
           ROUND(AVG(TIMESTAMPDIFF(MINUTE, Timestamp, ResolvedAt)), 0) AS avgMttrMin,
           SUM(IsResolved = 1)                                          AS resolvedCount,
           COUNT(*)                                                      AS totalCount
         FROM ALERT
         WHERE Timestamp >= NOW() - INTERVAL ? DAY
           AND AlertType = 'downtime'`,
        [period.days]
      )
    ]);

    const m = mttrRows[0] || {};
    return res.json({
      period: period.label,
      buckets: buckets.map(r => ({
        bucket:   r.bucket,
        downtime: Number(r.downtime) || 0,
        abnormal: Number(r.abnormal) || 0,
        recovery: Number(r.recovery) || 0,
        total:    Number(r.total)    || 0
      })),
      mttr: {
        avgMin:        m.avgMttrMin !== null ? Number(m.avgMttrMin) : null,
        resolvedCount: Number(m.resolvedCount) || 0,
        totalCount:    Number(m.totalCount)    || 0
      }
    });
  } catch (error) {
    console.error('analytics/incident-trend error:', error);
    return res.status(500).json({ error: 'Unable to load incident trend.' });
  }
});

// Incident counts grouped by hour-of-day — reveals peak failure windows
app.get('/api/analytics/peak-hours', requireAuth, async (req, res) => {
  const period = parsePeriod(req.query.period);
  if (!period) return res.status(400).json({ error: 'Invalid period.' });

  try {
    const [rows] = await dbPool.execute(
      `SELECT
         HOUR(Timestamp)             AS hour,
         COUNT(*)                    AS total,
         SUM(AlertType = 'downtime') AS downtime,
         SUM(AlertType = 'abnormal') AS abnormal
       FROM ALERT
       WHERE Timestamp >= NOW() - INTERVAL ? DAY
         AND AlertType IN ('downtime', 'abnormal')
       GROUP BY hour
       ORDER BY hour ASC`,
      [period.days]
    );

    // Fill all 24 hours so the chart always has a complete x-axis
    const hourMap = new Map(rows.map(r => [Number(r.hour), r]));
    const hours = Array.from({ length: 24 }, (_, h) => {
      const r = hourMap.get(h) || {};
      return { hour: h, total: Number(r.total) || 0, downtime: Number(r.downtime) || 0, abnormal: Number(r.abnormal) || 0 };
    });

    return res.json({ period: period.label, hours });
  } catch (error) {
    console.error('analytics/peak-hours error:', error);
    return res.status(500).json({ error: 'Unable to load peak hours.' });
  }
});

// Top 10 devices ranked by alert count with per-device MTTR
app.get('/api/analytics/top-problem-devices', requireAuth, async (req, res) => {
  const period = parsePeriod(req.query.period);
  if (!period) return res.status(400).json({ error: 'Invalid period.' });

  try {
    const [rows] = await dbPool.execute(
      `SELECT
         d.DeviceName,
         d.IPAddress,
         d.DeviceType,
         COALESCE(l.BuildingName, 'Unknown') AS building,
         COALESCE(l.Floor, '')               AS floor,
         COUNT(a.AlertID)                    AS alertCount,
         SUM(a.AlertType = 'downtime')       AS downtimeCount,
         ROUND(AVG(
           CASE WHEN a.IsResolved = 1 AND a.ResolvedAt IS NOT NULL
                THEN TIMESTAMPDIFF(MINUTE, a.Timestamp, a.ResolvedAt)
           END
         ), 1)                               AS avgResolutionMin
       FROM ALERT a
       JOIN DEVICE d ON d.DeviceID = a.DeviceID
       LEFT JOIN LOCATION l ON l.LocationID = d.LocationID
       WHERE a.Timestamp >= NOW() - INTERVAL ? DAY
       GROUP BY d.DeviceID, d.DeviceName, d.IPAddress, d.DeviceType, l.BuildingName, l.Floor
       ORDER BY alertCount DESC, downtimeCount DESC
       LIMIT 10`,
      [period.days]
    );

    return res.json({
      period: period.label,
      devices: rows.map(r => ({
        name:             r.DeviceName || r.IPAddress || 'Unknown',
        ip:               r.IPAddress,
        type:             r.DeviceType || '',
        building:         r.building,
        floor:            r.floor,
        alertCount:       Number(r.alertCount)      || 0,
        downtimeCount:    Number(r.downtimeCount)   || 0,
        avgResolutionMin: r.avgResolutionMin !== null ? Number(r.avgResolutionMin) : null
      }))
    });
  } catch (error) {
    console.error('analytics/top-problem-devices error:', error);
    return res.status(500).json({ error: 'Unable to load top problem devices.' });
  }
});

// Uptime percentage and downtime alert count grouped by building
app.get('/api/analytics/location-health', requireAuth, async (req, res) => {
  const period = parsePeriod(req.query.period);
  if (!period) return res.status(400).json({ error: 'Invalid period.' });

  try {
    const [[uptimeRows], [alertRows]] = await Promise.all([
      dbPool.execute(
        `SELECT
           COALESCE(l.BuildingName, 'Unknown') AS building,
           COUNT(DISTINCT d.DeviceID)          AS deviceCount,
           ROUND(
             SUM(CASE WHEN dl.Status = 'Online' THEN 1 ELSE 0 END) /
             NULLIF(COUNT(dl.LogID), 0) * 100
           , 1)                                AS uptimePct
         FROM DEVICE d
         LEFT JOIN LOCATION l ON l.LocationID = d.LocationID
         JOIN DEVICE_LOG dl ON dl.DeviceID = d.DeviceID
           AND dl.CreatedAt >= NOW() - INTERVAL ? DAY
         GROUP BY COALESCE(l.BuildingName, 'Unknown')
         ORDER BY uptimePct ASC`,
        [period.days]
      ),
      dbPool.execute(
        `SELECT
           COALESCE(l.BuildingName, 'Unknown') AS building,
           COUNT(*)                            AS alertCount
         FROM ALERT a
         JOIN DEVICE d ON d.DeviceID = a.DeviceID
         LEFT JOIN LOCATION l ON l.LocationID = d.LocationID
         WHERE a.Timestamp >= NOW() - INTERVAL ? DAY
           AND a.AlertType = 'downtime'
         GROUP BY COALESCE(l.BuildingName, 'Unknown')`,
        [period.days]
      )
    ]);

    const alertMap = new Map(alertRows.map(r => [r.building, Number(r.alertCount)]));

    return res.json({
      period: period.label,
      locations: uptimeRows.map(r => ({
        building:    r.building,
        deviceCount: Number(r.deviceCount) || 0,
        uptimePct:   r.uptimePct !== null ? Number(r.uptimePct) : null,
        alertCount:  alertMap.get(r.building) || 0
      }))
    });
  } catch (error) {
    console.error('analytics/location-health error:', error);
    return res.status(500).json({ error: 'Unable to load location health.' });
  }
});

// Update the authenticated user's profile
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

// ---- User Management (Admin only) ----

// List all user accounts
app.get('/api/users', requireAuth, requireRole('Admin'), async (req, res) => {
  try {
    const [rows] = await dbPool.execute(
      'SELECT UserID, FullName, Email, Role, CreatedAt FROM USERS ORDER BY CreatedAt DESC'
    );
    return res.json(rows.map(r => ({
      id: r.UserID,
      fullName: r.FullName,
      email: r.Email,
      role: r.Role,
      createdAt: r.CreatedAt
    })));
  } catch (error) {
    console.error('Users list error:', error);
    return res.status(500).json({ error: 'Unable to load users.' });
  }
});

// Change a user's role
app.put('/api/users/:id/role', requireAuth, requireRole('Admin'), async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  const { role } = req.body || {};
  if (role !== 'Admin' && role !== 'ITStaff') {
    return res.status(400).json({ error: 'Role must be Admin or ITStaff.' });
  }

  if (targetId === req.session.user.userId) {
    return res.status(400).json({ error: 'You cannot change your own role.' });
  }

  try {
    const [rows] = await dbPool.execute('SELECT FullName, Email FROM USERS WHERE UserID = ? LIMIT 1', [targetId]);
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });

    await dbPool.execute('UPDATE USERS SET Role = ? WHERE UserID = ?', [role, targetId]);
    logActivity(req, 'user_role_changed', `${rows[0].FullName} (${rows[0].Email}) → ${role}`);
    return res.json({ ok: true, role });
  } catch (error) {
    console.error('Role change error:', error);
    return res.status(500).json({ error: 'Unable to update role.' });
  }
});

// Delete a user account
app.delete('/api/users/:id', requireAuth, requireRole('Admin'), async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  if (targetId === req.session.user.userId) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }

  try {
    const [rows] = await dbPool.execute('SELECT FullName, Email FROM USERS WHERE UserID = ? LIMIT 1', [targetId]);
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });

    await dbPool.execute('DELETE FROM USERS WHERE UserID = ?', [targetId]);
    logActivity(req, 'user_deleted', `${rows[0].FullName} (${rows[0].Email})`);
    return res.json({ ok: true });
  } catch (error) {
    console.error('User delete error:', error);
    return res.status(500).json({ error: 'Unable to delete user.' });
  }
});

// ---- Activity Log (Admin only) ----

app.get('/api/activity-logs', requireAuth, requireRole('Admin'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  if (!Number.isFinite(limit) || !Number.isFinite(offset)) {
    return res.status(400).json({ error: 'Invalid pagination parameters.' });
  }

  try {
    const [rows] = await dbPool.execute(
      'SELECT LogID, UserID, FullName, Action, Details, IPAddress, CreatedAt FROM activity_logs ORDER BY CreatedAt DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    const [[{ total }]] = await dbPool.execute('SELECT COUNT(*) AS total FROM activity_logs');
    return res.json({ logs: rows, total: Number(total), limit, offset });
  } catch (error) {
    console.error('Activity log error:', error);
    return res.status(500).json({ error: 'Unable to load activity logs.' });
  }
});

// Idempotent DB migrations — run once at startup
async function runMigrations() {
  // Step 1: Add LatencyMs for per-scan latency storage
  try {
    await dbPool.execute('ALTER TABLE DEVICE_LOG ADD COLUMN LatencyMs FLOAT NULL');
    console.log('Migration: LatencyMs column added to DEVICE_LOG.');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('Migration: LatencyMs column already exists, skipping.');
    } else {
      console.error('Migration error (LatencyMs):', err.message);
    }
  }

  // Step 2: Ensure CreatedAt column exists with DEFAULT CURRENT_TIMESTAMP so
  // analytics time-range queries work. If the column already exists, MODIFY it
  // to guarantee it has the auto-default (idempotent in MySQL).
  try {
    await dbPool.execute(
      'ALTER TABLE DEVICE_LOG ADD COLUMN CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
    );
    console.log('Migration: CreatedAt column added to DEVICE_LOG.');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      try {
        await dbPool.execute(
          'ALTER TABLE DEVICE_LOG MODIFY COLUMN CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
        );
        console.log('Migration: CreatedAt default ensured on DEVICE_LOG.');
      } catch (_modErr) {
        // Column already correctly configured
      }
    } else {
      console.error('Migration error (CreatedAt):', err.message);
    }
  }

  // Step 3: Backfill any NULL CreatedAt rows so existing log entries show up in analytics
  try {
    const [result] = await dbPool.execute(
      'UPDATE DEVICE_LOG SET CreatedAt = NOW() WHERE CreatedAt IS NULL'
    );
    if (result.affectedRows > 0) {
      console.log(`Migration: Backfilled ${result.affectedRows} DEVICE_LOG rows with current timestamp.`);
    }
  } catch (err) {
    console.error('Migration error (CreatedAt backfill):', err.message);
  }

  // Step 4: Add AlertType column to ALERT (schema predates this field)
  try {
    await dbPool.execute(
      "ALTER TABLE ALERT ADD COLUMN AlertType VARCHAR(50) NOT NULL DEFAULT 'other'"
    );
    console.log('Migration: AlertType column added to ALERT.');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('Migration: AlertType column already exists, skipping.');
    } else {
      console.error('Migration error (AlertType):', err.message);
    }
  }

  // Step 5: Add ContactNumber column to USERS (schema predates this field)
  try {
    await dbPool.execute(
      "ALTER TABLE USERS ADD COLUMN ContactNumber VARCHAR(50) NULL DEFAULT ''"
    );
    console.log('Migration: ContactNumber column added to USERS.');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('Migration: ContactNumber column already exists, skipping.');
    } else {
      console.error('Migration error (ContactNumber):', err.message);
    }
  }

  // Step 6: Create activity_logs table for audit trail
  try {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        LogID INT UNSIGNED NOT NULL AUTO_INCREMENT,
        UserID INT UNSIGNED DEFAULT NULL,
        FullName VARCHAR(160) DEFAULT NULL,
        Action VARCHAR(100) NOT NULL,
        Details TEXT DEFAULT NULL,
        IPAddress VARCHAR(45) DEFAULT NULL,
        CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (LogID),
        KEY idx_actlog_user (UserID),
        KEY idx_actlog_created (CreatedAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Migration: activity_logs table ensured.');
  } catch (err) {
    console.error('Migration error (activity_logs):', err.message);
  }

  // Step 8: Add ResolutionNotes column to ALERT for maintenance feedback
  try {
    await dbPool.execute('ALTER TABLE ALERT ADD COLUMN ResolutionNotes TEXT NULL');
    console.log('Migration: ResolutionNotes column added to ALERT.');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('Migration: ResolutionNotes column already exists, skipping.');
    } else {
      console.error('Migration error (ResolutionNotes):', err.message);
    }
  }

  // Step 7: Add performance indexes for analytics time-range queries
  const perfIndexes = [
    { sql: 'CREATE INDEX idx_device_log_created ON DEVICE_LOG(CreatedAt)', name: 'idx_device_log_created' },
    { sql: 'CREATE INDEX idx_alert_timestamp ON ALERT(Timestamp)', name: 'idx_alert_timestamp' },
  ];
  for (const { sql, name } of perfIndexes) {
    try {
      await dbPool.execute(sql);
      console.log(`Migration: index ${name} created.`);
    } catch (err) {
      if (err.code === 'ER_DUP_KEYNAME') {
        console.log(`Migration: index ${name} already exists, skipping.`);
      } else {
        console.error(`Migration error (${name}):`, err.message);
      }
    }
  }
}

// Start the server and begin scheduled scans
httpServer.listen(PORT, async () => {
  console.log(`SmartCampus API running on http://localhost:${PORT}`);
  await runMigrations();
  startScheduledScans();
});
