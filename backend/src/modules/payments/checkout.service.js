const crypto = require('crypto');
const { clearTimeout } = require('node:timers');
const pool = require('../../config/database');
const gateway = require('../../config/razorpay');
const { emitUser } = require('../../shared/realtime');
const { submittedRentalSql } = require('../rentals/booking-state');
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const paise = value => Math.round(Number(value) * 100);
const date = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

class CheckoutService {
  constructor({ db = pool, provider = gateway, publish = emitUser, timeoutMs = 12000 } = {}) {
    Object.assign(this, { db, provider, publish, timeoutMs });
  }

  async transaction(userId, action) {
    const client = await this.db.connect();
    const notifications = [];
    try {
      await client.query('BEGIN');
      // Serialize cart creation, callbacks and recovery for the same customer.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`checkout:${userId}`]);
      const result = await action(client, notifications);
      await client.query('COMMIT');
      for (const rental of notifications) {
        try { this.publish(rental.owner_id, 'rental:request', { rental_id: rental.rental_id }); } catch { /* DB remains committed. */ }
      }
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async providerStatus(record) {
    if (!/^order_[A-Za-z0-9]+$/.test(record.id)) throw fail('This checkout is not configured for online payment.', 503);
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const [order, list] = await Promise.all([
            this.provider.orders.fetch(record.id), this.provider.orders.fetchPayments(record.id),
          ]);
          const amount = record.booking_data.items.reduce((sum, item) => sum + paise(item.booking_amount), 0);
          if (order.id !== record.id || order.currency !== 'INR' || Number(order.amount) !== amount
            || (order.notes?.user_id && order.notes.user_id !== record.user_id)) {
            throw fail('The saved checkout does not match the payment provider. Contact support; do not pay again.');
          }
          const captured = list.items.filter(payment => payment.status === 'captured');
          if (captured.length > 1) throw fail('Multiple payments require review. Contact support; do not pay again.');
          if (captured.length) {
            const payment = await this.provider.payments.fetch(captured[0].id);
            if (payment.id !== captured[0].id || payment.order_id !== record.id || payment.status !== 'captured'
              || payment.captured !== true || payment.currency !== 'INR' || Number(payment.amount) !== amount) {
              throw fail('Payment details do not match this cart. Contact support; do not pay again.');
            }
            return { payment };
          }
          if (order.status === 'paid' || list.items.some(payment => ['created', 'authorized'].includes(payment.status))) return { pending: true };
          if (!['created', 'attempted'].includes(order.status)) throw fail('Payment status needs review. Do not pay again.');
          return { unpaid: true };
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(fail('Payment status is unavailable. Do not pay again; retry confirmation shortly.', 503)), this.timeoutMs); }),
      ]);
    } catch (error) {
      if (error.status) throw error;
      throw fail('Could not confirm payment with the provider. Do not pay again; retry confirmation.', 503);
    } finally { clearTimeout(timer); }
  }

  async settle(client, record, payment, notifications) {
    const data = record.booking_data;
    if (data.completed) return data.result;
    const rentals = [];
    for (const item of data.items) {
      const rental = (await client.query(
        `INSERT INTO rentals(listing_id,borrower_id,owner_id,start_date,end_date,rental_days,
          rental_fee,delivery_fee,platform_fee,booking_amount,deposit_amount,delivery_requested,drop_location_id,
          status,booking_status,payment_status,deposit_status,owner_response)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
          'RENTAL_PAYMENT_COMPLETED','PAYMENT_COMPLETED','RENTAL_PAID','PENDING','PENDING') RETURNING id`,
        [item.listing_id, record.user_id, item.owner_id, item.start_date, item.end_date, item.rental_days,
          item.rental_fee,item.delivery_fee,item.platform_fee,item.booking_amount,item.deposit_amount,
          Boolean(item.delivery_requested),item.drop_location_id || null],
      )).rows[0];
      await client.query(`INSERT INTO payments(rental_id,payment_type,amount,status,transaction_id,gateway_mode)
        VALUES($1,'RENTAL',$2,'PAID',$3,$4)`, [rental.id,item.booking_amount,payment.id,require('../payouts/payout-config').modeFor() || 'legacy']);
      await client.query(`INSERT INTO transaction_events(rental_id,event_type,actor_user_id,metadata)
        VALUES($1,'RENTAL_PAYMENT_COMPLETED',$2,$3)`, [rental.id,record.user_id,{ gateway_order_id: record.id, cart_checkout: true }]);
      await client.query("INSERT INTO listing_interactions(listing_id,user_id,interaction_type) VALUES($1,$2,'RENT')", [item.listing_id,record.user_id]);
      // Preserve a cart item that the customer edited after opening checkout.
      await client.query(`DELETE FROM cart WHERE user_id=$1 AND item_id=$2 AND start_date=$3 AND end_date=$4
        AND delivery_requested=$5 AND drop_location_id IS NOT DISTINCT FROM $6::text`,
      [record.user_id,item.listing_id,item.start_date,item.end_date,Boolean(item.delivery_requested),item.drop_location_id || null]);
      rentals.push({ rental_id: rental.id, listing_id: item.listing_id });
      notifications.push({ rental_id: rental.id, owner_id: item.owner_id });
    }
    const result = { success: true, paid: true, rentals };
    // Keep the receipt/result so a lost HTTP response or repeated callback is idempotent.
    await client.query('UPDATE pending_orders SET booking_data=booking_data || $2::jsonb WHERE id=$1',
      [record.id,JSON.stringify({ completed: true, payment_id: payment.id, result })]);
    return result;
  }

  async reconcile(orderId, userId, expectedPaymentId) {
    return this.transaction(userId, async (client, notifications) => {
      const record = (await client.query('SELECT * FROM pending_orders WHERE id=$1 AND user_id=$2 FOR UPDATE', [orderId,userId])).rows[0];
      if (!record || !Array.isArray(record.booking_data?.items) || !record.booking_data.items.length) throw fail('Cart payment not found.', 404);
      if (record.booking_data.completed) {
        if (expectedPaymentId && record.booking_data.payment_id !== expectedPaymentId) throw fail('Payment does not match this checkout.');
        return record.booking_data.result;
      }
      const status = await this.providerStatus(record);
      if (!status.payment) return { paid: false, pending: Boolean(status.pending) };
      if (expectedPaymentId && expectedPaymentId !== status.payment.id) throw fail('Payment does not match this checkout.');
      return this.settle(client,record,status.payment,notifications);
    });
  }

  orderResponse(record) {
    const items = record.booking_data.items;
    const sum = key => items.reduce((total,item) => total + paise(item[key]),0) / 100;
    return { order_id: record.id, amount: sum('booking_amount'), totalAmount: sum('booking_amount'),
      rentalFee: sum('rental_fee'), platformFee: sum('platform_fee'), deliveryFee: sum('delivery_fee'),
      depositTotal: sum('deposit_amount'), selectedCount: items.length, currency: 'INR',
      razorpay_key: process.env.RAZORPAY_KEY_ID, test_mode: String(process.env.RAZORPAY_KEY_ID).startsWith('rzp_test_') };
  }

  async create(userId, selectedIds) {
    if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.length > 50
      || selectedIds.some(id => typeof id !== 'string')) throw fail('Select the cart items to pay for.',400);
    return this.transaction(userId, async (client,notifications) => {
      const rows = (await client.query(`SELECT c.*,c.start_date::text AS start_date,c.end_date::text AS end_date,
        l.owner_id,l.deposit,l.is_active,l.delivery_available,l.rent_price,l.delivery_charge AS current_delivery_charge
        FROM cart c JOIN listings l ON l.id=c.item_id
        WHERE c.user_id=$1 AND (c.id::text=ANY($2) OR c.item_id::text=ANY($2)) ORDER BY c.id FOR UPDATE OF c`, [userId,selectedIds])).rows;
      if (!rows.length || selectedIds.some(id => !rows.some(row => row.id === id || row.item_id === id))) throw fail('Your cart changed. Return to the cart and select your items again.',409);
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify(rows.map(row =>
        [row.id,date(row.start_date),date(row.end_date),row.delivery_requested,row.drop_location_id]))).digest('hex');
      // Reconcile old attempts for these cart rows before considering any new order.
      const previous = (await client.query(`SELECT * FROM pending_orders WHERE user_id=$1
        AND booking_data->'items' IS NOT NULL ORDER BY created_at DESC FOR UPDATE`, [userId])).rows;
      for (const record of previous) {
        if (record.booking_data.completed) continue;
        const overlaps = record.booking_data.items.some(item => rows.some(row => row.item_id === item.listing_id));
        if (!overlaps) continue;
        const status = await this.providerStatus(record);
        if (status.payment) return this.settle(client,record,status.payment,notifications);
        if (status.pending) throw fail('Your earlier cart payment is still processing. Do not pay again; check confirmation shortly.');
        if (record.booking_data.fingerprint === fingerprint) {
        await require('../payouts/payout-accounts').createAccountService({db:this.db}).assertRecipients(rows.map(row=>row.owner_id),client);
          return this.orderResponse(record);
        }
        // Different dates form a different booking intent. The old provider status
        // has been checked above; captured or processing attempts never reach here.
      }
      await require('../payouts/payout-accounts').createAccountService({db:this.db}).assertRecipients(rows.map(row=>row.owner_id),client);
      const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
      const items = [];
      for (const row of rows) {
        if (!row.is_active || row.owner_id === userId || date(row.start_date) < today || date(row.end_date) < date(row.start_date)) throw fail('A cart item is unavailable or its dates have expired. Update your cart.');
        if (row.delivery_requested && (!row.delivery_available || !row.drop_location_id)) throw fail('Choose a campus delivery location in your cart.');
        const conflict = await client.query(`SELECT r.id FROM rentals r WHERE listing_id=$1
          AND status NOT IN ('CANCELLED','COMPLETED','DEPOSIT_REFUNDED') AND ${submittedRentalSql('r')}
          AND NOT(end_date<$2 OR start_date>$3) LIMIT 1`, [row.item_id,row.start_date,row.end_date]);
        if (conflict.rowCount) throw fail('A selected item already has a booking for these dates. Update your cart.');
        const days = Math.round((new Date(row.end_date)-new Date(row.start_date))/86400000)+1;
        const rent = paise(row.price_per_day)*days;
        const platform = paise(Math.max(5,Math.round(rent/100*0.05)));
        const delivery = row.delivery_requested ? paise(row.current_delivery_charge) : 0;
        items.push({ listing_id:row.item_id, owner_id:row.owner_id, start_date:row.start_date,end_date:row.end_date,
          rental_days:days,rental_fee:rent/100,platform_fee:platform/100,delivery_fee:delivery/100,
          booking_amount:(rent+platform+delivery)/100,deposit_amount:Number(row.deposit),
          delivery_requested:row.delivery_requested,drop_location_id:row.drop_location_id });
      }
      const amount = items.reduce((total,item) => total+paise(item.booking_amount),0);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw fail('The cart total is invalid.',400);
      if (!/^rzp_(test|live)_/.test(process.env.RAZORPAY_KEY_ID || '') || !process.env.RAZORPAY_KEY_SECRET) throw fail('Online payment is not configured. No payment was taken.',503);
      const order = await this.provider.orders.create({ amount,currency:'INR',receipt:`cart_${crypto.randomBytes(8).toString('hex')}`,
        notes:{ user_id:userId,payment_type:'CHECKOUT' } });
      const record = { id:order.id,user_id:userId,booking_data:{ type:'CART',fingerprint,items } };
      await client.query('INSERT INTO pending_orders(id,user_id,booking_data) VALUES($1,$2,$3)',[record.id,userId,record.booking_data]);
      return this.orderResponse(record);
    });
  }
}
module.exports = new CheckoutService();
module.exports.CheckoutService = CheckoutService;
