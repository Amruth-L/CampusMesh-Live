const helmet = require('helmet');
function securityPolicy(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const configured = env.FRONTEND_ORIGIN || (production ? env.PUBLIC_API_URL : '');
  if (production && (!configured || !env.JWT_SECRET || Buffer.byteLength(env.JWT_SECRET) < 32))
    throw new Error(
      'Production needs FRONTEND_ORIGIN (or PUBLIC_API_URL) and a JWT_SECRET of at least 32 bytes.',
    );
  const origins = [
    ...new Set(
      (configured || '')
        .split(',')
        .filter(Boolean)
        .map((value) => {
          const url = new URL(value.trim());
          if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            (production && url.protocol !== 'https:')
          )
            throw new Error('Configure HTTPS website origins for production.');
          return url.origin;
        }),
    ),
  ];
  const allowed = (origin) => {
    if (!origin) return true; // Webhooks and native API clients still require their normal authentication.
    if (origins.includes(origin)) return true;
    if (!production) {
      try {
        const u = new URL(origin);
        return (
          ['http:', 'https:'].includes(u.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
        );
      } catch {
        return false;
      }
    }
    return false;
  };
  const origin = (value, callback) =>
    callback(
      allowed(value) ? null : Object.assign(new Error('Website origin is not allowed.'), { status: 403 }),
      allowed(value),
    );
  const connect = [
    "'self'",
    ...origins,
    ...origins.map((value) => value.replace(/^http/, 'ws')),
    'https://*.razorpay.com',
    'wss://*.razorpay.com',
  ];
  const headers = helmet({
    contentSecurityPolicy: {
      reportOnly: env.SECURITY_CSP_ENFORCE !== 'true',
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'https:', 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        mediaSrc: ["'self'", 'blob:', 'data:'],
        connectSrc: connect,
        frameSrc: ['https://*.razorpay.com'],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: production ? [] : null,
      },
    },
    strictTransportSecurity: production ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    xFrameOptions: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  const middleware = (req, res, next) =>
    headers(req, res, () => {
      // Enforce non-script protections immediately; stage the full script allowlist
      // in report-only mode until provider checkout has been verified by the owner.
      if (env.SECURITY_CSP_ENFORCE !== 'true')
        res.set('Content-Security-Policy', "base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
      res.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self)');
      next();
    });
  const numeric = (name, fallback) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < 1 || value > 100000) throw new Error(`Invalid ${name}`);
    return value;
  };
  return {
    allowed,
    origin,
    middleware,
    apiLimit: numeric('API_REQUESTS_PER_MINUTE', 1200),
    authLimit: numeric('AUTH_REQUESTS_PER_15_MINUTES', 60),
  };
}
module.exports = { securityPolicy };
