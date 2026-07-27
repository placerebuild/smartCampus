# SmartCampus SecureNet

Real-time campus network monitoring and device management system for IC Building, DNSC.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Features](#2-features)
3. [Technology Stack](#3-technology-stack)
4. [Folder Structure](#4-folder-structure)
5. [Prerequisites](#5-prerequisites)
6. [Installation](#6-installation)
7. [Environment Configuration](#7-environment-configuration)
8. [Database Setup](#8-database-setup)
9. [Running the Project](#9-running-the-project)
10. [First-Time Setup](#10-first-time-setup)
11. [Usage Guide](#11-usage-guide)
12. [API Reference](#12-api-reference)
13. [Troubleshooting](#13-troubleshooting)
14. [Deployment](#14-deployment)
15. [Security Notes](#15-security-notes)

---

## 1. Project Overview

SmartCampus SecureNet is a full-stack web application for monitoring campus network infrastructure in real time. It discovers devices connected to the campus subnet via ICMP ping, ARP table parsing, and optional SNMP queries, then tracks their availability, latency, and topology. Administrators and IT staff can view dashboards, manage devices, resolve alerts, and export reports.

Target environment: IC Building network — DNSC (De La Salle University – Dasmariñas).

---

## 2. Features

| Feature | Description |
|---------|-------------|
| Device Discovery | Automated ICMP ping sweep + ARP table scanning |
| Real-Time Status | Live device online/offline feed via Socket.IO |
| Network Topology | Graph view, floor map overlay, hierarchy view (Vis-Network) |
| Alerting | Downtime, recovery, and high-latency alerts with email notifications |
| Analytics | Latency trends, uptime %, alert summaries — 24h / 7d / 30d periods |
| RBAC | Role-based access control — Admin and IT Staff roles |
| Audit Log | Complete activity trail with user, action, IP, and timestamp |
| CSV Export | Export alert history and reports |
| SNMP Support | Optional SNMP metadata collection from managed devices |

---

## 3. Technology Stack

### Backend
| Component | Library/Version |
|-----------|----------------|
| Runtime | Node.js 18+ LTS |
| Framework | Express 4.x |
| Database | MySQL 8 (mysql2/promise) |
| Real-time | Socket.IO 4.7.5 |
| Auth | express-session + bcryptjs |
| Email | nodemailer (Gmail SMTP) |
| Network | ping, net-snmp, child_process |

### Frontend
| Component | Library/Version |
|-----------|----------------|
| UI Framework | Bootstrap 5.3.3 |
| Charts | Chart.js 4.4.1 |
| Topology | Vis-Network 9.1.2, Cytoscape 3.30.2 |
| Real-time | Socket.IO Client 4.7.5 |
| Icons | Font Awesome 6.5.1 |
| Fonts | Google Fonts (IBM Plex Sans, Sora) |

---

## 4. Folder Structure

```
smartCampus/
├── .env                        # Environment configuration (never commit)
├── .gitignore
├── vercel.json                 # Vercel deployment rewrites
├── README.md
├── server/
│   ├── server.js              # Main Express server (API, scanning, Socket.IO)
│   ├── package.json
│   └── package-lock.json
├── html/                       # Frontend HTML pages
│   ├── index.html             # Dashboard
│   ├── login.html
│   ├── signup.html
│   ├── devices.html
│   ├── topology.html
│   ├── alerts.html
│   ├── reports.html
│   ├── profile.html
│   ├── settings.html          # Admin only
│   ├── users.html             # Admin only
│   └── activity.html          # Admin only
├── js/                         # Frontend JavaScript modules
│   ├── script.js              # Core app logic
│   ├── auth.js                # Auth / session management
│   ├── monitoring.js          # Real-time monitoring cycle
│   ├── analytics.js           # Analytics charts
│   ├── users.js               # User management UI
│   └── activity.js            # Activity log UI
├── css/pages/                  # Per-page stylesheets
├── components/
│   └── sidebar.html           # Reusable navigation sidebar
└── images/                     # Logos and floor plan images
```

---

## 5. Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 18+ LTS | [nodejs.org](https://nodejs.org) |
| npm | 9+ | Bundled with Node.js |
| MySQL | 8.0+ | Running on localhost:3306 |
| Git | Any | |
| OS | Windows 10/11 or Linux | ARP/gateway detection uses `ipconfig` on Windows, `ip route` on Linux |

> **Windows users**: The server uses `ipconfig` and `arp -a` to detect the gateway and connected devices. Run the server on the same machine connected to the campus network.

---

## 6. Installation

```bash
# 1. Clone the repository
git clone <repository-url>
cd smartCampus

# 2. Install backend dependencies
cd server
npm install
cd ..
```

---

## 7. Environment Configuration

Create a `.env` file in the `server/` directory (copy the template below). **Never commit this file.**

```env
# ── Database ───────────────────────────────────────────
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_root_password
DB_NAME=smartcampus

# ── Session ────────────────────────────────────────────
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=replace_with_64_char_random_hex_string
SESSION_MAX_AGE_MS=28800000
SESSION_COOKIE_SECURE=false       # Set to true when running behind HTTPS

# ── Network Scanning ───────────────────────────────────
SNMP_ENABLED=false
ROUTER_IP=192.168.254.254         # Your campus gateway IP
NETWORK_CIDR=                     # Optional: auto-detected if left blank
BLACKLISTED_IPS=                  # Comma-separated IPs to exclude from scan

# ── Email Alerts ───────────────────────────────────────
ALERT_EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_sender@gmail.com
SMTP_PASS=your_gmail_app_password  # Google App Password (not your login password)
ALERT_EMAIL_FROM=SmartCampus SecureNet
ALERT_EMAIL_TO=it_team@yourinstitution.edu

# ── CORS (production) ──────────────────────────────────
ALLOWED_ORIGINS=http://localhost:3000
```

### Generating a Gmail App Password

1. Go to [Google Account](https://myaccount.google.com) → Security → 2-Step Verification (must be enabled)
2. Search for "App Passwords"
3. Create a new app password for "Mail"
4. Paste the 16-character password into `SMTP_PASS`

---

## 8. Database Setup

The server automatically creates all tables on first startup via built-in migrations. You only need to create the database itself:

```bash
# Open MySQL CLI
mysql -u root -p
```

```sql
CREATE DATABASE smartcampus
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

EXIT;
```

### Tables Created Automatically

| Table | Purpose |
|-------|---------|
| `USERS` | User accounts with roles (Admin / ITStaff) |
| `DEVICE` | Network device inventory |
| `DEVICE_LOG` | Historical ping/scan records per device |
| `DEVICE_CONNECTION` | Network topology links (router ↔ endpoint) |
| `LOCATION` | Physical locations (building / floor / room) |
| `ALERT` | System alerts (downtime, recovery, latency) |
| `activity_logs` | User and system audit trail |

---

## 9. Running the Project

### Start the Backend Server

```bash
cd server
node server.js
```

The server starts on **http://localhost:4000** and prints a startup message including the detected gateway IP and CIDR.

### Serve the Frontend

The frontend is static HTML. Open pages directly in a browser or use a local static server:

```bash
# From the project root
npx serve .
```

Then navigate to: **http://localhost:3000/html/login.html**

> Alternatively, open `html/login.html` directly in a browser (file://) — API calls will still reach the backend at localhost:4000.

---

## 10. First-Time Setup

1. Start the backend server (step 9 above).
2. Register an account at `html/signup.html`.
3. Elevate the first account to Admin in MySQL:
   ```sql
   UPDATE USERS SET Role = 'Admin' WHERE Email = 'your@email.com';
   ```
4. Log in at `html/login.html`.
5. Navigate to **Settings** to configure:
   - Enable/disable automated scanning
   - Adjust scan interval
   - Toggle email alerts

---

## 11. Usage Guide

### Dashboard (`index.html`)
Shows total devices, online count, average latency, active alerts, a latency trend chart, and a live ping feed updated every 2 seconds.

### Devices (`devices.html`)
Lists all discovered devices. Click any row to open a detail modal where you can:
- View IP, MAC, status, latency, location
- Edit device name, type, building, floor, room
- Ping the device on demand
- Delete the device (Admin only)

### Topology (`topology.html`)
Three view modes:
- **Graph** — Force-directed Vis-Network diagram
- **Floor Map** — Drag-and-drop device placement on floor plan images
- **Hierarchy** — Tree view grouped by floor

### Alerts (`alerts.html`)
Shows the last 100 alerts with severity (danger / warning / success). Mark alerts as resolved. Export to CSV.

### Reports (`reports.html`)
Four analytics panels with 24h / 7d / 30d time selectors:
- Overview stats
- Latency trend chart
- Per-device uptime %
- Alert summary by type

### Settings (`settings.html`) — Admin only
Toggle scanning on/off, set scan interval, configure email alerts at runtime.

### Users (`users.html`) — Admin only
Create, delete, and change roles of user accounts.

### Activity Log (`activity.html`) — Admin only
Paginated audit log of all user actions and system events.

---

## 12. API Reference

All endpoints are served at `http://localhost:4000`.

### Authentication
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Log in |
| POST | `/api/auth/register` | Register new account |
| POST | `/api/auth/logout` | Log out |
| GET | `/api/auth/me` | Get current session user |
| PUT | `/api/auth/profile` | Update profile (name, contact) |

### Devices
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/devices` | List all devices |
| DELETE | `/api/devices/:id` | Delete device (Admin) |
| PUT | `/api/devices/:id/location` | Update device metadata |
| GET | `/api/devices/:id/ping` | Live ping specific device |

### Monitoring
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/monitor/router` | On-demand router scan |
| POST | `/api/monitor/discover` | Trigger network discovery |
| GET | `/api/ping?target=IP` | Ping arbitrary IP |

### Topology
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/topology` | Network topology (devices + links) |

### Alerts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/alerts` | Last 100 alerts |
| PUT | `/api/alerts/:id/resolve` | Resolve alert |

### Analytics
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/analytics/overview?period=24h` | Summary stats |
| GET | `/api/analytics/latency-trend?period=7d` | Latency time series |
| GET | `/api/analytics/device-uptime?period=30d` | Per-device uptime % |
| GET | `/api/analytics/alerts-summary?period=24h` | Alert breakdown |

### Settings (Admin)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings/scanning` | Scanning enabled status |
| PUT | `/api/settings/scanning` | Toggle scanning |
| GET | `/api/settings/email-alerts` | Email alert config |
| POST | `/api/settings/email-alerts` | Update email alerts |

### Users (Admin)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List all users |
| PUT | `/api/users/:id/role` | Change user role |
| DELETE | `/api/users/:id` | Delete user |

### Audit
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/activity-logs` | Paginated audit logs (Admin) |

### Real-Time (Socket.IO)
| Event | Direction | Description |
|-------|-----------|-------------|
| `topology:update` | Server → Client | Topology changed |
| `devices:update` | Server → Client | Device list changed |
| `devices:ping_stream` | Server → Client | Live latency data (2s) |
| `alert:new` | Server → Client | New alert generated |

---

## 13. Troubleshooting

### Server fails to connect to MySQL
- Confirm MySQL is running: `mysql -u root -p` should succeed
- Check `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` in `.env`
- Ensure the `smartcampus` database exists

### Gateway not detected / no devices discovered
- Confirm `ROUTER_IP` in `.env` matches your actual gateway (check with `ipconfig` on Windows)
- Run the server as Administrator on Windows (ICMP ping may require elevated privileges)
- Set `NETWORK_CIDR` explicitly if auto-detection fails (e.g., `192.168.1.0/24`)

### Email alerts not sending
- Verify `SMTP_USER` and `SMTP_PASS` are correct (use a Gmail App Password, not your login password)
- Check that 2-Step Verification is enabled on the Gmail account
- Set `ALERT_EMAIL_ENABLED=true` in `.env`
- Toggle email alerts from the Settings page after login

### `CORS` errors in browser console
- The backend must be running on port 4000
- Set `ALLOWED_ORIGINS` in `.env` to the URL serving your frontend
- Do not open HTML files via a different port without updating `ALLOWED_ORIGINS`

### Real-time updates not working
- Confirm Socket.IO client version matches server (both 4.7.5)
- Check browser console for WebSocket errors
- Ensure no firewall is blocking port 4000

---

## 14. Deployment

### Backend (any VPS / server)

```bash
# Install PM2 for process management
npm install -g pm2

cd smartCampus/server
pm2 start server.js --name smartcampus-backend
pm2 save
pm2 startup
```

Set `SESSION_COOKIE_SECURE=true` and run behind an HTTPS reverse proxy (nginx/Caddy).

### Frontend (Vercel)

The `vercel.json` at the project root rewrites all routes to `html/index.html`. Deploy the project root to Vercel:

```bash
npm install -g vercel
vercel --prod
```

Update `ALLOWED_ORIGINS` in the backend `.env` to the deployed Vercel domain.

---

## 15. Security Notes

> The following must be addressed before any public or production deployment:

1. **Never commit `.env`** — The `.gitignore` excludes it; verify it was never accidentally committed with `git log --all --full-history -- .env`.
2. **Rotate credentials** if the `.env` was ever committed — revoke and regenerate your Gmail App Password and choose a new `SESSION_SECRET`.
3. **Use HTTPS** in production — set `SESSION_COOKIE_SECURE=true` and enforce HTTPS at the reverse proxy level.
4. **Restrict CORS** — set `ALLOWED_ORIGINS` to only your frontend domain, not a wildcard.
5. **Rate limiting** — `express-rate-limit` is applied to `/api/auth/login` (5 attempts / 15 min). Do not remove it.

---

*SmartCampus SecureNet — Capstone Project, DNSC IC Building*
