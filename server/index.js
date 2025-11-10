import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import Database from 'better-sqlite3';
import { customAlphabet } from 'nanoid';
import crypto from 'crypto';
import admin from 'firebase-admin';   // ✅ Firebase Admin import

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const db = new Database('pasta.db');
app.use(cors());
app.use(bodyParser.json());
app.use('/assets', express.static(path.join(__dirname, '..', 'web', 'assets')));
app.use(express.static(path.join(__dirname, '..', 'web')));

// ✅ Initialize Firebase Admin for push notifications
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

// ===== DATABASE STRUCTURE =====
db.prepare(`
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    phone TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS stamps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )
`).run();

// ✅ For storing push tokens
db.prepare(`
  CREATE TABLE IF NOT EXISTS device_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    platform TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )
`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_device_tokens_identifier ON device_tokens(identifier)`).run();

const nanoid = customAlphabet('123456789ABCDEFGHJKLMNPQRSTUVWXYZ', 8);

// ====== HELPER FUNCTIONS ======
function getOrCreateCustomer({ email, phone, name }) {
  const identifier = email || phone;
  if (!identifier) throw new Error('Email or phone required');
  let customer = db.prepare('SELECT * FROM customers WHERE email=? OR phone=?').get(email, phone);
  if (!customer) {
    const id = nanoid();
    db.prepare('INSERT INTO customers (id, name, email, phone) VALUES (?,?,?,?)').run(id, name, email, phone);
    db.prepare('INSERT INTO stamps (customer_id, count) VALUES (?,0)').run(id);
    customer = { id, name, email, phone };
  }
  return customer;
}

function getStamps(customer_id) {
  const row = db.prepare('SELECT count FROM stamps WHERE customer_id=?').get(customer_id);
  return row ? row.count : 0;
}

function addStamp(customer_id) {
  let { count } = db.prepare('SELECT count FROM stamps WHERE customer_id=?').get(customer_id) || { count: 0 };
  count++;
  if (count >= 10) {
    count = 0; // reset after free pasta
    return { redeemed: true, stamps: count };
  }
  db.prepare('UPDATE stamps SET count=?, updated_at=strftime("%s","now") WHERE customer_id=?').run(count, customer_id);
  return { redeemed: false, stamps: count };
}

// ===== API ROUTES =====

// Signup endpoint
app.post('/api/signup', (req, res) => {
  try {
    const { name, email, phone } = req.body || {};
    const customer = getOrCreateCustomer({ name, email, phone });
    const stamps = getStamps(customer.id);
    res.json({ customer, wallet: { stamps } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Add a stamp (QR scanning)
app.post('/api/stamps/add', (req, res) => {
  try {
    const { identifier } = req.body || {};
    if (!identifier) return res.status(400).json({ error: 'identifier required' });

    const customer = db.prepare('SELECT * FROM customers WHERE email=? OR phone=?').get(identifier, identifier);
    if (!customer) return res.status(404).json({ error: 'customer not found' });

    const result = addStamp(customer.id);
    res.json({ ...result, customerId: customer.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ✅ Save or update a device token
app.post('/api/push/register', (req, res) => {
  try {
    const { identifier, token, platform } = req.body || {};
    if (!identifier || !token) return res.status(400).json({ error: 'identifier and token required' });
    db.prepare(`
      INSERT INTO device_tokens (identifier, token, platform, created_at, updated_at)
      VALUES (?, ?, ?, strftime('%s','now'), strftime('%s','now'))
      ON CONFLICT(token) DO UPDATE SET
        identifier=excluded.identifier,
        platform=excluded.platform,
        updated_at=strftime('%s','now')
    `).run(identifier, token, platform || null);
    res.json({ ok: true });
  } catch (e) {
    console.error('push/register error', e);
    res.status(500).json({ error: 'failed to register token' });
  }
});

// ✅ Manual test push
app.post('/api/push/test', async (req, res) => {
  try {
    if (!admin.apps.length) return res.status(503).json({ error: 'push not configured' });
    const { identifier, title, body } = req.body || {};
    if (!identifier) return res.status(400).json({ error: 'identifier required' });

    const rows = db.prepare(`SELECT token FROM device_tokens WHERE identifier=?`).all(identifier);
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

// ====== STATIC FILES ======
app.get('/', (_, res) => res.sendFile(path.join(__dirname, '..', 'web', 'mobile.html')));

// ====== SERVER START ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ PastaPass running at http://localhost:${PORT}`);
});
