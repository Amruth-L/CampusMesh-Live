# Reproducing the isolated review

Use Node 22.12+ within Node 22. Install the documented frontend/backend development dependencies. Do not use a production database, production `.env`, email/calling keys or storage credentials for QA.

```sh
npm ci --prefix frontend
npm ci --prefix backend
npm run lint --prefix backend
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm test --prefix backend
npm test --prefix frontend
node scripts/build-frontend.cjs
```

The browser harness serves that production build with the real local API, a fresh `qa_browser_…` schema and a fake photo persistence adapter. Photos never go to production storage. Temporary QA sign-in tokens are written under the OS temporary directory; never publish that fixture file.

Start disposable PostgreSQL (choose an unused host port):

```sh
docker run --name campusmesh-review-db -e POSTGRES_PASSWORD=local_review_only -e POSTGRES_DB=campusmesh_review -p 127.0.0.1:55432:5432 -d postgres:16
export REVIEW_DATABASE_URL='postgresql://postgres:local_review_only@127.0.0.1:55432/campusmesh_review'
node scripts/qa/integration.cjs
TZ=Asia/Kolkata node --test backend/test/review-regressions.test.js
```

Both scripts enforce loopback and the disposable database name. Every lifecycle suite gets its own `qa_` schema, applies migrations and drops only that schema afterward. The browser server drops its owned schema on SIGINT/SIGTERM. If a process is forcibly killed, its orphaned QA schema may remain in the disposable database; removing the entire disposable container is sufficient. Do not run schema cleanup against another database.

Browser tooling is deliberately not a production app dependency:

```sh
npm install --prefix /tmp/campusmesh-ui-tools playwright-core
export NODE_PATH=/tmp/campusmesh-ui-tools/node_modules
export BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
node scripts/qa/browser-server.cjs
```

In a second terminal with the same `NODE_PATH` and browser executable:

```sh
node scripts/qa/browser.cjs
node scripts/qa/browser-extra.cjs
node scripts/qa/browser-cart.cjs
node scripts/qa/browser-security.cjs
```

Use a fresh browser-server fixture/schema for each complete run. The scripts perform real local mutations and should run in that order. They block browser requests to external services. The server clears inherited service configuration before startup, leaves calls in preview and uses fake photo persistence. Do not run a frontend rebuild during browser tests: hashed chunks can change underneath an open page.

Browser evidence is written into `artifacts/review/`. The first script covers 36 layout checks and keyboard/auth/request/edit behavior. The second covers touch, image preparation, publishing failures/retry, create/edit/reload, short viewport and scroll restoration. The third checks that partial cart retries do not resubmit successful requests.

The fourth checks failed logout/retry, another open tab, and rejection of a copied token after successful logout. Independent journeys obtain fresh local QA login tokens because logout now revokes existing tokens. Run `node --test backend/test/security-controls.test.js` with the same `REVIEW_DATABASE_URL` for the guarded security HTTP/socket regression suite; it creates and drops its own `qa_security_` schema.

A successful test run does not certify real Razorpay settlement, direct UPI receipt, AWS delivery, email, voice, physical camera capture or mobile keyboard behavior. See [the review report](CURRENT_REVIEW.md) for measured scope and remaining deployment requirements.
