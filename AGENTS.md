# AGENTS.md — SmartCampus SecureNet

Agent configuration and guidance for automated AI assistants working in this codebase.

## Project identity

**SmartCampus SecureNet** is a campus network monitoring system. Backend: Node.js/Express with Supabase PostgreSQL. Frontend: HTML + Bootstrap 5 + vanilla JS. Real-time updates via Socket.IO. Network scanning via ICMP ping, SNMP (net-snmp), and ARP table reads.

## Skills

Always load the relevant skill before writing code in that domain:

| Trigger | Skill to load |
|---|---|
| Code imports `@supabase/server` | `supabase-server` |
| Ping sweep, SNMP, ARP, alert pipeline | `network-monitoring` |
| DB queries, migrations, schema changes | `db-schema` |
| Anthropic SDK, model selection | `claude-api` |
| Vercel deployment, env vars, cloud mode | `vercel` |
| OpenAI SDK usage | `openai` |

## Key rules for agents

### Database
- All queries go through `dbPool.execute(sql, params)` — never use raw `pg.Pool` directly in routes
- Column names must be double-quoted: `"DeviceID"`, `"IPAddress"`, etc.
- Use `normalizeOptional(value)` to convert empty strings to `null` before DB writes
- Migrations live in `server/migrations/` as numbered SQL files; run `npm run db:migrate`

### Network scanning (LOCAL mode only)
- Check `CLOUD_MODE` before any scan — return `409` in cloud mode with the standard message
- All scan functions are `async` and handle their own errors; never `await` them without a try/catch
- `isBlacklistedIp(ip)` must be called before adding any discovered IP to the DB
- SNMP is optional; code must degrade gracefully when `SNMP_ENABLED=false`

### Alert pipeline
- Do NOT change alert thresholds (`OFFLINE_THRESHOLD`, `OFFLINE_WARN`, `OFFLINE_CRIT`) without understanding the 3-stage design in `CLAUDE.md`
- All alert DB inserts go through `insertAlert(type, severity, message, deviceId)`
- Email alerts go through `sendAlertEmail(...)` — it respects `emailAlertsEnabled` and cooldown maps

### Auth / sessions
- Protected routes must call `requireAuth` middleware first
- Admin-only routes add `requireRole('Admin')` after `requireAuth`
- Never expose `req.session` fields to the frontend beyond `user.userId`, `user.role`, `user.fullName`

### Frontend
- Pages load the shared sidebar via `fetch('/components/sidebar.html')` — keep it in `components/`
- JavaScript files in `js/` are served statically from `server.js` — no bundler, no transpile step
- Bootstrap 5.3 classes are used throughout; don't introduce a second CSS framework

### Socket.IO events (do not rename)
- `topology:hello` — initial handshake on connect
- `topology:update` — full topology payload `{ devices, links, reason, time }`
- `devices:update` — flat device array for the Device Inventory table
- `alert:new` — `{ type, severity, stage, message, deviceId, deviceName, time }`

## What agents should NOT do

- Push directly to `main`; always use the `Activity` branch or a new feature branch
- Drop or truncate any table — schema changes go through migrations
- Disable TLS verification for Supabase connections (`rejectUnauthorized` must stay `true`)
- Hardcode SMTP credentials, session secrets, or API keys — they belong in `.env`
- Change `CLOUD_MODE` behavior so scans run in cloud environments
- Add new npm packages without checking if the functionality is already available in the existing deps

## Testing

```sh
# From server/
npm test   # validates all SQL queries against PGlite — run before any DB change
```

Tests live in `server/tests/postgres.test.js`. Add a test case when adding new queries.

## File structure hints

- New API routes go in `server/server.js` following the existing Express pattern
- New frontend pages go in `html/` with a matching CSS file in `css/pages/`
- New frontend JS goes in `js/` and is loaded via a `<script>` tag in the HTML page
- New SQL migrations go in `server/migrations/` with the next 3-digit prefix (currently `003`)
