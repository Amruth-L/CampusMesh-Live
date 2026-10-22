const { randomUUID } = require('node:crypto');
const { URL } = require('node:url');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const MAX_BYTES = 5 * 1024 * 1024;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PHOTO_PATH = new RegExp(`^/api/photos/(${UUID})/(${UUID})\\.webp$`);
const photoError = (message, status = 400) => Object.assign(new Error(message), { status, photoError: true });

function storageConfig(env = process.env) {
  if (!env.S3_PHOTO_BUCKET || !(env.S3_REGION || env.AWS_REGION) || !env.PUBLIC_API_URL)
    throw photoError('Photo storage is not configured. Please try again later.', 503);
  const origin = new URL(env.PUBLIC_API_URL).origin;
  return { bucket: env.S3_PHOTO_BUCKET, region: env.S3_REGION || env.AWS_REGION, origin };
}

async function optimizePhoto(data) {
  if (typeof data !== 'string' || data.length > Math.ceil(MAX_BYTES * 4 / 3) + 100)
    throw photoError('Each photo must be 5 MB or smaller.');
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match) throw photoError('Choose a JPG, PNG or WebP photo from your device.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES) throw photoError('Each photo must be 5 MB or smaller.');
  try {
    // Decode the actual file, reject animation/SVG, strip metadata (including GPS),
    // and bound pixel allocation before processing untrusted image bytes.
    const input = sharp(bytes, { limitInputPixels: 40000000, failOn: 'warning' });
    const meta = await input.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages || 1) > 1)
      throw new Error('Unsupported image');
    return await input.rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer();
  } catch {
    throw photoError('This photo cannot be read. Use a non-animated JPG, PNG or WebP under 40 megapixels.');
  }
}

function createPhotoStorage({ env = process.env, clientFactory = options => new S3Client(options), sign = getSignedUrl, logger = console } = {}) {
  let client;
  const setup = () => {
    const config = storageConfig(env);
    client ||= clientFactory({ region: config.region, maxAttempts: 1 });
    return config;
  };
  const send = command => client.send(command, { abortSignal: globalThis.AbortSignal.timeout(20000) });
  async function remove(keys) {
    if (!keys.length) return;
    const config = setup();
    for (const Key of keys) {
      try { await send(new DeleteObjectCommand({ Bucket: config.bucket, Key })); }
      catch (error) { logger.error('[photos] cleanup failed', error.name); }
    }
  }
  function keyFor(url) {
    try {
      const config = storageConfig(env);
      const parsed = new URL(url);
      if (parsed.origin !== config.origin || parsed.search || parsed.hash) return null;
      const match = PHOTO_PATH.exec(parsed.pathname);
      return match ? `listings/${match[1]}/${match[2]}.webp` : null;
    } catch { return null; }
  }
  async function prepare({ ownerId, images, cover, existing = [] }) {
    if (!new RegExp(`^${UUID}$`).test(ownerId)) throw photoError('Please sign in again.', 401);
    if (!Array.isArray(images) || !images.length || images.length > 5 || images.some(x => typeof x !== 'string' || !x))
      throw photoError('Choose between 1 and 5 photos.');
    if (!images.includes(cover)) throw photoError('Choose a cover photo from your photos.');
    const unique = [...new Set(images)];
    // Validate every new image before creating any S3 objects.
    const optimized = new Map();
    for (const photo of unique) if (!existing.includes(photo)) optimized.set(photo, await optimizePhoto(photo));
    const createdKeys = [];
    const replacements = new Map();
    try {
      for (const [photo, Body] of optimized) {
        const config = setup();
        const id = randomUUID();
        const Key = `listings/${ownerId}/${id}.webp`;
        createdKeys.push(Key); // Includes ambiguous failed PUTs in cleanup.
        await send(new PutObjectCommand({ Bucket: config.bucket, Key, Body,
          ContentType: 'image/webp', CacheControl: 'public, max-age=86400', ServerSideEncryption: 'AES256' }));
        replacements.set(photo, `${config.origin}/api/photos/${ownerId}/${id}.webp`);
      }
      return { images: unique.map(p => replacements.get(p) || p), cover: replacements.get(cover) || cover, createdKeys };
    } catch (error) {
      await remove(createdKeys);
      if (error.photoError) throw error;
      logger.error('[photos] upload failed', error.name);
      throw photoError('We could not store your photos. Please try publishing again.', 503);
    }
  }
  async function downloadUrl(url) {
    const Key = keyFor(url);
    if (!Key) throw photoError('Photo not found.', 404);
    const config = setup();
    return sign(client, new GetObjectCommand({ Bucket: config.bucket, Key,
      ResponseContentType: 'image/webp', ResponseContentDisposition: 'inline' }), { expiresIn: 300 });
  }
  return { prepare, remove, keyFor, downloadUrl };
}

module.exports = { ...createPhotoStorage(), createPhotoStorage, optimizePhoto, storageConfig, PHOTO_PATH, photoError };
