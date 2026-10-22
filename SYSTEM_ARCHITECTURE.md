# CampusMesh — System Architecture

## Overview

CampusMesh is a campus-only platform for student rentals, route-matched delivery, and private Xerox printing. It is implemented as a frontend/backend monorepo with a shared PostgreSQL data model.

## High-level architecture

```text
Student / Courier / Xerox Desk
            |
            v
 React 19 + Vite client
 (routes, feature screens, auth state)
            |
       REST API + Socket.IO
            |
            v
 Node.js + Express backend
 (auth, rentals, payments, delivery, Xerox, listings)
            |
            v
 PostgreSQL / Supabase
 (users, listings, rentals, payments, delivery, events)
            |
   -----------------------------
   |             |             |
 Razorpay    Supabase      Nodemailer
 payments    private files  email
```

## Technology stack

- Frontend: React 19, Vite, React Router, Axios, Tailwind CSS, Lucide icons, Motion, Socket.IO client.
- Backend: Node.js, Express, JWT authentication, bcrypt, Socket.IO, ESLint.
- Database: PostgreSQL hosted/configured through Supabase, accessed with `pg`; SQL migrations and seed data are checked into the backend.
- Payments: Razorpay for rental, deposit, checkout, and Xerox payments, with local simulation mode when credentials are absent.
- File storage and email: Supabase Storage for private Xerox documents and Nodemailer for notifications.

## Main modules

- Marketplace and wishlist: listings, search, saved items, owner listing management.
- Rentals: date selection, server-side pricing, booking, owner approval, deposits, returns, and refunds.
- Delivery: declared courier routes, campus shortest-path routing, scored courier matching, expiring offers, live location updates, and QR/OTP handovers.
- Xerox: PDF validation and hashing, payment-gated requests, Xerox Desk processing, and private courier delivery.

## Core request flow

1. The React client sends authenticated REST requests with a JWT.
2. Express middleware authenticates the user and validates payment signatures where required.
3. Controllers/services apply business rules and persist changes in PostgreSQL transactions.
4. Socket.IO emits delivery offers, assignment, status, and location events to the relevant users.
5. External services handle payment processing, private document storage, and email delivery.

## Security principles

JWT-protected APIs, server-side pricing and payment verification, role/ownership checks, private Xerox document access, and single-use hashed QR/OTP handover credentials.
