# CampusMesh marketplace payouts

Updated 22 October 2026. This release includes direct recipient and bank onboarding through Razorpay Route. The owner reports that Route is approved; provider access and each recipient’s bank verification still need confirmation in the deployed environment. No real transfer or recipient provisioning was performed by these automated tests.

## What now works in the application

The Payouts page is at `/payouts` and is linked from the navigation and profile settings. It displays recipient setup, masked bank details, verification status, a funded earnings ledger, transfer references and bank settlement references. Test and historical rows are labelled separately from live obligations.

A customer payment and a recipient's bank settlement are distinct operations:

- Lender earnings become eligible after a fully paid rental is returned and its owner records the condition assessment. The ledger caps the amount to the captured original rental fee, excluding unpaid extensions, delivery fees, platform fees and deposits.
- Outbound delivery earnings become eligible after the recipient verifies the courier's handover, with a captured rental payment funding that delivery fee. Merely changing a task's status to completed is insufficient.
- Wish Box disbursement reimburses the agreed quote, including the item purchase cost. It is not labelled as net courier profit.
- Return delivery fees currently have no separate captured checkout in the existing app. Such obligations are explicitly `AWAITING_FUNDING` and cannot be sent to a bank. A funded return-checkout flow must be added before offering paid return deliveries in a full live rollout.
- Demo listings, historical rows with unknown payment mode, cancelled tasks and security deposits do not become automatically payable funds.

The existing delivery dashboard's total is a recorded earning; the Payouts page is the authority for transfer and settlement status.

## Required provider approval and funding

Ordinary Razorpay Payment Gateway activation is separate from Route activation. Ask Razorpay to approve the actual college rental marketplace model, individual student recipients, KYC process, transfer fees and recipient settlement flow. Its published eligibility requirements may prevent a student project from qualifying. Do not assume approval.

The current adapter creates transfers from captured payments after the fulfilment checks above. The provider must confirm that funds remain available in the Route balance when a transfer becomes eligible. In particular, a rental may last longer than the parent's normal settlement cycle. Before live activation, agree on an approved reservation/settlement-hold or funding arrangement with Razorpay. This code does not automatically create held transfers at checkout, hold a payment in an escrow account, or debit the merchant's bank to refill a balance. Insufficient or refunded funding is blocked or sent for review; the app never invents a successful payout.

Do not enable this adapter for a different business or unsupported fund-collection arrangement simply by setting environment flags.

## Recipient onboarding

1. Open **Payouts → Add and verify your bank account** after signing in with a verified campus email. The service must be configured in the appropriate Live or Test mode.
2. Enter your own legal name, individual PAN, Indian mobile, bank account number twice, and IFSC. Confirm ownership and accept the displayed provider terms. Do not send these details through chat or support tickets.
3. Submit the form. The backend uses Razorpay’s composite account API to create the linked recipient, Route product and settlement account together. The authenticated campus email is used automatically.
4. Use **Refresh verification** to check progress. Product activation alone is insufficient: the default active bank destination must also have `verification_status=verified`. Pending or failed bank verification blocks transfers.
5. Once the account shows **Bank account verified**, eligible funded earnings can enter automatic transfer processing. Provider transfer and recipient bank settlement remain separate statuses.

CampusMesh persists provider IDs, the beneficiary name, masked trailing bank digits, verification status and retry metadata. It does not persist the PAN, full bank number or IFSC from this form. Responses may expose only the last two bank digits. The sensitive submission is sent server-to-server to Razorpay over HTTPS.

A durable idempotency key and keyed request fingerprint prevent duplicate recipient creation after a lost response. Retry with the exact same details. A conflicting provider account or an ambiguous submission with changed details requires support reconciliation; deleting a CampusMesh user is not a recovery mechanism.

For an account already onboarded through Razorpay, an authorized operator can still associate its IDs using the trusted backend environment:

```sh
node scripts/link-payout-account.js --list-requests
node scripts/link-payout-account.js --user STUDENT@dbit.co.in --account acc_PROVIDER_ID --product acc_prd_PROVIDER_ID
```

The script checks the provider account and campus email and does not initiate a transfer. Bank changes are available after linking, but are blocked while a transfer needs confirmation. An uncertain bank update remains blocked for operator review. Only after checking the actual provider result should an operator use `--resolve-bank-update`.

## Deployment and activation

1. Deploy migrations through `016_recipient_onboarding.sql` through the normal startup migration runner. Existing payment rows remain `legacy`; do not relabel old test balances as live money.
2. Keep `PAYOUTS_ENABLED=false` and `RAZORPAY_ROUTE_APPROVED=false` until the account, recipient onboarding, funding and settlement plan are approved. With Live API keys, new marketplace collection is blocked until the lender has a recently verified live payout account and the service is activated. A courier also needs live payout setup before accepting a new delivery. Existing deliveries can still be completed.
3. After approval, use the matching Live API key pair and the existing payment webhook signing secret. Configure these Route events on the same webhook endpoint `/api/payment/webhook`:
   - `transfer.processed`
   - `transfer.failed`
   - `settlement.processed`
   - `product.route.activated`
   - `product.route.under_review`
   - `product.route.needs_clarification`
4. After provider onboarding and funding access are approved, set `RAZORPAY_ROUTE_APPROVED=true` and `PAYOUTS_ENABLED=true`. **Enabling both flags starts automatic transfer processing.** This also enables the self-service onboarding form. Begin with a limited set of recipients and wait for bank verification before taking live bookings. Do not enable these flags only to remove a setup banner.
5. Verify with fake/test transfers first, then have the account owner complete a small disclosed live transaction. Reconcile its capture, eligible earning, transfer and recipient settlement against the provider and bank records. A transfer's `processed` state is not bank settlement. The app requires provider `settlement_status=settled` plus a recipient settlement reference for its settled state.

## Scheduling on hosted Render

The app checks the payout queue every minute while its Node process is running. A free Render process may sleep, so an in-process timer alone does not guarantee processing. After provider activation, configure a separate random `PAYOUTS_SCHEDULER_SECRET` of at least 32 characters in Render and the trusted operator environment. Do not reuse the API secret.

The authenticated endpoint is `POST /api/payout-scheduler/tick` with `Authorization: Bearer <scheduler-secret>`. The prepared Supabase installer uses Vault for the secret and schedules this every 15 minutes:

```sh
node scripts/install-payout-scheduler.js
```

This script changes the production database scheduler and must be run explicitly by the operator after approval. It was not run during development. The backend also serializes workers with a database lock, so an external tick and the in-process timer cannot duplicate dispatches.

## Failures and reconciliation

Route transfer APIs do not document the RazorpayX payout idempotency header. This adapter sends one external mutation per intent and persists `SUBMITTING` before that request. A lost response becomes `REVIEW_REQUIRED`; status refresh searches the source payment's transfers using its immutable CampusMesh payout ID in provider notes. It never sends another transfer simply because the first response was lost. An operator must investigate unmatched ambiguous requests and failed/reversed transfers before any new payment is considered.

A confirmed provider response must match source payment, recipient, amount, currency, payout note and transfer ID. Settlement and reversal status are re-read from Razorpay. A parent merchant's settlement event does not mark all students paid. Repeated provider events and UI refreshes do not create new transfer attempts.

No bank passwords, OTPs or API secrets belong in chat, frontend environment variables, screenshots, logs or Git. Only the server's secrets manager should hold API and scheduler secrets.

## Verification

The disposable-schema integration suite tests recipient setup, masked bank data, handover funding, duplicate dispatch, provider settlement, lost responses, authorization, reversals, blocked return fees, historical-mode protection and live readiness checks. Gateway methods are fakes; the real payment account and bank are not touched. The existing payment, cart, delivery and Wish Box regressions were also run. Desktop/mobile UI fixtures cover the initial bank form and verified-recipient screen. The onboarding tests also cover pending bank checks, concurrent submissions, rejected details, lost responses and privacy. Tests use an isolated `qa_` schema verified before migrations or fixture writes; pooler connections require the spaced startup option `-c search_path=SCHEMA` and must not fall back to `public`.

## References

- https://razorpay.com/docs/payments/route/
- https://razorpay.com/docs/payments/route/linked-account/
- https://razorpay.com/docs/payments/route/integration-guide/
- https://razorpay.com/docs/api/payments/route/
- https://raw.githubusercontent.com/razorpay/markdown-docs/master/webhooks/route.md

- https://razorpay.com/docs/api/payments/route/create-linked-account-composite
- https://razorpay.com/docs/api/payments/route/update-product-config
