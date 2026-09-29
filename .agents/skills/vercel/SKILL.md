---
name: vercel
description: Use when deploying this project to Vercel, configuring environment variables for the cloud deployment, writing code that checks CLOUD_MODE, adding Vercel-specific configuration, or troubleshooting the read-only cloud dashboard. Trigger before modifying any code guarded by `CLOUD_MODE`, editing vercel.json, or setting up Vercel project settings.
---

# Vercel Deployment Skill — SmartCampus SecureNet

## Cloud mode architecture

When deployed to Vercel, the server runs as a **read-only dashboard**. Actual network scanning runs on the on-campus machine and pushes results to the shared Supabase database.

```
Campus machine (scanning)          Vercel (dashboard)
  └── server.js (full mode)           └── server.js (CLOUD_MODE=1)
       │                                    │
       ├── ping, ARP, SNMP                  ├── GET /api/devices ✓
       ├── writes to Supabase DB            ├── GET /api/topology ✓
       └── emits Socket.IO events           └── scan endpoints → 409 ✗
```

## CLOUD_MODE flag

Set in the environment: `VERCEL=1` (Vercel injects this automatically).

```js
const CLOUD_MODE = process.env.VERCEL === '1';
```

**What CLOUD_MODE disables:**
- All scheduled timers (no ping sweep, no discovery, no router scan)
- `POST /api/monitor`, `POST /api/scan`, scan-settings writes
- Socket.IO scan triggers from the frontend
- ARP table reads and SNMP queries

**What still works in CLOUD_MODE:**
- All GET endpoints (devices, alerts, topology, activity logs, users)
- Session auth (login, logout, profile)
- Alert listing and resolution
- Device CRUD (add, edit, delete device — does not require a live scan)

## CLOUD_MODE guard pattern

Every route or function that requires a live network must check this early:

```js
// In route handler
if (CLOUD_MODE) {
  return res.status(409).json({
    error: 'Run network scans and manage scanner settings on the campus computer. This dashboard displays data saved to Supabase.'
  });
}
```

The regex in server.js already guards the most sensitive paths automatically:
```js
const needsCampusNetwork = /^\/api\/(monitor\/|ping(?:\/|$)|devices\/[^/]+\/ping(?:\/|$))/.test(req.path)
  || (req.method !== 'GET' && ['/api/settings/scanning', '/api/settings/email-alerts'].includes(req.path));
```

If you add a new scan endpoint, add it to this list or add a manual check.

## vercel.json

Place in the project root (next to `server/`):

```json
{
  "version": 2,
  "builds": [
    { "src": "server/server.js", "use": "@vercel/node" }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "server/server.js" }
  ]
}
```

Static assets (`html/`, `js/`, `css/`, `images/`, `components/`) are served by the Express static middleware, which works on Vercel via the Node.js runtime.

## Required environment variables on Vercel

Set these in the Vercel dashboard under Project → Settings → Environment Variables:

| Variable | Value | Notes |
|---|---|---|
| `SUPABASE_DB_URL` | Session pooler URL | From Supabase Connect panel |
| `SESSION_SECRET` | Random 32+ char string | Use a secret generator |
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app` | Your Vercel domain |
| `SESSION_COOKIE_SECURE` | `true` | Required for HTTPS |
| `VERCEL` | `1` | Enables cloud mode |
| `SUPABASE_URL` | Supabase project URL | For JS client features |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Optional, for AI features |
| `GOOGLE_AI_API_KEY` | `AIza...` | Optional, for Gemini features |

Do **not** set `SMTP_*` or `SNMP_*` on Vercel — email alerts and scanning run on the campus machine only.

## Session cookies on Vercel

Vercel runs behind a proxy. The app already handles this:

```js
if (CLOUD_MODE) app.set('trust proxy', 1);
```

And the session cookie:
```js
const SESSION_COOKIE_SECURE = CLOUD_MODE || process.env.SESSION_COOKIE_SECURE === 'true';
```

Ensure `SESSION_COOKIE_SECURE=true` is set in Vercel env vars, otherwise session cookies won't transmit over HTTPS.

## Supabase connection on Vercel

Use the **Session pooler** (port 5432), not the direct connection. Vercel's serverless functions have a 10-second limit; the session pooler handles connection reuse. From Supabase → Connect → Session:

```
postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
```

The `SUPABASE_DB_CA_FILE` env var is not needed on Vercel — the CA is included in the Node.js bundle.

## Deploying

```sh
# Install Vercel CLI (once)
npm i -g vercel

# From project root
vercel         # deploy to preview
vercel --prod  # deploy to production
```

Or connect the GitHub repo to Vercel for automatic deployments on push to `main`.

## Debugging cloud deployments

```sh
vercel logs   # stream recent function logs
vercel env ls # list environment variables
```

Common issues:
- **401 on every request**: `SESSION_SECRET` not set or mismatched between deployments
- **DB connection refused**: wrong pooler URL or password not percent-encoded
- **Topology empty**: campus machine is not running or not writing to Supabase
- **Scan returns 409**: expected — scans are blocked in cloud mode by design
