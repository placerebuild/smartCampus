# Knowledge Base — SmartCampus SecureNet

Domain knowledge, design decisions, and operational context for the campus network monitoring system at DNSC.

## System purpose

SmartCampus SecureNet gives the DNSC Technical Systems Support Unit (TSSU) visibility into the campus LAN. It discovers connected devices, tracks uptime and latency, visualizes the network topology, and sends email alerts for sustained outages — reducing the time it takes TSSU to notice and respond to infrastructure problems.

## Network topology model

The system models a hub-and-spoke LAN topology:

```
Router/Modem (gateway)
  ├── Endpoint (PC, printer, AP, etc.)
  ├── Endpoint
  └── ...
```

Devices are discovered via:
1. **SNMP** — queries `sysDescr`, `sysUpTime`, `sysName`, `sysLocation` OIDs from the router
2. **ICMP ping** — determines if a host is alive and measures round-trip latency
3. **ARP table** — reads the OS ARP cache (`arp -a`) to get MAC addresses and IP→MAC mappings for devices that have communicated with the scanner host

Discovery scans the subnet derived from the local network interface (or `NETWORK_CIDR` env var). The router's IP is auto-detected from the OS routing table (`ipconfig` on Windows, `ip route` on Linux).

## Device lifecycle

| Event | Result |
|---|---|
| Device found in ARP/ping | `DEVICE` row upserted; `DEVICE_LOG` entry written |
| Device not seen in next discovery | `DEVICE_CONNECTION.IsActive` set to `0`; `DEVICE.Status` set to `'Offline'` |
| Device reappears | Connection re-activated; status back to `'Online'` |
| Manual device entry | Created via the Devices page form; no automatic scan needed |

Device types recognized: `Router`, `Modem/Router`, `Switch`, `Access Point`, `Endpoint`, `Printer`, `Server`, `Camera`, `Other`.

## Scan schedule (local mode)

| Scanner | Interval | Purpose |
|---|---|---|
| Router scan (ICMP + ARP + SNMP) | 15 s | Router health and SNMP metadata |
| Discovery scan (subnet ping + ARP) | 5 min | Full endpoint inventory update |
| Continuous ping sweep | 2 s | Per-device latency + alert staging |
| Device ping log | 15 s | Persistent latency records for history charts |

All intervals are configurable via environment variables and disabled entirely in `CLOUD_MODE`.

## Alert design rationale

False positives are expensive — a 2-second WiFi interruption should not page TSSU at 2 AM. The three-stage pipeline was designed to:

1. **Ignore transient drops** (< ~6 s): power blips, single packet loss, brief AP association delays
2. **Warn the dashboard** at ~30 s: staff monitoring the dashboard see it, but no email noise
3. **Email TSSU** only after 5 minutes of confirmed outage, or 3 incidents within 30 minutes (flapping)

The "flapping" fast-track to Critical catches devices that reboot repeatedly, which 5 min threshold alone wouldn't catch quickly enough.

## Database design decisions

- **Column names are `"QuotedCamelCase"`** because they were migrated from MySQL, which used mixed case without quoting. PostgreSQL lowercases unquoted identifiers, so all queries must quote them.
- **`DEVICE_CONNECTION.PortInfo`** is always empty string `''` for WiFi-discovered links. The unique constraint on `(SourceDeviceID, TargetDeviceID, PortInfo)` allows one active link per device pair per port, supporting future wired-port tracking.
- **`SCAN_SESSION`** tracks every discovery run (manual and scheduled) so the cloud dashboard can show scan history even though it cannot trigger scans itself.
- **`smartcampus_private.sessions`** is in a separate schema so RLS on `public` tables doesn't accidentally restrict session reads.

## Cloud/Vercel deployment

When `VERCEL=1`, the server:
- Accepts all read requests (`GET /api/devices`, topology, alerts, etc.)
- Rejects scan-trigger and scanner-settings routes with `409` and an explanatory message
- Disables all scheduled timers (no ping, no discovery)
- Relies on the campus computer to push scan results to the shared Supabase database in real-time via Socket.IO relay from the Supabase Realtime channel

This allows a public read-only dashboard hosted on Vercel while the actual scanning runs on a campus machine.

## AI integration

Two AI SDKs are loaded but are feature-gated (not critical path):
- **`@anthropic-ai/sdk`** — intended for natural-language device/alert queries ("what devices went offline today?")
- **`@google/generative-ai`** — Gemini, available as an alternative or fallback

Neither SDK blocks server startup. If an API key is absent, the AI features simply do not activate.

## Security model

- Session tokens live in PostgreSQL (`smartcampus_private.sessions`), not in-memory, so server restarts don't log everyone out
- RLS prevents the `browser` role (used by Supabase JS client on the frontend) from directly reading password hashes or other sensitive columns
- CORS is restricted to `ALLOWED_ORIGINS`; credentials are only sent same-origin
- Rate limiting is applied to auth endpoints to prevent brute force
- SNMP community strings and SMTP passwords live only in `.env`, never in source

## Glossary

| Term | Definition |
|---|---|
| TSSU | Technical Systems Support Unit — the campus IT team that receives alerts |
| ICMP | Internet Control Message Protocol — the underlying protocol for `ping` |
| SNMP | Simple Network Management Protocol — used to query router metadata (OIDs) |
| ARP | Address Resolution Protocol — maps IP addresses to MAC addresses on the LAN |
| CIDR | Classless Inter-Domain Routing notation (e.g. `192.168.1.0/24`) used to define subnets |
| OID | Object Identifier — SNMP data path (e.g. `1.3.6.1.2.1.1.5.0` = sysName) |
| Upsert | INSERT ... ON CONFLICT DO UPDATE — write a row whether or not it already exists |
| Socket.IO | WebSocket library used to push real-time updates to the frontend |
| Cloud mode | Server deployment mode (`VERCEL=1`) where scanning is disabled |
| PGlite | In-process PostgreSQL for testing; used to validate SQL queries without a live DB |
