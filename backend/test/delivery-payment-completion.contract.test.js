const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

test('direct delivery completes only after courier receipt, for both rental legs', { skip: process.env.EVIDENCE_E2E !== '1', timeout: 120000 }, async t => {
  const db = require('../src/config/database');
  const scope = (await db.query('SELECT current_schema() s,current_schemas(false) scopes')).rows[0];
  assert(scope.s.startsWith('qa_') && !scope.scopes.includes('public'));
  const service = require('../src/modules/direct-upi/service').createService({ db, notify() {}, match: async () => {}, onConfirmed() {} });
  const { issueCredential, verifyCredential } = require('../src/modules/delivery/handover.service');
  const { requestReturn } = require('../src/modules/rentals/return.service');
  const controller = require('../src/modules/delivery/delivery.controller');
  const [owner, renter, courier, stranger] = Array.from({ length: 4 }, randomUUID);
  const invoke = async (fn, req) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await fn(req, res); return res;
  };
  try {
    for (const id of [owner, renter, courier, stranger]) await db.query("INSERT INTO users(id,name,email,email_verified) VALUES($1,'Payment fixture',$2,true)", [id, id+'@dbit.co.in']);
    const listing = (await db.query("INSERT INTO listings(owner_id,title,description,category,price,rent_price) VALUES($1,'Delivery payment fixture','Test','Electronics',50,50) RETURNING id", [owner])).rows[0].id;
    await service.profile(courier, { upi_id: 'courier@bank', payee_name: 'Courier fixture', confirm: true });
    let reference = 987654321000;
    async function fixture(type = 'RENTAL_OUTBOUND', fee = 10, method = 'DIRECT_UPI') {
      const rental = (await db.query(`INSERT INTO rentals(listing_id,owner_id,borrower_id,start_date,end_date,rental_days,rental_fee,booking_amount,deposit_amount,payment_method,status)
        VALUES($1,$2,$3,CURRENT_DATE,CURRENT_DATE+1,2,50,50,100,$4,'RENTAL_ACTIVE') RETURNING *`, [listing, owner, renter, method])).rows[0];
      const returning = type === 'RENTAL_RETURN';
      const stage = returning ? 'RETURN_RECEIVED' : 'DELIVERY';
      const receiver = returning ? owner : renter;
      const task = (await db.query(`INSERT INTO delivery_requests(rental_id,courier_id,seller_id,customer_id,pickup_location,task_type,status,courier_earning)
        VALUES($1,$2,$3,$4,'Library',$5,$6,$7) RETURNING *`, [rental.id,courier,returning?renter:owner,receiver,type,returning?'RETURN_IN_TRANSIT':'ARRIVED_AT_DESTINATION',fee])).rows[0];
      await db.query(`UPDATE rentals SET ${returning?'return_delivery_id':'outbound_delivery_id'}=$2 WHERE id=$1`, [rental.id,task.id]);
      await db.query(`INSERT INTO handover_verifications(delivery_id,stage,otp_hash,credential_hash,shown_to_user_id,expires_at,status)
        VALUES($1,$2,'fixture','fixture',$3,NOW(),'USED')`, [task.id,returning?'RETURN_PICKUP':'PICKUP',returning?renter:owner]);
      await db.query('INSERT INTO handover_photos(delivery_id,stage,uploaded_by,object_key,content_hash) VALUES($1,$2,$3,$4,$5)', [task.id,stage,courier,'fixture/'+task.id,'a'.repeat(64)]);
      const credential = await issueCredential(task.id,stage,receiver);
      assert(credential.otp, JSON.stringify(credential));
      const finishHandover = () => verifyCredential(task.id,courier,{stage,method:'OTP',value:credential.otp});
      return { rental,task,finishHandover };
    }
    for (const type of ['RENTAL_OUTBOUND','RENTAL_RETURN']) await t.test(type+' stays pending through report and dispute, then closes exactly once', async () => {
      const f = await fixture(type);
      assert.equal((await f.finishHandover()).status,'DELIVERY_PAYMENT_PENDING');
      const state = async () => (await db.query('SELECT * FROM delivery_requests WHERE id=$1',[f.task.id])).rows[0];
      assert.equal((await state()).completed_at,null);
      assert((await state()).delivery_verified_at);
      const stats = await invoke(controller.getDeliveryStats,{user:{id:courier}});
      assert(stats.data.active > 0);
      const bypass = await invoke(controller.updateStatus,{params:{id:f.task.id},user:{id:courier},body:{status:'COMPLETED'}});
      assert.equal(bypass.code,400);
      const payment = (await service.list(renter,f.rental.id)).find(p=>p.delivery_id===f.task.id);
      assert(payment?.uri);
      await assert.rejects(service.act(payment.id,courier,'confirm',{confirm:true}),/Wait for the payer/);
      await service.act(payment.id,renter,'report',{reference:String(++reference),confirm:true});
      assert.equal((await state()).status,'DELIVERY_PAYMENT_PENDING');
      const tracking=await invoke(controller.getRentalDeliveryStatus,{params:{rentalId:f.rental.id},user:{id:renter}});
      assert.equal(tracking.code,200,JSON.stringify(tracking.data));
      assert.equal(tracking.data.fee_status,'REPORTED');
      assert.equal(tracking.data.payment_method,'DIRECT_UPI');
      assert.equal(Number(tracking.data.courier_earning),10);
      assert(tracking.data.delivery_verified_at);
      await assert.rejects(service.act(payment.id,renter,'confirm',{confirm:true}),e=>e.status===403);
      await assert.rejects(service.act(payment.id,stranger,'confirm',{confirm:true}),e=>e.status===404);
      await service.act(payment.id,courier,'dispute',{confirm:true});
      assert.equal((await state()).status,'DELIVERY_PAYMENT_PENDING');
      if(type==='RENTAL_RETURN') await assert.rejects(service.complete(f.rental.id,owner,{}),/courier must complete/);
      else await assert.rejects(requestReturn(f.rental.id,renter,'DIRECT'),/delivery fee/);
      await Promise.all([service.act(payment.id,courier,'confirm',{confirm:true}),service.act(payment.id,courier,'confirm',{confirm:true})]);
      assert.equal((await state()).status,'COMPLETED');
      assert((await state()).completed_at);
      const completed=await invoke(controller.getRentalDeliveryStatus,{params:{rentalId:f.rental.id},user:{id:renter}});
      assert.equal(completed.data.fee_status,'CONFIRMED');
      assert(completed.data.completed_at);
      if(type==='RENTAL_RETURN') {
        const outbound=(await db.query(`INSERT INTO delivery_requests(rental_id,courier_id,seller_id,customer_id,pickup_location,task_type,status)
          VALUES($1,$2,$3,$4,'Library','RENTAL_OUTBOUND','COMPLETED') RETURNING id`,[f.rental.id,courier,owner,renter])).rows[0];
        await db.query('UPDATE rentals SET outbound_delivery_id=$2 WHERE id=$1',[f.rental.id,outbound.id]);
        const latest=await invoke(controller.getRentalDeliveryStatus,{params:{rentalId:f.rental.id},user:{id:renter}});
        assert.equal(latest.data.delivery_id,f.task.id,'completed return must remain the selected journey');
      }
      assert.equal((await db.query("SELECT 1 FROM transaction_events WHERE delivery_id=$1 AND event_type='DELIVERY_PAYMENT_CONFIRMED'",[f.task.id])).rowCount,1);
      if(type==='RENTAL_RETURN') {
        assert.equal((await db.query('SELECT status FROM rentals WHERE id=$1',[f.rental.id])).rows[0].status,'RETURN_PENDING');
        await service.complete(f.rental.id,owner,{});
        assert.equal((await db.query('SELECT deposit_status FROM rentals WHERE id=$1',[f.rental.id])).rows[0].deposit_status,'REFUND_PENDING');
      }
    });
    await t.test('zero-fee and prepaid gateway deliveries do not acquire an extra payment gate', async () => {
      for (const [fee,method] of [[0,'DIRECT_UPI'],[10,'RAZORPAY']]) {
        const f = await fixture('RENTAL_OUTBOUND',fee,method);
        assert.equal((await f.finishHandover()).status,'COMPLETED');
      }
    });
    await t.test('migration repairs existing unpaid completion without changing confirmed receipts', async () => {
      const f=await fixture(); await f.finishHandover();
      await db.query("UPDATE delivery_requests SET status='COMPLETED',completed_at=NOW() WHERE id=$1",[f.task.id]);
      const sql=await fs.readFile(path.join(__dirname,'../src/db/migrations/018_delivery_payment_completion.sql'),'utf8');
      await db.query(sql); await db.query(sql);
      assert.equal((await db.query('SELECT status FROM delivery_requests WHERE id=$1',[f.task.id])).rows[0].status,'DELIVERY_PAYMENT_PENDING');
      const paid=await db.query("SELECT d.status FROM delivery_requests d JOIN direct_upi_payments p ON p.delivery_id=d.id WHERE p.status='CONFIRMED'");
      assert.equal(paid.rowCount,2); assert(paid.rows.every(d=>d.status==='COMPLETED'));
    });
  } finally { await db.end(); }
});
