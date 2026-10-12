---
name: topology-socketio
description: Use when modifying the network topology map, the Socket.IO event pipeline, or the server-side functions that build and broadcast topology payloads. Trigger before editing fetchTopologyPayload, buildRouterDevice, buildRouterLinks, mergeTopologyDevices, emitTopologyUpdate, emitDevicesUpdate, the topology:update/devices:update/alert:new event handlers, or topology.html.
---

# Topology & Socket.IO Skill — SmartCampus SecureNet

## Overview

Data flow: scanning functions call `emitTopologyUpdate(reason)` after persisting results → `fetchTopologyPayload()` reads DB + ARP → `io.emit('topology:update', payload)` → frontend re-renders the vis-network map.

All topology builder functions live in `server/server.js` (~lines 839–1015). Frontend consumers are in `js/script.js`.

## Node shape

Built by `mapTopologyRow()`. The `id` field is **always the IP address string** — never a database ID.

```js
{
  id: row.IPAddress,           // primary deduplication key
  name: row.DeviceName || row.IPAddress,
  type: row.DeviceType || DEFAULT_ENDPOINT_TYPE,
  ip: row.IPAddress,
  mac: row.MACAddress,         // may be null
  status: 'Online' | 'Offline' | 'Warning',
  lastSeen: 'ISO8601 string',
  location: 'Building / Floor / Room',
  building: string,
  floor: string,
  room: string
}
```

## Link shape

Links use `from` / `to` — **not** `source` / `target`.

```js
{
  id: `link-${sourceIp}-${targetIp}`,
  from: sourceIp,              // IP string
  to: targetIp,                // IP string
  medium: row.ConnectionType || '',   // 'WiFi', 'Ethernet', etc.
  bandwidth: '',
  status: 'Online' | 'Offline'
}
```

## `fetchTopologyPayload(connectedEntries?)`

Three-step merge:

1. DB devices via `mapTopologyRow()` (primary array — wins on conflict)
2. ARP-discovered devices via `buildDiscoveredDevice()` (extras)
3. Synthetic router node via `buildRouterDevice()` if router IP is not already present

Links come from `DEVICE_CONNECTION` rows where `IsActive = 1`. If none exist, falls back to synthetic ARP links via `buildRouterLinks()`. In `CLOUD_MODE`, `connectedEntries` is forced to `[]` — no ARP runs.

Pass `connectedEntries` only when the caller already has ARP results to avoid a duplicate ARP read.

## `mergeTopologyDevices(primary, extras)`

Merges two device arrays. Primary array wins on IP conflict (`String(device.id)` is the key). Use DB devices as `primary` and ARP-discovered devices as `extras`.

## `emitTopologyUpdate(reason, connectedEntries?)`

Call after any operation that changes device or link state (discovery scans, router scans, device CRUD).

```js
emitTopologyUpdate('router-scan-scheduled');
emitTopologyUpdate('network-discovery', connectedEntries); // pass ARP results to avoid double read
emitTopologyUpdate('manual');
```

## `emitDevicesUpdate()`

Call after any write to the `DEVICE` table. Uses `getMappedDevices()` which queries the full device list with location join. Topology update and devices update are **separate concerns** — both may be needed after a single write.

## Socket.IO event contract

Server emits (all via `io.emit()`):

```js
// On new connection only
socket.emit('topology:hello', { ok: true, time: ISO8601 })

// After any topology change
io.emit('topology:update', {
  devices: Device[],   // node array
  links: Link[],       // edge array
  reason: string,
  time: ISO8601
})

// After DEVICE table changes
io.emit('devices:update', Device[])   // flat array from getMappedDevices()

// From continuous ping sweep
io.emit('alert:new', {
  type: 'downtime' | 'recovery' | 'abnormal',
  severity: 'warning' | 'danger' | 'success',
  stage: 'warn' | 'critical' | 'resolved',
  message: string,
  deviceId: number,
  deviceName: string,
  time: ISO8601
})
```

## Frontend consumers (`js/script.js`)

Both sockets are initialized with `{ withCredentials: true, transports: ['websocket', 'polling'] }` and only when `!window.SMARTCAMPUS_CLOUD`.

| Event | Handler location | Action |
|---|---|---|
| `topology:update` | `topologySocket.on(...)` ~line 1990 | Re-renders vis-network topology map |
| `devices:update` | `dashboardSocket.on(...)` ~line 2718 | Refreshes flat device inventory table |
| `alert:new` | `dashboardSocket.on(...)` ~line 2727 | Shows Bootstrap toast notification |

## Common mistakes to avoid

- **Never emit raw DB rows** — always use `fetchTopologyPayload()` or `getMappedDevices()` for the mapped shape.
- **Do not set `id` to anything other than the IP address string** — `mergeTopologyDevices` deduplicates on `String(device.id)`, and vis-network uses it as the node identifier.
- **Links use `from`/`to`, not `source`/`target`** — using the wrong keys produces a silent render failure on the topology map.
- **Always call `emitDevicesUpdate()` after `DEVICE` writes** — topology update and devices update are separate; forgetting one leaves a stale view in the other panel.
- **Do not add a Socket.IO event name without a frontend listener** — orphaned events are silent and easy to miss.
