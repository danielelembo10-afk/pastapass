# PastaPass 10+1 — Track A (Wallet Pass MVP)

This is a ready-to-run MVP for **Pasta Factory — PastaPass 10+1** (buy 10 pastas, get 1 free) without building a mobile app.
It uses a **rotating QR token** at the counter to add stamps, **SQLite** for storage, and stubs for **Apple/Google Wallet passes**.

Created: 2025-11-08

## Quick start
1. Install Node 18+
2. `npm install`
3. `cp .env.example .env` and set `HMAC_SECRET`, `JWT_SECRET`
4. `npm run init-db`
5. `npm run dev`
6. Open: `/signup` and `/staff`

## API
- POST `/api/signup` — body: `{ email, phone, name, consentMarketing, consentLocation }`
- POST `/api/stamps/add` — body: `{ identifier, token }`  (identifier = email or phone)
- GET  `/api/wallet/:customerId`
- POST `/api/rewards/redeem` — body: `{ code }`

See `/docs/privacy.md` and `/docs/staff-one-pager.md`.
Wallet pass instructions in `/server/wallet/README_wallet.md`.
