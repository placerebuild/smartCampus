---
name: alerts-email
description: Use when writing or modifying the three-stage severity escalation pipeline, insertAlert(), sendAlertEmail(), mapSeverityToDb/FromDb(), per-device email cooldowns, nodemailer SMTP setup, or latency/downtime alert thresholds. Trigger before editing OFFLINE_WARN, OFFLINE_CRIT, LATENCY_WARN_MS, LATENCY_CRIT_MS, the abnormalEmailCooldowns map, or any call to insertAlert or sendAlertEmail in server.js.
---

# Alerts & Email Skill — SmartCampus SecureNet

## Overview

The alert pipeline lives entirely in `server/server.js`. Three concerns interlock:

1. **Severity conversion** — Bootstrap tokens ↔ DB strings via `mapSeverityToDb` / `mapSeverityFromDb`
2. **DB persistence** — `insertAlert()` writes to the `ALERT` table
3. **Email dispatch** — `sendAlertEmail()` uses nodemailer with a per-device cooldown for `abnormal` alerts

Email is only ever sent at **Stage 3 (critical)** and on **recovery when Stage 2+ was already reached**. Never at Stage 1 or Stage 2.

## SMTP configuration

Six env vars control email (all optional — server starts and runs without them):

| Env var | Purpose |
|---|---|
| `SMTP_HOST` | Mail server hostname |
| `SMTP_PORT` | Mail server port (default 587) |
| `SMTP_SECURE` | `'true'` for port 465 TLS |
| `SMTP_USER` | Login username |
| `SMTP_PASS` | Login password |
| `ALERT_EMAIL_FROM` | Sender address |
| `ALERT_EMAIL_TO` | Recipient address |
| `ALERT_EMAIL_ENABLED` | `'false'` to disable at startup |

`mailer` is `null` when `SMTP_HOST`, `SMTP_USER`, or `SMTP_PASS` is absent. `sendAlertEmail()` is a silent no-op when `mailer` is null or when `emailAlertsEnabled` is false. Toggle at runtime via `PUT /api/settings/email-alerts`.

Do **not** set these vars on Vercel — email runs on the campus machine only (see the `vercel` skill).

## Severity mapping

`insertAlert` accepts a **Bootstrap token** and calls `mapSeverityToDb` internally — do not pre-convert.

| Bootstrap token (pass to insertAlert) | DB string (stored in ALERT) |
|---|---|
| `danger` | `High` |
| `warning` | `Warning` |
| `success` | `Low` |
| *(anything else)* | `Medium` |

`mapSeverityFromDb` additionally maps `Critical` → `danger` and `Medium` → `warning` for legacy rows.

## `insertAlert(type, severity, message, deviceId)`

- `type`: `'downtime' | 'recovery' | 'abnormal'`
- `severity`: Bootstrap token (`'danger' | 'warning' | 'success'`) — **not** the DB string
- `deviceId`: number or `null` for system-level alerts
- Calls `mapSeverityToDb(severity)` internally before writing to DB
- Fire-and-forget safe — it never throws to the caller

## `sendAlertEmail(type, severity, message, deviceName, deviceId)`

Wraps nodemailer. For `type === 'abnormal'`, consults `abnormalEmailCooldowns` Map:

```js
const ABNORMAL_EMAIL_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes per device
```

`'downtime'` and `'recovery'` emails have **no cooldown**. Always call `insertAlert` alongside `sendAlertEmail` — never one without the other.

## Stage thresholds

Each ping interval is ~2 seconds. All constants are at module level in `server.js` — do not change without updating the accompanying wall-clock comments.

| Constant | Value | Wall time | Action |
|---|---|---|---|
| `OFFLINE_THRESHOLD` | 3 | ~6 s | Stage 1: internal status change only — no socket, no DB, no email |
| `OFFLINE_WARN` | 15 | ~30 s | Stage 2: socket `alert:new` + `insertAlert`, no email |
| `OFFLINE_CRIT` | 150 | ~5 min | Stage 3: socket + `insertAlert` + `sendAlertEmail` |
| `OFFLINE_FREQ_COUNT` | 3 incidents/30 min | — | Fast-track device straight to Stage 3 on 3rd incident in 30 min |
| `RECOVERY_THRESHOLD` | 2 | ~4 s | Consecutive successes required to declare recovery |

## Latency alert thresholds

| Constant | Value | Sustained pings | Action |
|---|---|---|---|
| `LATENCY_WARN_MS` | 200 ms | 5 (~10 s) | Stage 1 latency: socket + DB |
| `LATENCY_CRIT_MS` | 500 ms | 30 (~60 s) | Stage 2 latency: socket + DB + email |

A single ping ≥ 500 ms bypasses the ping-count wait and fires critical immediately.

## Recovery rule

`insertAlert('recovery', ...)` and `sendAlertEmail('recovery', ...)` only fire when `alertStage >= 2` at the moment recovery is detected. A device that was only at Stage 1 (silent) when it came back online produces **no** recovery alert.

## Common mistakes to avoid

- **Always pair** `insertAlert` + `sendAlertEmail` — never call one without the other at Stage 3.
- **Do not email at Stage 1 or Stage 2** — only Stage 3 downtime and recovery from Stage 2+.
- **Do not pre-convert severity** before passing to `insertAlert` — it calls `mapSeverityToDb` internally; passing a DB string will double-map it.
- **Do not add SMTP vars to Vercel** — cloud mode is read-only and cannot send emails.
- **Do not change threshold constants** without updating the inline wall-clock comments — they document behavior tied to the 2-second ping interval.
