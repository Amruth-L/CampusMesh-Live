const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { createPhotoStorage, optimizePhoto } = require('../src/modules/listings/photo-storage');
const ownerId = '00000000-0000-4000-8000-000000000001';
const env = { S3_PHOTO_BUCKET: 'test-campusmesh', S3_REGION: 'us-east-1', PUBLIC_API_URL: 'https://campusmesh.example' };
const photo = async (width = 10) => 'data:image/png;base64,' + (await sharp({ create: {
  width, height: 10, channels: 3, background: '#15803d',
} }).png().toBuffer()).toString('base64');

test('photos are decoded, resized and stripped of metadata before storage', async () => {
  const result = await optimizePhoto(await photo(2000));
  const meta = await sharp(result).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 1600);
  assert.equal(meta.exif, undefined);
  assert.equal(meta.icc, undefined);
  for (const bad of ['data:image/png;base64,SGVsbG8=', 'data:image/svg+xml;base64,PHN2Zy8+', 'https://example.com/photo.jpg'])
    await assert.rejects(optimizePhoto(bad), { status: 400 });
  await assert.rejects(optimizePhoto('data:image/png;base64,' + 'A'.repeat(7 * 1024 * 1024)), { status: 400 });
});

test('gallery uses stable URLs, preserves cover order and uploads a duplicate only once', async () => {
  const commands = [];
  const storage = createPhotoStorage({ env, clientFactory: () => ({ send: async c => { commands.push(c); return {}; } }) });
  const a = await photo(), b = await photo(20);
  const r = await storage.prepare({ ownerId, images: [a, b, a], cover: b });
  assert.equal(commands.length, 2);
  assert.equal(r.images.length, 2);
  assert.equal(r.cover, r.images[1]);
  assert.ok(r.images.every(p => p.startsWith(env.PUBLIC_API_URL + '/api/photos/') && !p.includes('?')));
  assert.equal(commands[0].input.ContentType, 'image/webp');
  assert.equal(commands[0].input.ServerSideEncryption, 'AES256');
  assert.equal(commands[0].input.ACL, undefined);
  assert.equal((await sharp(commands[0].input.Body).metadata()).format, 'webp');
});

test('partial S3 failures clean up all attempted keys and do not return a gallery', async () => {
  const commands = [];
  const storage = createPhotoStorage({ env, logger: { error() {} }, clientFactory: () => ({ send: async c => {
    commands.push(c);
    if (c.constructor.name === 'PutObjectCommand' && commands.length === 2) throw new Error('network failed');
    return {};
  } }) });
  const a = await photo(), b = await photo(20);
  await assert.rejects(storage.prepare({ ownerId, images: [a, b], cover: a }), { status: 503 });
  assert.deepEqual(commands.map(c => c.constructor.name), ['PutObjectCommand', 'PutObjectCommand', 'DeleteObjectCommand', 'DeleteObjectCommand']);
  assert.deepEqual(commands.slice(2).map(c => c.input.Key), commands.slice(0, 2).map(c => c.input.Key));
});

test('only existing listing photos can be retained, new external URLs and oversized galleries fail', async () => {
  let calls = 0;
  const storage = createPhotoStorage({ env, clientFactory: () => ({ send: async () => { calls++; } }) });
  const existing = 'https://old.example/item.jpg';
  const retained = await storage.prepare({ ownerId, images: [existing], cover: existing, existing: [existing] });
  assert.equal(retained.cover, existing);
  await assert.rejects(storage.prepare({ ownerId, images: [existing], cover: existing }), { status: 400 });
  const a = await photo();
  await assert.rejects(storage.prepare({ ownerId, images: Array(6).fill(a), cover: a }), { status: 400 });
  await assert.rejects(storage.prepare({ ownerId, images: [a], cover: existing }), { status: 400 });
  assert.equal(calls, 0);
});

test('download signing only accepts canonical app photo URLs and expires in five minutes', async () => {
  let signed;
  const storage = createPhotoStorage({ env, clientFactory: () => ({}), sign: async (_c, command, options) => {
    signed = { command, options }; return 'https://signed.example/photo';
  } });
  const url = `${env.PUBLIC_API_URL}/api/photos/${ownerId}/${ownerId}.webp`;
  assert.equal(await storage.downloadUrl(url), 'https://signed.example/photo');
  assert.equal(signed.options.expiresIn, 300);
  assert.equal(signed.command.input.Key, `listings/${ownerId}/${ownerId}.webp`);
  for (const bad of [url + '?extra=1', url.replace('campusmesh.example', 'attacker.example'), url.replace('.webp', '.svg')])
    assert.equal(storage.keyFor(bad), null);
});
