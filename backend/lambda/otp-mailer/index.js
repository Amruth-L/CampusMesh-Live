'use strict';

const nodemailer = require('nodemailer');
const { setTimeout, clearTimeout } = require('node:timers');
const tls = require('node:tls');

const PURPOSES = Object.freeze({
  verify: {
    subject: 'Verify your CampusMesh email',
    instruction: 'Use this code to verify your college email and continue to CampusMesh.',
  },
  reset: {
    subject: 'Reset your CampusMesh password',
    instruction: 'Use this code to reset your CampusMesh password.',
  },
});
const ALLOWED_FIELDS = new Set(['version', 'to', 'purpose', 'code', 'name']);
const failure = (code, retryable = false) => ({ ok: false, code, retryable });

function validateRequest(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const prototype = Object.getPrototypeOf(event);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (Object.keys(event).some(key => !ALLOWED_FIELDS.has(key))) return null;
  if (event.version !== 1 || !Object.hasOwn(PURPOSES, event.purpose)) return null;
  if (typeof event.code !== 'string' || event.code.length !== 6 || !/^\d{6}$/.test(event.code)) return null;
  if (typeof event.to !== 'string') return null;
  const to = event.to.trim().toLowerCase();
  if (!/^[a-z0-9._+-]{1,64}@dbit\.co\.in$/.test(to)) return null;
  const localPart = to.split('@')[0];
  if (localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) return null;
  if (event.name !== undefined && (typeof event.name !== 'string' || event.name.length > 120 || /[\u0000-\u001f\u007f]/.test(event.name))) return null;
  return { to, purpose: event.purpose, code: event.code, name: event.name?.trim() || 'there' };
}

function configuration(env) {
  const from = typeof env.EMAIL_USER === 'string' ? env.EMAIL_USER.trim().toLowerCase() : '';
  if (!/^[a-z0-9._+-]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/.test(from)) return null;
  if (typeof env.EMAIL_PASS !== 'string' || !env.EMAIL_PASS.trim()) return null;
  return { from, pass: env.EMAIL_PASS };
}

function emailContent(request, from) {
  const { subject, instruction } = PURPOSES[request.purpose];
  const escapedName = request.name.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  return {
    from: { name: 'CampusMesh', address: from },
    to: { address: request.to },
    subject,
    text: `Hello ${request.name},\n\n${instruction}\n\n${request.code}\n\nThis code expires in 10 minutes. Do not share it with anyone.\n\nIf you did not request this code, you can ignore this email.\n\nCampusMesh`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#202522"><h2 style="color:#15803d">CampusMesh</h2><p>Hello ${escapedName},</p><p>${instruction}</p><p style="padding:16px;background:#f2f6f3;font-size:28px;font-weight:bold;letter-spacing:5px">${request.code}</p><p>This code expires in 10 minutes. Do not share it with anyone.</p><p>If you did not request this code, you can ignore this email.</p></div>`,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

function classifyFailure(error) {
  // Provider errors can contain the recipient, message, credentials or SMTP
  // transcript. Never return or log the raw error or provider response.
  if (error?.code === 'EAUTH') return failure('SMTP_AUTHENTICATION');
  if (error?.code === 'RELAY_DEADLINE') return failure('DELIVERY_TIMEOUT');
  if (Number.isInteger(error?.responseCode)) {
    if (error.responseCode >= 400 && error.responseCode < 500) return failure('SMTP_TEMPORARY', true);
    if (error.responseCode >= 500 && error.responseCode < 600) return failure('SMTP_REJECTED');
  }
  if (['ETIMEDOUT', 'ESOCKET', 'ECONNRESET'].includes(error?.code)) return failure('DELIVERY_UNCONFIRMED');
  if (['ECONNECTION', 'EDNS', 'ENOTFOUND', 'ECONNREFUSED'].includes(error?.code)) return failure('DELIVERY_UNAVAILABLE', true);
  return failure('DELIVERY_UNAVAILABLE');
}

function createHandler({
  env = process.env,
  transportFactory = options => nodemailer.createTransport(options),
  socketFactory = options => tls.connect(options),
  deadlineMs = 15000,
} = {}) {
  return async event => {
    const request = validateRequest(event);
    if (!request) return failure('INVALID_REQUEST');
    const config = configuration(env);
    if (!config) return failure('CONFIGURATION');
    let transport, socket, timer;
    try {
      transport = transportFactory({
        host: 'smtp.gmail.com', port: 465, secure: true, pool: false,
        auth: { user: config.from, pass: config.pass },
        connectionTimeout: 6000, greetingTimeout: 6000, socketTimeout: 10000,
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
        logger: false, debug: false,
        // Own the TLS socket so the overall deadline can really cancel the
        // in-flight connection. Non-pooled Nodemailer.close() alone does not.
        getSocket(_options, callback) {
          let returned = false;
          const finish = error => {
            if (returned) return;
            returned = true;
            callback(error, error ? undefined : { connection: socket, secured: true });
          };
          try {
            socket = socketFactory({ host: 'smtp.gmail.com', port: 465, servername: 'smtp.gmail.com', minVersion: 'TLSv1.2', rejectUnauthorized: true });
            socket.once('error', finish);
            socket.once('secureConnect', () => {
              socket.setTimeout(10000);
              finish(null);
            });
            socket.setTimeout(6000, () => socket.destroy(Object.assign(new Error('SMTP socket timeout'), { code: 'ETIMEDOUT' })));
          } catch (error) { finish(error); }
        },
      });
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Delivery deadline reached'), { code: 'RELAY_DEADLINE' })), deadlineMs);
      });
      // Exactly one send attempt. An ambiguous timeout must not automatically
      // retry and send the same code twice. The authenticated app owns resends.
      const result = await Promise.race([transport.sendMail(emailContent(request, config.from)), deadline]);
      const accepted = Array.isArray(result?.accepted) ? result.accepted : [];
      const acceptedRecipient = accepted.length === 1 && typeof accepted[0] === 'string' && accepted[0].trim().toLowerCase() === request.to;
      const messageId = result?.messageId;
      if (!acceptedRecipient || result?.rejected?.length || typeof messageId !== 'string' || !messageId || messageId.length > 255 || /[\r\n\u0000]/.test(messageId)) {
        return failure('DELIVERY_UNCONFIRMED');
      }
      return { ok: true, messageId };
    } catch (error) {
      return classifyFailure(error);
    } finally {
      if (timer) clearTimeout(timer);
      try { socket?.destroy(); } catch { /* No provider detail may escape. */ }
      try { transport?.close?.(); } catch { /* No provider detail may escape. */ }
    }
  };
}

module.exports = { handler: createHandler(), createHandler };
