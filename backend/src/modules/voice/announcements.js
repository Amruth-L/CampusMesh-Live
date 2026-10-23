/* global AbortSignal */
const { bookingStatuses } = require('../calls/call-policy');
const fail = (status, message) => Object.assign(new Error(message), { status });
const WELCOME =
  "Welcome to CampusMesh! We're happy you're here. You can borrow useful items, lend what you own, or earn by delivering. Open Voice assistant whenever you'd like to talk with me.";

// Only server-authored, authenticated events can spend TTS credit. No arbitrary text API.
function createAnnouncements({ db, capabilities, transport = globalThis.fetch, clock = Date.now } = {}) {
  const cache = new Map(),
    usage = new Map(),
    pending = new Map();
  const eligible = `FROM rentals r JOIN listings l ON l.id=r.listing_id
    WHERE r.borrower_id=$1 AND r.payment_status='FULLY_PAID'
    AND r.status=ANY($2) AND l.demo_slug IS NULL AND r.booking_confirmed_at IS NOT NULL`;
  function enabled() {
    const c = capabilities();
    if (!c.enabled || !c.aiConfigured)
      throw fail(503, 'Voice updates are unavailable. Your booking is unaffected.');
  }
  async function updates(user, since) {
    enabled();
    const date = new Date(since);
    if (!since || !Number.isFinite(date.getTime())) throw fail(400, 'A valid update time is required.');
    // Never recite historical orders on login; cap catch-up to the last day.
    const after = new Date(Math.max(date.getTime(), clock() - 86400000));
    const { rows } = await db.query(
      `SELECT r.id ${eligible}
      AND r.booking_confirmed_at >= $3 ORDER BY r.booking_confirmed_at ASC, r.id ASC LIMIT 100`,
      [user, bookingStatuses, after],
    );
    return rows.map((r) => ({
      id: `booking:${r.id}`,
      kind: 'booking',
      rentalId: r.id,
      text: 'Your booking is confirmed. Thank you for using CampusMesh. Open rental details for pickup or delivery updates.',
    }));
  }
  async function audio(user, body) {
    enabled();
    if (body?.kind !== 'welcome' && body?.kind !== 'booking') throw fail(400, 'Unknown voice update.');
    let text = WELCOME;
    if (body.kind === 'booking') {
      if (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(body.rentalId || ''))
        throw fail(400, 'Invalid booking.');
      const { rows } = await db.query(`SELECT r.id ${eligible} AND r.id=$3`, [
        user,
        bookingStatuses,
        body.rentalId,
      ]);
      if (!rows.length) throw fail(404, 'This booking is not ready for a confirmation.');
      // Generic audio is shared in a small memory cache; no account data leaves the server.
      text =
        'Your booking is confirmed. Thank you for using CampusMesh. Open rental details for pickup or delivery updates.';
    }
    for (const [id, u] of usage) if (u.until <= clock()) usage.delete(id);
    const u = usage.get(user) || { count: 0, until: clock() + 600000 };
    if (u.count >= 20 || (!usage.has(user) && usage.size >= 1000))
      throw fail(429, 'Please wait before replaying voice updates.');
    u.count++;
    usage.set(user, u);
    const entry = cache.get(body.kind);
    if (entry?.until > clock()) return entry.audio;
    if (pending.has(body.kind)) return pending.get(body.kind);
    const task = (async () => {
      try {
        const response = await transport(
          'https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3&speed=0.9&mip_opt_out=true',
          {
            method: 'POST',
            headers: {
              Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text }),
            signal: AbortSignal.timeout(12000),
          },
        );
        if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) {
          await response.body?.cancel();
          throw Error('Provider rejected audio');
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 1024 * 1024) throw Error('Audio too large');
          chunks.push(Buffer.from(chunk));
        }
        if (!size) throw Error('Empty audio');
        const bytes = Buffer.concat(chunks);
        cache.set(body.kind, { audio: bytes, until: clock() + 3600000 });
        return bytes;
      } catch {
        throw fail(503, 'Voice could not play right now. You can retry; your booking is unaffected.');
      } finally {
        pending.delete(body.kind);
      }
    })();
    pending.set(body.kind, task);
    return task;
  }
  return { updates, audio };
}
module.exports = { createAnnouncements, WELCOME };
