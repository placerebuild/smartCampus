---
name: analytics-ai-insights
description: Use when adding or modifying analytics data endpoints or the AI-powered insights route. Trigger before editing any GET /api/analytics/* handler, parsePeriod(), the Gemini integration in the ai-insights route, or any code that aggregates DEVICE_LOG/ALERT data for reporting. Also trigger before wiring Anthropic as a primary provider with Gemini as a fallback.
---

# Analytics & AI Insights Skill — SmartCampus SecureNet

## Overview

Eight data endpoints and one AI endpoint all live under `GET /api/analytics/<name>` in `server/server.js`. All require `requireAuth` middleware. All accept a `?period=` query parameter. The frontend (`js/analytics.js`, used on `reports.html`) fetches all nine in parallel on page load.

## `parsePeriod(raw)` helper

Every analytics route must call this first:

```js
const period = parsePeriod(req.query.period);
if (!period) return res.status(400).json({ error: 'Invalid period. Use 24h, 7d, or 30d.' });
```

Valid values and their SQL day counts:

| `?period=` | `period.days` | `period.label` |
|---|---|---|
| `24h` | 1 | `'24h'` |
| `7d` | 7 | `'7d'` |
| `30d` | 30 | `'30d'` |
| anything else | — | returns `null` |

Use `period.days` in SQL: `NOW() - ($1 * INTERVAL '1 day')`. Never compute the date window in JavaScript.

## Analytics endpoints

| Endpoint | Purpose | Primary table(s) |
|---|---|---|
| `overview` | Summary counts, uptime %, avg latency | `DEVICE`, `DEVICE_LOG` |
| `latency-trend` | Hourly avg/min/max latency over period | `DEVICE_LOG` |
| `device-uptime` | Per-device uptime % + avg latency | `DEVICE_LOG` |
| `alerts-summary` | Alert counts by type and severity | `ALERT` |
| `incident-trend` | Downtime incidents per day | `DEVICE_LOG` |
| `peak-hours` | Alert counts by hour of day | `ALERT` |
| `top-problem-devices` | Devices with most alerts | `ALERT`, `DEVICE` |
| `location-health` | Uptime + alert count per building | `DEVICE_LOG`, `LOCATION`, `DEVICE` |

Use `DEVICE_LOG` for **historical/period** metrics. Use `DEVICE` only for **current live state** (active count, current status). Never aggregate period data from the `DEVICE` table alone.

## `ai-insights` endpoint

`GET /api/analytics/ai-insights` — currently uses Gemini only (`gemini-2.5-flash`). Returns 503 if `GEMINI_API_KEY` is absent.

Response shape:
```json
{
  "period": "24h",
  "insights": "<markdown text>",
  "generatedAt": "2026-10-12T10:00:00.000Z"
}
```

The route gathers five parallel DB queries before calling the model: overview stats, latency trend sample, devices with uptime < 90%, alert severity counts, and top problem devices. The prompt asks for three structured sections: health status, observations, and recommendations.

## Dual-provider pattern (recommended for new AI routes)

`@anthropic-ai/sdk` is installed. For any new AI call in this file, use Anthropic as primary and Gemini as fallback:

```js
const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
const hasGemini    = Boolean(process.env.GEMINI_API_KEY);
if (!hasAnthropic && !hasGemini) {
  return res.status(503).json({ error: 'AI insights are not configured.' });
}

let result;
if (hasAnthropic) {
  try {
    // Use Anthropic — see the claude-api skill for SDK usage and max_tokens guidance
    // 1024 tokens is appropriate for insights-style responses
    result = await callAnthropic(prompt);
  } catch (err) {
    if (!hasGemini) throw err;
    result = await callGemini(prompt);
  }
} else {
  result = await callGemini(prompt);
}
```

Note: the current `ai-insights` route does **not** implement this pattern yet — it is Gemini-only. See the `claude-api` skill for Anthropic SDK usage.

## Common mistakes to avoid

- **Never skip the null check on `parsePeriod`** — a missing or misspelled `?period=` returns null, and `period.days` will crash.
- **Never compute the date window in JavaScript** — always use `NOW() - ($1 * INTERVAL '1 day')` in SQL.
- **Never aggregate period data from `DEVICE` table** — use `DEVICE_LOG` for historical metrics.
- **Always guard the provider key before initializing the SDK client** — do not let a missing key cause an unhandled error at startup or request time.
- **Always return 503** (not 500) when both AI provider keys are absent — it signals a configuration issue, not a server error.
