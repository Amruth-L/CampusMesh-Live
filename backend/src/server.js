const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { authenticateToken, watchSocketSession } = require('./security/session');
const { Server } = require('socket.io');
const app = require('./app');
const pool = require('./config/database');
const realtime = require('./shared/realtime');
const { refreshOpenDeliveries } = require('./modules/delivery/matching.service');

const server = http.createServer(app);
const policy = require('./security/policy').securityPolicy();
const io = new Server(server, {
  maxHttpBufferSize: 64 * 1024,
  cors: { origin: policy.origin },
  allowRequest: (req, done) => done(null, policy.allowed(req.headers.origin)),
});
io.use(async (socket, next) => {
  try {
    socket.user = await authenticateToken(socket.handshake.auth?.token, pool);
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});
io.on('connection', (socket) => {
  watchSocketSession(socket, socket.user, socket.handshake.auth.token, pool);
  socket.join(`user:${socket.user.id}`);
  require('./modules/delivery/delivery.socket').attachDeliveryRooms(socket, pool);
});
require('./modules/voice/voice.socket').attachVoice(io, { db: pool });
realtime.setIO(io);
const port = Number(process.env.PORT || 3003);
server.listen(port, () => {
  console.log('[server] CampusMesh listening on ' + port);
  refreshOpenDeliveries().catch((error) =>
    console.error('[delivery-refresh] initial refresh failed:', error.message),
  );
});
const deliveryRefresh = globalThis.setInterval(() => {
  refreshOpenDeliveries().catch((error) =>
    console.error('[delivery-refresh] refresh failed:', error.message),
  );
}, 15000);
deliveryRefresh.unref?.();

require('./modules/calls/call.worker').start();

require('./modules/payouts/payout-worker').start();
