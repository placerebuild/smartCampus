# SmartCampus SecureNet — Claude Code Context

## Project overview

Campus network monitoring and management system for DNSC. Monitors network devices in real-time using ICMP ping, SNMP, and ARP scanning. Built with Express + PostgreSQL (Supabase) on the backend and vanilla HTML/JS/Bootstrap on the frontend.

## Architecture

```
smartCampus/
├── server/           Node.js Express backend (port 4000)
│   ├── server.js     Main application — routes, scanning, alerts, Socket.IO
│   ├── postgres.js   Pool factory and DB abstraction layer
│   ├── supabase.js   Supabase client initializer
│   ├── migrate.js    Schema migration runner
│   └── migrations/   SQL migration files (001_supabase, 002_sessions, 003_realtime)
├── html/             Frontend pages (index, devices, mainpage, users, profile, activity)
├── js/               Frontend scripts (script.js, monitoring.js, live-scan.js, etc.)
├── css/pages/        Per-page stylesheets
├── components/       Shared sidebar component
├── images/           Static assets
└── public/           Mirror of html/js/css/images served statically
```

**Runtime modes:**
- **Local** (`VERCEL` unset): full scanning, SNMP, ARP, scheduled scans, Socket.IO all enabled
- **Cloud** (`VERCEL=1`): read-only dashboard; scans are blocked with a 409 and a clear message

## Key commands

```sh
# From server/
npm install          # install dependencies
npm run db:migrate   # apply schema migrations to Supabase PostgreSQL
npm start            # start the backend on port 4000
npm test             # run query-validation tests against PGlite (no live DB needed)
npm run db:import:mysql  # one-shot MySQL → Supabase migration
```

## Environment variables

All live in root `.env` (or `server/.env` — server env overrides root):

| Variable | Purpose |
|---|---|
| `SUPABASE_DB_URL` | PostgreSQL session pooler connection string |
| `SUPABASE_DB_CA_FILE` | Optional CA cert path for TLS |
| `SUPABASE_URL` | Supabase project URL (for JS client features) |
| `SESSION_SECRET` | Express session signing key |
| `ROUTER_IP` | Fallback router IP when gateway detection fails |
| `SNMP_COMMUNITY` | SNMP community string (default: `public`) |
| `SNMP_ENABLED` | Enable/disable SNMP queries (default: `true`) |
| `NETWORK_CIDR` | Override discovery subnet (e.g. `192.168.1.0/24`) |
| `SMTP_HOST/PORT/USER/PASS` | Email alert configuration |
| `ALERT_EMAIL_TO` | Alert recipient email |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |
| `VERCEL` | Set to `1` in cloud/Vercel deployments |

## Database schema (PostgreSQL, schema: `public`)

Core tables:
- **`USERS`** — accounts with roles (`Admin`, `User`, `Viewer`)
- **`DEVICE`** — tracked network devices (IP, MAC, type, status, location FK)
- **`DEVICE_LOG`** — per-scan history records (status, latency, method)
- **`DEVICE_CONNECTION`** — router→endpoint links (`IsActive` flag)
- **`LOCATION`** — building/floor/room records
- **`ALERT`** — alert history (`AlertType`, `Severity`, `Issue`)
- **`SCAN_SESSION`** — discovery run history (trigger, CIDR, counts)
- **`activity_logs`** — user action audit trail

Private schema (`smartcampus_private`):
- **`sessions`** — express-session store (PgSession)

## Conventions

- All DB queries go through `dbPool.execute()` — never raw `pg` queries in routes
- Column names use `"QuotedCamelCase"` (PostgreSQL-style from MySQL migration)
- New devices default to `DEFAULT_ENDPOINT_TYPE` env var unless they answer SNMP
- Alert severity in DB: `High` / `Warning` / `Medium` / `Low` — mapped to Bootstrap `danger` / `warning` / `success` in the frontend
- Socket.IO events: `topology:update`, `topology:hello`, `devices:update`, `alert:new`
- The `CLOUD_MODE` flag gates any write to the DB that requires a live network scan

## Auth & security

- Session-based auth using `express-session` + `connect-pg-simple`
- Passwords hashed with `bcryptjs`
- `requireAuth` middleware on all `/api/*` protected routes
- `requireRole(...roles)` for admin-only endpoints
- RLS is enabled in Supabase; the app uses the session-pooler role, not the `anon` key
- Input validation regexes: `NAME_REGEX`, `EMAIL_REGEX`, `PASSWORD_REGEX`

## Alert pipeline

Three-stage progressive alerting to reduce noise:

| Stage | Threshold | Action |
|---|---|---|
| 1 — Silent | ~6 s (3 consecutive failures) | Internal status change only |
| 2 — Warning | ~30 s (15 failures) | Socket.IO + DB insert, no email |
| 3 — Critical | ~5 min (150 failures) or 3 incidents / 30 min | Socket.IO + DB + email via SMTP |

Latency alerts fire at ≥200 ms sustained for ~10 s (warning) or ≥500 ms / 60 s (critical).
Recovery messages are sent only when Stage 2 or higher was reached.

## AI integrations

- `@anthropic-ai/sdk` — Claude API (loaded in server.js)
- `@google/generative-ai` — Gemini API (loaded in server.js)
- Both are optional; the server starts without them if API keys are absent

## Skills available

| Skill | Trigger |
|---|---|
| `supabase-server` | Any code using `@supabase/server` |
| `network-monitoring` | Alert pipeline, ping sweep, SNMP, ARP scanning |
| `db-schema` | DB queries, schema migrations, DEVICE/ALERT tables |
| `claude-api` | Anthropic SDK usage, model selection, prompt design |
| `vercel` | Cloud deployment, environment variables, `CLOUD_MODE` |
| `openai` | Adding OpenAI integration to the AI layer |
| `alerts-email` | Three-stage severity pipeline, `insertAlert`, `sendAlertEmail`, SMTP config, email cooldowns |
| `analytics-ai-insights` | `GET /api/analytics/*` routes, `parsePeriod`, Gemini/Anthropic dual-provider AI insights |
| `topology-socketio` | `fetchTopologyPayload`, Socket.IO event contract, node/link shape, `emitTopologyUpdate` |
| `frontend-conventions` | New pages, auth guards, sidebar wiring, fetch conventions, CDN dependencies |
