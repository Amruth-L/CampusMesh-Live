# CampusMesh delivery flow: local demo

Deployment is not required when all three sessions use the same machine. Start PostgreSQL, then run:

```bash
cd backend && npm run dev
cd frontend && npm run dev -- --host 0.0.0.0
curl http://localhost:3003/health
```

The health response must contain `ok: true` and `database: true`. Open three isolated browser profiles/incognito windows; normal tabs share one login token.

1. Log in as **Bhavna Student** (`studentb@dbit.co.in`) and rent an item from **Aarav Lender** with **Request Delivery**.
2. Complete booking payment. In the Aarav session, accept the request from Owner dashboard.
3. In the Bhavna session, pay the refundable deposit. This is the gate that starts courier matching.
4. Log in as **Charan Courier** (`studentc@dbit.co.in`), select a route containing the listing pickup and renter destination, and click **Save route & go online**.
5. The courier should see the real renter, owner, item, pickup, destination, payout, match score, and expiry in **Available deliveries** within about five seconds.
6. Accept the request. It must move to the courier's **Active delivery** and disappear for other couriers. Bhavna and Aarav should see the courier assignment without refreshing.
7. Move to pickup, then have Aarav show the secure pickup QR/OTP. Verify it in the courier session. Move to the destination, then have Bhavna show the secure delivery QR/OTP. Verify it.
8. The final state is **Completed**. The generic rental QR is used only for self-pickup rentals.

Failure checks: stop the backend and confirm the UI says **Backend disconnected**, let a route expire and confirm **Offline**, attempt a second courier accept and expect `409`, and try an invalid/reused/out-of-order QR and expect rejection.

Run the lightweight matcher checks with `cd backend && npm test`.

Optional API integration coverage (uses the configured local database and creates one demonstration rental):

```bash
cd backend
DELIVERY_E2E=1 npm test -- test/delivery-flow.contract.test.js
```

The contract test logs in the three configured users, verifies the paid owner queue, accepts the booking, pays the deposit, submits ten concurrent courier route saves, checks the real offer and participant data, performs both secure QR/OTP handovers, and verifies the unified renter history. Override `DELIVERY_E2E_OWNER_EMAIL`, `DELIVERY_E2E_RENTER_EMAIL`, `DELIVERY_E2E_COURIER_EMAIL`, `DELIVERY_E2E_PASSWORD`, or `DELIVERY_API_URL` when using different local accounts. The test is skipped by normal `npm test` unless `DELIVERY_E2E=1` is set.
