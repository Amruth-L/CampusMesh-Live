# CampusMesh

CampusMesh is a campus-only rental, route-matched courier, and private Xerox delivery platform. Lender, borrower, and courier are actions available to every verified student account.

## Cloud deployment

Deploy the repository root as a **Node web service**, using Node 22, build command `npm run build`, start command `npm start`, and health-check path `/health`. Set `SERVE_FRONTEND=true` and `NODE_ENV=production`. The root build explicitly uses the deployed origin for API and Socket.IO traffic, and the backend serves the compiled frontend and SPA deep links. Startup applies pending migrations; it never resets or seeds the database.

Configure secrets in the hosting dashboard, never Git. Use [backend/.env.example](backend/.env.example) as the configuration reference: set `DATABASE_URL`, `JWT_SECRET`, your chosen email provider's credentials, and Razorpay credentials when payments are needed. Set `DATABASE_SSL=true` for the Supabase session-pooler connection, and set `FRONTEND_ORIGIN` and `PUBLIC_API_URL` to the actual public HTTPS origin. Let the host supply `PORT`.

Keep test Razorpay credentials for preview testing. Calls stay disabled with `CALLS_MODE=preview` and `CALLS_SCHEDULER_ENABLED=false`; model-generated support additionally needs OpenAI credentials. The English help library and browser voice previews work without those providers. Campus Print remains locked as coming soon. See [backend configuration](backend/README.md) for the complete support/calling setup.

Render's free web services pause when idle and block outbound SMTP ports. Use a configured HTTPS email adapter (`EMAIL_PROVIDER=lambda` or `ses`); see [email setup](backend/README.md#otp-email-on-render-free). SES needs a verified sender, sending permissions and production access for general recipients. Direct Gmail SMTP requires a host permitting SMTP. Always-running background reminders also need an always-on service. See [Render's free-tier limitations](https://render.com/docs/free). Compute-plan selection is separate from code preparation; no paid deployment is created by building locally.

A multi-stage `Dockerfile` is also included. It excludes `.env` files and runs as the non-root Node user. Docker is optional for the native Node deployment.

## Features

- Student authentication with signup, email verification, login, logout, and password reset
- JWT-protected user profiles and listing management
- Marketplace listing CRUD with owner-only edit and delete access
- Item rental workflow with booking requests, owner responses, rental status, and returns
- Shopping cart and checkout support
- Saved items / wishlist
- Dynamic rental pricing calculation
- Razorpay rental, security-deposit, and checkout payments
- Payment verification, history, and deposit refunds
- Email notifications through Nodemailer
- Postman collection for backend API testing
- Dijkstra campus routing with declared courier routes and transparent 100-point matching
- Atomic, expiring courier offers delivered through authenticated Socket.IO user rooms
- Single-use, hashed QR/OTP credentials for outbound, return, and Xerox handovers
- Private PDF validation, ₹3/page pricing, Xerox Desk queue, and courier delivery
- Trending and personalized marketplace recommendations from first-party interactions

## Project structure

```text
.
├── backend/
│   ├── .env.example              # Server configuration template; no real secrets
│   ├── src/server.js             # Express application entry point
│   ├── src/config/               # PostgreSQL and Razorpay configuration
│   ├── src/modules/              # Auth, rentals, deliveries, payments and calls
│   ├── src/db/                   # Migrations and optional demo seed data
│   ├── lambda/otp-mailer/        # Optional AWS Lambda email adapter
│   ├── test/                     # Backend tests
│   └── Postman_Collection.json   # API requests for Postman
└── frontend/
    ├── .env.example              # Public browser configuration template
    ├── public/images/            # Catalog and category images
    ├── src/features/             # Feature screens and flows
    ├── src/pages/                # Application screens
    ├── src/components/           # Shared UI components
    ├── src/context/              # Authentication state
    └── src/utils/                # Frontend service helpers
```

## Tech stack

- Frontend: React 19, React Router, Vite, Axios
- Backend: Node.js, Express, JWT, bcrypt
- Database: PostgreSQL, accessed through `pg` and Supabase
- Payments: Razorpay
- Email: Nodemailer

## Prerequisites

- Node.js 22.12+ within the Node 22 release line, and npm (see `package.json`)
- A PostgreSQL database (the project is configured for Supabase PostgreSQL)
- Razorpay test credentials for payment testing, or live credentials for real payments

## Configuration

From the project root, copy both templates, then fill in your own configuration:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

The [backend example](backend/.env.example) documents database, OTP email, S3 photos, payments, support and calling settings. The [frontend example](frontend/.env.example) contains only public browser settings. Never place AWS secrets, database credentials, service-role keys or calling-provider secrets in a `VITE_` variable: Vite includes these values in the browser bundle.

Actual `.env` files, dependencies, builds, logs, private deployment files and archives are ignored by Git. Only `.env.example` templates belong in source archives. The archive does not contain hosted environment settings or database records; configure your own services after extracting it. See [LOCAL_SETUP.md](LOCAL_SETUP.md) for setup steps and optional demo data.

The examples use `http://localhost:3003` for the API and `http://localhost:5173` for the frontend. Calling defaults to preview mode; a copied example does not activate real calls.

## Installation and setup

Install dependencies in both applications:

```bash
npm ci --prefix backend
npm ci --prefix frontend
```

Apply idempotent migrations:

```bash
npm run migrate --prefix backend
```

For an isolated development database only, `npm run seed --prefix backend` adds presentation accounts, catalog items and sample courier availability. Do not run the demo seed against your hosted user database.

## Running locally

Start the backend in one terminal:

```bash
cd backend
npm run dev
```

The API runs on [http://localhost:3003](http://localhost:3003). Use `npm start` to run without watch mode.

Start the frontend in another terminal:

```bash
cd frontend
npm run dev
```

Vite will print the local frontend URL, normally [http://localhost:5173](http://localhost:5173).

## Backend API overview

| Area | Base path | Examples |
| --- | --- | --- |
| Authentication | `/` | `/signup`, `/verify-email`, `/login`, `/logout` |
| Listings | `/listings` | `GET`, `POST`, `PUT`, `DELETE` |
| Profile | `/api/profile` | Read and update profile |
| Rentals | `/api/rentals` | Bookings, requests, status, returns |
| Payments | `/api/payment` | Orders, verification, history, refunds |
| Cart | `/api/cart` | Add, update, remove, and view cart items |
| Pricing | `/api/pricing` | Calculate rental pricing |
| Wishlist | `/api/wishlist` | View, toggle, and remove saved items |
| Courier routes/offers | `/api/courier` | Availability routes and scored offers |
| Delivery tracking/handover | `/api/delivery` | Assignment, live checkpoints, QR/OTP verification |
| Campus graph | `/api/campus` | Locations and computed shortest paths |
| Xerox | `/api/xerox` | PDF preview, requests, desk queue, and private documents |

Demo accounts are `studenta@dbit.co.in` through `studentl@dbit.co.in`, plus `xerox@dbit.co.in`. The presentation-only password is `CampusMesh@123`.

Most user, rental, cart, wishlist, and payment endpoints require a JWT in the request authorization header.

## Testing the API

Import `backend/Postman_Collection.json` into Postman. Set the backend URL to `http://localhost:3003`, then test signup/login before calling protected endpoints.

## Useful commands

```bash
# Backend
cd backend && npm run dev
cd backend && npm start
cd backend && npm run seed
cd backend && npm test

# Frontend
cd frontend && npm run dev
cd frontend && npm run build
cd frontend && npm run lint
cd frontend && npm run preview
```


## Direct UPI rental flow

Direct UPI is the default for new deployments. `DIRECT_UPI_ENABLED=true` enables
it explicitly; setting this flag to `false` retains gateway checkout for new rentals.
Startup applies migration 017 before accepting requests. This
selects direct UPI for **new rentals only**. Existing Razorpay rentals and Wish Box
keep their existing payment method. Do not delete gateway keys or webhook settings
while those transactions still need reconciliation or refunds.

1. Lenders and delivery students save their own receiving UPI ID under **Payments**.
   This is self-declared; CampusMesh does not validate bank ownership.
2. A renter submits dates. The lender accepts or declines without charging anyone.
3. Acceptance creates a rental-fee request with a snapshot of the recipient UPI ID,
   exact amount and payment reference. The renter authorises payment in a UPI app.
4. The renter reports the 12-digit transaction reference. Only the recipient can
   confirm receipt after checking their bank history. A QR scan, app return,
   screenshot or reported reference never marks a payment confirmed automatically.
5. The deposit follows the same separate flow. Handover or delivery matching unlocks
   only after rental and required deposit receipts are confirmed.
6. After a courier completes a verified handover, a separate fee request becomes
   available in Payments for renter → courier. Return delivery has its own request.
   These direct fees have no platform deduction. Courier fees can remain unpaid:
   this architecture cannot enforce or automatically collect them.
7. The lender confirms physical return. The deposit becomes refund pending. Once
   the renter saves a UPI ID, either party prepares the refund; the lender sends it
   and the renter confirms actual receipt. No automatic refund takes place.

### Payment records and guarantees

`upi_profiles` contains receiving details. `direct_upi_payments` contains one
obligation per rental/kind or delivery leg, participant IDs, integer paise, a
recipient snapshot and receipt status. `direct_upi_events` records actions.

Status flow: `PENDING → REPORTED → CONFIRMED`. A recipient can mark `DISPUTED`
after checking their history, then confirm later if the credit is found. Disputes
never generate another payable QR; resolve them through support without paying
twice. Database locks, unique source keys and unique transaction references guard
against concurrent confirmation and duplicate requests. Participant-only APIs
protect payment details. Existing requests retain their recipient snapshot after
profile edits.

There is no combined cart debit, automated split, bank verification, escrow,
automatic refund or platform fee in this mode. Damage deductions and extensions
require support; the app refuses unsupported automated adjustments. Checkout
requests each cart item independently and retains failed items. Calls still need
an active provider and credits, independently of payment mode.

### Validation

`backend/test/direct-upi.contract.test.js` covers input validation and, with
`EVIDENCE_E2E=1` in a disposable `qa_` database schema, request retries, acceptance,
participant permissions, amount/recipient snapshots, duplicate references,
manual confirmation, deposit gating, verified courier fees, refund confirmation,
and exclusion from Razorpay payout records. Never use a production schema for
these integration tests. A real UPI transfer must additionally be checked in both
participants' bank histories; passing application tests does not prove bank credit.
