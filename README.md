SmartCampus SecureNet
A web-based network monitoring and device management system for the IC Building at Davao del Norte State College (DNSC).
Table of Contents


1. Project Overview
SmartCampus SecureNet is a full-stack web application for monitoring campus network infrastructure. It discovers devices on the campus subnet using ICMP ping and ARP table parsing, then tracks availability, latency, and network topology. Administrators and IT personnel can use the dashboard to view devices, manage device information, resolve alerts, and export reports.
Target environment: IC Building network, Davao del Norte State College (DNSC).
Implementation note: The original project notes mention optional SNMP support. Confirm whether SNMP is still implemented and in scope before relying on it; the core discovery description here uses ICMP and ARP.

2. Features
Feature	Description
Device Discovery	Discovers devices using ICMP ping sweeps and ARP table scanning.
Real-Time Status	Displays device status updates through Socket.IO.
Network Topology	Provides graph, floor-map, and hierarchy views.
Alerting	Tracks downtime, recovery, and high-latency alerts, with optional email notifications.
Analytics	Shows latency trends, uptime percentages, and alert summaries for 24-hour, 7-day, and 30-day periods.
Role-Based Access Control	Supports Admin and IT Staff roles.
Audit Log	Records user actions and system events, including user, action, IP, and timestamp.
CSV Export	Exports alert history and reports.
SNMP Support	Listed in the original notes as optional metadata collection from managed devices; verify current implementation and project scope.


3. Technology Stack
Backend
Component	Technology / Version
Runtime	Node.js 22+
Framework	Express 4.x
Database	Supabase PostgreSQL (pg)
Real-Time Communication	Socket.IO 4.7.5
Authentication / Sessions	express-session, bcryptjs
Email	nodemailer with Gmail SMTP
Network Utilities	ping, net-snmp, child_process


Frontend
Component	Technology / Version
UI Framework	Bootstrap 5.3.3
Charts	Chart.js 4.4.1
Network Visualization	Vis-Network 9.1.2, Cytoscape 3.30.2
Real-Time Client	Socket.IO Client 4.7.5
Icons	Font Awesome 6.5.1
Fonts	Google Fonts: IBM Plex Sans and Sora


4. Project Structure
smartCampus/
├── .env                         # Environment variables; do not commit
├── .gitignore
├── vercel.json                  # Vercel routing configuration
├── README.md
├── server/
│   ├── server.js                # Express server, API, scanning, Socket.IO
│   ├── package.json
│   └── package-lock.json
├── html/                        # Frontend HTML pages
│   ├── index.html               # Dashboard
│   ├── login.html
│   ├── signup.html
│   ├── devices.html
│   ├── topology.html
│   ├── alerts.html
│   ├── reports.html
│   ├── profile.html
│   ├── settings.html             # Admin only
│   ├── users.html                # Admin only
│   └── activity.html             # Admin only
├── js/                           # Frontend JavaScript modules
│   ├── script.js
│   ├── auth.js
│   ├── monitoring.js
│   ├── analytics.js
│   ├── users.js
│   └── activity.js
├── css/pages/                    # Page-specific stylesheets
├── components/
│   └── sidebar.html              # Reusable navigation sidebar
└── images/                       # Logos and floor-plan images
5. Prerequisites
Requirement	Version / Type	Notes
Node.js	22 or newer	Download Node.js
npm	9 or newer	Included with Node.js
Supabase	PostgreSQL project	A session-pooler connection is required for database migrations.
Git	Any recent version	Required to clone and manage the repository.
Operating System	Windows 10/11 or Linux	Network gateway detection uses platform-specific commands.


Windows note: The server uses ipconfig and arp -a to detect network information and connected devices. Run the server on a machine connected to the target campus network. Network scanning only works where you have authorization and suitable network access.
6. Installation
6.1 Clone the repository
Replace <repository-url> with the Git repository URL.
git clone <repository-url>
cd smartCampus
6.2 Install backend dependencies
cd server
npm install
cd ..
7. Environment Configuration
Create the environment file(s) required by the current backend implementation. Never commit real credentials or secrets.
7.1 Supabase configuration
The application notes specify Supabase PostgreSQL for application data. Add the following variables to the root .env file, replacing the placeholders with values from your Supabase project:
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_JWKS_URL=https://your-project.supabase.co/auth/v1/.well-known/jwks.json
SUPABASE_DB_URL=your_postgresql_session_pooler_connection_string
The hosting environment takes priority, followed by server/.env, then the root .env. Avoid defining the same Supabase credentials in multiple files.
The project notes reference getSupabaseClients() in server/supabase.js, with clients available through app.locals.supabase and app.locals.supabaseAdmin. The admin client bypasses Row Level Security (RLS), so it must only be used in authorized backend operations. Never expose the admin client or secret key to frontend code.
After installing dependencies, the original notes recommend running:
npm run check:supabase
Run this command from server/ if it is defined in server/package.json. It is intended to check the configured keys, database API, and JWKS endpoint without modifying data. Restart the backend after changing credentials.
7.2 Session, network scanning, and email variables
The original configuration notes also list the following variables for server/.env. Confirm which variables are read by the current code before using them, because the notes include both Supabase and legacy MySQL settings.
# Session
SESSION_SECRET=replace_with_a_secure_random_secret
SESSION_MAX_AGE_MS=28800000
SESSION_COOKIE_SECURE=false

# Network scanning
SNMP_ENABLED=false
ROUTER_IP=192.168.254.254
NETWORK_CIDR=
BLACKLISTED_IPS=

# Email alerts
ALERT_EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_sender@gmail.com
SMTP_PASS=your_gmail_app_password
ALERT_EMAIL_FROM=SmartCampus SecureNet
ALERT_EMAIL_TO=it_team@yourinstitution.edu

# CORS
ALLOWED_ORIGINS=http://localhost:3000
- Set SESSION_COOKIE_SECURE=true when the application is served over HTTPS.
- Use a Gmail App Password for SMTP_PASS, not your regular Google account password.
- Set ROUTER_IP, NETWORK_CIDR, and BLACKLISTED_IPS to match your authorized test network.
- Set ALLOWED_ORIGINS to the actual frontend origin(s).
7.3 Gmail App Password
1. Open Google Account Security.
2. Enable 2-Step Verification if it is not already enabled.
3. Open the App Passwords section.
4. Generate an app password and place it in SMTP_PASS.
8. Database Setup
Follow the project migration guide at [`server/MIGRATION.md`](server/MIGRATION.md) for database connection settings and data transfer.
From the server/ directory, run the scripts that are available in the current package.json:
npm run db:migrate
For importing existing MySQL records, configure the required MySQL connection and MYSQL_DATETIME_OFFSET, then run:
npm run db:import:mysql
The original project notes state that the migration creates seven application tables and that the MySQL importer preserves existing accounts, password hashes, device IDs, logs, and alerts. The importer is described as refusing to overwrite populated target tables and leaving the source MySQL data intact.
Database configuration reminder: The project notes identify Supabase PostgreSQL as the application database but also include legacy DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, and DB_NAME MySQL variables. Use the migration guide and current source code to determine which variables are required for your setup.
9. Running the Project
9.1 Start the backend
From the project root:
cd server
node server.js
The project notes state that the backend runs at http://localhost:4000 and prints the detected gateway IP and network CIDR during startup.
9.2 Serve the frontend
The frontend uses static HTML files. From the project root, start a local static server:
npx serve .
Open the login page at:
http://localhost:3000/html/login.html
If the static server uses a different port, update ALLOWED_ORIGINS and any frontend API configuration as needed. Opening an HTML file directly with file:// may cause browser-origin or CORS issues, so using a local server is recommended.
10. First-Time Setup
1. Start the backend and frontend as described in Running the Project.
2. Register an account at html/signup.html.
3. For a fresh database, the original notes provide this SQL example to assign the Admin role to your account. Run it only in the correct Supabase project and after confirming the table and column names:
   UPDATE public."USERS"
   SET "Role" = 'Admin'
   WHERE "Email" = 'your@email.com';
4. Log in at html/login.html.
5. Open Settings to configure automated scanning, scan intervals, and email alerts.
11. Usage Guide
Dashboard — html/index.html
Displays device totals, online-device count, average latency, active alerts, a latency trend chart, and a live ping feed.
Devices — html/devices.html
Lists discovered devices. Select a device to view or manage its details, including:
- IP address, MAC address, status, latency, and location
- Device name, type, building, floor, and room
- On-demand ping
- Device deletion (Admin only)
Topology — html/topology.html
Provides three views:
- Graph: Force-directed network diagram using Vis-Network.
- Floor Map: Device placement on floor-plan images.
- Hierarchy: Devices grouped by floor.
Alerts — html/alerts.html
Displays recent alerts, including danger, warning, and success severity levels. Users can resolve alerts and export alert history to CSV.
Reports — html/reports.html
Provides analytics for 24-hour, 7-day, and 30-day periods:
- Overview statistics
- Latency trends
- Per-device uptime percentages
- Alert summaries by type
Settings — html/settings.html (Admin only)
Controls scanning, scan intervals, and email-alert configuration.
Users — html/users.html (Admin only)
Supports user creation, deletion, and role management.
Activity Log — html/activity.html (Admin only)
Displays a paginated audit log of user actions and system events.
12. API Reference
The local backend API is described below. Unless otherwise configured, the base URL is http://localhost:4000.
Authentication
Method	Endpoint	Description
POST	/api/auth/login	Log in
POST	/api/auth/register	Register an account
POST	/api/auth/logout	Log out
GET	/api/auth/me	Get the current session user
PUT	/api/auth/profile	Update profile details


Devices
Method	Endpoint	Description
GET	/api/devices	List devices
DELETE	/api/devices/:id	Delete a device (Admin)
PUT	/api/devices/:id/location	Update device metadata or location
GET	/api/devices/:id/ping	Ping a specific device


Monitoring
Method	Endpoint	Description
GET	/api/monitor/router	Run an on-demand router scan
POST	/api/monitor/discover	Trigger network discovery
GET	/api/ping?target=IP	Ping a target IP address


Topology
Method	Endpoint	Description
GET	/api/topology	Get devices and network links


Alerts
Method	Endpoint	Description
GET	/api/alerts	Get the latest 100 alerts
PUT	/api/alerts/:id/resolve	Resolve an alert


Analytics
Method	Endpoint	Description
GET	/api/analytics/overview?period=24h	Get summary statistics
GET	/api/analytics/latency-trend?period=7d	Get latency time series
GET	/api/analytics/device-uptime?period=30d	Get device uptime percentages
GET	/api/analytics/alerts-summary?period=24h	Get alert breakdown


Settings (Admin)
Method	Endpoint	Description
GET	/api/settings/scanning	Get scanning status
PUT	/api/settings/scanning	Enable or disable scanning
GET	/api/settings/email-alerts	Get email-alert configuration
POST	/api/settings/email-alerts	Update email-alert configuration


Users (Admin)
Method	Endpoint	Description
GET	/api/users	List users
PUT	/api/users/:id/role	Change a user's role
DELETE	/api/users/:id	Delete a user


Audit Logs
Method	Endpoint	Description
GET	/api/activity-logs	Get paginated audit logs (Admin)


Real-Time Events (Socket.IO)
Event	Direction	Description
topology:update	Server → Client	Network topology changed
devices:update	Server → Client	Device list changed
devices:ping_stream	Server → Client	Live latency updates
alert:new	Server → Client	New alert generated


13. Troubleshooting
Backend cannot connect to Supabase
- Verify SUPABASE_DB_URL uses the correct PostgreSQL session-pooler connection string and database password.
- Run npm run db:migrate from server/ if the schema has not been created.
- If TLS verification fails, set SUPABASE_DB_CA_FILE to the downloaded project CA certificate, if required by the deployment.
- MySQL DB_* settings are described as being used by the import script; check the migration guide.
Gateway not detected or no devices discovered
- Confirm ROUTER_IP matches the actual gateway; on Windows, check ipconfig.
- Run the server with the permissions required by your operating system and network configuration.
- Set NETWORK_CIDR explicitly if automatic detection fails (for example, 192.168.1.0/24).
- Confirm the host is connected to the authorized network being monitored.
Email alerts are not sending
- Verify SMTP_USER and SMTP_PASS; use a Gmail App Password.
- Confirm that 2-Step Verification is enabled for the Google account.
- Set ALERT_EMAIL_ENABLED=true.
- Check the email-alert settings in the application.
CORS errors
- Confirm that the backend is running on port 4000.
- Set ALLOWED_ORIGINS to the frontend's actual origin.
- Avoid serving the frontend from a different port or origin unless it is configured in CORS.
Real-time updates are not working
- Confirm that the Socket.IO client and server versions are compatible.
- Check the browser console for WebSocket errors.
- Confirm that network or host firewalls are not blocking the backend connection.
14. Deployment
Backend — VPS or server
The original deployment notes describe using PM2 to keep the backend process running:
npm install -g pm2
cd smartCampus/server
pm2 start server.js --name smartcampus-backend
pm2 save
pm2 startup
For production, set SESSION_COOKIE_SECURE=true and serve the backend through HTTPS using a properly configured reverse proxy such as Nginx or Caddy.
Network-scanning limitation: Network discovery depends on access to the target local network and the host's network interfaces. A typical serverless deployment environment such as Vercel cannot directly scan devices on a private campus LAN. Run the scanning backend on an authorized machine or server with the required network access.

Frontend — Vercel
The project includes a root-level vercel.json. Review its rewrites and static-file paths before deployment. The original notes specify deploying the project root:
npm install -g vercel
vercel --prod
Set the backend's ALLOWED_ORIGINS to the deployed frontend domain. The frontend also needs a reachable backend API URL; confirm that the deployed frontend is not still pointing to localhost.
15. Security Notes
Before deploying publicly or using the system in production:
1. Protect environment files. Never commit .env files or real credentials. Check whether .env was committed with:
   git log --all --full-history -- .env
2. Rotate exposed credentials. If secrets were committed or shared, revoke and replace them, including Supabase keys, Gmail App Passwords, and the session secret.
3. Use HTTPS. Enable secure session cookies when the application is served over HTTPS.
4. Restrict CORS. Allow only trusted frontend origins; do not use a wildcard for a credentialed application.
5. Keep authentication rate limiting. The original notes state that express-rate-limit limits login attempts to five per 15 minutes. Verify that this remains enabled in the current code.
6. Protect privileged database access. Keep Supabase secret/service-role credentials on the backend only and apply appropriate authorization checks.
7. Limit network scanning to authorized systems. Configure the correct subnet and exclusions, and obtain permission before scanning campus devices.
SmartCampus SecureNet — Capstone Project, DNSC IC Building
