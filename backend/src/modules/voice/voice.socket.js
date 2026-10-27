/* global setInterval, clearInterval, clearTimeout */
const { authenticateToken, watchSocketSession } = require('../../security/session');
const WebSocket = require('ws');
const { voiceService } = require('./voice.service');
const { agentSettings } = require('./deepgram.settings');
const ENDPOINT = 'wss://agent.deepgram.com/v1/agent/converse';

// Only audio and bounded text cross this bridge. Clients cannot change prompts,
// models, provider credentials, account ownership or the upstream endpoint.
function attachVoice(
  io,
  {
    db,
    service = voiceService,
    settings = agentSettings,
    connect = () =>
      new WebSocket(ENDPOINT, {
        headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
        handshakeTimeout: 15000,
        maxPayload: 1024 * 1024,
      }),
  } = {},
) {
  const namespace = io.of('/voice');
  namespace.use(async (socket, next) => {
    try {
      const user = await authenticateToken(socket.handshake.auth?.token, db);
      const result = await db.query('SELECT email_verified FROM users WHERE id=$1', [user.id]);
      if (!result.rows[0]?.email_verified) throw Error('unauthorized');
      socket.voiceUser = user;
      next();
    } catch {
      next(new Error('Sign in with a verified CampusMesh account to use voice.'));
    }
  });
  namespace.on('connection', async (socket) => {
    socket.join(`user:${socket.voiceUser.id}`);
    // Audio is already byte/turn limited. Poll revocation without a DB read for every PCM frame.
    watchSocketSession(socket, socket.voiceUser, socket.handshake.auth.token, db, { checkPackets:false });
    const { id: userId, exp } = socket.voiceUser;
    const { sessionId, sampleRate } = socket.handshake.auth;
    let upstream,
      ready = false,
      welcomed = false,
      closed = false,
      keepalive,
      timer;
    let turns = 0,
      textTimes = [],
      bucket = Date.now(),
      audioBytes = 0;
    function close(message = 'Session ended. Start a new conversation when you are ready.') {
      if (closed) return;
      closed = true;
      clearInterval(keepalive);
      clearTimeout(timer);
      upstream?.terminate();
      if (socket.connected) {
        socket.emit('voice:ended', { message });
        socket.disconnect(true);
      }
      service.end(userId, sessionId);
    }
    function fail(message = 'Deepgram could not complete this session. Please retry or use text Support.') {
      if (socket.connected) socket.emit('voice:error', { message });
      close(message);
    }
    socket.on('disconnect', () => close());
    socket.on('voice:end', () => close());
    try {
      if (![8000, 16000, 24000, 32000, 44100, 48000].includes(sampleRate)) throw Error('audio format');
      const session = service.claim(userId, sessionId, () => close(), exp ? exp * 1000 : undefined);
      const config = await settings(userId, db, sampleRate);
      if (closed) return;
      upstream = connect();
      timer = setTimeout(() => fail('Deepgram took too long to connect. Please try again.'), 20000);
      timer.unref?.();
      upstream.on('message', (data, binary) => {
        if (closed) return;
        if (binary) {
          if (ready && socket.connected) socket.emit('voice:audio', data);
          return;
        }
        let event;
        try {
          event = JSON.parse(data.toString());
        } catch {
          return fail();
        }
        if (event.type === 'Welcome' && !welcomed) {
          welcomed = true;
          upstream.send(JSON.stringify(config));
          keepalive = setInterval(() => {
            if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ type: 'KeepAlive' }));
          }, 5000);
          keepalive.unref?.();
        } else if (event.type === 'SettingsApplied' && welcomed) {
          ready = true;
          clearTimeout(timer);
          socket.emit('voice:ready', { expiresAt: session.expiresAt });
        } else if (event.type === 'ConversationText' && ready && ['user', 'assistant'].includes(event.role)) {
          if (event.role === 'user' && ++turns > 30)
            return close('Conversation limit reached. Start a new session.');
          socket.emit('voice:event', {
            type: event.type,
            role: event.role,
            content: String(event.content || '').slice(0, 5000),
          });
        } else if (
          ['UserStartedSpeaking', 'AgentThinking', 'AgentStartedSpeaking', 'AgentAudioDone'].includes(
            event.type,
          ) &&
          ready
        ) {
          socket.emit('voice:event', { type: event.type });
        } else if (event.type === 'InjectionRefused') {
          socket.emit('voice:notice', {
            message: 'Please wait for the assistant to finish, then send your question again.',
          });
        } else if (event.type === 'Error') {
          // Do not expose provider payloads, prompts or credentials in client errors/logs.
          console.warn(
            '[voice] Deepgram session error',
            String(event.code || 'UNKNOWN')
              .replace(/[^A-Z0-9_]/gi, '')
              .slice(0, 60),
          );
          fail();
        }
      });
      upstream.on('unexpected-response', (_request, response) => {
        response.resume();
        console.warn('[voice] Deepgram connection rejected', response.statusCode);
        fail('Deepgram could not start. The project owner should check API access and available credits.');
      });
      upstream.on('error', () => fail());
      upstream.on('close', () => {
        if (!closed) fail('The voice connection ended. Please start a new session.');
      });
      socket.on('voice:audio', (data) => {
        if (!ready || closed) return;
        if (!Buffer.isBuffer(data) || data.length > 32768 || data.length % 2)
          return fail('Invalid microphone audio.');
        if (Date.now() - bucket >= 1000) {
          bucket = Date.now();
          audioBytes = 0;
        }
        audioBytes += data.length;
        if (audioBytes > sampleRate * 6 || upstream.bufferedAmount > 256000)
          return fail('Your audio connection is too slow or exceeded its limit. Please reconnect.');
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
      });
      socket.on('voice:text', (content) => {
        if (!ready || closed) return;
        textTimes = textTimes.filter((t) => t > Date.now() - 60000);
        if (typeof content !== 'string' || !content.trim() || content.length > 1500 || textTimes.length >= 10)
          return fail('Question limit reached. Please try again later.');
        textTimes.push(Date.now());
        upstream.send(JSON.stringify({ type: 'InjectUserMessage', content: content.trim() }));
      });
    } catch {
      fail('Could not start your voice session. Please retry or use text Support.');
    }
  });
  return namespace;
}
module.exports = { attachVoice };
