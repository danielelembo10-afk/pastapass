# Wallet passes (Apple & Google) — how to enable

This MVP ships WITHOUT live pass issuance (certs are required). To enable later:

## Apple Wallet
1. Enroll in Apple Developer, create a Pass Type ID and certificate.
2. Export:
   - WWDR.pem
   - pass_certificate.pem
   - pass_key.pem (+ passphrase)
3. Put them under `./certs/` and set paths in `.env`.
4. Use a Node lib like `passkit-generator` to build a `.pkpass` with `locations`:
   ```json
   "locations": [ { "latitude": 60.1699, "longitude": 24.9384 } ]
   ```
   iOS can then show a lock screen suggestion when nearby.

## Google Wallet
1. Create an Issuer and class via Google Wallet console.
2. Download a service account JSON, save as `./certs/google_wallet_service_account.json`.
3. Use `google-wallet` APIs to create a pass with `locations` for proximity prompts.

Once working, email/SMS the "Add to Wallet" link to users after `/api/signup`.
