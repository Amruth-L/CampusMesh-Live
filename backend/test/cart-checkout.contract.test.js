const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('cart payment retry and recovery in an isolated schema', { skip: process.env.CART_CHECKOUT_E2E !== '1', timeout: 180000 }, async t => {
  const pool = require('../src/config/database');
  const { CheckoutService } = require('../src/modules/payments/checkout.service');
  const namespace = (await pool.query('SELECT current_schema() AS schema,current_schemas(false) AS schemas')).rows[0];
  assert(namespace.schema.startsWith('qa_') && !namespace.schemas.includes('public'));
  const owner = randomUUID(), borrower = randomUUID(), outsider = randomUUID();
  const orders = new Map(), payments = new Map();
  let creates = 0;
  const provider = { orders: {
    async create(input) { const id = `order_Cart${++creates}`; const order = { ...input,id,status:'created' }; orders.set(id,order); return order; },
    async fetch(id) { assert(orders.has(id)); return orders.get(id); },
    async fetchPayments(id) { return { items: [...payments.values()].filter(p => p.order_id === id) }; },
  }, payments: { async fetch(id) { assert(payments.has(id)); return payments.get(id); } } };
  const service = new CheckoutService({ db:pool,provider,publish:()=>{} });
  const key = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_KEY_ID = 'rzp_test_fixture'; process.env.RAZORPAY_KEY_SECRET = 'fixture-only';
  try {
    for (const id of [owner,borrower,outsider]) await pool.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[id,'Cart fixture',`${id}@dbit.co.in`]);
    const fixture = async (price = 100) => {
      const id = randomUUID();
      await pool.query("INSERT INTO listings(id,owner_id,title,description,category,rent_price,deposit) VALUES($1,$2,'Cart fixture','Test only','Electronics',$3,500)",[id,owner,price]);
      await pool.query(`INSERT INTO cart(user_id,item_id,start_date,end_date,days,price_per_day,subtotal,platform_fee)
        VALUES($1,$2,CURRENT_DATE+10,CURRENT_DATE+12,3,$3,$3::numeric*3,GREATEST(5,ROUND($3::numeric*3*0.05)))`,[borrower,id,price]);
      return id;
    };
    const ids = [await fixture(),await fixture(200)];
    let order;
    await t.test('concurrent clicks reuse one provider order and exact per-item totals',async()=>{
      const results = await Promise.all([service.create(borrower,ids),service.create(borrower,ids)]);
      assert.equal(creates,1); assert.equal(results[0].order_id,results[1].order_id);
      order = results[0]; assert.equal(order.amount,945); assert.equal(order.platformFee,45);
    });
    await t.test('another account cannot recover this cart and no unpaid order becomes a rental',async()=>{
      await assert.rejects(service.reconcile(order.order_id,outsider),e=>e.status===404);
      assert.equal((await service.reconcile(order.order_id,borrower)).paid,false);
      assert.equal((await pool.query('SELECT COUNT(*)::int n FROM rentals')).rows[0].n,0);
    });
    await t.test('authorized payment blocks a second checkout',async()=>{
      payments.set('pay_Cart1',{id:'pay_Cart1',order_id:order.order_id,amount:94500,currency:'INR',status:'authorized',captured:false});
      orders.get(order.order_id).status='attempted';
      await assert.rejects(service.create(borrower,ids),/still processing/);
      assert.equal(creates,1);
    });
    await t.test('wrong amount cannot settle; retry succeeds after provider reports valid captured amount',async()=>{
      Object.assign(payments.get('pay_Cart1'),{status:'captured',captured:true,amount:1});
      await assert.rejects(service.reconcile(order.order_id,borrower),/do not pay again/);
      assert.equal((await pool.query('SELECT COUNT(*)::int n FROM rentals')).rows[0].n,0);
      payments.get('pay_Cart1').amount=94500; orders.get(order.order_id).status='paid';
    });
    let result;
    await t.test('lost callback recovers two paid rentals exactly once without handover QR',async()=>{
      const results=await Promise.all([service.reconcile(order.order_id,borrower),service.reconcile(order.order_id,borrower,'pay_Cart1')]);
      assert.deepEqual(results[0],results[1]);result=results[0];assert.equal(result.rentals.length,2);
      const rentals=(await pool.query('SELECT status,payment_status,deposit_status,qr_code_hash FROM rentals')).rows;
      assert.equal(rentals.length,2);
      for(const rental of rentals) assert.deepEqual(rental,{status:'RENTAL_PAYMENT_COMPLETED',payment_status:'RENTAL_PAID',deposit_status:'PENDING',qr_code_hash:null});
      assert.equal((await pool.query('SELECT COUNT(*)::int n FROM cart')).rows[0].n,0);
      assert.equal((await pool.query('SELECT SUM(amount)::numeric total FROM payments')).rows[0].total,'945.00');
    });
    await t.test('completed checkout survives repeated confirmation but rejects a different receipt',async()=>{
      assert.deepEqual(await service.reconcile(order.order_id,borrower),result);
      await assert.rejects(service.reconcile(order.order_id,borrower,'pay_Other'),/does not match/);
      assert.equal((await pool.query('SELECT COUNT(*)::int n FROM transaction_events')).rows[0].n,2);
    });
    await t.test('legacy pending checkout also recovers without requiring a fingerprint',async()=>{
      const listing=await fixture(10); const newOrder=await service.create(borrower,[listing]);
      await pool.query("UPDATE pending_orders SET booking_data=booking_data-'fingerprint'-'type' WHERE id=$1",[newOrder.order_id]);
      payments.set('pay_Legacy',{id:'pay_Legacy',order_id:newOrder.order_id,amount:3500,currency:'INR',status:'captured',captured:true});
      orders.get(newOrder.order_id).status='paid';
      assert.equal((await service.reconcile(newOrder.order_id,borrower)).rentals.length,1);
    });
    await t.test('provider downtime releases locks and never creates another order',async()=>{
      const listing=await fixture(20);await service.create(borrower,[listing]);const before=creates;
      const unavailable=new CheckoutService({db:pool,provider:{orders:{fetch:async()=>{throw new Error('offline');},fetchPayments:async()=>({items:[]})}},publish:()=>{}});
      await assert.rejects(unavailable.create(borrower,[listing]),e=>e.status===503);
      assert.equal(creates,before);
      assert((await service.create(borrower,[listing])).order_id);
    });
  } finally {
    process.env.RAZORPAY_KEY_ID=key;process.env.RAZORPAY_KEY_SECRET=secret;
    await pool.end();
  }
});
