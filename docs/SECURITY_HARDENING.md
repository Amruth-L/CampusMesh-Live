# Security release — 28 October 2026

This release adds focused protections around existing authentication, uploads and API traffic. It does not change payment confirmation rules, enable calls, alter original images, or modify production records during testing.

## Changes and purpose

- **Revocable sessions:** HTTP and Socket.IO authentication check the user's database `auth_version`. Logout signs out all devices. Password reset/change increments that version in the same database write as the password change. Old copied tokens then fail authentication; deleted accounts cannot continue using tokens. Existing version-zero tokens remain compatible until revoked. Only HS256 JWTs with valid UUID user IDs and session-version claims are accepted.
- **Socket revocation:** logout/password changes disconnect local user sockets. Other API instances recheck idle sockets within 30 seconds; delivery event packets are checked before handlers run. Voice audio uses periodic checks instead of querying the database for every audio frame. Token expiry also disconnects sockets.
- **Shared request limits:** PostgreSQL atomic counters work across API instances. Defaults are 1,200 API requests/minute/IP, 60 public signup/recovery requests/15 minutes/IP, and 20 photo writes/minute/user. Existing account/IP password-login throttling remains. Excess traffic gets HTTP 429 with `Retry-After`; limiter/database failures return controlled 503 responses. Counter identifiers use HMAC rather than storing plaintext IPs.
- **Bounded payloads:** ordinary JSON is limited to 128 KiB. Authenticated listing writes allow 36 MiB for supported photos; authenticated delivery-photo writes allow 8 MiB. Authentication happens before the large upload parser. Signed Razorpay webhooks retain their separate raw-body parser and 1 MiB limit.
- **Browser protections:** explicit origin allowlists cover HTTP CORS and WebSocket handshakes. Production requires an HTTPS website origin and a JWT secret of at least 32 bytes. Helmet adds anti-framing, content-type and referrer headers, and production HSTS. Camera/microphone/geolocation are restricted to the same origin. Protected responses use `Cache-Control: no-store`.
- **Staged CSP:** `base-uri`, `object-src` and `frame-ancestors` restrictions are enforced immediately. The full script/network allowlist is **report-only by default** to preserve external checkout compatibility. It is not yet an enforced script-injection defense.
- **Frontend sign-out:** logout waits for backend revocation. A network failure retains the session and displays a retry message instead of falsely claiming a secure sign-out. Other tabs react to token removal. Password changes return the user to sign-in, and stale account refreshes cannot restore an old token.
- **Dependencies:** added Helmet and applied compatible npm advisory fixes for body-parser, Nodemailer and qs. Production dependency audits reported zero known vulnerabilities at verification time; this is not a guarantee against unknown vulnerabilities.

Main implementation: `backend/src/security/{session,request-limits,policy}.js`, `backend/src/app.js`, auth/profile controllers, socket setup and `frontend/src/context/AuthContext.jsx`.

## Deploy on Render

1. Deploy the repository root with Node 22.12+ within Node 22, build command `npm run build`, start command `npm start`, and health path `/health`.
2. Keep the existing database and service configuration. Set `NODE_ENV=production`, `SERVE_FRONTEND=true`, `FRONTEND_ORIGIN=https://campusmesh-amruth.onrender.com` and `PUBLIC_API_URL=https://campusmesh-amruth.onrender.com`. Origins can be comma-separated for explicitly approved frontends; do not use `*`.
3. Ensure `JWT_SECRET` is a private, cryptographically random value of at least 32 bytes. Do not paste it in chat or Git. Changing it invalidates every existing token. Any previously exposed credential still needs rotation in its provider dashboard; this release does not rotate credentials.
4. `npm start` applies migration **023_security_controls.sql** before launching the API. It adds `users.auth_version` and `request_rate_limits`; it does not reset or seed data. Apply the migration before starting any upgraded API instance if using a custom start command. All instances need the same database and JWT secret.
5. Verify `TRUST_PROXY_HOPS` against the actual reverse-proxy chain. Keep the narrowest correct hop count; blindly trusting forwarded IPs allows rate-limit bypass. The example defaults to zero for direct local access. Tune `API_REQUESTS_PER_MINUTE` and `AUTH_REQUESTS_PER_15_MINUTES` if many students share campus NAT; defaults may need adjustment for a busy expo.
6. Leave `SECURITY_CSP_ENFORCE=false` until an authorized sandbox checkout and configured voice/storage origins have been checked for CSP violations. Explicitly add legitimate provider origins if needed before enforcing. A separate frontend/API deployment also needs its API/socket origin in the CSP allowlist.
7. After deployment, check `/health`, sign-in, logout, a fresh sign-in, and a sandbox booking/upload. Production bank settlement, real UPI receipt and provider delivery require separate authorized end-to-end verification.

Rate limits deliberately fail closed when their database is unavailable. Database outages therefore affect requests even before controller execution. Monitor 429/503 responses and database capacity. The version check adds one database read to authenticated HTTP requests.

## Verification

All fixture/mutation tests used disposable local `campusmesh_review` schemas with `qa_` guards. External emails, calls, payments and production storage uploads were disabled or replaced with fakes. Node 22.12.0 was used for backend/build checks.

| Check | Result |
| --- | --- |
| Standard backend suite | 168 tests: 144 passed, 24 skipped, 0 failed |
| Frontend helpers | 40 passed, 0 failed |
| New isolated security HTTP/socket suite | 10 passed, 0 skipped, 0 failed |
| Existing isolated review regressions | 11 passed, 0 skipped, 0 failed |
| Eight isolated payment/delivery/return/deletion suites | 61 passed, 0 skipped, 0 failed |
| Backend/frontend lint, frontend type-check | Passed |
| Production frontend build | Passed; entry chunk 338.46 kB, gzip 109.62 kB |
| Backend/frontend production npm audits | 0 known vulnerabilities reported |
| Browser journeys | 36 measured viewport checks; request/acceptance, quote retry, edit/reload, sign-in/recovery, cart partial retry passed |
| Added session browser journey | Failed logout/retry, cross-tab sign-out, copied-token rejection passed |
| Docker production build | Blocked fetching Node image metadata from Docker Hub: `DeadlineExceeded: context deadline exceeded` |

Browser checks used actual CSS widths **320, 360, 375, 390, 414, 768, 1024 and 1440**, with measured dimensions recorded in [browser-results.json](../artifacts/security-2026-10-28/browser-results.json). Extra checks covered 390×360 short height, 768×320 landscape, text scaling, focus/Escape behavior, and scroll restoration. Touch was simulated in Chromium at 390×720; the new two-tab session check ran at 375×720. These are responsive-browser/simulated-touch checks, **not physical-device tests** or mobile keyboard/camera verification.

Evidence and logs: [security artifacts](../artifacts/security-2026-10-28/). Screenshots use clearly disposable QA accounts/items, not the live catalogue. The original bundled photos remain unchanged. Browser automation initially timed out on an owner acceptance click; the same action succeeded in a diagnostic run and the complete clean-fixture rerun passed with reduced-motion settings consistent across contexts.

Reproduction instructions: [REVIEW_TESTING.md](REVIEW_TESTING.md). The guarded new suite is `backend/test/security-controls.test.js`; the new UI journey is `scripts/qa/browser-security.cjs`.

## Remaining boundaries

Bearer tokens are still stored in localStorage. An XSS compromise can read an active token until it is revoked; a cookie-based session migration is a separate change. Full CSP enforcement needs provider validation. This release does not configure cloud IAM/MFA, rotate secrets, add an external WAF, certify live provider settlements, or eliminate every security risk. Existing seven-day JWT expiry remains; logout revokes all devices rather than managing individual-device sessions.

For a beginner: deleting a browser token alone does not invalidate stolen copies, so the server now checks a revocation version. Request limits must share storage to remain effective across servers. Large photo requests need their own authenticated limits rather than making every endpoint accept huge bodies. Browser security headers help, but provider compatibility must be tested before enforcing a strict script policy.
