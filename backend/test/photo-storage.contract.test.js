const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Opt-in: creates two disposable users and one listing against the configured DB
// and API, uploads real tiny fixtures to S3, then removes all created resources.
test('real S3 listing photos: publish, gallery, ownership, replace and delete', { skip: process.env.PHOTO_STORAGE_E2E !== '1', timeout: 180000 }, async () => {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
  const base = process.env.PHOTO_TEST_BASE_URL;
  assert.ok(base, 'Set PHOTO_TEST_BASE_URL to the API that uses this database.');
  process.env.PUBLIC_API_URL = base;
  const pool = require('../src/config/database');
  const jwt = require('jsonwebtoken');
  const sharp = require('sharp');
  const storage = require('../src/modules/listings/photo-storage');
  const ids = [randomUUID(), randomUUID()];
  let listingId;
  const uploadedUrls = new Set();
  const token = id => jwt.sign({ id, email: `photo-qa-${id}@example.invalid` }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const request = (route, method = 'GET', data, id = ids[0]) => globalThis.fetch(base + route, {
    method, headers: { ...(id ? { Authorization: `Bearer ${token(id)}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}), signal: globalThis.AbortSignal.timeout(60000),
  });
  const photo = async color => 'data:image/png;base64,' + (await sharp({ create: { width: 32, height: 24, channels: 3, background: color } }).png().toBuffer()).toString('base64');
  const original = await photo('#15803d'), second = await photo('#202522'), replacement = await photo('#f0f0f0');
  const payload = { title: 'Temporary photo integration check', description: 'Disposable storage check; removed automatically.',
    price: 0, rent_price: 10, category: 'Books', location: 'Library', image_url: second, image_urls: [original, second] };
  try {
    for (const id of ids) await pool.query('INSERT INTO users(id,name,username,email,email_verified) VALUES($1,$2,$3,$4,TRUE)',
      [id, 'Photo storage QA', `photoqa_${id.slice(0, 8)}`, `photo-qa-${id}@example.invalid`]);
    assert.equal((await request('/listings', 'POST', payload, null)).status, 401);
    const bad = { ...payload, image_url: 'data:image/png;base64,SGVsbG8=', image_urls: ['data:image/png;base64,SGVsbG8='] };
    assert.equal((await request('/listings', 'POST', bad)).status, 400);
    const created = await request('/listings', 'POST', payload);
    assert.equal(created.status, 201, await created.clone().text());
    const item = await created.json();
    listingId = item.id;
    item.image_urls.forEach(url => uploadedUrls.add(url));
    assert.equal(item.image_urls.length, 2);
    assert.equal(item.image_url, item.image_urls[1]);
    const saved = (await pool.query('SELECT image_url,image_urls FROM listings WHERE id=$1', [listingId])).rows[0];
    assert.ok(saved.image_urls.every(url => url.startsWith(base + '/api/photos/') && url.length < 250 && !url.includes('base64')));
    const image = await globalThis.fetch(item.image_url, { signal: globalThis.AbortSignal.timeout(30000) });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/webp');
    assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).width, 32);
    const unsigned = await globalThis.fetch(image.url.split('?')[0]);
    assert.equal(unsigned.status, 403, 'S3 bucket must stay private');
    assert.equal((await request(`/listings/${listingId}`, 'PUT', { image_url: replacement }, ids[1])).status, 403);
    const changed = await request(`/listings/${listingId}`, 'PUT', { image_url: replacement });
    assert.equal(changed.status, 200, await changed.clone().text());
    const edited = await changed.json();
    edited.image_urls.forEach(url => uploadedUrls.add(url));
    assert.equal(edited.image_urls.length, 2);
    assert.notEqual(edited.image_url, item.image_url);
    assert.ok(edited.image_urls.includes(item.image_urls[0]));
    assert.equal((await globalThis.fetch(item.image_url, { redirect: 'manual' })).status, 404, 'Removed cover is no longer served');
    assert.equal((await globalThis.fetch(edited.image_url)).status, 200);
    assert.equal((await request(`/listings/${listingId}`, 'DELETE')).status, 200);
    listingId = null;
    for (const url of uploadedUrls) {
      assert.equal((await globalThis.fetch(url, { redirect: 'manual' })).status, 404);
      const deleted = await globalThis.fetch(await storage.downloadUrl(url));
      assert.notEqual(deleted.status, 200, 'Deleted photo must be removed from S3');
    }
  } finally {
    if (listingId) await pool.query('DELETE FROM listings WHERE id=$1', [listingId]);
    await storage.remove([...uploadedUrls].map(url => storage.keyFor(url)).filter(Boolean));
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    await pool.end();
  }
});
