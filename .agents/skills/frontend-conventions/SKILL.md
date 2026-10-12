---
name: frontend-conventions
description: Use when adding a new HTML page, JS module, fetch call, auth guard, or sidebar integration to the SmartCampus dashboard. Trigger before creating any file in html/ or js/, wiring a new fetch to an API endpoint, setting up a page-level role guard, adding CDN dependencies, or using escapeHtml/formatLastSeen utilities in script.js.
---

# Frontend Conventions Skill — SmartCampus SecureNet

## Overview

No bundler, no framework. Every page is a plain `.html` in `html/`, with a corresponding `.js` in `js/` and `.css` in `css/pages/`. The server statically serves `html/`, `js/`, `css/`, `images/`, and `components/` directly. Paths in HTML reference sibling directories with `../` (e.g. `../js/script.js`).

## Global base URL

Every JS file that makes API calls must define:

```js
const API_BASE = window.MONITOR_API_BASE || window.location.origin;
```

`window.MONITOR_API_BASE` is injected by the server config when present. The `||` fallback ensures pages work when opened directly. **Never hardcode `http://localhost:3000` or any other origin.**

## Fetch convention

Every `fetch()` call to any `/api/*` path must include `credentials: 'include'`:

```js
const res = await fetch(`${API_BASE}/api/devices`, { credentials: 'include' });
```

Omitting it causes the session cookie to not be sent, producing a 401 with no helpful error message.

## Script load order

Every page follows this order (confirmed from `html/index.html`):

```html
<!-- 1. Shared globals and utilities — always first -->
<script src="../js/script.js"></script>

<!-- 2. Optional: monitoring/realtime — only on pages with device tables or live UI -->
<script src="../js/monitoring.js"></script>

<!-- 3. Auth guard — always last, always type="module" -->
<script type="module" src="../js/auth.js"></script>
```

`auth.js` must be **last** and must have `type="module"`. `script.js` must come first because both `auth.js` and `monitoring.js` depend on its globals.

## Auth guards (`js/auth.js`)

**Default** — including `auth.js` on any non-auth page auto-redirects unauthenticated users to `login.html`.

**Role-only page** — set before `auth.js` loads:
```html
<script>window.pageRequiredRole = 'Admin';</script>
<script type="module" src="../js/auth.js"></script>
```

**Async role check** — call before rendering sensitive content:
```js
await window.requirePageRole('Admin'); // redirects non-Admin users to index.html
```

## Sidebar

Every page needs these two things in `<body>`:

```html
<body class="sidebar-layout">
  <div id="sidebar-container"></div>
  <!-- rest of page -->
```

`loadSidebar()` is called automatically by `script.js` on load — **do not call it manually**. A double call fetches `components/sidebar.html` twice and produces duplicate nav items. Admin-only nav items have `data-admin-only` and are hidden by default; `loadSidebar()` reveals them after verifying `user.role === 'Admin'` via `/api/auth/me`.

## CDN dependencies

Load all CDN scripts in `<head>` before `script.js`. Do not mix vis-network and Cytoscape on the same page.

| Library | Version | Used on |
|---|---|---|
| Bootstrap 5 CSS + JS | 5.3.3 | All pages |
| Font Awesome | 6.5.1 | All pages |
| Chart.js | 4.4.1 | Dashboard, reports |
| Socket.IO client | 4.7.5 | Dashboard, topology |
| vis-network | 9.1.2 | Topology only |
| Cytoscape | 3.30.2 | Dashboard only |

## Utility functions in `js/script.js`

| Function | Purpose |
|---|---|
| `escapeHtml(str)` | Escapes `&`, `<`, `>`, `"`, `'` — use for any user-controlled string going into `innerHTML` |
| `formatLastSeen(value)` | Converts ISO date to `toLocaleString()`, returns `''` for falsy |
| `formatLocationLabel(building, floor, room)` | Joins non-empty parts with ` / ` |
| `resolveLocationLabel(device)` | Uses `device.location` if set, falls back to `formatLocationLabel` |
| `upsertDevice(device)` | Updates `devicesData` array by IP |
| `getDeviceKey(device)` | Returns `device.id \|\| device.ip` as a string |

## Adding a new page — checklist

1. Create `html/newpage.html` — copy `<head>` from an existing page; update title and CSS path
2. Set `<body class="sidebar-layout">`
3. Add `<div id="sidebar-container"></div>` as first child of `<body>`
4. Add Bootstrap and Font Awesome CDN links in `<head>`
5. Add script tags at end of `<body>`: `script.js` → `monitoring.js` (if needed) → `auth.js type="module"`
6. Add a nav link in `components/sidebar.html` (and `public/components/sidebar.html`)
7. Create `js/newpage.js` with a page-guard at the top:
   ```js
   if (!document.getElementById('some-unique-anchor')) return;
   ```
8. Create `css/pages/newpage.css` for page-specific styles

## Common mistakes to avoid

- **Missing `credentials: 'include'`** on fetch calls — produces silent 401s; always include it.
- **`innerHTML` with raw data** — always run user-controlled strings through `escapeHtml()` first.
- **Loading `auth.js` before `script.js`** — `auth.js` depends on globals defined in `script.js`.
- **Omitting `type="module"` on `auth.js`** — it must be a module for deferred execution and `import`/`export`.
- **Calling `loadSidebar()` manually** — it runs automatically; a second call duplicates the nav.
- **Hardcoding `localhost`** — always use `window.MONITOR_API_BASE || window.location.origin`.
- **Mirroring to `public/`** — the `public/` directory is a mirror of `html/`, `js/`, `css/`, and `components/`; update both when adding pages or sidebar links.
