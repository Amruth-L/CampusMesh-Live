const nodemailer = require('nodemailer');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
require('dotenv').config();

const configError = message => Object.assign(new Error(message), { code: 'EMAIL_CONFIGURATION' });
function emailConfiguration(env = process.env) {
  const provider = (env.EMAIL_PROVIDER || 'smtp').trim().toLowerCase();
  if (!['smtp', 'ses', 'lambda'].includes(provider)) throw configError('EMAIL_PROVIDER must be smtp, ses or lambda.');
  if (provider === 'lambda') {
    const region = env.AWS_REGION?.trim();
    const functionName = env.EMAIL_LAMBDA_FUNCTION?.trim();
    if (!region || !functionName) throw configError('Configure AWS_REGION and EMAIL_LAMBDA_FUNCTION.');
    return { provider, region, functionName };
  }
  const from = (provider === 'ses' ? env.EMAIL_FROM : env.EMAIL_USER)?.trim();
  if (!from || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from))
    throw configError(provider === 'ses' ? 'Configure EMAIL_FROM with a verified SES sender.' : 'Configure EMAIL_USER.');
  const region = env.AWS_REGION?.trim();
  if (provider === 'ses' && !region) throw configError('Configure AWS_REGION for the verified SES sender.');
  if (provider === 'smtp' && !env.EMAIL_PASS) throw configError('Configure EMAIL_PASS.');
  return { provider, from, region };
}

function createEmailSender({
  env = process.env,
  sesFactory = options => new SESv2Client(options),
  lambdaFactory = options => new LambdaClient(options),
  smtpFactory = options => nodemailer.createTransport(options),
  logger = console,
} = {}) {
  let ses, smtp, lambda;
  return async (to, subject, otpCode, name) => {
    let provider = 'unconfigured';
    try {
      const config = emailConfiguration(env);
      provider = config.provider;
      if (provider === 'lambda') {
        const purposes = {
          'Your CampusMesh Verification Code': 'verify',
          'Your CampusMesh Password Reset Code': 'reset',
        };
        const purpose = purposes[subject];
        if (!purpose || !/^[^\s@]+@dbit\.co\.in$/.test(to) || !/^\d{6}$/.test(String(otpCode)))
          throw configError('Invalid OTP email request.');
        // IAM-authenticated HTTPS, one synchronous attempt. The private function
        // owns its Gmail credentials; they are never included in this payload.
        lambda ||= lambdaFactory({ region: config.region, maxAttempts: 1 });
        const result = await lambda.send(new InvokeCommand({
          FunctionName: config.functionName,
          InvocationType: 'RequestResponse',
          Payload: Buffer.from(JSON.stringify({ version: 1, to, purpose, code: String(otpCode), name: String(name || 'there').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120) })),
        }), { abortSignal: globalThis.AbortSignal.timeout(30000) });
        let reply;
        try { reply = JSON.parse(Buffer.from(result.Payload || []).toString()); } catch { /* fail closed */ }
        if (result.StatusCode !== 200 || result.FunctionError || reply?.ok !== true || typeof reply.messageId !== 'string' || !reply.messageId)
          throw Object.assign(new Error('The mail function did not confirm delivery.'), {
            code: /^[A-Z_]{1,50}$/.test(reply?.code || '') ? reply.code : 'EMAIL_NOT_ACCEPTED',
          });
        return { provider, messageId: reply.messageId };
      }
      const safeName = String(name || 'there').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      })[char]);
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#202522">
          <h2 style="color:#15803d">CampusMesh</h2>
          <p>Hello ${safeName},</p><p>Your verification code is:</p>
          <p style="padding:16px;background:#f2f6f3;font-size:28px;font-weight:bold;letter-spacing:5px">${otpCode}</p>
          <p>This code expires in 10 minutes. Do not share it with anyone.</p>
          <p>Thank you,<br>CampusMesh</p>
        </div>`;
      const text = `${subject}: ${otpCode}. This code expires in 10 minutes. Do not share it with anyone.`;
      if (provider === 'ses') {
        // HTTPS (443), compatible with Render Free. One attempt avoids duplicate
        // emails after ambiguous network failures; never fall back to SMTP.
        ses ||= sesFactory({ region: config.region, maxAttempts: 1 });
        const result = await ses.send(new SendEmailCommand({
          FromEmailAddress: `CampusMesh <${config.from}>`,
          Destination: { ToAddresses: [to] },
          Content: { Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Html: { Data: html, Charset: 'UTF-8' }, Text: { Data: text, Charset: 'UTF-8' } },
          } },
        }), { abortSignal: globalThis.AbortSignal.timeout(12000) });
        if (!result.MessageId) throw Object.assign(new Error('SES did not acknowledge the message.'), { code: 'EMAIL_NOT_ACCEPTED' });
        return { provider, messageId: result.MessageId };
      }
      smtp ||= smtpFactory({
        service: 'gmail', connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
        auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASS },
      });
      const result = await smtp.sendMail({ from: `CampusMesh <${config.from}>`, to, subject, html, text });
      if (!result.accepted?.length) throw Object.assign(new Error('SMTP did not accept the recipient.'), { code: 'EMAIL_NOT_ACCEPTED' });
      return { provider, messageId: result.messageId };
    } catch (error) {
      // Never log recipients, OTPs, request bodies, credentials or full provider errors.
      const code = String(error.code || error.name || 'EmailError');
      logger.error('[email] delivery failed', { provider, code: /^[A-Za-z0-9_]{1,60}$/.test(code) ? code : 'EmailError' });
      throw error;
    }
  };
}

module.exports = createEmailSender();
module.exports.createEmailSender = createEmailSender;
module.exports.emailConfiguration = emailConfiguration;
