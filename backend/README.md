# CampusMesh Backend

A complete Node.js backend for CampusMesh. 

## OTP email on Render Free

The campus preview can use `EMAIL_PROVIDER=lambda`, `AWS_REGION=us-east-1` and `EMAIL_LAMBDA_FUNCTION=campusmesh-otp-mailer`. Render invokes the private AWS Lambda synchronously over HTTPS; the function sends with the existing Gmail account over TLS. Grant only `lambda:InvokeFunction` on that exact function ARN to the application's IAM user. Set the Gmail sender and app password on the Lambda environment, not in its deployment ZIP or API payload. The app accepts success only after the function confirms SMTP acceptance. See [the mail function deployment instructions](lambda/otp-mailer/README.md). `npm run email:check` tests invocation permission without sending mail. Gmail sending quotas still apply; use an approved transactional provider and a verified sending domain for larger production use.

Signup remains restricted to `@dbit.co.in`. Failed initial sends preserve an unverified account; retrying signup returns the user to verification without overwriting its password. Codes expire after ten minutes, have five attempts, are single-use, and have separate verification/reset purposes. Resending is limited to once per minute. Profile edits cannot replace the verified sign-in email.

### Amazon SES option

Set `EMAIL_PROVIDER=ses`, `EMAIL_FROM` to a verified sender email, and `AWS_REGION` to the region where that identity is verified. Supply `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` privately in the server environment (plus `AWS_SESSION_TOKEN` for temporary credentials). The SDK also supports standard AWS credential profiles and IAM roles. S3-only permissions do not authorize SES: the application identity needs `ses:SendEmail` for the chosen SES sender identity. Use a dedicated application IAM identity, not root access keys.

SES uses HTTPS on port 443. The adapter sends one request with a 12-second deadline and no automatic retry or SMTP fallback. It returns success only after SES supplies a message ID; that means accepted by the provider, not confirmed inbox delivery. Provider failures roll back the new OTP and return an error to the user. Logs contain a provider/error code without email addresses, OTP values or credentials.

Run `npm run email:check` with SES configured to inspect sending status, sender verification and production access without sending an email. This diagnostic additionally requires `ses:GetAccount` and `ses:GetEmailIdentity`. SES sandbox accounts can send only to verified recipients (or the AWS mailbox simulator). Production access is required for general student signups. Sender verification, permissions and sandbox status apply in the selected AWS region. A real test to an authorized recipient and confirmation of receipt are still required before claiming delivery works.

The existing Gmail path remains available with `EMAIL_PROVIDER=smtp`, `EMAIL_USER` and `EMAIL_PASS`; it requires a host permitting outbound SMTP. Switching the code to SES alone does not configure AWS or activate sending. Keep AWS keys on the backend only. AWS email usage is billed separately from Render hosting.

References: [SES API](https://docs.aws.amazon.com/ses/latest/dg/send-email-api.html), [SES sandbox and production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

## Calling flow: start here

The browser shows messages and saves preferences. The Node backend reads the database,
queues eligible call jobs, and sends them through a telephone provider. Closing the PWA
must not stop reminders; browser speech previews are not phone calls.

| Event | Current behavior |
| --- | --- |
| Signup and email verification | An in-app welcome message; no SMS required. |
| Successful sign-in | Optional greeting to the saved, verified phone. Repeated sign-ins are limited; no greeting on a page refresh. |
| Confirmed rental | One booking call after owner acceptance and verified deposit payment (`FULLY_PAID`). The initial rental payment only submits a request. |
| Active rental nearing its due date | Reminder 4 days before, 1 day before, on the due date, and 1 day overdue. Returned/cancelled rentals and stale due dates are excluded. |

A phone in `users` is not enough: `call_preferences` must contain the verified calling
number and the relevant opt-in. Phone verification is completed by the student inside
CampusMesh after provider activation; they do not need their own Authkey account.
Calls run from 09:00 to 19:00 India time, with a 30-minute gap and a maximum of three
attempts per rolling day. There is at most one due reminder per rolling day.

### Where to read or change the code

- `src/modules/calls/call-policy.js`: reminder dates, call windows, rental stages and consent mapping; pure functions.
- `src/modules/calls/call-scripts.js`: welcome, booking and due-date wording for each provider.
- `src/modules/calls/call.config.js`: private environment configuration and provider readiness.
- `src/modules/calls/call.service.js`: preferences, eligibility, durable job creation and dispatch. Keep eligibility checks both when queuing and before sending.
- `src/modules/calls/call.worker.js`: background queue processing; wake requests coalesce and never block login/payment responses.
- `src/modules/calls/authkey.client.js`: Authkey HTTP requests and sanitized errors.
- `src/modules/calls/scheduler.routes.js`: authenticated external scheduler endpoint.
- `src/modules/auth/onboarding.service.js`: records first sign-in and repeat-safe sign-in events.
- `src/modules/payments/payment.controller.js`: wakes the worker after successful deposit verification. The payment remains successful if the wake fails; scheduled scans recover the job.

### What is required before real phones can ring

1. Authkey must activate the account/Voice API, approve the message/verification templates,
   and supply usable voice credits. A pending free-credit application is not a funded balance.
2. Set credentials privately on the backend. After activation has been confirmed, enable
   `CALLS_PROVIDER=authkey`, `AUTHKEY_VOICE_APPROVED=true`, `CALLS_MODE=live` and
   `CALLS_SCHEDULER_ENABLED=true`; retain the approved OTP/voice template IDs.
3. The student opts in and verifies their own saved number through CampusMesh.
4. Keep the authenticated external scheduler running. Render Free sleeps after inactivity,
   so the in-process timer alone cannot guarantee reminders. The existing Supabase job
   checks every 15 minutes; a successful job run still does not prove that a phone rang.
5. Confirm one authorized real call with the recipient before claiming end-to-end delivery.
   Authkey submission IDs show acceptance, not an answered call. Confirm the English voice
   in Authkey separately; browser female-voice previews do not configure the telephone voice.

For a zero-budget demonstration, the in-app messages and browser voice preview work
without calling credits. Real telephone calls require an approved trial/grant or a funded
provider account. Avoid repeated login greetings if conserving a small allowance; booking
and return reminders are more useful. Turning off recurring greetings is a user preference,
not something the server should silently change.

The existing unit and isolated contract tests use fake providers. They verify scheduling,
consent, deduplication and state changes without spending credits or calling students.

## Campus intelligence, support and reminder calls

Run `npm run db:migrate` before starting the API. Migrations 004 and 005 add private support/call records and delivery estimate metadata; 006 adds one-time welcome calls; 010 adds Authkey provider tracking and private phone-verification challenges; 011 adds separate sign-in-call consent and a private event ledger. The Express API uses the server database connection; these private tables have RLS enabled with no browser-access policies.

The frontend exposes `/insights`, `/support` and `/reminders`. The API starts its reminder worker once per minute with the server. **Default mode is preview: no provider account, SMS or telephone call is required.** `/api/calls/preview` generates text for current eligible rentals and welcome calls, with clearly labelled examples. Browser speech playback does not dial a phone.

### Automatic sign-in greetings

`login_calls_enabled` is a separate, unchecked signup/Reminders preference for a greeting after successful sign-ins. Existing one-time welcome consent is preserved and does not opt anyone into recurring calls. The browser sends a UUID `login_attempt_id` to `POST /login` and reuses it on retries of the same submission. Only a valid password with verified college email can record a sign-in call event; `/me`, page reloads, failed logins and logout do not trigger greetings.

Migration 011 stores private sign-in call events and the latest intent's time, ID and saved calling number. Replaying an older request ID cannot replace a newer event. The worker reads the latest consented event from the database and uses the existing verified-number and provider-activation gates. Phone ownership is never inferred from successful email/password login. A nonblocking worker wake follows successful sign-in and phone verification; the regular timer and Supabase scheduler provide recovery. Sign-in does not wait for a telephone provider.

Only the latest greeting remains eligible, for at most 24 hours. It is cancelled if the number changes or consent is withdrawn. Calls run 09:00–19:00 India time, with at least 30 minutes between calls and at most three calls in a rolling day across all categories. A sign-in greeting that hits a repeat-call limit is skipped instead of being delayed into a backlog. Booking and due-date calls keep priority. When sign-in calls are enabled, the legacy one-time welcome is suppressed so a first login cannot produce two greetings. Authkey activation and funded, approved voice access are still required; preview mode cannot place calls.

`SIGN_IN_CALLS_E2E=1 node --test test/sign-in-calls.contract.test.js` requires a disposable database schema with migrations 001–011 and no `public` search-path fallback. It uses fake calling providers to check successful/failed logins, retries, session refresh, number changes and repeat-call limits. It must never target the hosted application's schema.

### Legacy one-time welcome call

The legacy API accepts `phone_number` (an E.164 number or a 10-digit Indian mobile number), plus optional `welcome_enabled: true`. The current signup form instead offers the separate sign-in-call option above; existing users can choose a one-time welcome in Reminders. Signup saves the number and this separate consent; it does not send phone SMS or dial. Email verification is unchanged. The first successful password login atomically records `users.first_signed_in_at`; invalid credentials and unverified email do not count. If welcome consent is enabled and phone ownership is not verified, that first login opens `/reminders?welcome=1` with the saved number and a skip link.

After phone verification, the worker can queue one `WELCOME` job per account (`welcome:<user-id>`). Repeated logins, worker ticks and concurrent workers cannot place a second welcome attempt. A job cancelled before its first attempt can resume after consent is restored; an attempted, failed or uncertain call is never automatically redialled. Consent, verified number and first-login age are rechecked before dispatch. Welcome eligibility expires seven days after the first successful login to avoid stale onboarding calls when a provider is connected later. Existing call windows and daily limits apply, so this is not a promise of an immediate call.

The generic welcome introduces CampusMesh and thanks the user for joining, without a press-1 step. With Twilio, it uses the configured female English voice and press 9 disables all automated call categories. Authkey uses one-way English speech; users turn calls off in Reminders and save their preferences. Its voice is configured in the approved Authkey template, not selected by the API adapter; keypad actions are not supported. A welcome-script browser preview is available without a provider.

### Matching and predictions

- Delivery offers match directed campus routes, detour limits and available time. The student still accepts before assignment; one active task is allowed. Wish Box highlights campus destinations on the student's route, but outside-shop travel is not mapped and is not given a fabricated ETA.
- Pickup-to-handover ETA starts with a walking-route baseline. With at least 20 valid completed non-demo trips, a distance/time regression is trained on the older 80% and checked on the newest 20%. It is used only if it beats the baseline; distances outside the observed range retain the baseline. Ranges are planning estimates, not arrival guarantees. The model is refreshed from records, with a five-minute cache.
- Demand uses 28 days of paid rental activity, with more weight on recent weeks. Forecasts need at least 10 rentals spread across five days. Demo/test rentals are excluded. This is campus demand, not a live external-market feed.
- Recommendations combine unique views, saves, paid rentals, momentum and category interests, with a category-diversity cap and visible reasons. Demo items never count as evidence of real demand.
- Return reliability uses completed paid rentals and agreed return dates, with smoothing and an uncertainty range. It appears only after five completed non-demo rentals. New users remain “Building history”; it never automatically rejects a customer. Only the borrower and the owner of an associated rental can request that borrower's estimate.

### Optional generative support

The interactive [browser voice assistant](../docs/browser-voice.md) uses Deepgram's
Voice Agent API through an authenticated server-side Socket.IO bridge. Configure
`DEEPGRAM_API_KEY` privately and keep `BROWSER_VOICE_ENABLED=true`. It reuses JWT
and account/help data, but does not use browser speech synthesis or require an
OpenAI key. See the guide for configuration, costs, privacy and acceptance tests.

The English help assistant works immediately from curated CampusMesh answers and the signed-in user's own rental/Wish Box records. It can save support tickets, but does not contact an external support team or promise a response time.

To enable model-generated answers, privately configure `OPENAI_API_KEY` and `OPENAI_MODEL` in `backend/.env` with a Responses API model that supports structured outputs. Restart the API. Requests use `store: false`, a strict response schema and a 12-second timeout. Missing credentials, provider failures or invalid outputs fall back to the help library. Obvious email/phone/OTP strings are redacted from questions; minimal authenticated account facts and relevant help text are sent to the configured model. No tools capable of issuing refunds, payments or account changes are exposed. The model can still make mistakes: the UI links the underlying help and offers a support request.

See [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

### Listing photos on Amazon S3

New listing photos are decoded and checked by the API, resized to at most 1600 pixels per side, stripped of embedded metadata, and saved as WebP in a private S3 bucket. Supabase stores only stable app photo URLs in `listings.image_url` and `image_urls`. Existing listings retain their original images. The browser keeps local previews (and optional drafts) until publishing; it never receives AWS credentials.

Configure `S3_PHOTO_BUCKET`, `S3_REGION` (or `AWS_REGION`), and `PUBLIC_API_URL` on the API. The existing server-side AWS credential chain is used. Allow only `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` on `arn:aws:s3:::YOUR_BUCKET/listings/*`. Keep S3 Block Public Access enabled, ACLs disabled, and SSE-S3 encryption. No bucket CORS, public-read policy, KMS key or CDN is required.

The API accepts up to five JPG/PNG/WebP photos, at most 5 MB and 40 megapixels each. New external URL submissions and animated images are rejected. `/api/photos/:owner/:file` checks that a photo is still attached to a listing, then redirects to a five-minute signed S3 URL. Listing photos are publicly viewable through the marketplace. Replacing/deleting a listing removes its unreferenced S3 photos; failed cleanup is logged for retry. A crash between an S3 upload and database save can leave an orphan object, so retain logs and reconcile storage periodically; no automatic broad bucket deletion is enabled.

Run `PHOTO_STORAGE_E2E=1 PHOTO_TEST_BASE_URL=https://your-api.example node --test test/photo-storage.contract.test.js` from `backend/` for a real storage check. This opt-in test needs the API and local environment to use the same database, JWT secret and S3 bucket. It creates disposable accounts/listing, checks uploads, private storage, gallery, ownership, replacement and deletion, then removes its fixtures. It sends no email or phone calls. S3 usage is billed under your AWS account/free-tier eligibility.

### Authkey student-project calling

The Authkey adapter is prepared, but the current account has zero voice credits and activation is pending. **Code integration alone does not make calling active.** Keep the approval gate off until Authkey approves the student application, credits the account, and confirms transactional voice access for consenting Indian mobile recipients. The [startup program](https://authkey.io/startup-india) requires approval; credits are limited, not permanent free calling. Promotional recommendation calls are disabled for this provider.

Configure only on the backend/Render service:

```dotenv
CALLS_PROVIDER=authkey
AUTHKEY_API_KEY=
AUTHKEY_VOICE_APPROVED=false
AUTHKEY_OTP_TEMPLATE_ID=
AUTHKEY_VOICE_TEMPLATE_ID=
CALLS_MODE=preview
CALLS_SCHEDULER_ENABLED=false
```

Keep the API key out of frontend variables, source control and logs. In Authkey, obtain approval for a Voice OTP template containing `{#2fa#}`, then set its numeric template ID as `AUTHKEY_OTP_TEMPLATE_ID`. Authkey generates the code. The optional `AUTHKEY_VOICE_TEMPLATE_ID` must be an approved voice template containing `{#message#}`; leaving it empty uses direct text-to-speech. Template IDs accept 1–20 digits. In the template form, choose **English (India)** (`en-IN`) and **Female** (`FEMALE`); leave keypress/repeat controls off. The console has no speed or soft-tone setting, so confirm the voice in an authorized test after approval. Confirm both templates and their permitted content with Authkey. See [Voice API](https://authkey.io/voice-api-docs) and [2FA API](https://authkey.io/2fa-api-docs).

After credits and voice approval are confirmed, set `AUTHKEY_VOICE_APPROVED=true`, `CALLS_MODE=live` and `CALLS_SCHEDULER_ENABLED=true`, then redeploy. Students save their own `+91` mobile number, request a verification call in Reminders, and enter the code they hear. The CampusMesh challenge expires after five minutes. Resends wait 60 seconds, sends are capped at three per destination per hour across accounts, and each account gets at most eight send/check attempts per hour. Changing a number clears verification and its pending challenge. No administrator needs to mark every signup number verified. Once verified, enabled welcome and eligible booking/due-date calls use the existing scheduler and call limits below.

Authkey currently provides one-way speech only: no press-9 opt-out, interactive support conversation, or guaranteed female/soft voice. Calls explain how to opt out in Reminders and keep item names/account details in the app. A `SENT` record means Authkey acknowledged submission with a `LogID`; it does not prove the phone rang or the student answered. Timeouts or unclear responses remain `UNKNOWN` and are never retried automatically. CampusMesh does not buy credits, enable recharge, or fall back to paid Twilio/SMS on failure. Configuration readiness does not check the provider's credit balance; inspect the account and confirm an authorized live test before claiming delivery works.

### Twilio alternative

Twilio uses Voice plus Verify for phone ownership. Keep `CALLS_MODE=preview` and `CALLS_SCHEDULER_ENABLED=false` while reviewing previews. When a Twilio account and an HTTPS deployment are ready, configure these values privately:

```dotenv
CALLS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
TWILIO_VERIFY_SERVICE_SID=
PUBLIC_API_URL=https://your-api.example
CALLS_MODE=live
CALLS_SCHEDULER_ENABLED=false
```

`PUBLIC_API_URL` must be the externally reachable backend origin, with the same URL used for signature verification. Voice/status callback URLs are supplied on each call under `/api/calls/webhooks/:id/{voice,answer,status}`. Only valid provider-signed requests are accepted. Users must save an E.164 number, verify it by SMS and separately opt in to welcome calls, reminders and/or recommendations. Phone verification sends a real SMS only when the configured user explicitly requests it. Changing the phone clears verification.

Set `CALLS_SCHEDULER_ENABLED=true` only when ready to place calls, then restart the API. Both live mode and scheduler enablement are required for outbound calls. The worker needs a running server; it is not suitable for a serverless process that sleeps between requests. Provider account/geographic restrictions and number availability must be checked with the chosen provider before launch.

Both providers run scheduled calls 09:00–19:00 Asia/Kolkata, at most three times per rolling 24 hours per user, spaced at least 30 minutes apart; one due reminder per rolling day. Twilio recommendation calls are limited to once per seven days. Rental reminders take priority and are eligible four days before, the day before, on the date, and one day after the agreed return date. Every attempt rechecks consent, verification and rental state. Returned rentals or changed due dates invalidate stale reminders. A unique job key prevents repeated scheduler ticks from duplicating reminders. Ambiguous provider failures are marked `UNKNOWN` and require manual reconciliation; they are never automatically redialled.

Twilio voice delivery uses female Indian English (`Polly.Aditi`). Full accounts use SSML at 90% speed and soft volume; trial accounts put text directly inside `Say` so trial sanitization cannot discard nested speech. Browser previews prefer an installed female English voice, at 0.9 speed and 0.85 volume; the exact preview sound depends on the device and does not establish the Authkey call voice. See [Twilio speech controls](https://www.twilio.com/docs/voice/twiml/say/text-speech).

Twilio calls disclose that they are automated. Rental details require the recipient to press 1; the generic welcome plays immediately. Press 9 (or say “stop” during a speech prompt) to turn off all call categories. Follow-up English questions use the same support assistant, limited to three turns and a two-minute call. No audio recording is requested. Neither provider books items, collects payment information, approves extensions or changes rental state. Twilio recommendation calls refer to rentals because CampusMesh currently has no purchase checkout.

Provider references: [Voice calls](https://www.twilio.com/docs/voice/api/call-resource), [webhook signatures](https://www.twilio.com/docs/usage/security), [speech/DTMF Gather](https://www.twilio.com/docs/voice/twiml/gather), [phone verification](https://www.twilio.com/docs/verify/api/verification).

### Verification

`node --test test/authkey-config.test.js test/authkey-client.test.js` checks configuration, readiness, provider separation and fake HTTP contracts without connecting to a database or placing calls. `AUTHKEY_E2E=1 node --test test/authkey-calls.contract.test.js` requires migrations 001–011 in a disposable schema and a `DATABASE_URL` scoped only to that schema (no `public` fallback). It refuses the default schema, uses fake Authkey calls, and checks phone ownership, welcome deduplication, reminder opt-out, destination limits, expiry and phone-change races. The test removes its fixtures; the runner should drop the disposable schema afterward. Never run it against the hosted application's schema.

`WELCOME_E2E=1 node --test test/welcome-calls.contract.test.js` starts a temporary local API, creates a disposable signup, mocks email/SMS/Voice providers, checks concurrent first-login detection, phone verification, consent withdrawal and exactly one welcome attempt, then removes its records. Worker queries are scoped to the fixture. No real email, SMS or phone call is sent.

`npm test` runs local unit tests. Against an idle development API on port 3003, `INTELLIGENCE_E2E=1 node --test test/calls-support.contract.test.js` creates disposable records, injects a fake phone provider, tests consent/call limits/webhook signatures/cancellation and authenticated data isolation, then cleans up. No real calls or SMS are made. The contract test expects preview configuration and no other enabled call users or queued jobs. Existing delivery and Wish Box contracts are opt-in via `DELIVERY_OFFERS_E2E=1` and `WISH_E2E=1` respectively; run them separately against an idle development environment.

## Features
- **Custom Authentication**: JWT based auth built from scratch using `bcrypt` and `jsonwebtoken`.
- **Restricted Signup**: Only students with an `@dbit.co.in` email can register.
- **Protected Routes**: Secure endpoints requiring a valid JSON Web Token.
- **Marketplace Listings CRUD**: Users can create, view, update, and delete listings. Only the listing owner can update or delete it.
- **PostgreSQL Database**: Built on top of Supabase's Postgres with raw SQL queries using the `pg` package.

## Tech Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL (Supabase)
- **Database Driver**: `pg`
- **Security**: `bcrypt` for hashing, `jsonwebtoken` for stateless authentication

## Folder Structure
```
backend/
├── server.js               # Main Express app and server startup
├── package.json            # Project metadata and dependencies
├── .env                    # Environment variables (Database URL, JWT Secret)
├── config/
│   └── db.js               # PostgreSQL pool connection setup
├── middleware/
│   └── authMiddleware.js   # JWT validation middleware
├── controllers/
│   ├── authController.js   # Logic for signup, login, profile, logout
│   └── listingController.js# Logic for listing CRUD operations
├── routes/
│   ├── authRoutes.js       # Express routes for authentication
│   └── listingRoutes.js    # Express routes for listings
├── seed.js                 # Script to create tables and insert dummy users
└── README.md               # Documentation
```

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Setup Environment Variables:
   Open the `.env` file and populate `DATABASE_URL` with your Supabase Postgres connection string.
   ```env
   DATABASE_URL=postgres://[user]:[password]@[host]:[port]/[database]
   JWT_SECRET=your_jwt_secret
   PORT=3003
   ```

## Database Setup & Seeding

This project requires a `users` table and a `listings` table. The `seed.js` script handles both the SQL table creation (migrations) and seeding of dummy users.

Run the seed script:
```bash
npm run seed
```

This will:
- Create the `users` and `listings` tables if they don't exist.
- Insert 10 dummy students (all with password `Password@123`).
- Skip any users that already exist.

## Running the Server

Start the application in development mode (auto-reload on changes):
```bash
npm run dev
```

Or run standard:
```bash
npm start
```

The server will start on `http://localhost:3003`.

## API Endpoints

### Authentication
- `POST /signup`: Register a new user (Requires `@dbit.co.in` email).
- `POST /login`: Authenticate and receive a JWT.
- `GET /profile`: Get the logged-in user's profile (Requires JWT).
- `POST /logout`: Logout (Client removes the token).

### Listings
- `GET /listings`: Retrieve all listings.
- `GET /listings/:id`: Retrieve a specific listing.
- `POST /listings`: Create a listing (Requires JWT).
- `PUT /listings/:id`: Update a listing (Requires JWT & Owner privileges).
- `DELETE /listings/:id`: Delete a listing (Requires JWT & Owner privileges).

## Testing with Postman
You can find the comprehensive Postman Collection `Postman_Collection.json` in this directory. Import it into your Postman workspace to easily test all endpoints, including authentication flows and listing modifications.

Booking calls: opt in using `booking_enabled` (signup rental-call consent also enables reminders). Only newly fully paid real rentals qualify, once per rental and within 24 hours of confirmation. Historical, unpaid, cancelled and demo bookings are excluded. Payment confirmation and its timestamp commit together; scheduler retries deduplicate. Signup shows an in-app welcome after email verification; it does not send SMS. Provider credentials alone do not prove voice readiness: check the correct Voice sending number (trials may use shared numbers), recipient verification, geographic permissions, and a live test before enabling calls.

`BOOKING_CALLS_E2E=1 node --test test/booking-calls.contract.test.js` scopes worker queries to disposable records and tests booking deduplication, cancellation, expiry, unchanged preferences, and four-day reminders. `DELIVERY_E2E=1 node --test test/delivery-flow.contract.test.js` starts its own local API and uses a fake Razorpay provider with valid fixture signatures and captured-payment responses. It tests booking through both delivery handovers, notification emission, concurrent route saves and payment replay without charging money. All records are removed afterward. Never run delivery contracts while real couriers are online.

### Supabase call scheduler and Twilio trials

The private `POST /api/call-scheduler/tick` endpoint requires `Authorization: Bearer CALLS_SCHEDULER_SECRET` (a random secret of at least 32 characters; never expose it to the frontend). It invokes the same deduplicated worker as the server timer. Configure the same secret on the API and locally, then run `CALLS_SCHEDULER_API_URL=https://your-api.example node scripts/install-call-scheduler.js`. This explicitly enables pg_cron/pg_net, stores the secret and URL in Supabase Vault, and schedules a job every 15 minutes. The SQL function is executable only by its owner and sends requests only in 09:00–19:00 India time when a verified opted-in user exists. Its HTTP timeout allows Render cold starts. Monitor `cron.job_run_details` and `net._http_response`; scheduler success alone is not proof of phone delivery. Disable just this job with `SELECT cron.unschedule('campusmesh-automated-calls')`. Free-provider outages and trial limits still apply.

Set `TWILIO_TRIAL_MODE=true` for the new trial API. Calls use URL-hosted TwiML and omit unsupported advanced parameters; inline TwiML is rejected by the trial API. Trial recipients must be verified in Twilio. An administrator may link an explicitly confirmed recipient to the same verified CampusMesh account after checking provider evidence, recording consent and phone verification; never automatically mark every signup number verified. Other users still need phone verification before automated calls. Trial minutes, recipient limits and expiry are enforced by Twilio.

The trial custom-TwiML fetcher was observed omitting `X-Twilio-Signature`, which previously caused HTTP 403 and an audible application error. Trial speech URLs now carry a 15-minute HMAC token bound to the exact call and endpoint. Missing, altered, expired and cross-call tokens fail closed; signed requests still use normal Twilio validation, and status callbacks always require it. Treat these URLs as temporary secrets: never log their query strings or expose them to the frontend. Trial fetches without a CallSid resolve only the accepted provider SID stored on that call job. The signed provider probe can test speech without fabricating a rental or first sign-in. A real trial call to the owner's explicitly approved recipient played the CampusMesh female-voice greeting successfully on 2026-10-15; the recipient confirmed hearing it. Live booking/reminder delivery still depends on qualifying events, consent, phone verification, calling hours and provider availability.

### Delivery availability and returns

- `POST /api/courier/availability` with `availability_mode: "OPEN"` and a future `available_until` starts campus-wide offers without a route. `ROUTE` retains the optional origin/destination filter. Availability expires automatically; students can go offline anytime.
- Offers contain pickup, destination, earnings and a walking estimate after pickup. Notifications use Socket.IO with polling while the app is open; closed-app Web Push is not configured.
- Couriers choose Accept or Decline. Acceptance is atomic and allows one current task. Send `offer_id` with either response; return acceptance requires it so a stale screen cannot accept a changed destination.
- `POST /api/rentals/:id/return-request` reuses an existing courier return. New courier returns wait in `RETURN_LOCATION_PENDING` until the owner confirms a campus destination with `PUT /api/rentals/:id/return-destination`.
- Owners may revise an unassigned return destination. Old offers are replaced, and the destination is locked after acceptance. Direct returns continue through owner inspection.
- Browse-item demand uses verified rental payment records from the last 30 days and unique non-owner viewers from the last seven days. Cancelled/rejected rentals, sample listings and QA accounts are excluded. It is campus activity, not an external market forecast.
