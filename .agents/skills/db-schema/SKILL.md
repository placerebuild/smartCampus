---
name: db-schema
description: Use when writing or modifying database queries, schema migrations, or any code that reads from or writes to the SmartCampus PostgreSQL tables. Trigger before editing queries touching DEVICE, DEVICE_LOG, DEVICE_CONNECTION, LOCATION, ALERT, SCAN_SESSION, USERS, or activity_logs. Also trigger when writing new migration files in server/migrations/.
---

# DB Schema Skill — SmartCampus SecureNet

## Query interface

All queries go through `dbPool.execute(sql, params)`. It normalises parameters and returns `[rows]` (always an array, possibly empty).

```js
// Read
const [rows] = await dbPool.execute(
  'SELECT * FROM "DEVICE" WHERE "DeviceID" = ? LIMIT 1',
  [deviceId]
);
// rows is an array; rows[0] is the first result or undefined

// Write with RETURNING
const [result] = await dbPool.execute(
  'INSERT INTO "DEVICE" ("DeviceName") VALUES (?) RETURNING "DeviceID" AS "insertId"',
  [name]
);
// result.insertId is the new PK

// Dynamic IN list
const placeholders = ids.map(() => '?').join(', ');
const [rows] = await dbPool.execute(
  `SELECT * FROM "DEVICE" WHERE "DeviceID" IN (${placeholders})`,
  ids
);
```

**Never** use raw `pg.Pool.query()` in route handlers — always go through `dbPool`.

## Column-name quoting rule

PostgreSQL lowercases unquoted identifiers. All column and table names in this schema use mixed case inherited from MySQL, so they **must** be double-quoted in every query:

```sql
-- correct
SELECT "DeviceID", "IPAddress", "Status" FROM "DEVICE"

-- wrong — PostgreSQL silently reads deviceid, ipaddress, status (all lowercase, may not exist)
SELECT DeviceID, IPAddress, Status FROM DEVICE
```

## Tables reference

### `public."DEVICE"` — tracked network devices

| Column | Type | Notes |
|---|---|---|
| `DeviceID` | serial PK | auto-increment |
| `DeviceName` | varchar | display name |
| `DeviceType` | varchar | `Router`, `Endpoint`, `Switch`, `Access Point`, etc. |
| `IPAddress` | varchar | IPv4 string |
| `MACAddress` | varchar | lowercase `xx:xx:xx:xx:xx:xx` |
| `Hostname` | varchar | reverse DNS, may be null |
| `Status` | varchar | `Online`, `Offline`, `Warning` |
| `LastSeen` | timestamptz | null if never seen online |
| `LocationID` | integer FK | → `LOCATION.LocationID`, nullable |
| `Manufacturer` | varchar | nullable |
| `Model` | varchar | nullable |

### `public."DEVICE_LOG"` — per-scan history

| Column | Type | Notes |
|---|---|---|
| `LogID` | serial PK | |
| `DeviceID` | integer FK | → `DEVICE`, cascades on delete |
| `Timestamp` | timestamptz | default now() |
| `Status` | varchar | `Online`, `Offline`, `Warning` |
| `IPAddress` | varchar | IP at scan time |
| `ConnectivityDetails` | varchar(255) | `icmp=alive 5ms; mac=xx:xx; snmp=Router` |
| `ScanMethod` | varchar | `PING`, `SNMP`, `ARP`, `Other` |
| `LatencyMs` | numeric | nullable |

### `public."DEVICE_CONNECTION"` — topology links

| Column | Type | Notes |
|---|---|---|
| `ConnectionID` | serial PK | |
| `SourceDeviceID` | integer FK | router end |
| `TargetDeviceID` | integer FK | endpoint end |
| `ConnectionType` | varchar | `WiFi`, `Ethernet`, etc. |
| `IsActive` | integer | `1` = active, `0` = inactive |
| `PortInfo` | varchar | empty string `''` for WiFi links |

Unique constraint: `(SourceDeviceID, TargetDeviceID, PortInfo)`.

Upsert pattern:
```sql
INSERT INTO "DEVICE_CONNECTION" ("SourceDeviceID", "TargetDeviceID", "ConnectionType", "IsActive", "PortInfo")
VALUES (?, ?, 'WiFi', 1, '')
ON CONFLICT ("SourceDeviceID", "TargetDeviceID", "PortInfo") DO UPDATE SET "IsActive" = 1
RETURNING "ConnectionID" AS "insertId"
```

### `public."LOCATION"` — building/floor/room

| Column | Type | Notes |
|---|---|---|
| `LocationID` | serial PK | |
| `BuildingName` | varchar | nullable |
| `Floor` | varchar | nullable |
| `Room` | varchar | nullable |

Use `findOrCreateLocationId(building, floor, room)` — never insert manually.

### `public."ALERT"` — alert history

| Column | Type | Notes |
|---|---|---|
| `AlertID` | serial PK | |
| `DeviceID` | integer FK | nullable (system alerts have no device) |
| `Timestamp` | timestamptz | default now() |
| `AlertType` | varchar | `downtime`, `recovery`, `abnormal` |
| `Severity` | varchar | `High`, `Warning`, `Medium`, `Low` (DB values) |
| `Issue` | text | human-readable message |
| `IsResolved` | boolean | default false |

Severity mapping (DB ↔ frontend Bootstrap):
```js
// DB → frontend
'High' | 'Critical' → 'danger'
'Warning' | 'Medium' → 'warning'
'Low' → 'success'

// frontend → DB
'danger'  → 'High'
'warning' → 'Warning'
'success' → 'Low'
```

Use `insertAlert(type, severity, message, deviceId)` — never insert directly.

### `public."SCAN_SESSION"` — discovery run history

| Column | Type | Notes |
|---|---|---|
| `ScanSessionID` | serial PK | |
| `StartedAt` | timestamptz | default now() |
| `CompletedAt` | timestamptz | nullable |
| `Status` | varchar | `running`, `completed`, `failed` |
| `TriggerType` | varchar | `manual`, `scheduled` |
| `TriggeredByUserID` | integer FK | nullable |
| `Cidr` | varchar | subnet scanned, nullable |
| `DevicesFound` | integer | nullable |
| `NewDevices` | integer | nullable |
| `ErrorMessage` | varchar(500) | nullable |

### `public."USERS"` — application accounts

| Column | Type | Notes |
|---|---|---|
| `UserID` | serial PK | |
| `FirstName` | varchar | |
| `LastName` | varchar | |
| `Email` | varchar | unique, case-insensitive |
| `Password` | varchar | bcrypt hash |
| `Role` | varchar | `Admin`, `User`, `Viewer` |
| `CreatedAt` | timestamptz | |

### `public."activity_logs"` — audit trail

| Column | Type | Notes |
|---|---|---|
| `LogID` | serial PK | |
| `UserID` | integer FK | nullable for system actions |
| `FullName` | varchar | denormalized for display |
| `Action` | varchar | action verb |
| `Details` | text | nullable |
| `IPAddress` | varchar | request IP |
| `Timestamp` | timestamptz | default now() |

Log via `logActivity(req, action, details)` — never insert directly.

### `smartcampus_private."sessions"` — express sessions

Managed by `connect-pg-simple`. Do not query this table directly.

## Migration conventions

Migration files live in `server/migrations/` as `NNN_name.sql` (e.g. `004_new_feature.sql`).

- Wrap the whole migration in `BEGIN; ... COMMIT;`
- Check `smartcampus_migrations` table to see what's already been applied
- Migrations are idempotent — use `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`
- Never `DROP` or `TRUNCATE` in a migration — add columns, create tables, add indexes only
- Run `npm run db:migrate` from `server/` to apply pending migrations
- Run `npm test` before and after to catch any query breakage

## Helper functions

```js
normalizeOptional(value)      // '' | null | undefined → null; else trims
normalizeEmail(value)         // trim + lowercase
normalizeName(value)          // trim
buildFullName(first, last)    // 'First Last'
findOrCreateLocationId(b,f,r) // async, returns LocationID integer
mapDeviceRow(row)             // DB row → API payload shape
getMappedDevices()            // async, returns full device list for API/Socket.IO
```

## Common query patterns

```js
// Find device by IP or MAC
const existing = await findDeviceByIpOrMac(ip, mac);

// List devices with location join
const [rows] = await dbPool.execute(`
  SELECT d."DeviceID", d."DeviceName", d."IPAddress", d."Status",
         l."BuildingName", l."Floor", l."Room"
  FROM "DEVICE" d
  LEFT JOIN "LOCATION" l ON l."LocationID" = d."LocationID"
  ORDER BY d."LastSeen" DESC NULLS LAST
`);

// Dynamic filter (never interpolate user input directly)
const conditions = [];
const params = [];
if (status) { conditions.push('"Status" = ?'); params.push(status); }
if (type)   { conditions.push('"DeviceType" = ?'); params.push(type); }
const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
const [rows] = await dbPool.execute(`SELECT * FROM "DEVICE" ${where}`, params);
```
