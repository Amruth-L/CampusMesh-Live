# Deepgram browser voice assistant

CampusMesh uses Deepgram's **Voice Agent API**, not a locally trained voice model,
Web Speech recognition, or a phone call. After a successful explicit sign-in, a
short Deepgram welcome announcement plays when browser audio is permitted.
The voice-updates bar links to `/voice` for conversation. The user presses **Start AI voice session**,
allows the microphone and hears the Deepgram greeting. Speech is continuous;
users can interrupt, mute their microphone, mute playback, type a question while
the assistant is listening, or end the session. Login/signup and OTP stay unchanged.

## Automatic workflow announcements

- After email verification and successful sign-in, a welcome message plays automatically when audio is allowed. Signing up alone does not bypass email verification or request microphone access.
- The sign-in click/key gesture primes Web Audio. Browsers can still block audio; **Tap to hear** is the honest fallback. Audio is never forced through a browser restriction.
- A visible tab checks for updates every 15 seconds. The feed includes lender decisions, payment reports and receipt confirmations, eligible courier offers, assignment, condition photos, pickup, handover, return destination/inspection, deposit refunds, extensions, Wish Box status and return reminders. Only the involved renter/lender/courier receives private events. Wish Box open requests are also announced to students who enabled Wish Box availability. Expired offers and superseded payment/progress states are skipped.
- Confirmed booking speech stays separate from payment reports. The backend requires the signed-in borrower, `FULLY_PAID`, a confirmation timestamp, an eligible active status and a real (non-demo) listing. Direct UPI reports remain pending until the recipient confirms rent and any required deposit. Razorpay callbacks must already have passed the existing server verification.
- This reads confirmed state and does not alter payment, lender approval, delivery or refund transitions. No success message is based on navigating to a success URL.
- The event feed reuses committed `transaction_events`, `direct_upi_events` and current offer/Wish Box/refund records. It changes no business state and needs no database migration. Immutable event IDs prevent repeated polls from speaking again. Pagination preserves PostgreSQL microsecond timestamps so simultaneous events cannot loop or be lost through millisecond rounding. Pages contain up to 20 updates, and playback queues up to 100. Current-state notifications can be superseded before playback; the audio endpoint rechecks them and the player skips stale entries.
- Active, fully paid rentals also get one browser reminder per item/date at four days, one day, the due date and each overdue day, using Asia/Kolkata calendar dates. Changing the due date or starting a return invalidates queued reminders. These reminders can appear when opening the site; ordinary event catch-up starts with the current sign-in session.
- Refreshes and polls do not replay heard updates. History is per account on this browser (last 300 events); clearing site storage or using another device resets this history. Catch-up is bounded to 24 hours and the current sign-in session.
- **Mute updates** stops playback and saves the preference for this account/browser. **Dismiss** skips the current message. Hidden tabs, logout, offline mode, and entering the conversation page stop announcements; the conversation never competes with a background announcement.
- `/api/voice/announcements` and `/api/voice/announcements/audio` require authenticated, email-verified accounts. The audio endpoint accepts only a welcome, an owned confirmed booking, or an authenticated event ID, never arbitrary text. It rechecks event access before serving cached audio. It uses Aura-2 Thalia via Deepgram TTS, with no microphone or separate OpenAI key.
- Fixed-script MP3s are cached by script for one hour in memory (at most 32 entries, 1 MB each), with coalesced requests and 60 requests/user/10 minutes. Different milestones never reuse the wrong script. These limits protect provider credit; a rate-limited user can retry after the window expires. No names or booking data go to TTS. Responses are private/no-store. Provider failure does not affect login or booking.
- This does not speak with the website closed, dial a phone, or create unattended due-date calls.

## Configure locally and on Render

1. Sign in at <https://console.deepgram.com/>. Select your project, then **Settings →
   API Keys → Create a New API Key**. Give it a descriptive name such as
   `CampusMesh voice`. Use a key with permission to call Voice Agent (usage/write);
   do not give the application account-administration access unnecessarily.
2. Check that the project has Voice Agent access and available credit. Deepgram
   advertises signup credit, but eligibility and your actual balance are shown in
   your console. This is usage-billed, not permanently free voice.
3. Add these backend-only variables privately to `backend/.env`:

   ```dotenv
   BROWSER_VOICE_ENABLED=true
   DEEPGRAM_API_KEY=YOUR_PRIVATE_DEEPGRAM_KEY
   ```

4. On Render, open the existing CampusMesh service → **Environment**. Add
   `DEEPGRAM_API_KEY` and set `BROWSER_VOICE_ENABLED=true`. Edit existing rows instead
   of creating duplicates. Click **Save, rebuild, and deploy**.
5. Locally restart `npm run dev` in `backend`; start the frontend normally. On
   Render wait for **Live**. Open CampusMesh, sign in, choose **Voice assistant**,
   press Start and allow microphone access. Use headphones for the clearest test.

Never place this key in a `VITE_` variable, commit it, paste it into chat, or send it
to the browser. No separate `OPENAI_API_KEY` is required for voice: Deepgram manages
its configured LLM. The existing optional text-support AI configuration is separate.
Missing Deepgram configuration disables Start and provides a text Support link.
A configured key is not proof that the provider has credit or accepts requests.

## Architecture and choice

| Option | Trade-off |
| --- | --- |
| Deepgram browser connection with a temporary token | Shorter audio path, but browser-held provider tokens complicate server-enforced duration, configuration and spend limits. |
| **Deepgram through the existing Node/Socket.IO server** | Chosen: one extra network hop; server controls credentials, account context, allowed messages and session lifetime. Reuses the app's existing real-time transport. |
| Self-hosted speech and language models | Requires compute and operational work; not used. |

`browser microphone → AudioWorklet PCM → authenticated /voice Socket.IO namespace
→ Deepgram Voice Agent → PCM speech + transcript → browser Web Audio`

The worklet only converts samples to PCM. It does not generate speech or recognize
words. Deepgram provides Nova-3 recognition, a managed `gpt-4o-mini` reasoning model,
and Aura-2 Thalia female English speech at 0.9 speed. No custom model is trained.
Provider settings live in `backend/src/modules/voice/deepgram.settings.js`.

HTTP `POST /api/voice/sessions` issues a one-use, 30-second connection ticket.
The Socket.IO handshake needs both that ticket and the current CampusMesh JWT.
The server rechecks email verification, claims the ticket for its owner, obtains
minimal account facts, then connects to `wss://agent.deepgram.com/v1/agent/converse`.
It sends Settings only after Welcome and audio only after SettingsApplied.
Clients cannot change the prompt, models, provider URL or account identity.
Provider keys never leave the backend. There is no public token endpoint.

The agent receives curated help and a start-of-session snapshot of the signed-in
user's last eight owned/borrowed rentals and five related wishes. Only titles,
statuses and due dates are included: no internal IDs, email, mobile, bank or UPI
fields. Titles are redacted and bounded. It cannot perform payments, refunds or
account actions. To check newly changed status, start a new session.

CampusMesh does not persist audio/transcripts. Deepgram and its managed LLM process
the audio/text under their service terms; this is not a promise of zero provider
retention. `mip_opt_out: true` requests exclusion from Deepgram model improvement.
The page explains the data flow before the microphone is requested.

## Limits and failure behavior

- One session per user; a new session closes the previous one.
- Five starts per ten minutes per user, ten simultaneous sessions per Node process.
- Ten-minute maximum or JWT expiry, whichever comes first; 30 user turns.
- Typed messages: 1–1500 characters, at most ten per minute.
- PCM packet/throughput limits and upstream backpressure protection.
- End, logout, page/tab exit, microphone loss and network failure close microphone,
  audio playback, timers and the provider connection. No automatic reconnection
  that could silently begin a second billed session.
- Muting stops microphone transmission but leaves the provider session open;
  **End session** stops provider usage. Silence may still be billable.
- UserStartedSpeaking cancels queued assistant audio for interruption.
- Missing credit, invalid settings or provider/network failure show a retry message;
  they do not silently fall back to browser-generated speech.

The ticket registry is in memory and intended for the current single Render
instance. Multi-instance deployment needs a shared ticket/rate-limit store and
correct Socket.IO routing. Restarting/deploying ends active conversations. Render
cold starts can delay connection. Browser voice does not provide unattended
phone reminders, and it is not an identity-verification mechanism.

## Tests

From the repository root (install frontend and backend dependencies first):

```sh
node --test backend/test/browser-voice.test.js backend/test/voice-announcements.test.js frontend/test/voice-session.test.js frontend/test/announcement-player.test.js
npm run lint --prefix backend
npm run lint --prefix frontend
npm run build --prefix frontend
```

The tests simulate Deepgram, not a paid call. They exercise real HTTP/JWT and
Socket.IO authentication, ticket ownership/replay/expiry, provider message ordering,
PCM/text forwarding, credential redaction, error shutdown, microphone denial,
late permission results, mute, playback and interruption. The gated
`backend/test/browser-voice.contract.test.js` also verifies account isolation with
real database queries; run only in a disposable `qa_evidence_*` schema with
`VOICE_E2E=1` and no provider keys. The gated `backend/test/voice-events.contract.test.js` checks event ownership, payment-report versus receipt semantics, pickup supersession, pagination, due dates, rollback, expired offers and Wish Box visibility. Run it with `VOICE_E2E=1` in a disposable `qa_evidence_*` schema and no provider keys. No schema migration is needed for voice.

Before declaring live voice verified, test with an actual configured account:

1. Log in normally: hear the welcome or use Tap to hear. No microphone request on login. Confirm Mute stops it. Open Talk to assistant to begin a conversation.
2. Allow microphone, hear the greeting and ask about renting an item.
3. Ask a follow-up, interrupt the answer, and confirm both transcript and audio.
4. Mute/unmute, mute output, and send a typed question while it is listening.
5. Deny microphone on a fresh attempt; confirm text Support remains usable.
6. End, log out or leave the tab; confirm the browser microphone indicator stops.
7. Check Deepgram's usage dashboard for the session. Confirm expiry/network errors
   do not leave an open provider connection.
8. Repeat on current desktop Chrome/Edge and mobile Safari/Chrome over HTTPS.

For announcement verification, complete a non-demo rental through the existing payment flow. A pending/reported payment must never speak a payment-success message; reports instead explain that recipient confirmation is pending. After rent and any required deposit are confirmed, the borrower hears one update within 15 seconds in a visible tab. Refresh and confirm it does not repeat. Try muted, offline, blocked autoplay, logout during loading, and switching accounts. Test backend transitions in an isolated schema; never mark real payments paid for testing.

## Official references and costs

- [Deepgram text-to-speech](https://developers.deepgram.com/docs/text-to-speech)
- [Voice Agent protocol](https://developers.deepgram.com/docs/voice-agent-message-flow)
- [Managed LLM options](https://developers.deepgram.com/docs/voice-agent-llm-models)
- [Voice settings](https://developers.deepgram.com/docs/voice-agent-tts-models)
- [Creating API keys](https://developers.deepgram.com/docs/create-additional-api-keys)
- [Deepgram pricing](https://deepgram.com/pricing)

At implementation, the published Standard managed Voice Agent rate is $0.075/min,
with advertised $200 signup credit for eligible new accounts. Verify current
pricing and actual credit in the console before relying on either. The integration
does not enable auto-recharge, buy credits, or place telephone calls.

### Workflow announcement checks

Use separate renter, lender and courier sessions with voice enabled. Request a real student listing, accept it, report/confirm each direct payment, accept the courier offer, upload condition photos, verify pickup and handover, confirm the delivery fee, request return, confirm the destination, verify return handover, inspect the item, and report/confirm the deposit refund. Each participant should hear their relevant update within the polling/playback delay. Refund reporting must say pending until the renter confirms receipt; physical handover must not say the delivery fee is paid. Unrelated accounts must receive neither the event nor its audio. For a due-date test use an isolated fixture rather than altering real rentals.

Voice is informational: it cannot verify a bank transfer, approve a rental, or complete a delivery. Browser announcements require an open, visible tab, enabled audio, working network and available Deepgram credit. They do not run with the site closed. Existing microphone consent and phone-call configuration remain separate.
