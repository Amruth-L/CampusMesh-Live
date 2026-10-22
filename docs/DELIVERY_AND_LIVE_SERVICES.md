# CampusMesh: delivery evidence and live-service setup

Updated 21 October 2026. This guide distinguishes source changes from provider activation. No live keys, payments, purchases, or calls were made as part of this change.

## Delivery Mesh Score

The delivery dashboard shows a separate courier score and eligibility explanation. This is a transparent delivery-history rule, not a trained AI model or a measure of a person's character. The borrower's existing return-reliability estimate is separate.

- A verified college email is required.
- With no finished deliveries, show “New partner”, not 100/100.
- The first four finished tasks are provisional; new students can start delivering.
- After at least five finished tasks, require a score of at least 50 for new assignments.
- Score = rounded `100 × (completed + 2) / (completed + failed + 4)`.
- Completed/Delivered and Failed task outcomes count. Declines, expired offers, cancelled tasks and demo listings do not count. Failed outcomes need operational review when disputed; do not record a customer cancellation as a courier failure.
- Eligibility is checked when going online, when generating offers, when accepting an offer, and when claiming a Wish Box request. An already accepted delivery can still be finished.
- Existing availability, one-active-task, participant exclusion and atomic acceptance checks still apply.
- The UI provides a Support link for incorrect failure records. This does not add an automatic appeal adjudication system.

The 50-point cutoff and five-task minimum are initial product rules, not empirically validated thresholds. Review them using actual campus outcomes before broad rollout. Only authorized operational review should correct recorded task outcomes.

## Condition photos

At each custody exchange, the assigned delivery student captures/uploads 1–3 condition photos, then confirms the participant's QR or OTP:

1. Owner → delivery student: PICKUP.
2. Delivery student → borrower: DELIVERY.
3. Borrower → delivery student on return: RETURN_PICKUP.
4. Delivery student → owner on return: RETURN_RECEIVED.

Wish Box collection also requires a pickup photo; final receipt requires a photo plus the requester's code. A browser camera capture option is provided; browsers can allow gallery selection, so this is not guaranteed live-camera attestation or automatic AI damage detection.

The server rejects handover completion without a photo for that exact stage. Only the assigned courier can upload and only at the current checkpoint. Retried identical uploads are deduplicated. Saved evidence is not replaceable through the API after submission. Other delivery participants can view the history on the delivery tracking page.

Photos accept JPG, PNG and WebP, up to 5 MB, and are decoded, resized, converted to WebP and stripped of metadata using the existing Sharp pipeline. Upload time is a server timestamp; it is not proof of capture time. Photos are private S3 objects under `handovers/`, separate from public listing-photo routes. Authorized participants receive five-minute signed image URLs. There is no new public bucket policy.

Before deploying:

1. Apply migration `013_handover_photos.sql` through the normal migration command.
2. Configure `S3_PHOTO_BUCKET`, `S3_REGION`/`AWS_REGION`, `PUBLIC_API_URL` and server-side AWS credentials or workload role.
3. Extend the runtime IAM policy to permit `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` on `arn:aws:s3:::YOUR_BUCKET/handovers/*`, in addition to the existing listing prefix.
4. Keep S3 Block Public Access enabled. Test upload and participant viewing before requiring this new flow on the hosted deployment.
5. Do not apply a blanket short-expiry S3 lifecycle rule to handover evidence without a retention/deletion policy for disputes. Historical completed handovers will not gain invented photos.

## Real Razorpay payments

The code creates gateway orders and verifies captured payments, including callback recovery. It does not yet provide a complete production marketplace settlement system. Changing to live keys does not create seller/courier bank payouts.

Account steps:

1. Complete Razorpay onboarding/KYC with accurate applicant and business details, bank account and the CampusMesh website. Let Razorpay confirm eligibility for the actual student rental marketplace model.
2. Publish accurate contact, privacy, terms, cancellation/refund and delivery policies on the site; finish the account's activation requirements.
3. Once activated, select Live Mode and generate Live API keys in the Razorpay dashboard.
4. Put the live `RAZORPAY_KEY_ID` and matching `RAZORPAY_KEY_SECRET` in Render's backend environment. Keep the secret out of frontend code, Git, screenshots and chat. Do not mix test-created order IDs with live payments.
5. Configure capture settings and use fresh live orders. A client success popup alone must not change the rental to paid; the server must validate order, amount, currency, signature and captured state.

Implemented payment safeguards:

- Deposit retries serialize on the rental and reuse its stored gateway order. Captured deposits can recover without another payment.
- Missing payment credentials fail closed. The frontend no longer falls back to a hard-coded test key.
- `POST /api/payment/webhook` verifies the exact raw body using HMAC and `RAZORPAY_WEBHOOK_SECRET`. It records event IDs only after reconciliation, rejects conflicting/repeated payloads appropriately, and lets Razorpay retry transient failures. Set up `payment.captured`, `order.paid`, `refund.processed`, and `refund.failed` events in the same Live account as the keys.
- Migration `014_payment_lifecycle.sql` adds the event ledger and durable refund intents/provider IDs.
- Refund requests use a persisted `X-Refund-Idempotency` key and identical retry body. A timeout stays UNKNOWN, an accepted request stays PENDING, and only provider confirmation marks PROCESSED. A full damage deduction never sends a zero-amount refund request.
- Owner rejection refunds the booking fee; a return refunds the assessed deposit. Only the owner can assess damage after physical return; delivery returns require completed handover. Refund refresh is restricted to the rental participants.
- Viewing an expired deposit timer no longer cancels a rental while a late capture is being reconciled. New deposit attempts after expiry remain blocked for support review.

Deployment and operational steps still required:

1. Sign in to Razorpay in the shared preview, confirm Live Mode, and configure matching live credentials privately in Render. Register the webhook with the exact same separately chosen signing secret as `RAZORPAY_WEBHOOK_SECRET`.
2. Deploy the payment code and migration, then confirm an unsigned webhook is rejected. Use the provider's test webhook delivery to verify signed receipt; never forge or skip signatures.
3. Keep test-created orders separate from live payments. Existing unfinished test orders need explicit reconciliation/archive before a user can retry those same bookings with live keys. Do not silently replace an ambiguous paid order.
4. Decide how lenders and delivery students receive money. Current earnings are database records, not bank payouts. Razorpay Route requires provider eligibility/approval; otherwise define a provider-approved manual settlement process.
5. Reconcile older refund rows manually: older PROCESSED entries without provider IDs cannot prove a bank refund. New code refuses to blindly resubmit those refunds. Provider-failed refunds and expired deposits require support follow-up.
6. Have the account owner perform one small disclosed live purchase and refund after setup, and compare both with the Razorpay and bank records. This change does not itself make a real charge.

The S3 handover-prefix check using the current local AWS credentials returned AccessDenied (403). Keep the photo-required handover changes out of the hosted release until the runtime role permits the private `handovers/` prefix and upload/readback checks pass. The payment release can be deployed independently.

The normal product sequence is: booking payment captured → owner acceptance → security deposit captured → courier acceptance → condition photos and verified pickup/drop-off → return photos and verification → deposit assessment/refund. The existing booking-confirmation call triggers after the fully paid stage, not after an unconfirmed checkout popup.

## Automated welcome, booking and due-date calls

A telephone call has separate costs: the number/caller-ID service, telecom usage, and possibly speech generation. Buying one number does not include unlimited calls. One approved outbound number can identify calls to many users, subject to the provider's account permissions. Some providers use a shared outbound caller ID rather than renting you a dedicated number; confirm the displayed number with them.

For CampusMesh, one-way text-to-speech or a reusable recorded greeting is sufficient. A conversational AI agent, speech recognition and an LLM are unnecessary for “Welcome” and “Your item is due tomorrow”. A self-recorded welcome greeting has no speech-generation fee, but dialing still costs money. Browser voice previews do not dial phones.

Public pricing checked 21 October 2026:

- Authkey lists 10,000 voice calls for ₹3,540 including 18% GST (₹0.30 per listed voice unit before GST). That is the smallest pack shown on its public voice page, not proof that smaller custom packs are unavailable. Ask about a student micro-pack, billing pulse, duration limits, included TTS, caller ID and minimum recharge before buying. The current project already includes its adapter. Startup credits remain an application, not guaranteed funds.
- Twilio lists calls to Indian mobiles at US$0.0496/minute and international numbers starting at US$1.15/month; its India page says it does not offer voice-enabled numbers in India. Basic TTS is free, while premium speech costs extra. Number rental and usage are separate. This does not fit a ₹20 total budget with a newly rented number.
- MSG91 says TTS has no extra charge, and API calling requires a number from its number section (outside its Hello application). Obtain an India quote for the number, minimum top-up, outbound rate and billing increments; a ₹20 package was not confirmed.

No verified public offer was found for ₹20 total including a dedicated number and unrestricted automated calls to new users. Do not buy a provider number on that assumption. The smallest practical next step is a written Authkey student micro-pack quote, because the adapter already exists.

Activation steps for the existing Authkey integration:

1. Use the existing account associated with your mobile; finish provider account verification and Voice API activation.
2. Confirm its caller-ID policy, approved message/template parameters, ability to call opted-in Indian user numbers, billing unit, minimum recharge and available balance.
3. Use approved voice templates for phone verification and notification text. Ensure template variables match the integration's expected OTP/message parameters. Preview the provider's actual voice; the browser's female voice does not guarantee the provider uses the same voice.
4. Save the API key privately in Render. Set the applicable `AUTHKEY_OTP_TEMPLATE_ID` and `AUTHKEY_VOICE_TEMPLATE_ID`. Only after provider approval, configure `CALLS_PROVIDER=authkey`, `AUTHKEY_VOICE_APPROVED=true`, `CALLS_MODE=live`, and `CALLS_SCHEDULER_ENABLED=true`.
5. Check the authenticated external scheduler configured for the hosted app. A free Render instance may sleep; an in-process timer alone cannot promise scheduled calls. Verify each scheduled invocation in logs.
6. In CampusMesh, the user verifies their college email, saves and verifies ownership of their phone number, and chooses call preferences. Users do not need their own Authkey accounts. A number merely being present in PostgreSQL is not sufficient to send calls.
7. Test a first-sign-in welcome, one fully paid booking confirmation, and a controlled due-date reminder. Inspect the provider delivery status and listen to the actual call. A queued job is not a successful call.

The existing policy supports a once-only welcome, optional later sign-in greetings with repeat limits, booking confirmations, and reminders 4 days before, 1 day before, on the due date and 1 day overdue. Calls run during the configured 9 am–7 pm India window, with daily caps and cooldowns. Cancellation, changed phone numbers and revoked consent must suppress obsolete jobs. A first-time visitor who has not registered should not receive a call.

## Official references

- Authkey voice pricing: https://authkey.io/pricing/voice
- Authkey Voice API: https://authkey.io/voice-api-docs
- Twilio India voice, number and TTS pricing: https://www.twilio.com/en-us/voice/pricing/in
- MSG91 voice FAQ: https://msg91.com/help/voice/voice-faq-s
- Razorpay go-live requirements: https://razorpay.com/blog/instant-payment-gateway-activation-india/
- Razorpay Route and eligibility: https://razorpay.com/docs/payments/route/

## Validation of this source change

- Backend suite: 119 passed; 14 provider/database contracts are intentionally skipped in the default run.
- Dedicated isolated database runs: 6 evidence/eligibility checks and 11 existing booking, delivery, return and Wish Box regression checks passed. Temporary schemas were removed. Storage and payment effects were simulated; no real call or charge was made.
- Frontend tests: 13 passed; frontend build passed. Lint has only the pre-existing AuthContext export and CartPage dependency warnings.
- Desktop/mobile UI fixture: score display, disabled confirmation without a photo, upload feedback, enabled confirmation after upload, no horizontal overflow and no page errors passed. This was a local fixture, not a live S3 upload.
- Not deployed by this change. Apply migration and verify S3 permissions before rollout. Provider account activation, live keys, real bank settlements and real call delivery remain unverified.


Payment validation (21 October 2026): provider calls were faked and database fixtures used a disposable schema with no public search-path fallback. Tests cover duplicate deposit clicks, captured-payment recovery, invalid signatures/amounts, cancelled-booking protection, owner authorization, ambiguous refund retries, refund webhook reconciliation, rejected-booking refunds and zero-refund safety. No real charge or refund was initiated.
