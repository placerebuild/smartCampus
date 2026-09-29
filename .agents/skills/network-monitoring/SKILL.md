---
name: network-monitoring
description: Use when writing or modifying any code related to network scanning, device discovery, ICMP ping, SNMP queries, ARP table reads, the three-stage alert pipeline, continuous ping sweep, scheduled scans, Socket.IO topology broadcasts, or the SCAN_SESSION / DEVICE_LOG tables. Trigger before editing server.js sections covering fetchIcmpSnapshot, fetchSnmpSnapshot, fetchArpSnapshot, discoverNetworkDevices, runContinuousPingSweep, runScheduledRouterScan, emitTopologyUpdate, or insertAlert.
---

# Network Monitoring Skill — SmartCampus SecureNet

## Scan methods

Three complementary methods produce a device snapshot:

| Method | Function | What it gives |
|---|---|---|
| ICMP | `fetchIcmpSnapshot(ip)` | alive, latency (avg/min/max), packet loss |
| SNMP | `fetchSnmpSnapshot(ip)` | sysDescr, sysName, sysUpTime, sysLocation |
| ARP | `fetchArpSnapshot(ip)` | MAC address from OS ARP cache |

Fast single-probe variant: `fetchFastIcmpSnapshot(ip)` — used by the 2-second continuous sweep (1 probe, 1 s timeout). Do not use it for router scans or on-demand user requests.

## Snapshot shape

All scan functions return a snapshot object with an `ok` flag:

```js
// ICMP
{ ok: true, alive: true, timeMs: 12.4, avgMs: 12.4, minMs: 10.1, maxMs: 15.0, packetLoss: 0, probes: 4 }
{ ok: false, error: 'ICMP request failed.' }

// SNMP
{ ok: true, sysDescr: '...', sysName: 'Router', sysUpTime: '...', sysLocation: '...' }
{ ok: false, disabled: true, error: 'SNMP disabled by server config.' }

// ARP
{ ok: true, entry: { ip: '192.168.1.1', mac: '00:1a:2b:3c:4d:5e' } }
{ ok: false, error: 'Unable to read ARP table.' }
```

A full device scan snapshot:
```js
{
  target: '192.168.1.1',
  scannedAt: '2026-09-29T10:00:00.000Z',
  icmp: { ok: true, alive: true, timeMs: 5.2, ... },
  arp:  { ok: true, entry: { ip: '192.168.1.1', mac: '...' } },
  snmp: { ok: true, sysName: 'Router', ... }
}
```

## IP filtering

**Always call `isBlacklistedIp(ip)` before persisting any discovered IP.**

Blacklisted automatically: multicast (224–239), broadcast (255.255.255.255), link-local (169.254.x.x), loopback (127.x.x.x), zero-network (0.x.x.x), Class E (240+), subnet broadcasts (.255), manual list from `BLACKLISTED_IPS` env var.

## Discovery flow

1. `resolveDiscoveryCidr()` — determine subnet from env var or local interface
2. `expandCidr(cidr, DISCOVERY_MAX_HOSTS)` — enumerate host IPs (max 512 by default)
3. `runWithConcurrency(hosts, 30, pingHost)` — concurrent ICMP probes
4. `readArpTable()` → `parseArpEntries(output)` — get MAC addresses
5. Merge ping-alive hosts not in ARP table (handles AP isolation)
6. `upsertDiscoveredDevice(entry)` for each entry — persist to `DEVICE`
7. `upsertDeviceConnection(routerDeviceId, deviceId)` — persist link
8. Mark stale connections (`IsActive = 0`) and offline devices
9. `emitDevicesUpdate()` — push fresh list to all frontends

Use `runTrackedDiscoveryScan(cidrOverride, { triggerType, userId })` to wrap a discovery in a `SCAN_SESSION` record.

## Three-stage alert pipeline

Constants (defined at module level in server.js — do not change without understanding the design):

```js
OFFLINE_THRESHOLD  = 3    // ~6 s  silent internal change
OFFLINE_WARN       = 15   // ~30 s warning to dashboard
OFFLINE_CRIT       = 150  // ~5 min critical + email
OFFLINE_FREQ_COUNT = 3    // incidents in 30 min → immediate critical
RECOVERY_THRESHOLD = 2    // consecutive successes → recovered
LATENCY_WARN_MS    = 200  // ms above which latency is "high"
LATENCY_CRIT_MS    = 500  // ms above which latency is "critical"
LATENCY_WARN_PINGS = 5    // ~10 s sustained → warning
LATENCY_CRIT_PINGS = 30   // ~60 s sustained → critical
```

Per-device state is kept in `realtimeDeviceStates` (Map). Fields:

```js
{
  status: 'Online' | 'Offline',
  latency: number | null,
  failCount: number,
  successCount: number,
  alertStage: 0 | 1 | 2 | 3,       // 0=none 1=silent 2=warned 3=critical
  highLatencyCount: number,
  latencyAlertStage: 0 | 1 | 2,
  incidentLog: number[],             // timestamps of recent downtime starts
  downtimeStart: number | null       // Date.now() when current outage began
}
```

## Persisting scan results

```js
// Persist router scan + emit topology
await upsertDeviceSnapshot(snapshot);
emitTopologyUpdate('router-scan-scheduled');

// Persist discovered endpoint
const { deviceId, isNew } = await upsertDiscoveredDevice(entry);

// Write a raw log entry
await insertDeviceLog(deviceId, snapshot, status, ipAddress);
```

## Socket.IO broadcasts

```js
// Full topology (devices + links)
io.emit('topology:update', { devices, links, reason, time });

// Flat device list for inventory table
io.emit('devices:update', await getMappedDevices());

// Alert notification
io.emit('alert:new', {
  type: 'downtime' | 'recovery' | 'abnormal',
  severity: 'warning' | 'danger' | 'success',
  stage: 'warn' | 'critical' | 'resolved',
  message: string,
  deviceId: number,
  deviceName: string,
  time: ISO8601
});
```

## CLOUD_MODE guard

Any code path that runs a scan or modifies scanner settings MUST check:

```js
if (CLOUD_MODE) {
  return res.status(409).json({
    error: 'Run network scans and manage scanner settings on the campus computer. This dashboard displays data saved to Supabase.'
  });
}
```

## Adding a new scan type

1. Write a `fetchXxxSnapshot(ip)` function that returns `{ ok, ...data }` or `{ ok: false, error }`
2. Call it inside `runScheduledRouterScan()` if it applies to the router
3. Include its result in the `snapshot` object passed to `upsertDeviceSnapshot()`
4. Update `deriveScanMethod(snapshot)` to recognise it
5. Update `buildConnectivityDetails(snapshot)` if the data is worth logging
