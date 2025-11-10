import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';

// DB drivers
import Database from 'better-sqlite3';          // local fallback
import { createClient } from '@libsql/client';  // Turso (libSQL)

import { customAlphabet } from 'nanoid';
import crypto from 'crypto';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use('/assets', express.static(path.join(__dirname, '..', 'web', 'assets')));
app.use(express.static(path.join(__dirname, '..', 'web')));

// ---------- DB LAYER (Turso if env present, else local SQLite) ----------
const useTurso = !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);

let tdb = null;            // libsql client
let sdb = null;            // better-sqlite3 instance

// tiny helpers to unify API
const db = {
  async exec(sql, params = []) {
    if (useTurso) return tdb.execute({ sql, args: params });
    const stmt = sdb.prepare(sql);
    return stmt.run(...params);
  },
  async get(sql, params = []) {
    if (useTurso) {
      const r = await tdb.execute({ sql, args: params });
      return r.rows[0] || undefined;
    }
    const stmt = sdb.prepare(sql);
    return stmt.get(...params);
  },
  async all(sql, params = []) {
    if (useTurso) {
      const r = await tdb.execute({ sql, args: params });
      return r.rows || [];
    }
    const stmt = sdb.prepare(sql);
    return stmt.all(...params);
  }
};

(async () => {
  try {
    if (useTurso) {
      tdb = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN
      });
      console.log('✅ Turso (libSQL) client initialized');
    } else {
      sdb = new Database('pasta.db');
      console.log('✅ Local SQLite (better-sqlite3) initialized → pasta.db');
    }

    // SCHEMA (works for both backends)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        phone TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS stamps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS device_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identifier TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        platform TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )
    `);

    await db.exec(`CREATE INDEX IF NOT EXISTS idx_device_tokens_identifier ON device_tokens(identifier)`);

  } catch (e) {
    console.error('DB init error:', e);
    process.exit(1);
  }
})();

// ---------- Firebase Admin (push) ----------
if (!admin.apps.length) {
  const projectId  = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
    console.log('✅ Firebase Admin initialized');
  } else {
    console.warn('⚠️ Firebase Admin env missing; push disabled');
  }
}

const nanoid = customAlphabet('123456789ABCDEFGHJKLMNPQRSTUVWXYZ', 8);

// ---------- HELPERS ----------
async function getOrCreateCustomer({ email, phone, name }) {
  const identifier = email || phone;
  if (!identifier) throw new Error('Email or phone required');

  const existing = await db.get('SELECT * FROM customers WHERE email=? OR phone=?', [email, phone]);
  if (existing) return existing;

  const id = nanoid();
  await db.exec('INSERT INTO customers (id, name, email, phone) VALUES (?,?,?,?)', [id, name, email, phone]);
  await db.exec('INSERT INTO stamps (customer_id, count) VALUES (?,0)', [id]);
  return { id, name, email, phone };
}

async function getStamps(customer_id) {
  const row = await db.get('SELECT count FROM stamps WHERE customer_id=?', [customer_id]);
  return row ? Number(row.count) : 0;
}

async function setStamps(customer_id, count) {
  await db.exec('UPDATE stamps SET count=?, updated_at=strftime("%s","now") WHERE customer_id=?', [count, customer_id]);
}

async function addStamp(customer_id) {
  const current = await getStamps(customer_id);
  let next = current + 1;
  if (next >= 10) {
    // redeemed
    await setStamps(customer_id, 0);
    return { redeemed: true, stamps: 0 };
  } else {
    await setStamps(customer_id, next);
    return { redeemed: false, stamps: next };
  }
}

// ---------- ROUTES ----------
app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, phone } = req.body || {};
    const customer = await getOrCreateCustomer({ name, email, phone });
    const stamps = await getStamps(customer.id);
    res.json({ customer, wallet: { stamps } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/stamps/add', async (req, res) => {
  try {
    const { identifier } = req.body || {};
    if (!identifier) return res.status(400).json({ error: 'identifier required' });

    const customer = await db.get('SELECT * FROM customers WHERE email=? OR phone=?', [identifier, identifier]);
    if (!customer) return res.status(404).json({ error: 'customer not found' });

    const result = await addStamp(customer.id);
    res.json({ ...result, customerId: customer.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Push: save token
app.post('/api/push/register', async (req, res) => {
  try {
    const { identifier, token, platform } = req.body || {};
    if (!identifier || !token) return res.status(400).json({ error: 'identifier and token required' });
    // upsert by token
    await db.exec(`
      INSERT INTO device_tokens (identifier, token, platform, created_at, updated_at)
      VALUES (?, ?, ?, strftime('%s','now'), strftime('%s','now'))
      ON CONFLICT(token) DO UPDATE SET
        identifier=excluded.identifier,
        platform=excluded.platform,
        updated_at=strftime('%s','now')
    `, [identifier, token, platform || null]);
    res.json({ ok: true });
  } catch (e) {
    console.error('push/register error', e);
    res.status(500).json({ error: 'failed to register token' });
  }
});

// Push: manual test
app.post('/api/push/test', async (req, res) => {
  try {
    if (!admin.apps.length) return res.status(503).json({ error: 'push not configured' });
    const { identifier, title, body } = req.body || {};
    if (!identifier) return res.status(400).json({ error: 'identifier required' });

    const rows = await db.all(`SELECT token FROM device_tokens WHERE identifier=?`, [identifier]);
    if (!rows.length) return res.status(404).json({ error: 'no tokens for identifier' });

    const response = await admin.messaging().sendMulticast({
      notification: { title: title || 'PastaPass', body: body || 'Test push 🚀' },
      tokens: rows.map(r => r.token),
    });
    res.json({ sent: response.successCount, failed: response.failureCount });
  } catch (e) {
    console.error('push/test error', e);
    res.status(500).json({ error: 'failed to send test push' });
  }
});

// static
app.get('/', (_, res) => res.sendFile(path.join(__dirname, '..', 'web', 'mobile.html')));

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ PastaPass running at http://localhost:${PORT}`);
  if (useTurso) {
    console.log('🔗 DB: Turso (libSQL) via', process.env.TURSO_DATABASE_URL);
  } else {
    console.log('🔗 DB: Local SQLite (pasta.db)');
  }
});
