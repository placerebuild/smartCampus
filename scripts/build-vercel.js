const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const output = path.join(root, 'public');
fs.mkdirSync(output, { recursive: true });
// Explicit allowlist: never copy environment files, backend source, logs, or SQL exports.
for (const directory of ['html', 'js', 'css', 'images', 'components']) {
  fs.cpSync(path.join(root, directory), path.join(output, directory), { recursive: true });
}
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const supabaseCdnTag = supabaseUrl && supabasePublishableKey
  ? '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js"></script>\n'
  : '';

for (const file of fs.readdirSync(path.join(output, 'html'))) {
  if (!file.endsWith('.html')) continue;
  const target = path.join(output, 'html', file);
  const html = fs.readFileSync(target, 'utf8').replace(/<head>/i, `<head>\n<script src="/runtime-config.js"></script>\n${supabaseCdnTag}`);
  fs.writeFileSync(target, html);
}

const supabaseConfigLines = [
  supabaseUrl             ? `window.SUPABASE_URL = ${JSON.stringify(supabaseUrl)};`             : '',
  supabasePublishableKey  ? `window.SUPABASE_PUBLISHABLE_KEY = ${JSON.stringify(supabasePublishableKey)};` : '',
].filter(Boolean).join('\n');

fs.writeFileSync(path.join(output, 'runtime-config.js'), `window.SMARTCAMPUS_CLOUD = true;
${supabaseConfigLines}
document.addEventListener('DOMContentLoaded', () => {
  if (/login|signup|mainpage/.test(location.pathname)) return;
  const notice = document.createElement('div');
  notice.className = 'alert alert-info rounded-0 mb-0 text-center small';
  notice.setAttribute('role', 'status');
  notice.textContent = 'Cloud dashboard: showing the latest saved data. Live network scans run on the campus computer.';
  document.body.prepend(notice);
});
`);
console.log('Vercel public assets prepared.');
