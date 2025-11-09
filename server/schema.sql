CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  name TEXT,
  consent_marketing INTEGER DEFAULT 0,
  consent_location INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loyalty_wallets (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  stamps INTEGER DEFAULT 0,
  rewards_earned INTEGER DEFAULT 0,
  rewards_redeemed INTEGER DEFAULT 0,
  last_stamp_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS stamp_events (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  tx_id TEXT,
  amount REAL,
  source TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  status TEXT DEFAULT 'issued', -- 'issued' | 'redeemed' | 'expired'
  issued_at TEXT DEFAULT (datetime('now')),
  redeemed_at TEXT,
  code TEXT UNIQUE,
  expires_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
