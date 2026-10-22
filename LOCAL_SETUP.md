# CampusMesh local setup

Use Node.js 22.12+ within Node 22, npm, and a PostgreSQL database. Start in the extracted project folder containing the root `package.json`.

## 1. Create your local configuration

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

The archive includes safe examples only. Your existing cloud credentials and database records are not included. Keep `.env` files private; Git ignores them.

In `backend/.env`, set:

- `DATABASE_URL`: your PostgreSQL connection string. For Supabase, use the session pooler connection and URL-encode special characters in the password.
- `DATABASE_SSL`: `true` for Supabase; match your database requirements for local PostgreSQL.
- `JWT_SECRET`: a fresh, long random value. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and save it privately.
- `FRONTEND_ORIGIN=http://localhost:5173` and `PUBLIC_API_URL=http://localhost:3003` for local development.
- Your chosen email provider and its credentials if testing signup, email verification or password reset. Signup accepts `@dbit.co.in` addresses only. See [email configuration](backend/README.md#otp-email-on-render-free).

The backend example also documents S3 photos, Razorpay, AI support, Twilio/Authkey and optional private print storage. Configure only the services you use. For the optional Lambda mailer, configure its own environment in AWS using [its setup guide](backend/lambda/otp-mailer/README.md).

Keep `CALLS_MODE=preview`, `CALLS_SCHEDULER_ENABLED=false` and `AUTHKEY_VOICE_APPROVED=false` until your calling provider is activated and usable credits are confirmed. Browser voice previews do not dial phones.

In `frontend/.env`, leave the API URL blank to use the local default. If using Razorpay checkout, use the public Key ID from the same test account configured on the backend. Every `VITE_` value is visible in the browser; never put secret keys there.

## 2. Install dependencies and migrate

From the project root:

```bash
npm ci --prefix backend
npm ci --prefix frontend
npm run migrate --prefix backend
```

Migrations create/update the database schema. They do not import the hosted project's users or orders.

## 3. Optional demo data

For a separate development database, add demo accounts, catalog items and courier availability:

```bash
npm run seed --prefix backend
```

Do not run demo seeding against your hosted user database. Demo users are `studenta@dbit.co.in` through `studentl@dbit.co.in`, plus `xerox@dbit.co.in`; their presentation-only password is `CampusMesh@123`.

## 4. Start the app

Terminal 1, from the project root:

```bash
npm run dev --prefix backend
```

Terminal 2, from the project root:

```bash
npm run dev --prefix frontend
```

Open [http://localhost:5173](http://localhost:5173). The backend runs at [http://localhost:3003](http://localhost:3003); `/health` reports database connectivity. If Vite chooses a different port, update `FRONTEND_ORIGIN` and restart the backend.

For cloud hosting and production build commands, see [README.md](README.md#cloud-deployment). Configure hosted secrets in the hosting dashboard; copying example files alone does not connect email, storage, payment or calling accounts.
