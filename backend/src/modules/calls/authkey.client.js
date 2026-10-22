// Official API contracts (checked 2026-10-16):
// https://authkey.io/voice-api-docs
// https://authkey.io/2fa-api-docs
// https://documenter.getpostman.com/view/28006064/2sAYXCje4N#3dc15bf1-645f-43be-b31f-8b6168a58310
// Voice OTP uses POST with query parameters and a pre-approved {#2fa#} template.
// LogID acknowledges submission; it does not prove the recipient answered.
const { URL, URLSearchParams } = require('node:url');

const SEND_URL = 'https://api.authkey.io/request';
const VERIFY_URL = 'https://console.authkey.io/api/2fa_verify.php';
const LOG_ID = /^[A-Za-z0-9_-]{16,128}$/;
const TEMPLATE_ID = /^\d{1,20}$/;

function supportsPhone(phone) {
  return typeof phone === 'string' && /^\+91[6-9]\d{9}$/.test(phone);
}

function failure(code, message, { status = 502, definite = false } = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.definite = definite;
  return error;
}

function invalid(message) {
  return failure('AUTHKEY_INVALID_REQUEST', message, { status: 400, definite: true });
}

function createAuthkeyClient(config = {}, { fetchImpl = globalThis.fetch } = {}) {
  const key = config.authkeyApiKey;

  function assertConfigured() {
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,512}$/.test(key)) {
      throw failure('AUTHKEY_NOT_CONFIGURED', 'Authkey credentials are not configured.', {
        status: 503,
        definite: true,
      });
    }
  }

  function phoneParams(to) {
    if (!supportsPhone(to)) throw invalid('Authkey calls currently support Indian mobile numbers only.');
    return { mobile: to.slice(3), country_code: '91' };
  }

  async function request(base, params, method = 'GET') {
    assertConfigured();
    const url = new URL(base);
    url.search = new URLSearchParams({ authkey: key, ...params }).toString();
    let response;
    let body;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        redirect: 'error',
        signal: globalThis.AbortSignal.timeout(20_000),
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      // Do not retain fetch errors: their URL/body can contain the key or OTP.
      // A timeout or lost response must never cause a second automatic call.
      if (response.status >= 500 || response.status < 200 || (response.status >= 300 && response.status < 400)) {
        throw new Error('Unknown provider outcome');
      }
      if (response.status >= 400) {
        throw failure('AUTHKEY_REJECTED', 'Authkey rejected the request. Check the provider account.', {
          status: 503,
          definite: true,
        });
      }
      const raw = await response.text();
      if (raw.length > 16_384) throw new Error('Unexpected provider response');
      body = JSON.parse(raw);
    } catch (error) {
      if (error?.code === 'AUTHKEY_REJECTED' && error.definite === true) throw error;
      throw failure('AUTHKEY_OUTCOME_UNKNOWN', 'Authkey did not confirm the result. Check the provider before retrying.');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw failure('AUTHKEY_OUTCOME_UNKNOWN', 'Authkey returned an unrecognized result. Check the provider before retrying.');
    }
    return body;
  }

  function accepted(body) {
    if (body.Message === 'Submitted Successfully' && typeof body.LogID === 'string' && LOG_ID.test(body.LogID)
      && body.status !== false && body.success !== false && !(typeof body.code === 'number' && body.code >= 400)) {
      return { id: body.LogID };
    }
    // An explicit failure without a submission ID is safe to mark as rejected.
    // Anything contradictory or undocumented stays unknown, never auto-retried.
    if (!body.LogID && (body.status === false || body.success === false
      || typeof body.code === 'number' && body.code >= 400 && body.code < 500)) {
      throw failure('AUTHKEY_REJECTED', 'Authkey rejected the request. Check the provider account.', {
        status: 503,
        definite: true,
      });
    }
    throw failure('AUTHKEY_OUTCOME_UNKNOWN', 'Authkey did not acknowledge submission. Check the provider before retrying.');
  }

  return {
    async sendVoice({ to, text } = {}) {
      const params = phoneParams(to);
      if (typeof text !== 'string' || !text.trim() || text.length > 1600 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
        throw invalid('The call message is missing or too long.');
      }
      const template = config.authkeyVoiceTemplateId;
      if (template) {
        if (!TEMPLATE_ID.test(String(template))) throw invalid('The Authkey voice template is not configured correctly.');
        params.vid = String(template);
        // This optional template must have a {#message#} variable approved by Authkey.
        params.message = text;
      } else {
        params.voice = text;
      }
      return accepted(await request(SEND_URL, params));
    },

    async sendVerification(to) {
      const params = phoneParams(to);
      const template = config.authkeyOtpTemplateId;
      if (!template || !TEMPLATE_ID.test(String(template))) {
        throw failure('AUTHKEY_VERIFICATION_NOT_CONFIGURED', 'Authkey phone verification is not configured.', {
          status: 503,
          definite: true,
        });
      }
      params.vid = String(template);
      return accepted(await request(SEND_URL, params, 'POST'));
    },

    async checkVerification(logId, code) {
      if (typeof logId !== 'string' || !LOG_ID.test(logId) || typeof code !== 'string' || !/^\d{4,8}$/.test(code)) {
        throw invalid('The phone verification session or code is invalid.');
      }
      const body = await request(VERIFY_URL, { channel: 'voice', otp: code, logid: logId });
      if (body.status === true) return true;
      if (body.status === false) return false;
      throw failure('AUTHKEY_OUTCOME_UNKNOWN', 'Authkey did not confirm phone verification. Please try verifying again.');
    },
  };
}

module.exports = { createAuthkeyClient, supportsPhone };
