const { randomUUID } = require('node:crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { optimizePhoto, storageConfig } = require('../listings/photo-storage');

function createEvidenceStorage({ env = process.env, clientFactory = options => new S3Client(options), sign = getSignedUrl } = {}) {
  let client;
  const setup = () => {
    const config = storageConfig(env);
    client ||= clientFactory({ region: config.region, maxAttempts: 1 });
    return config;
  };
  const send = command => client.send(command, { abortSignal: globalThis.AbortSignal.timeout(20000) });
  const remove = async key => {
    const config = setup();
    await send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  };
  const put = async (deliveryId, stage, body) => {
    const config = setup();
    const key = `handovers/${deliveryId}/${stage}/${randomUUID()}.webp`;
    try {
      await send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body,
        ContentType: 'image/webp', CacheControl: 'private, no-store', ServerSideEncryption: 'AES256' }));
    } catch {
      await remove(key).catch(() => {});
      throw Object.assign(new Error('Photo upload failed. Retry before confirming handover.'), { status: 503 });
    }
    return key;
  };
  const url = async key => {
    const config = setup();
    return sign(client, new GetObjectCommand({ Bucket: config.bucket, Key: key,
      ResponseCacheControl: 'private, no-store', ResponseContentType: 'image/webp' }), { expiresIn: 300 });
  };
  return { put, remove, url, optimize: optimizePhoto };
}
module.exports = { ...createEvidenceStorage(), createEvidenceStorage };
