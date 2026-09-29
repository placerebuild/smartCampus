const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { PGlite } = require('@electric-sql/pglite');
const { bindParameters, createDatabase } = require('../postgres');
const { migrate } = require('../migrate');

test('parameters remain bound values, including quote and injection payloads', () => {
  const payload = "'; DROP TABLE USERS; --";
  assert.deepEqual(bindParameters(`SELECT '?' AS "?", ? AS value`, [payload]), {
    text: `SELECT '?' AS "?", $1 AS value`, values: [payload],
  });
  assert.throws(() => bindParameters('SELECT ?', []), /count mismatch/);
});

test('schema migration is tracked, repeatable, and refuses untracked existing tables', async () => {
  const db = new PGlite();
  const client = {
    async query(sql, params) {
      if (params) return db.query(sql, params);
      const results = await db.exec(sql);
      return results.at(-1);
    },
    release() {},
  };
  const pool = { connect: async () => client };
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE "USERS" (original text);');
    await assert.rejects(migrate(pool), /tables already exist/);
    assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'USERS'")).rows[0].column_name, 'original');
    await db.exec('DROP TABLE "USERS";');
    await migrate(pool);
    await migrate(pool);
    assert.equal((await db.query('SELECT count(*) AS n FROM smartcampus_migrations')).rows[0].n, 3);
  } finally { await db.close(); }
});

test('schema, all backend queries, relational integrity, analytics and RLS', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    const schema = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_supabase.sql'), 'utf8');
    await db.exec(schema);
    await db.exec(schema);
    const realtimeSchema = fs.readFileSync(path.join(__dirname, '..', 'migrations', '003_realtime.sql'), 'utf8');
    await db.exec(realtimeSchema);
    await db.exec(realtimeSchema);

    // Parse actual application SQL so new or missed query variants fail validation.
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const ast = acorn.parse(source, { ecmaVersion: 'latest', locations: true });
    const queries = [];
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' &&
          node.callee.object.name === 'dbPool' && node.callee.property.name === 'execute') {
        const arg = node.arguments[0];
        if (arg.type === 'Literal') queries.push({ sql: arg.value, line: arg.loc.start.line });
        else if (arg.type === 'TemplateLiteral') {
          for (const filter of ['', 'AND "DeviceID" = ?']) {
            const substitutions = { placeholders: '?, ?', ph: '?, ?', bucketFmt: 'YYYY-MM-DD HH24:00', deviceFilter: filter };
            let sql = arg.quasis[0].value.cooked;
            arg.expressions.forEach((expr, i) => {
              assert.ok(expr.type === 'Identifier' && expr.name in substitutions, `Uncovered interpolation on line ${expr.loc.start.line}`);
              sql += substitutions[expr.name] + arg.quasis[i + 1].value.cooked;
            });
            queries.push({ sql, line: arg.loc.start.line });
          }
        } else assert.fail('Uncovered SQL argument');
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
      }
    }
    visit(ast);
    assert.ok(queries.length >= 67);
    for (const { sql, line } of queries) {
      const count = (sql.match(/\?/g) || []).length;
      const query = bindParameters(sql, Array(count).fill(null));
      try { await db.query('EXPLAIN ' + query.text, query.values); }
      catch (error) { throw new Error(`SQL on server.js:${line}: ${error.message}`); }
    }

    const adapter = createDatabase({
      async query({ text, values }) {
        const result = await db.query(text, values);
        return { rows: result.rows, rowCount: result.affectedRows, command: text.trim().split(/\s/)[0].toUpperCase() };
      },
    });
    const [user] = await adapter.execute(`INSERT INTO "USERS" ("Username", "PasswordHash", "FullName", "Email") VALUES (?, ?, ?, ?) RETURNING "UserID" AS "insertId"`, ['test', 'hash', 'Test User', 'test@example.invalid']);
    assert.equal(user.insertId, 1);
    await assert.rejects(db.query(`INSERT INTO "USERS" ("Username", "PasswordHash", "FullName", "Email") VALUES ('another', 'hash', 'Test', 'TEST@example.invalid')`), /duplicate key/);
    await db.exec(`INSERT INTO "DEVICE" ("DeviceName", "IPAddress", "Status") VALUES ('Router', '192.0.2.1', 'Online'), ('Endpoint', '192.0.2.2', 'Online');`);
    await db.exec(`INSERT INTO "DEVICE_LOG" ("DeviceID", "Status", "LatencyMs") VALUES (1, 'Online', 10), (1, 'Offline', NULL), (2, 'Online', 20);`);
    const link = queries.find(q => q.sql.includes('ON CONFLICT')).sql;
    await adapter.execute(link, [1, 2]);
    await adapter.execute(link, [1, 2]);
    assert.equal((await db.query('SELECT count(*) AS n FROM "DEVICE_CONNECTION"')).rows[0].n, 1);
    // Preserve historical MySQL links: multiple NULL ports are valid in its unique key.
    await db.exec(`INSERT INTO "DEVICE_CONNECTION" ("SourceDeviceID", "TargetDeviceID", "ConnectionType", "PortInfo") VALUES (1, 2, 'WiFi', NULL), (1, 2, 'WiFi', NULL);`);
    assert.equal((await db.query('SELECT count(*) AS n FROM "DEVICE_CONNECTION"')).rows[0].n, 3);
    const overview = queries.find(q => q.sql.includes('AS "totalLogs"') && q.sql.includes('FROM "DEVICE_LOG"') && !q.sql.includes('JOIN')).sql;
    const [[stats]] = await adapter.execute(overview, [1]);
    assert.equal(Number(stats.totalLogs), 3);
    assert.equal(Number(stats.onlineLogs), 2);
    assert.equal(Number(stats.avgLatencyMs), 15);
    const location = queries.find(q => q.sql.includes('NULLIF(COUNT(dl."LogID")')).sql;
    const [[health]] = await adapter.execute(location, [1]);
    assert.equal(Number(health.uptimePct), 66.7);
    const [removed] = await adapter.execute('DELETE FROM "DEVICE" WHERE "DeviceID" = ?', [1]);
    assert.equal(removed.affectedRows, 1);
    assert.equal((await db.query('SELECT count(*) AS n FROM "DEVICE_LOG"')).rows[0].n, 1);
    assert.equal((await db.query('SELECT count(*) AS n FROM "DEVICE_CONNECTION"')).rows[0].n, 0);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query('SELECT * FROM "USERS"'), /permission denied/);
      await db.exec('RESET ROLE');
    }
  } finally { await db.close(); }
});
