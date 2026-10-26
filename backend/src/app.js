const cors = require('cors');
const pool = require('./config/database');
const express = require('express');
const path = require('node:path');
const { existsSync } = require('node:fs');
const authRoutes = require('./modules/auth/auth.routes');
const activityRoutes = require('./modules/activity/activity.routes');
const campusRoutes = require('./modules/campus/campus.routes');
const cartRoutes = require('./modules/cart/cart.routes');
const courierRoutes = require('./modules/delivery/courier.routes');
const deliveryRoutes = require('./modules/delivery/delivery.routes');
const listingRoutes = require('./modules/listings/listings.routes');
const paymentRoutes = require('./modules/payments/payment.routes');
const pricingRoutes = require('./modules/payments/pricing.routes');
const profileRoutes = require('./modules/profile/profile.routes');
const rentalRoutes = require('./modules/rentals/rentals.routes');
const wishlistRoutes = require('./modules/saved/saved.routes');
const xeroxRoutes = require('./modules/xerox/xerox.routes');

const app = express();
app.disable('x-powered-by');
// Explicit trusted proxy hops; never trust arbitrary client X-Forwarded-For.
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5) throw new Error('Invalid TRUST_PROXY_HOPS');
app.set('trust proxy', proxyHops);
app.use(cors({ origin: process.env.FRONTEND_ORIGIN?.split(',') || true, credentials: true }));
app.post('/api/payment/webhook', express.raw({ type: 'application/json', limit: '1mb' }), require('./modules/payments/payment-webhook').createWebhook());
app.use(express.json({ limit: '50mb' }));
app.use((req,res,next) => {
  if (req.body === undefined) req.body = {};
  if (['POST','PUT','PATCH'].includes(req.method) && (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)))
    return res.status(400).json({ error: 'Send a JSON object with the requested fields.' });
  next();
});
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: true, serverTime: new Date().toISOString() });
  } catch {
    res.status(503).json({
      ok: false,
      database: false,
      serverTime: new Date().toISOString(),
      error: 'Database unavailable.',
    });
  }
});
app.use('/', authRoutes);
app.use('/listings', listingRoutes);
app.use('/api/photos', require('./modules/listings/photo.routes'));
app.use('/api/profile', profileRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/rentals', rentalRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/direct-upi', require('./modules/direct-upi/routes'));
app.use('/api/payouts', require('./modules/payouts/payout-routes'));
app.use('/api/payout-scheduler', require('./modules/calls/scheduler.routes').schedulerRouter({ run: require('./modules/payouts/payout-worker').tick, secret: () => process.env.PAYOUTS_SCHEDULER_SECRET }));
app.use('/api/cart', cartRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/intelligence', require('./modules/intelligence/intelligence.routes'));
app.use('/api/support', require('./modules/support/support.routes'));
app.use('/api/voice', require('./modules/voice/voice.routes').createVoiceRouter());
app.use('/api/call-scheduler', require('./modules/calls/scheduler.routes').schedulerRouter());
app.use('/api/calls', require('./modules/calls/call.routes'));
app.use('/api/wishes', require('./modules/payouts/courier-readiness'), require('./modules/wishes/wish.routes'));
app.use('/api/delivery', require('./modules/payouts/courier-readiness'), deliveryRoutes);
app.use('/api/campus', campusRoutes);
app.use('/api/courier', courierRoutes);
app.use('/api/xerox', (req, res, next) => req.method === 'POST' ? res.status(503).json({ error: 'Campus Print is coming soon.' }) : next(), xeroxRoutes);
if (process.env.SERVE_FRONTEND === 'true') {
  const frontendDist = path.resolve(__dirname, '../../frontend/dist');
  const index = path.join(frontendDist, 'index.html');
  if (!existsSync(index)) throw new Error('Frontend build missing. Run the root build command before starting the hosted app.');
  app.use(express.static(frontendDist, { index: false, dotfiles: 'deny' }));
  app.use((req, res, next) => {
    // SPA deep links return HTML; missing APIs/assets must keep real 404 responses.
    if (req.method !== 'GET' || !req.accepts('html') ||
        /^\/(api|listings|socket\.io|health)(\/|$)/.test(req.path) || /(?:^|\/)\./.test(req.path) || path.extname(req.path)) return next();
    res.set('Cache-Control', 'no-store').sendFile(index);
  });
}
app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
app.use((error, req, res, next) => {
  void next;
  console.error('[request]', error);
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'The upload is too large.' });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Send valid JSON.' });
  return res.status(error.status || 500).json({ error: error.status && error.status < 500 ? error.message : 'Internal Server Error' });
});
module.exports = app;
