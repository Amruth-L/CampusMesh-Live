# Browser voice assistant

CampusMesh now has a signed-in, English voice assistant at `/voice`. After an
explicit successful login or signup verification, a dismissible invitation offers
**Start AI voice**. Restoring an existing login does not display another invitation.
The same feature is always reachable from **Voice assistant** in the navigation
and from Support. Login, signup, email verification and telephone reminders retain
their existing authentication and provider flows.

## Architecture and trade-offs

| Option | Cost and latency | Compatibility and integration | Decision |
| --- | --- | --- | --- |
| Browser speech recognition + browser speech synthesis + grounded text AI | No telephone or audio-generation API charge from CampusMesh. Text-model usage is billed by the AI provider. A reply follows each completed sentence, with a short recognition/network/model pause. | Reuses existing auth, support retrieval and Responses API integration; no new dependency. Speech recognition is not supported uniformly. Device voices vary. Typed input and visible replies remain available. | Implemented: the practical first release for this student project. |
| Native speech-to-speech through WebRTC, such as OpenAI Realtime | More fluid audio and interruption handling; usage-based audio charges. | Backend exchanges authenticated SDP or issues short-lived credentials. Requires an AI account with model access and credit, additional audio lifecycle and provider controls. | A future upgrade if full-duplex audio is needed. This release does not claim to stream Realtime audio. |
| Self-hosted recognition + language model + speech synthesis | Avoids per-request vendor billing but consumes server CPU/GPU, storage and operations time. | Needs several models and services. A small free Render instance is a poor fit for consistently responsive inference. | Evaluated; not added to this existing application. |

Sources: [Web Speech recognition and compatibility](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition),
[OpenAI WebRTC architecture](https://developers.openai.com/api/docs/guides/voice-webrtc),
[OpenAI API pricing](https://developers.openai.com/api/docs/pricing),
[whisper.cpp microphone transcription example](https://github.com/ggml-org/whisper.cpp/blob/master/examples/stream/README.md).
Prices, voice availability and provider access can change; no free AI credit is assumed.

Web Audio is useful for meters and custom audio processing; it does not itself
recognize speech or generate answers. This release uses Web Speech for recognition
and playback and therefore does not need a custom Web Audio graph or WebRTC connection.

## User experience

1. Sign in normally, then choose the voice invitation or open `/voice`.
2. Choose **Start AI voice session** to hear a welcome greeting. This does not
   access the microphone or make a telephone call.
3. Choose **Talk** and permit microphone access. Ask one question. Recognition
   ends after the sentence; **Finish speaking** also ends that listening turn.
4. The backend answers using CampusMesh help and the current user's own account
   records. Hear and read the reply, then choose Talk for the next turn. Tap Talk
   during playback to interrupt the assistant. Typed questions work throughout.
5. **Mute mic** stops listening immediately and blocks Talk until unmuted. The
   **Read replies aloud** option independently controls assistant audio.
6. **End session**, signing out, leaving the page/tab, lost connectivity or the
   ten-minute limit stops capture/playback and ends the conversation. The visible
   transcript remains until leaving or starting another session.

The assistant prefers known female English device voices, including Indian English
when available, with a slightly slower delivery. Web Speech exposes no gender field;
it cannot guarantee a particular voice or tone. It falls back to the device's English
voice and shows its name. It never claims to be a person or to verify identity.

## Configuration

For local use, set these in `backend/.env`; for the hosted site, set the same keys
in **Render → CampusMesh service → Environment**, then save and deploy:

```dotenv
BROWSER_VOICE_ENABLED=true
OPENAI_API_KEY=
OPENAI_MODEL=
```

Enter your API key privately and choose a text model available to that API project
which supports the Responses API and JSON Schema structured output, for example
`gpt-4.1-mini` if available to your project. The existing
support chat uses these same settings. No additional SDK, phone number, Twilio,
Authkey, SMS verification or Realtime API key is needed. Configure a provider usage
budget and monitor actual consumption. API use is separate from a ChatGPT subscription.

When either OpenAI setting is blank, browser speech still works with the built-in
help library and account records. The UI says **Built-in help · generative AI
unavailable**. This is spoken help, not open-ended model-generated conversation.
When a configured model fails or times out, an explicitly labelled help reply is
used. An invalid model/key or exhausted credit must be corrected with the provider;
a simulated test cannot establish that live generation is operational.

`BROWSER_VOICE_ENABLED=false` disables new sessions and further answers. Keep keys
on the backend only. Do not add them to frontend env files or `VITE_` variables.
Existing SES, S3, payment and phone-provider settings need no change.

Local commands (after the project's normal database/env setup):

```sh
npm run dev --prefix backend
npm run dev --prefix frontend
```

Keep the frontend's existing public API base URL pointed at the backend. Hosted
microphone use requires HTTPS; localhost is allowed for development. Some embedded
previews, Brave configurations, Firefox and mobile/PWA combinations do not provide
Web Speech recognition even if the microphone hardware works. Open the site directly
in a supported browser, allow microphone permission, or use the typed fallback.

## Backend boundaries

- `GET /api/voice/capabilities`: authenticated availability and mode, never keys.
- `POST /api/voice/sessions`: verified existing account; creates an opaque session ID,
  fixed greeting and expiry. The request cannot choose a different user.
- `POST /api/voice/sessions/:id/turns`: checks ownership, expiry, one in-flight answer,
  input size and rate limits. Reads only the JWT user's records through the existing
  support service. Uses up to eight redacted conversation messages for follow-ups.
- `DELETE /api/voice/sessions/:id`: idempotently ends the caller's session and aborts
  an in-flight AI request. Other users cannot end or query that session.
- Every route uses existing Bearer JWT authentication and checks that the account
  still exists and has verified its email. Voice is never an authentication factor.
- No raw audio is uploaded to CampusMesh. Browser recognition may send audio to the
  browser vendor's service. Questions and selected account facts go to the configured
  AI provider. Responses use `store:false`; this does not override provider retention
  policies. Account secrets should never be spoken to the assistant.
- Transcripts stay in the page and bounded server memory, never `support_turns`,
  localStorage or the account database. Ending a session removes server history;
  crashes/disconnects are bounded by expiry and periodic cleanup. Proxy logs must not
  be configured to record request bodies or Authorization headers.
- Limits: 10 minutes/session, 30 turns/session, 10 turns/minute, five starts per
  user per ten minutes, one active session per user, 200 concurrent sessions.
  AI requests time out after 12 seconds. Browser listening stops after 30 seconds.
- This first release keeps state and limits in one Node process. A restart/deploy
  requires starting a new session. Before running multiple replicas, move the
  session/limiter store to shared storage such as Redis. Render free-tier cold starts
  can delay initial access. No background job is required for browser voice.

## Validation

Automated checks (no microphone recordings, provider charges or production fixtures):

```sh
node --test backend/test/browser-voice.test.js frontend/test/*.test.js
npm run lint --prefix frontend
npm run build --prefix frontend
```

The voice tests cover real JWT enforcement, unverified/deleted accounts, ownership,
concurrent turns, session replacement/cancellation, rate/turn limits, expiry,
redacted context, provider failure, microphone denial, unsupported browsers, late
responses after ending, mute, and cleanup. Provider transport and Web Speech are
controlled fakes; they do not prove live microphone or AI-provider delivery.

Manual acceptance on your own device:

- Sign out and sign in; see the invitation without a microphone prompt. Dismiss it
  and confirm the normal destination and logout still work.
- Start a session, then Talk. Allow the mic and ask “How does Wish Box work?” Follow
  with another question. Confirm a transcript, reply playback and correct mode label.
- With an AI key configured, check that replies say **AI-assisted answer**. If they
  say **CampusMesh help & account records**, inspect API model access/billing; the
  live provider has not succeeded for that turn.
- Deny the mic, then type a question. Test mute during listening, Talk during speech,
  audio off, End during a pending reply, logout, leaving the tab, and airplane mode.
  Capture must stop and no late answer may resume audio.
- Use a second signed-in account: its voice session must show only its own records.
  Test desktop and a real phone, including narrow layouts and visible logout.
- Verify typing/playback on a browser without speech recognition. No microphone or
  provider failure should block the rest of CampusMesh.

This does not place welcome, booking or due-date calls to a phone. Proactive browser
audio cannot reliably ring a closed app, bypass autoplay rules or use a background
microphone. Telephone reminders remain a separate, explicitly opted-in service.
