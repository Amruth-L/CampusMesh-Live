const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const app = require('./app');
const pool = require('./config/database');
const realtime = require('./shared/realtime');
const { refreshOpenDeliveries } = require('./modules/delivery/matching.service');

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.FRONTEND_ORIGIN?.split(',') || '*' } });
io.use((socket, next) => {
  try {
    socket.user = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});
io.on('connection', (socket) => {
  socket.join(`user:${socket.user.id}`);
  require('./modules/delivery/delivery.socket').attachDeliveryRooms(socket, pool);
});
require('./modules/voice/voice.socket').attachVoice(io, { db: pool });
realtime.setIO(io);
const port = Number(process.env.PORT || 3003);
server.listen(port, () => {
  console.log('[server] CampusMesh listening on ' + port);
  refreshOpenDeliveries().catch((error) => console.error('[delivery-refresh] initial refresh failed:', error.message));
});
const deliveryRefresh = globalThis.setInterval(() => {
  refreshOpenDeliveries().catch((error) => console.error('[delivery-refresh] refresh failed:', error.message));
}, 15000);
deliveryRefresh.unref?.();

require('./modules/calls/call.worker').start();

require('./modules/payouts/payout-worker').start();
