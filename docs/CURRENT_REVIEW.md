# CampusMesh current-code review — 25 October 2026

Reviewed starting commit **db1cf4b**, in `/Users/amruth/CampusMesh-Live`. The historical reference was 88eb6dc. The separate `Campus-Mesh-Latest(new)` checkout contained ongoing work and was left untouched. This review did not deploy the changes. GitHub publication is tracked separately from the test results. No production records, credentials, bank transfers, emails, calls, or storage uploads were used.

## Finding checklist

“Fixed” means the remaining defect was changed and verified locally. “Already fixed” means the current behavior was verified and preserved. Mixed findings identify the preserved behavior separately. Test evidence is described below; screenshots and raw results are in [artifacts/review](../artifacts/review/).

| Finding | Initial assessment → outcome | Evidence and change |
|---|---|---|
| **1A Delivery socket reliability** | Still present → **fixed** | An isolated API process exited with code 1 on a non-UUID join. `delivery.socket.js` now checks payload/user identifiers, catches DB/join failures, keeps the participant query, and sends generic acknowledgements. The regression starts a real API child, submits malformed payloads, rejects another user's delivery, accepts a participant, and verifies `/health` plus a live process. A fake DB failure verifies error redaction. |
| **1B Public owner email** | Still present → **fixed** | Collection and detail handlers returned `owner_email`. Both now serialize an explicit public allowlist and omit contact fields. Tests exercise both handlers; browser browsing/details/booking still work. No frontend consumer of `owner_email` was found. |
| **1C Password login limiting** | Still present → **fixed; hosted proxy configuration needs verification** | Added PostgreSQL atomic counters: 10 attempts per email/IP pair and 300 per IP in a 15-minute window. Success clears the pair; counters expire without extending a lock indefinitely. Counters are shared across instances and hash identifiers. HTTP tests cover failed passwords, 429 + `Retry-After`, expiry, and valid login; middleware tests cover another IP and recovery. OTP/recovery routes retain their own controls. See proxy requirements below. |
| **1D Request validation** | Partially fixed → **remaining gaps fixed** | Reproduced profile `name:123` and `username:null` as 500s. They now return 400. Added shared bounded text, password, monetary and date rules; explicit boolean/object validation; listing UUID guards; cart delivery/type validation. Create/update share listing validation. Malformed JSON and unexpected failures have separate controlled handling. Actual HTTP profile tests and handler tests pass. |
| **2A One-day rentals** | Partially fixed → **fixed** | Backend inclusive dates were correct in intent; summary rejected same-day selection and calendar/pricing calculations differed. One shared calendar-date module now drives picker, summary, cart and booking. SQL DATE stays a date string across host timezones. Tests cover same-day, leap/month boundaries, reversed/impossible/past dates and blocked interiors; browser verifies one-day summary/cart/request. Single booking retains its lock/conflict check. Legacy cart settlement now also locks listings and rechecks availability after capture. |
| **2B Payment-mode quotes** | Partially fixed → **fixed** | Removed independent dialog/summary pricing and reused a server quote based on saved listing prices. Direct UPI charges no platform fee and distinguishes request-time ₹0, rent/deposit after acceptance, delivery after handover. Cart refreshes prices before checkout. Loading/error states block continuation; an injected 503 never becomes a payable ₹0 quote. Existing captured Razorpay receipts retain their historical amounts. Lifecycle/recovery suites and browser retry tests pass. |
| **2C Payment instructions** | Partially fixed → **remaining gaps fixed** | The current owner inbox already groups new/accepted/returns/history and describes review before direct payment; preserved it. Direct acceptance already clears the legacy deposit deadline, verified by lifecycle tests. Removed the summary's universal 30-minute deadline and QR-only wording. Direct-mode text describes payment/refunds to recipients with manual confirmation. Existing return/refund and handover gates were preserved and retested. |
| **3A Availability setting** | Still present → **fixed by removing unsupported choices** | “Tomorrow/weekend/custom” was only local form state and not a supported saved scheduling field. Removed the misleading selector rather than inventing availability scheduling. The existing active/inactive listing flag and booking checks remain. Edit reload confirms no ineffective timeframe control. |
| **3B Create/edit/category parity** | Still present → **fixed** | Shared category definitions include the union of existing choices; an existing unknown category remains representable. Edit now uses the create form and supports daily rent, item value, deposit, condition, pickup, delivery and photos. Regression tests persist those fields and preserve untouched photos; browser create→edit→reload preserves ₹12.35→₹13.45 and ₹75.25, without rounding. |
| **3C Fabricated metrics** | Still present → **fixed** | Removed missing-data fallbacks 4.8/98/Computer Science/semester 6 from the listing form. Missing department/ratings display honest empty states. Existing independently calculated Mesh/trust data was not replaced. `data/mockData.js` still contains sample sellers, but no runtime import was found; it was not rewritten. Demo listing identification remains visible. |
| **4A Header/navigation** | Partially fixed → **remaining gaps fixed** | The current compact header already had a 44×44 logout control; rendered checks confirmed it at 320px, so it was retained. Shared account/payment/voice pages no longer highlight an unrelated workspace. Overflow navigation has a descriptive accessible name; current horizontal scrolling is intentional within navigation. No page-level horizontal overflow in measured screens. |
| **4B Fixed navigation/overlays** | Partially fixed → **remaining gaps fixed; physical-device verification blocked** | Added route-wide bottom space with safe-area inset, including screens not using `main`. Floating help moves out of the mobile action area. Simulated-touch save is reachable at 390×360; landscape 768×320 passes. No physical phone/OS keyboard or device safe-area emulator was available; those behaviors are not certified. |
| **4C Rental dialog/calendar** | Still present → **fixed** | Added accessible title, labelled controls/dates, selected/disabled semantics, internal scrolling, initial focus, Tab containment, Escape and focus restoration. Calendar buttons are at least 44px high; narrow cells remain narrower than 44px to fit seven days. Native labelled date inputs provide an alternative. Browser tests check keyboard behavior and all eight widths. Blocked range interiors cannot be continued. |
| **4D Forms/accessibility** | Partially fixed → **remaining verified gaps fixed** | Shared create/edit labels are connected; validation summary is associated with fields; feedback is inline/live rather than alert dialogs. Photo actions remain visible on mobile and keyboard focus. Login password label no longer includes “Forgot password?” or the visibility control. Browser inspection found no unlabelled visible fields on the measured forms (hidden file inputs are activated by named buttons). Measured primary/secondary contrasts are listed below. This is not a full assistive-technology certification. |
| **4E Page consistency/navigation** | Partially fixed → **remaining gaps fixed** | Summary uses responsive title/gutters, stacked date fields and a non-wrapping condition badge. Long title/name/address fixtures fit measured widths. Forward navigation reset scroll to 0; Back restored 400px. Reduced-motion rules already existed and remain active. 200% text sizing passed; desktop browser page-zoom and physical keyboard behavior were not separately verified. |
| **5A Terminology** | Partially fixed → **targeted inconsistencies fixed** | Authentication screens use “DBIT campus email”; listing prices distinguish daily rent, deposit and item value. Removed obsolete sale-value wording from validation and Lend eyebrow on the listing form. Existing user-facing status translation helpers were retained. This was a focused correction, not a rewrite of every sentence in the product. |
| **5B Settings hierarchy** | Still present → **fixed** | Settings now says “Manage your profile and contact details,” omits rental statistics and links to “Payment details & receipts.” This neutral label remains accurate for direct UPI and the retained legacy payout destination. Browser verifies settings heading/stat removal and form labels. |
| **5C Optional voice** | Partially fixed → **remaining gap fixed** | Unavailable optional voice no longer dominates regular pages; setup stays in its own feature. Signup consent already defaults false, preserves optional status/verification/opt-out details and was retained. Calls and external services were not enabled. |
| **5D Actions/feedback** | Partially fixed → **remaining gaps fixed** | Rental selection continues to a quote/request rather than implying immediate payment. Listing preview/draft/success feedback is inline. Failed listing publication keeps input/photos; browser injects 503 then successfully retries. Demo listings remain labelled before a real-payment flow. Existing payment confirmation/retry safeguards are preserved. |
| **5E Mobile hierarchy** | Still present → **fixed** | Marketplace search/results now precede optional recommendations. Header and available filters retain the green identity; mobile help no longer competes with booking actions. Screenshots and narrow-width tests verify the result. |
| **6 Shared code / stale responses** | Partially fixed → **targeted improvements completed** | Shared listing form, category definitions, calendar-date rules, quote calculation/hook and dialog focus logic remove verified duplication. Quote and summary listing loads ignore stale responses. No framework migration or broad component rewrite. |
| **6 Route splitting / bundle** | Still present → **fixed** | Added lazy routes with loading and error/reload states. Removed eager Razorpay script; the existing checkout loader remains. Entry JS reduced from 938,068 to 337,968 bytes (about 64%). Full chunk totals and limitations below. |
| **6 Type checking / lint** | Still present → **fixed** | Added an actual `tsc --noEmit` step for existing TS/TSX authentication files; it does not claim to type-check the whole JS project. Split the context hook from its provider to remove the Fast Refresh warning. No broad dependency upgrades; TypeScript is the one added dev dependency. |
| **7 Live-provider/physical verification** | **Blocked / intentionally not exercised** | Production ingress access/configuration, real-device access and authorized live-provider transactions were outside this isolated run. Fake providers and a local photo adapter were used. Do not interpret these results as proof of live banking, email, voice or S3 delivery. |

No historical issue was dismissed just because a comment or file changed. The preserved/already-fixed portions above have behavior-level or regression evidence. Unsupported availability scheduling was removed, not claimed as implemented.

## Important source changes

- [Socket handling](../backend/src/modules/delivery/delivery.socket.js), [public listing contract](../backend/src/modules/listings/public-listing.js), [login limiter](../backend/src/modules/auth/login-throttle.js), [migration 022](../backend/src/db/migrations/022_login_throttle.sql).
- [Shared validation](../backend/src/shared/validation.js), [listing input rules](../backend/src/modules/listings/listing-input.js), [calendar dates](../shared/rental-dates.js), [database date parser](../backend/src/config/database.js).
- [Authoritative rental quote](../backend/src/shared/rental-quote.js), [pricing endpoint](../backend/src/modules/payments/pricing.controller.js), [cart settlement](../backend/src/modules/payments/checkout.service.js), [cart controller](../backend/src/modules/cart/cart.controller.js).
- [Rental dialog](../frontend/src/features/marketplace/RentalDialog.jsx), [summary](../frontend/src/pages/RentSummary.jsx), [shared create/edit form](../frontend/src/pages/AddListing.jsx), [quote hook](../frontend/src/hooks/useRentalQuote.js), [dialog hook](../frontend/src/hooks/useDialog.js).
- [Routes and scroll restoration](../frontend/src/App.jsx), [navigation](../frontend/src/components/layout/AppNavbar.jsx), [settings](../frontend/src/features/account/AccountPage.jsx), [CSS](../frontend/src/index.css), [Docker packaging](../Dockerfile).

Many two-line frontend diffs only change the `useAuth` import after separating the hook/provider exports; they do not change each screen's business logic.

## Verification results

| Command / suite | Pass | Fail | Skip | Notes |
|---|---:|---:|---:|---|
| `npm test --prefix backend` | 141 | 0 | 23 | 164 tests; optional external/DB suites remain opt-in. Historical counts are not used as proof. |
| `npm test --prefix frontend` | 40 | 0 | 0 | Current helper tests, including owner-request/status behavior. |
| `node --test backend/test/review-regressions.test.js` with isolated DB, **Node 22.12**, `TZ=Asia/Kolkata` | 11 | 0 | 0 | New validation/privacy/pricing/login/socket regression group. |
| Direct-UPI lifecycle | 12 | 0 | 0 | Manual receipt/refund/state constraints. |
| Private handover evidence | 6 | 0 | 0 | Participant authorization / evidence safeguards. |
| Cart checkout/recovery | 10 | 0 | 0 | Includes captured-payment availability change, saved legacy amount, retry/idempotency. |
| Rental booking | 8 | 0 | 0 | Date/availability and booking semantics. |
| Rental payment recovery | 7 | 0 | 0 | Reconciliation safeguards. |
| Delivery payment completion | 6 | 0 | 0 | Completion requires the appropriate receipt gate. |
| Open delivery and return | 8 | 0 | 0 | Assignment, handover and return transitions. |
| Listing deletion | 4 | 0 | 0 | Existing deletion/history safety preserved. |
| Backend lint / frontend lint | — | 0 | — | Both clean; no frontend Fast Refresh warning. |
| `npm run typecheck --prefix frontend` | — | 0 | — | Pass. |
| `node scripts/build-frontend.cjs` | — | 0 | — | Production frontend build passes. |
| `docker build -t campusmesh-review:local .` | — | 0 | — | Complete Node 22 production packaging passes, including `shared/`. |
| Browser journeys | 36 viewport assertions | 0 | — | Browse, dialog keyboard, one-day quote/cart/request, quote error, acceptance, edit/reload, settings, sign-in and recovery validation. Zero uncaught page errors. |
| Additional browser journeys | 2 suites | 0 | — | Simulated touch create/photo/error/retry/edit/reload; cart partial failure/retry. |

The eight optional lifecycle suites total **61 passing tests**. The 11-test regression run includes four tests also executed in the standard suite; do not sum these counts as distinct tests. The standard tests, both linters and type check were also rerun under Node 22.12.0 (see `artifacts/review/node-version.txt`). Standard suite skips are documented opt-in tests, not silently marked successful. Provider-dependent tests outside the selected suites remain unverified.

### Browser measurements

Measured `window.innerWidth`/`innerHeight`, not requested tool sizes: **320×800, 360×800, 375×800, 390×800, 414×800, 768×800, 1024×800, 1440×800** for marketplace, rental dialog, booking summary and edit listing (32 checks). Also settings at 375×720, landscape 768×320, 200% root text at 768×320, and payments at 768×320. Screenshots include 320×720, 375×720 and 390×720 variants.

A separate Chromium context used `isMobile:true`, `hasTouch:true`; measured 390×720 and `navigator.maxTouchPoints=1`. At 390×360 the save button bounds were y=158…202, clear of bottom navigation. This simulates a constrained viewport; it does not open a real mobile keyboard. 200% root text scaling is not desktop page zoom. Physical-device Safari/Android, real camera capture, hardware keyboard/screen-reader interaction, OS keyboard and actual safe-area behavior remain unverified.

The shared T3 preview was tried first, but resizing produced inconsistent CSS widths (requested 320 gave 384; compensations gave 319/321; fractional input returned `Expected an integer at ["width"]`). Exact-width checks therefore used local standalone Playwright/Chromium. External browser requests were blocked.

Rendered primary button colors were white on `rgb(35,116,66)` (**5.76:1**). Secondary copy `#59665e` on paper `#f7f8f7` is **5.66:1**; placeholder `#647168` on white is **5.12:1**. These are representative measured/token-resolved checks, not an exhaustive WCAG audit. The design detector's two transition warnings were false positives: margin declarations followed explicit color/transform transitions; margin was not animated.

### Screenshots

| Screen | Desktop | Mobile |
|---|---|---|
| Marketplace | [1440px](../artifacts/review/marketplace-desktop.png) | [320px](../artifacts/review/marketplace-mobile.png) |
| Rental dialog | [1440px](../artifacts/review/rental-dialog-desktop.png) | [320px](../artifacts/review/rental-dialog-mobile.png) |
| Booking summary | [1440px](../artifacts/review/summary-desktop.png) | [390px](../artifacts/review/summary-mobile.png) |
| Edit listing | [1440px](../artifacts/review/edit-listing-desktop.png) | [375px](../artifacts/review/edit-listing-mobile.png) |
| Other checks | | [Pricing fields](../artifacts/review/edit-pricing-mobile.png), [settings](../artifacts/review/settings-mobile.png), [cart](../artifacts/review/cart-mobile.png), [cart retry](../artifacts/review/cart-recovery-mobile.png) |

These are disposable local accounts/items. Provider results are simulated only where explicitly described. Viewport screenshots were preferred over stitched full-page captures, which initially repeated fixed/sticky content in the capture; those captures were replaced.

### Performance evidence

The previous entry was **938,068 bytes**; the new entry is **337,968 bytes**. Static imports of that entry total **368,619 bytes** before the selected lazy page loads. All emitted lazy/shared JS totals **963,576 bytes**: splitting reduces initial work, not total application code. Per-chunk gzip sizes do not equal a measured network transfer, and route-specific resources add to entry costs. No Lighthouse score or field-performance improvement is claimed. [Raw bundle measurements](../artifacts/review/bundle-results.json).

## Deployment requirements and limits

1. Apply migration **022_login_throttle.sql** before serving password login. The documented root start command already runs pending migrations; do not reset or seed production.
2. Deploy the repository root, including **shared/**. Both native root builds and Docker need it. Keep Node **22.12+ within Node 22**, as required by the repository; shared ESM helpers are used from the backend.
3. Set `TRUST_PROXY_HOPS` only after checking the actual ingress path. Default 0 trusts no forwarded IP headers. A one-proxy, non-bypassable deployment may need 1, but this run did not inspect Render's live ingress. A wrong value can pool customers into one IP bucket or trust spoofed forwarding headers. All instances must use the same existing JWT secret and database.
4. Keep existing payment-provider settings and reconciliation records. No gateway migration, real charge, transfer, refund, call activation or storage migration was performed. Direct UPI still requires payer authorization and recipient confirmation; it is not an automatic bank-verification service.
5. The editable availability timeframe was removed. Future availability scheduling would require a product rule, persisted dates and booking enforcement; it is not part of this release.
6. QA scripts reject hosted databases and require a loopback database named `campusmesh_review`. Browser photos are processed by the real frontend but persisted with a fake local adapter; this does not certify production S3 permissions.
7. GitHub publication does not verify deployment. Run the deployment process after configuring the ingress/migration requirements, then verify the hosted release.

## Engineering lessons

- Validate at the boundary: a button or TypeScript type cannot stop malformed network input. Async socket listeners need their own error handling.
- A public API should name fields it exposes. Selecting a database row and returning it whole can reveal future private columns accidentally.
- Dates without times should stay calendar dates. A one-day rental is one day even when the host timezone changes.
- Calculate money once on the server and explain when each part is due. A failed quote is an error, never a zero-price offer.
- A payment receipt and item availability are different facts. Recheck availability when committing, preserve captured receipts, and never ask for another payment to resolve an uncertain first attempt.
- Reuse one listing form and validation contract. Edit should preserve precision and fields the user did not change.
- Responsive quality needs rendered checks: viewport dimensions, focus, touch targets, scrolling and action reachability all matter beyond a successful build.
