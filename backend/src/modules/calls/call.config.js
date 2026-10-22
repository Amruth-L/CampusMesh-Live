// Server-only configuration. Never return credentials in API responses.
const { E164 } = require('./call-policy');
const providerName = (c) => c.provider || 'twilio';
function config() {
  return {
    provider: process.env.CALLS_PROVIDER || 'twilio',
    live: process.env.CALLS_MODE === 'live',
    trial: process.env.TWILIO_TRIAL_MODE === 'true',
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_FROM_NUMBER,
    verify: process.env.TWILIO_VERIFY_SERVICE_SID,
    base: process.env.PUBLIC_API_URL?.replace(/\/$/, ''),
    enabled: process.env.CALLS_SCHEDULER_ENABLED === 'true',
    authkeyApiKey: process.env.AUTHKEY_API_KEY,
    authkeyVoiceApproved: process.env.AUTHKEY_VOICE_APPROVED === 'true',
    authkeyOtpTemplateId: process.env.AUTHKEY_OTP_TEMPLATE_ID,
    authkeyVoiceTemplateId: process.env.AUTHKEY_VOICE_TEMPLATE_ID,
  };
}
function ready(c = config()) {
  if (providerName(c) === 'authkey')
    return Boolean(
      c.live &&
      /^[A-Za-z0-9_-]{8,512}$/.test(c.authkeyApiKey || '') &&
      c.authkeyVoiceApproved &&
      (!c.authkeyVoiceTemplateId || /^\d{1,20}$/.test(c.authkeyVoiceTemplateId)),
    );
  if (providerName(c) !== 'twilio') return false;
  return Boolean(
    c.live &&
    /^AC[\da-f]{32}$/i.test(c.sid || '') &&
    c.token &&
    E164.test(c.from || '') &&
    /^https:\/\//.test(c.base || ''),
  );
}

module.exports = { config, ready, providerName };
