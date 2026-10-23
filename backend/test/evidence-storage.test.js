const test = require('node:test');
const assert = require('node:assert/strict');
const { createEvidenceStorage } = require('../src/modules/delivery/evidence-storage');
const { createPhotoStorage } = require('../src/modules/listings/photo-storage');

const env = { S3_PHOTO_BUCKET: 'fixture-photos', S3_REGION: 'us-east-1', PUBLIC_API_URL: 'https://campusmesh.example' };
const deliveryId = '00000000-0000-4000-8000-000000000001';

test('handover evidence works with the deployed listings-only S3 permission and stays outside public photo URLs', async () => {
  const commands = [];
  const storage = createEvidenceStorage({ env, clientFactory: () => ({ send: async command => {
    assert.ok(command.input.Key.startsWith('listings/'), 'runtime policy only grants listings/*');
    commands.push(command);
  } }) });
  const key = await storage.put(deliveryId, 'PICKUP', Buffer.from('fixture'));
  assert.match(key, /^listings\/handovers\/[^/]+\/PICKUP\/[^/]+\.webp$/);
  assert.equal(commands[0].input.CacheControl, 'private, no-store');
  assert.equal(commands[0].input.ServerSideEncryption, 'AES256');
  assert.equal(commands[0].input.ACL, undefined);
  const publicPhotos = createPhotoStorage({ env });
  assert.equal(publicPhotos.keyFor(env.PUBLIC_API_URL + '/api/photos/' + key.slice('listings/'.length)), null);
  await storage.remove(key);
  assert.equal(commands[1].constructor.name, 'DeleteObjectCommand');
  assert.equal(commands[1].input.Key, key);
});

test('new and legacy evidence keys retain private five-minute downloads', async () => {
  let signed;
  const storage = createEvidenceStorage({ env, clientFactory: () => ({}), sign: async (_client, command, options) => {
    signed = { command, options }; return 'fixture-url';
  } });
  for (const key of [`handovers/${deliveryId}/PICKUP/old.webp`, `listings/handovers/${deliveryId}/DELIVERY/new.webp`]) {
    assert.equal(await storage.url(key), 'fixture-url');
    assert.equal(signed.command.input.Key, key);
    assert.equal(signed.command.input.ResponseCacheControl, 'private, no-store');
    assert.equal(signed.options.expiresIn, 300);
  }
});

test('failed upload is cleaned up and logs diagnostics without provider messages or photo content', async () => {
  const commands = [], logs = [];
  const storage = createEvidenceStorage({ env, logger: { error: (...args) => logs.push(args) }, clientFactory: () => ({ send: async command => {
    commands.push(command);
    if (command.constructor.name === 'PutObjectCommand') throw Object.assign(new Error('private provider detail'), {
      name: 'AccessDenied', $metadata: { httpStatusCode: 403, requestId: 'fixture-request' },
    });
  } }) });
  await assert.rejects(storage.put(deliveryId, 'PICKUP', Buffer.from('private image')), { status: 503 });
  assert.equal(commands[1].constructor.name, 'DeleteObjectCommand');
  assert.equal(commands[1].input.Key, commands[0].input.Key);
  assert.deepEqual(logs[0][1], { name: 'AccessDenied', status: 403, requestId: 'fixture-request' });
  assert.ok(!JSON.stringify(logs).includes('private'));
});
