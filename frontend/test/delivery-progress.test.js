import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryProgress } from '../src/lib/delivery-progress.js';
const rental={payment_method:'DIRECT_UPI',owner_response:'ACCEPTED',payment_status:'FULLY_PAID',deposit_amount:100,delivery_fee:10,status:'RENTAL_ACTIVE'};
const assigned={task_type:'RENTAL_OUTBOUND',payment_method:'DIRECT_UPI',courier:{id:'courier'},accepted_at:'2026-10-23',courier_earning:10};
const pickup={...assigned,pickup_verified_at:'2026-10-23'};
const handover={...pickup,arrived_destination_at:'2026-10-23',delivery_verified_at:'2026-10-23'};
test('outward checkpoints advance one step at a time from actual confirmations',()=>{
 const cases=[
  [{...rental,owner_response:'PENDING',payment_status:'PENDING'},null,'approval',0],
  [{...rental,payment_status:'PENDING'},null,'rental-payment',1],
  [rental,{status:'MATCHING_COURIER'},'courier',2],
  [rental,{...assigned,status:'ARRIVED_AT_PICKUP'},'pickup',3],
  [rental,{...pickup,status:'IN_TRANSIT'},'transit',4],
  [rental,{...pickup,status:'ARRIVED_AT_DESTINATION'},'handover',5],
  [rental,{...handover,status:'DELIVERY_PAYMENT_PENDING',fee_status:'PENDING'},'fee',6],
  [rental,{...handover,status:'DELIVERY_PAYMENT_PENDING',fee_status:'REPORTED'},'fee',6],
  [rental,{...handover,status:'DELIVERY_PAYMENT_PENDING',fee_status:'DISPUTED'},'fee',6],
  [rental,{...handover,status:'COMPLETED',fee_status:'CONFIRMED'},undefined,8],
 ];
 for(const [r,d,current,count] of cases){const p=deliveryProgress(r,d);assert.equal(p.current?.key,current);assert.equal(p.steps.filter(s=>s.done).length,count);}
});
test('active rental or completed label cannot fabricate pickup, handover or fee receipt',()=>{
 assert.equal(deliveryProgress(rental,{...assigned,status:'COMPLETED'}).current.key,'pickup');
 const p=deliveryProgress(rental,{...handover,status:'COMPLETED',fee_status:'PENDING'});
 assert.equal(p.finished,false);assert.equal(p.current.key,'fee');
 assert.match(deliveryProgress(rental,{...handover,status:'DELIVERY_PAYMENT_PENDING',fee_status:'REPORTED'}).summary,/Do not pay again/);
});
test('return uses its own pickup, handover and payment instead of reusing outward ticks',()=>{
 const base={...assigned,task_type:'RENTAL_RETURN',destination_location_id:'library'};
 assert.equal(deliveryProgress(rental,{...base,status:'RETURN_LOCATION_PENDING'}).current.key,'destination');
 assert.equal(deliveryProgress(rental,{...base,status:'RETURN_COURIER_ASSIGNED'}).current.key,'pickup');
 assert.equal(deliveryProgress(rental,{...base,pickup_handover_status:'USED',status:'RETURN_IN_TRANSIT'}).current.key,'transit');
 const p=deliveryProgress(rental,{...handover,...base,status:'COMPLETED',fee_status:'CONFIRMED'});
 assert.equal(p.finished,true);assert.equal(p.steps.at(-1).label,'Return delivered');assert.match(p.summary,/refund.*separately/);
});
test('zero-fee delivery has no fee step, and gateway booking precedes approval and deposit',()=>{
 const free=deliveryProgress(rental,{...handover,courier_earning:0,status:'COMPLETED'});
 assert(free.finished);assert(!free.steps.some(s=>s.key==='fee'));
 const gateway=deliveryProgress({...rental,payment_method:'RAZORPAY',owner_response:'PENDING',payment_status:'RENTAL_PAID'},null);
 assert.equal(gateway.steps[0].key,'booking');assert.equal(gateway.current.key,'approval');
});
test('cancelled or failed deliveries do not suggest a next actionable step',()=>{
 for(const status of ['CANCELLED','FAILED']){const p=deliveryProgress(rental,{...pickup,status});assert.equal(p.current,undefined);assert.match(p.summary,/stopped/);assert(!p.finished);}
});
