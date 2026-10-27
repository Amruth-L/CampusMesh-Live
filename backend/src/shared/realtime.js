let io;
exports.setIO = (server) => { io = server; };
exports.emitDelivery = (deliveryId, event, data) => { if (io) io.to(`delivery:${deliveryId}`).emit(event, data); };
exports.emitUser = (userId, event, data) => { if (io) io.to(`user:${userId}`).emit(event, data); };
exports.disconnectUser = userId => {
  if (!io) return;
  for (const namespace of ['/', '/voice']) io.of(namespace).in(`user:${userId}`).disconnectSockets(true);
};

