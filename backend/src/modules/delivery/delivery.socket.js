const { isUuid } = require('../../shared/validation');
// Socket.IO does not forward rejected async listeners to Express error handling.
function attachDeliveryRooms(socket, db) {
  socket.on('delivery:join', async (id, acknowledge) => {
    const reply = (result) =>
      typeof acknowledge === 'function' ? acknowledge(result) : socket.emit('delivery:join-result', result);
    if (!isUuid(id) || !isUuid(socket.user?.id)) return reply({ ok: false, error: 'Invalid delivery ID.' });
    try {
      const allowed = await db.query(
        'SELECT id FROM delivery_requests WHERE id=$1 AND $2 IN (customer_id,seller_id,courier_id)',
        [id, socket.user.id],
      );
      if (!allowed.rowCount) return reply({ ok: false, error: 'Delivery unavailable.' });
      await socket.join(`delivery:${id}`);
      reply({ ok: true });
    } catch {
      reply({ ok: false, error: 'Unable to join delivery updates. Please retry.' });
    }
  });
  socket.on('delivery:leave', (id) => {
    if (isUuid(id)) socket.leave(`delivery:${id}`);
  });
}
module.exports = { attachDeliveryRooms };
