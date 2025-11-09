// ==============================
// 🍝 Pasta Factory A Mare – PastaPass Server (Turso + cooldown + caching + health)
// ==============================

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

// DB: Turso (cloud SQLite) or local SQLite
import Database from "better-sqlite3";
import { createClient as createTurso } from "@libsql/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config ---
const PORT = process.env.PORT || 3000;
const QR_SECRET = process.env.QR_SECRET || "PASTA123";
const useTurso = !!process.env.TURSO_DATABASE_URL;
// Cooldown to prevent double-stamp via refresh
const COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

function isValidStaticToken(t) {
  return t && String(t) === String(QR_SECRET);
}

// --- Express ---
const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- Static files with caching ---
const WEB_DIR = path.join(__dirname, "..", "web");
const ASSETS_DIR = path.join(WEB_DIR, "assets");

// cache HTML/CSS/JS for 7 days, assets for 30 days
app.use(express.static(WEB_DIR, { maxAge: "7d", etag: true }));
app.use("/assets", express.static(ASSETS_DIR, { maxAge: "30d", etag: true }));

// optional: support /web/mobile.html too (if old QR used that path)
app.use("/web", express.static(WEB_DIR, { maxAge: "7d", etag: true }));

// Health endpoint for pingers / uptime (keeps instance warm)
app.get("/health", (req, res) => res.status(200).send("ok"));

// --- DB init (Turso if set, else local file) ---
let turso = null;
let sqlite = null;
let dbGetOne, dbRun, dbAll, initSchema;

if (useTurso) {
  turso = createTurso({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  dbRun = async (sql, args = []) => { await turso.execute({ sql, args }); };
  dbGetOne = async (sql, args = []) => {
    const r = await turso.execute({ sql, args });
    return r.rows?.[0] || null;
  };
  dbAll = async (sql, args = []) => {
    const r = await turso.execute({ sql, args });
    return r.rows || [];
  };
  initSchema = async () => {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        phone TEXT UNIQUE,
        created_at TEXT
      )
    `);
    await dbRun(`
      CREATE TABLE IF NOT EXISTS wallets (
        customer_id TEXT PRIMARY KEY,
        stamps INTEGER DEFAULT 0,
        last_redeemed_at TEXT,
        last_stamped_at TEXT,
        FOREIGN KEY(customer_id) REFERENCES customers(id)
      )
    `);
    // Safe ALTER in case added later
    try { await dbRun(`ALTER TABLE wallets ADD COLUMN last_stamped_at TEXT`); } catch {}
  };
} else {
  const DATA_DIR = path.join(__dirname, "..", "data");
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const dbPath = path.join(DATA_DIR, "pasta.sqlite");
  sqlite = new Database(dbPath);

  dbRun = async (sql, args = []) => sqlite.prepare(sql).run(args);
  dbGetOne = async (sql, args = []) => sqlite.prepare(sql).get(args) || null;
  dbAll = async (sql, args = []) => sqlite.prepare(sql).all(args);
  initSchema = async () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        phone TEXT UNIQUE,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS wallets (
        customer_id TEXT PRIMARY KEY,
        stamps INTEGER DEFAULT 0,
        last_redeemed_at TEXT,
        last_stamped_at TEXT,
        FOREIGN KEY(customer_id) REFERENCES customers(id)
      );
    `);
    try { sqlite.prepare(`ALTER TABLE wallets ADD COLUMN last_stamped_at TEXT`).run(); } catch {}
  };
}

// --- Data helpers ---
async function getCustomerByIdentifier(identifier) {
  return await dbGetOne(
    `SELECT id, name, email, phone
     FROM customers
     WHERE email = ? OR phone = ?
     LIMIT 1`,
    [identifier, identifier]
  );
}
async function createCustomer({ id, name, email, phone }) {
  await dbRun(
    `INSERT INTO customers (id, name, email, phone, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, name, email, phone, new Date().toISOString()]
  );
}
async function getWallet(customerId) {
  return await dbGetOne(
    `SELECT customer_id, stamps, last_redeemed_at, last_stamped_at
     FROM wallets
     WHERE customer_id = ?
     LIMIT 1`,
    [customerId]
  );
}
async function createWallet(customerId) {
  await dbRun(
    `INSERT INTO wallets (customer_id, stamps, last_redeemed_at, last_stamped_at)
     VALUES (?, 0, NULL, NULL)`,
    [customerId]
  );
}
async function updateWallet({ customerId, stamps, lastRedeemedAt, lastStampedAt }) {
  await dbRun(
    `UPDATE wallets
     SET stamps = ?, last_redeemed_at = ?, last_stamped_at = ?
     WHERE customer_id = ?`,
    [stamps, lastRedeemedAt || null, lastStampedAt || null, customerId]
  );
}

// ==============================
// API ROUTES
// ==============================

// Signup
app.post("/api/signup", async (req, res) => {
  try {
    const { name = null, email = null, phone = null } = req.body || {};
    const identifier = email || phone;
    if (!identifier) return res.status(400).json({ error: "Missing email or phone" });

    let customer = await getCustomerByIdentifier(identifier);
    if (!customer) {
      const id = identifier; // simple id = email or phone
      await createCustomer({ id, name, email: email || null, phone: phone || null });
      customer = await getCustomerByIdentifier(identifier);
    }

    let wallet = await getWallet(customer.id);
    if (!wallet) {
      await createWallet(customer.id);
      wallet = { customer_id: customer.id, stamps: 0, last_redeemed_at: null, last_stamped_at: null };
    }

    res.json({
      customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone },
      wallet: { stamps: wallet.stamps || 0 },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Signup failed" });
  }
});

// Add stamp via static QR secret (with 2-min cooldown)
app.post("/api/stamps/add", async (req, res) => {
  try {
    const { identifier, token } = req.body || {};
    if (!isValidStaticToken(token)) return res.status(401).json({ error: "Unauthorized: invalid token" });
    if (!identifier) return res.status(400).json({ error: "Missing identifier (email or phone)" });

    let customer = await getCustomerByIdentifier(identifier);
    if (!customer) {
      const id = identifier;
      await createCustomer({
        id,
        name: null,
        email: identifier.includes("@") ? identifier : null,
        phone: identifier.includes("@") ? null : identifier,
      });
      customer = await getCustomerByIdentifier(identifier);
    }

    let wallet = await getWallet(customer.id);
    if (!wallet) {
      await createWallet(customer.id);
      wallet = { customer_id: customer.id, stamps: 0, last_redeemed_at: null, last_stamped_at: null };
    }

    // Cooldown check
    const now = Date.now();
    const last = wallet.last_stamped_at ? Date.parse(wallet.last_stamped_at) : 0;
    const diff = now - last;
    if (diff < COOLDOWN_MS) {
      const secondsLeft = Math.ceil((COOLDOWN_MS - diff) / 1000);
      return res.json({
        customerId: customer.id,
        stamps: wallet.stamps || 0,
        cooldown: true,
        cooldownMinutes: Math.round(COOLDOWN_MS / 60000),
        secondsLeft
      });
    }

    // Normal award / redemption
    let stamps = wallet.stamps || 0;
    let redeemedNow = false;
    let rewardMessage = null;

    if (stamps < 10) {
      stamps += 1;
      if (stamps === 10) {
        rewardMessage = "🎉 Congratulations — you’ve earned a FREE pasta for being a loyal customer!";
      }
      await updateWallet({
        customerId: customer.id,
        stamps,
        lastRedeemedAt: wallet.last_redeemed_at,
        lastStampedAt: new Date().toISOString()
      });
    } else {
      // was 10 → next scan resets to 0 (redeemed)
      stamps = 0;
      redeemedNow = true;
      await updateWallet({
        customerId: customer.id,
        stamps,
        lastRedeemedAt: new Date().toISOString(),
        lastStampedAt: new Date().toISOString()
      });
    }

    return res.json({
      customerId: customer.id,
      stamps,
      redeemed: redeemedNow,
      rewardMessage
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Stamp add failed" });
  }
});

// ---- bootstrap ----
await initSchema();

app.listen(PORT, () => {
  console.log(`✅ PastaPass running at http://localhost:${PORT}`);
  console.log(useTurso ? "🗄 Using Turso (cloud SQLite)" : "💾 Using local SQLite file");
});
