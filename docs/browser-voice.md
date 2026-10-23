# Deepgram browser voice assistant

CampusMesh uses Deepgram's **Voice Agent API**, not a locally trained voice model,
Web Speech recognition, or a phone call. After a successful explicit sign-in, the
existing invitation opens `/voice`. The user presses **Start AI voice session**,
allows the microphone and hears the Deepgram greeting. Speech is continuous;
users can interrupt, mute their microphone, mute playback, type a question while
the assistant is listening, or end the session. Login/signup and OTP stay unchanged.

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
node --test backend/test/browser-voice.test.js frontend/test/voice-session.test.js
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
`VOICE_E2E=1` and no provider keys. No schema migration is needed for voice.

Before declaring live voice verified, test with an actual configured account:

1. Log in normally and start from the invitation; no microphone request on login.
2. Allow microphone, hear the greeting and ask about renting an item.
3. Ask a follow-up, interrupt the answer, and confirm both transcript and audio.
4. Mute/unmute, mute output, and send a typed question while it is listening.
5. Deny microphone on a fresh attempt; confirm text Support remains usable.
6. End, log out or leave the tab; confirm the browser microphone indicator stops.
7. Check Deepgram's usage dashboard for the session. Confirm expiry/network errors
   do not leave an open provider connection.
8. Repeat on current desktop Chrome/Edge and mobile Safari/Chrome over HTTPS.

## Official references and costs

- [Voice Agent protocol](https://developers.deepgram.com/docs/voice-agent-message-flow)
- [Managed LLM options](https://developers.deepgram.com/docs/voice-agent-llm-models)
- [Voice settings](https://developers.deepgram.com/docs/voice-agent-tts-models)
- [Creating API keys](https://developers.deepgram.com/docs/create-additional-api-keys)
- [Deepgram pricing](https://deepgram.com/pricing)

At implementation, the published Standard managed Voice Agent rate is $0.075/min,
with advertised $200 signup credit for eligible new accounts. Verify current
pricing and actual credit in the console before relying on either. The integration
does not enable auto-recharge, buy credits, or place telephone calls.
