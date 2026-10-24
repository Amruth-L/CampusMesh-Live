const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

// Opt-in integration check. All fixtures and migrations live in a fresh schema;
// no real users, listings, payments, files or provider APIs are changed.
test('listing deletion preserves rental history and prevents new bookings', {
  skip: process.env.LISTING_DELETION_E2E !== '1', timeout: 180000,
}, async (t) => {
  const { Pool } = require('pg');
  const originalUrl = process.env.DATABASE_URL;
  const admin = new Pool({ connectionString: originalUrl, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
  const schema = `qa_listing_delete_${randomUUID().replaceAll('-', '')}`;
  let db;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(originalUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    db = require('../src/config/database');
    assert.equal((await db.query('SELECT current_schema() name')).rows[0].name, schema);
    const directory = path.join(__dirname, '../src/db/migrations');
    for (const file of (await fs.readdir(directory)).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort()) {
      await db.query(await fs.readFile(path.join(directory, file), 'utf8'));
    }
    const owner = randomUUID(), renter = randomUUID();
    for (const id of [owner, renter]) await db.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)', [id, 'Deletion QA', `${id}@example.invalid`]);
    const listings = require('../src/modules/listings/listings.controller');
    const rentals = require('../src/modules/rentals/rentals.controller');
    const { deleteListing } = require('../src/modules/listings/delete-listing');
    const invoke = async (handler, id, user = owner, body = {}) => {
      const result = { status: 200 };
      await handler({ params: { id }, user: { id: user }, body }, { status(n) { result.status = n; return this; }, json(data) { result.data = data; return this; } });
      return result;
    };
    const makeListing = async () => {
      const id = randomUUID();
      await db.query("INSERT INTO listings(id,owner_id,title,description,category,rent_price,image_url) VALUES($1,$2,'Deletion QA','Fixture','Books',10,'https://example.invalid/retained.jpg')", [id, owner]);
      return id;
    };
    await t.test('unused listing deletes; another user cannot delete it', async () => {
      const id = await makeListing();
      assert.equal((await invoke(listings.deleteListing, id, renter)).status, 403);
      assert.equal((await invoke(listings.deleteListing, 'not-a-uuid')).status, 400);
      assert.equal((await invoke(listings.deleteListing, id)).status, 200);
      assert.equal((await db.query('SELECT id FROM listings WHERE id=$1', [id])).rowCount, 0);
      assert.equal((await invoke(listings.deleteListing, id)).status, 404);
    });
    await t.test('rented listing disappears, with rentals and payments intact', async () => {
      const id = await makeListing(), rental = randomUUID();
      await db.query(`INSERT INTO rentals(id,listing_id,owner_id,borrower_id,start_date,end_date,rental_days,rental_fee,booking_amount,deposit_amount,status)
        VALUES($1,$2,$3,$4,CURRENT_DATE,CURRENT_DATE+2,3,30,30,100,'ACTIVE')`, [rental, id, owner, renter]);
      await db.query("INSERT INTO payments(rental_id,payment_type,amount,status,transaction_id) VALUES($1,'RENTAL',30,'PAID',$2)", [rental, randomUUID()]);
      await db.query('INSERT INTO wishlist(user_id,item_id) VALUES($1,$2)', [renter,id]);
      // This is the original failure, confirmed against the actual FK.
      await assert.rejects(db.query('DELETE FROM listings WHERE id=$1', [id]), { code: '23503' });
      const result = await invoke(listings.deleteListing, id);
      assert.equal(result.status, 200);assert.equal(result.data.archived, true);
      const kept = (await db.query('SELECT * FROM listings WHERE id=$1', [id])).rows[0];
      assert.ok(kept.deleted_at);assert.equal(kept.is_active, false);assert.ok(kept.image_url);
      assert.equal((await db.query('SELECT r.id FROM rentals r JOIN listings l ON l.id=r.listing_id JOIN payments p ON p.rental_id=r.id WHERE r.id=$1', [rental])).rowCount, 1);
      assert.equal((await invoke(listings.getMyListings, id)).data.length, 0);
      assert.equal((await invoke(listings.getListings, id)).data.length, 0);
      assert.equal((await invoke(listings.getListingById, id)).status, 404);
      assert.equal((await invoke(listings.updateListing, id, owner, { is_active: true })).status, 404);
      assert.equal((await invoke(listings.deleteListing, id)).status, 200, 'Repeated archive is safe');
      const saved = require('../src/modules/saved/saved.controller');
      assert.equal((await invoke(saved.getWishlist, id, renter)).data.length, 0);
      const cart = require('../src/modules/cart/cart.controller');
      const future = new Date(Date.now()+86400000).toISOString().slice(0,10);
      assert.equal((await invoke(cart.addToCart,id,renter,{item_id:id,start_date:future,end_date:future})).status,404);
      assert.equal((await invoke(rentals.bookRental,id,renter,{listing_id:id,start_date:future,end_date:future})).status,404);
    });
    await t.test('pending cart checkout references retain their listing', async () => {
      const id = await makeListing();
      await db.query(`INSERT INTO pending_orders(id,user_id,booking_data) VALUES($3,$1,$2)`, [renter, { items: [{listing_id:id}] }, randomUUID()]);
      assert.equal((await deleteListing(db,id,owner)).archived,true);
    });
  } finally {
    if (db) await db.end();
    process.env.DATABASE_URL = originalUrl;
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
