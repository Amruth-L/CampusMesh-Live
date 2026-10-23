const { randomUUID } = require('node:crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { optimizePhoto, storageConfig } = require('../listings/photo-storage');

function createEvidenceStorage({ env = process.env, clientFactory = options => new S3Client(options), sign = getSignedUrl, logger = console } = {}) {
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
    // Reuse the app's permitted photo namespace. This nested path cannot match
    // the public listing-photo route (which accepts only two UUID segments).
    // Evidence URLs are issued only after the delivery participant check.
    const key = `listings/handovers/${deliveryId}/${stage}/${randomUUID()}.webp`;
    try {
      await send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body,
        ContentType: 'image/webp', CacheControl: 'private, no-store', ServerSideEncryption: 'AES256' }));
    } catch (error) {
      logger.error('[handover-photos] upload failed', {
        name: error.name,
        status: error.$metadata?.httpStatusCode,
        requestId: error.$metadata?.requestId,
      });
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
