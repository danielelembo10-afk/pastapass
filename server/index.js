// ==============================
// 🍝 Pasta Factory A Mare – PastaPass Server
// ==============================

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const QR_SECRET = process.env.QR_SECRET || "PASTA123"; // static secret for printed QR

function isValidStaticToken(t) {
  return t && String(t) === String(QR_SECRET);
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

const WEB_DIR = path.join(__dirname, "..", "web");
const ASSETS_DIR = path.join(WEB_DIR, "assets");

console.log("🔎 WEB_DIR:", WEB_DIR);
console.log("🔎 ASSETS_DIR:", ASSETS_DIR);

app.use(express.static(WEB_DIR));
app.use("/assets", express.static(ASSETS_DIR));

// --- Database setup ---
const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const dbPath = path.join(DATA_DIR, "pasta.sqlite");
const db = new Database(dbPath);

db.exec(`
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
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);
`);

const getCustomer = db.prepare(`
  SELECT id, name, email, phone FROM customers
  WHERE email = @identifier OR phone = @identifier
  LIMIT 1;
`);
const createCustomer = db.prepare(`
  INSERT INTO customers (id, name, email, phone, created_at)
  VALUES (@id, @name, @email, @phone, @created_at);
`);
const getWallet = db.prepare(`
  SELECT customer_id, stamps, last_redeemed_at
  FROM wallets
  WHERE customer_id = @customer_id
  LIMIT 1;
`);
const createWallet = db.prepare(`
  INSERT INTO wallets (customer_id, stamps, last_redeemed_at)
  VALUES (@customer_id, 0, NULL);
`);
const updateWallet = db.prepare(`
  UPDATE wallets
  SET stamps = @stamps, last_redeemed_at = @last_redeemed_at
  WHERE customer_id = @customer_id;
`);

// ========== API ROUTES ==========

// Sign up
app.post("/api/signup", (req, res) => {
  try {
    const { name = null, email = null, phone = null } = req.body || {};
    const identifier = email || phone;
    if (!identifier) return res.status(400).json({ error: "Missing email or phone" });

    let customer = getCustomer.get({ identifier });
    if (!customer) {
      const id = identifier;
      createCustomer.run({
        id,
        name,
        email: email || null,
        phone: phone || null,
        created_at: new Date().toISOString(),
      });
      customer = getCustomer.get({ identifier });
    }

    let wallet = getWallet.get({ customer_id: customer.id });
    if (!wallet) {
      createWallet.run({ customer_id: customer.id });
      wallet = { customer_id: customer.id, stamps: 0, last_redeemed_at: null };
    }

    res.json({
      customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone },
      wallet: { stamps: wallet.stamps },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Signup failed" });
  }
});

// Add stamp via static QR token
app.post("/api/stamps/add", (req, res) => {
  try {
    const { identifier, token } = req.body || {};
    if (!isValidStaticToken(token)) return res.status(401).json({ error: "Unauthorized: invalid token" });
    if (!identifier) return res.status(400).json({ error: "Missing identifier (email or phone)" });

    let customer = getCustomer.get({ identifier });
    if (!customer) {
      const id = identifier;
      createCustomer.run({
        id,
        name: null,
        email: identifier.includes("@") ? identifier : null,
        phone: identifier.includes("@") ? null : identifier,
        created_at: new Date().toISOString(),
      });
      customer = getCustomer.get({ identifier });
    }

    let wallet = getWallet.get({ customer_id: customer.id });
    if (!wallet) {
      createWallet.run({ customer_id: customer.id });
      wallet = { customer_id: customer.id, stamps: 0, last_redeemed_at: null };
    }

    let stamps = wallet.stamps || 0;
    let redeemedNow = false;
    let rewardMessage = null;

    if (stamps < 10) {
      stamps += 1;
      if (stamps === 10) {
        rewardMessage = "🎉 Congratulations — you’ve earned a FREE pasta for being a loyal customer!";
      }
      updateWallet.run({ customer_id: customer.id, stamps, last_redeemed_at: wallet.last_redeemed_at });
    } else {
      stamps = 0;
      redeemedNow = true;
      updateWallet.run({ customer_id: customer.id, stamps, last_redeemed_at: new Date().toISOString() });
    }

    res.json({ customerId: customer.id, stamps, redeemed: redeemedNow, rewardMessage });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Stamp add failed" });
  }
});

// Apple Wallet placeholder
app.get("/api/wallet/apple/:id.pkpass", (req, res) => {
  res.status(501).json({ error: "Apple Wallet pass signing not configured yet." });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ PastaPass running at http://localhost:${PORT}`);
});
