# CampusMesh local rerun — 26 October 2026

App: http://127.0.0.1:5175 (CampusMesh-Live checkout).
The existing server on 5174 was preserved; QA scripts ran with a temporary port substitution, without changing application source.

- Node 22.12.0 production frontend build: passed.
- Backend lint, frontend lint, frontend type check: passed.
- Backend tests: 141 passed, 23 opt-in skipped, 0 failed (164 total).
- Frontend tests: 40 passed, 0 skipped, 0 failed.
- Browser main suite: 36 viewport assertions passed; zero uncaught page errors.
- Simulated touch: photo preparation, create, injected failure/retry, edit/reload and constrained-height save passed.
- Navigation: forward scroll reset to 0; Back restored 400px.
- Cart: partial failure/retry passed, 3 submission attempts produced 2 successful rental requests without resubmitting the successful item.
- CSS widths checked: 320, 360, 375, 390, 414, 768, 1024, 1440.
- API /health: healthy database connection.

No blocking application failure was found in these journeys. Startup warns that Razorpay credentials are not configured in this deliberately isolated test environment. Node 22.12 also emits its experimental CommonJS/ESM interoperability warning; it did not prevent startup or tests. Real gateway payments, external voice/email/storage and physical-device behavior were not exercised.

The local server uses disposable local qa_ records and a fake photo persistence adapter. The preview was signed in as a test renter for inspection. All production accounts/data and unrelated working-tree changes were preserved.
