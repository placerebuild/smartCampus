const fs = require('fs');
const path = require('path');
const { createPool } = require('./postgres');

async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(73821501)");
    await client.query('CREATE TABLE IF NOT EXISTS public.smartcampus_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    await client.query('REVOKE ALL ON public.smartcampus_migrations FROM anon, authenticated');
    const { rows } = await client.query('SELECT version FROM public.smartcampus_migrations WHERE version = $1', ['001_supabase']);
    if (!rows.length) {
      const existing = await client.query(
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2::text[])',
        ['public', ['USERS', 'LOCATION', 'DEVICE', 'DEVICE_LOG', 'DEVICE_CONNECTION', 'ALERT', 'activity_logs']]);
      if (existing.rows.length) throw new Error('Application tables already exist without migration history. Inspect their schema before migrating; no existing tables were modified.');
      await client.query(fs.readFileSync(path.join(__dirname, 'migrations', '001_supabase.sql'), 'utf8'));
      await client.query('INSERT INTO public.smartcampus_migrations (version) VALUES ($1)', ['001_supabase']);
    }
    const sessions = await client.query('SELECT version FROM public.smartcampus_migrations WHERE version = $1', ['002_sessions']);
    if (!sessions.rows.length) {
      await client.query(fs.readFileSync(path.join(__dirname, 'migrations', '002_sessions.sql'), 'utf8'));
      await client.query('INSERT INTO public.smartcampus_migrations (version) VALUES ($1)', ['002_sessions']);
    }
    const realtime = await client.query('SELECT version FROM public.smartcampus_migrations WHERE version = $1', ['003_realtime']);
    if (!realtime.rows.length) {
      await client.query(fs.readFileSync(path.join(__dirname, 'migrations', '003_realtime.sql'), 'utf8'));
      await client.query('INSERT INTO public.smartcampus_migrations (version) VALUES ($1)', ['003_realtime']);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { migrate };
if (require.main === module) {
  (async () => {
    const pool = createPool();
    try { await migrate(pool); console.log('Supabase schema migration complete.'); }
    finally { await pool.end(); }
  })().catch(error => { console.error('Migration failed:', error.code || error.message); process.exitCode = 1; });
}
