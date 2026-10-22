const test = require('node:test');
const assert = require('node:assert/strict');
const { SendEmailCommand } = require('@aws-sdk/client-sesv2');
const { InvokeCommand } = require('@aws-sdk/client-lambda');
const { createEmailSender, emailConfiguration } = require('../src/shared/send-email');
const env = { EMAIL_PROVIDER: 'ses', EMAIL_FROM: 'sender@example.invalid', AWS_REGION: 'ap-south-1' };
const quiet = { error() {} };

test('SES sends one UTF-8 OTP email over its API with a bounded request', async () => {
  let sends = 0;
  const send = createEmailSender({ env, logger: quiet,
    smtpFactory: () => assert.fail('SES must not use SMTP'),
    sesFactory: options => {
      assert.equal(options.region, 'ap-south-1');
      assert.equal(options.maxAttempts, 1);
      return { send: async (command, options) => {
        sends++;
        assert(command instanceof SendEmailCommand);
        assert.equal(options.abortSignal.aborted, false);
        assert.deepEqual(command.input.Destination.ToAddresses, ['student@dbit.co.in']);
        assert.equal(command.input.FromEmailAddress, 'CampusMesh <sender@example.invalid>');
        const content = command.input.Content.Simple;
        assert.equal(content.Subject.Charset, 'UTF-8');
        assert.match(content.Body.Html.Data, /Hello &lt;Student&gt;/);
        assert.match(content.Body.Text.Data, /654321/);
        return { MessageId: 'fixture-message' };
      } };
    },
  });
  assert.deepEqual(await send('student@dbit.co.in', 'Verification code', '654321', '<Student>'),
    { provider: 'ses', messageId: 'fixture-message' });
  assert.equal(sends, 1);
});

test('SES rejection propagates, logs no recipient/code/secrets and never falls back', async () => {
  const logs = [];
  const rejection = Object.assign(new Error('student@dbit.co.in secret-key 654321'), { name: 'MessageRejected' });
  const send = createEmailSender({ env,
    logger: { error: (...args) => logs.push(args) },
    sesFactory: () => ({ send: async () => { throw rejection; } }),
    smtpFactory: () => assert.fail('Provider failure must not fall back to blocked SMTP'),
  });
  await assert.rejects(send('student@dbit.co.in', 'Code', '654321', 'Student'), error => error === rejection);
  assert.match(JSON.stringify(logs), /MessageRejected/);
  assert.doesNotMatch(JSON.stringify(logs), /student@|secret-key|654321/);
});

test('missing SES acknowledgement is a delivery failure', async () => {
  const send = createEmailSender({ env, logger: quiet, sesFactory: () => ({ send: async () => ({}) }) });
  await assert.rejects(send('student@dbit.co.in', 'Code', '654321'), { code: 'EMAIL_NOT_ACCEPTED' });
});

test('misconfigured email fails before any provider connection', async () => {
  for (const bad of [
    { ...env, EMAIL_PROVIDER: 'unknown' }, { ...env, EMAIL_FROM: '' },
    { ...env, EMAIL_FROM: 'sender@example.invalid\r\nBcc: other@example.invalid' }, { ...env, AWS_REGION: '' },
  ]) {
    const send = createEmailSender({ env: bad, logger: quiet,
      sesFactory: () => assert.fail('Bad configuration reached provider'),
      smtpFactory: () => assert.fail('Bad configuration reached SMTP'),
    });
    await assert.rejects(send('student@dbit.co.in', 'Code', '654321'), { code: 'EMAIL_CONFIGURATION' });
  }
});

test('existing SMTP configuration is preserved and requires an accepted recipient', async () => {
  const smtpEnv = { EMAIL_USER: 'sender@example.invalid', EMAIL_PASS: 'fixture-password' };
  assert.equal(emailConfiguration(smtpEnv).provider, 'smtp');
  let accepted = ['student@dbit.co.in'];
  const send = createEmailSender({ env: smtpEnv, logger: quiet,
    sesFactory: () => assert.fail('SMTP unexpectedly reached SES'),
    smtpFactory: () => ({ sendMail: async () => ({ messageId: 'smtp-message', accepted }) }),
  });
  assert.equal((await send('student@dbit.co.in', 'Code', '654321')).provider, 'smtp');
  accepted = [];
  await assert.rejects(send('student@dbit.co.in', 'Code', '654321'), { code: 'EMAIL_NOT_ACCEPTED' });
});

test('private mail function uses synchronous IAM invocation and reports only acknowledged sends', async () => {
  const env = { EMAIL_PROVIDER: 'lambda', AWS_REGION: 'us-east-1', EMAIL_LAMBDA_FUNCTION: 'campusmesh-otp-mailer' };
  let response = { ok: true, messageId: 'smtp-message' };
  let functionError;
  let sends = 0;
  const send = createEmailSender({ env, logger: quiet,
    smtpFactory: () => assert.fail('Render must not use SMTP'),
    sesFactory: () => assert.fail('No fallback to SES sandbox'),
    lambdaFactory: options => {
      assert.equal(options.maxAttempts, 1);
      return { send: async command => {
        sends++;
        assert(command instanceof InvokeCommand);
        assert.equal(command.input.InvocationType, 'RequestResponse');
        assert.equal(command.input.FunctionName, 'campusmesh-otp-mailer');
        assert.deepEqual(JSON.parse(command.input.Payload), { version: 1, to: 'student@dbit.co.in', purpose: 'reset', code: '654321', name: 'Student' });
        return { StatusCode: 200, FunctionError: functionError, Payload: Buffer.from(JSON.stringify(response)) };
      } };
    },
  });
  const invoke = () => send('student@dbit.co.in', 'Your CampusMesh Password Reset Code', '654321', 'Student');
  assert.deepEqual(await invoke(), { provider: 'lambda', messageId: 'smtp-message' });
  response = { ok: false, code: 'SMTP_UNAVAILABLE', retryable: true };
  await assert.rejects(invoke(), { code: 'SMTP_UNAVAILABLE' });
  response = { ok: true, messageId: 'not-a-success' };
  functionError = 'Unhandled';
  await assert.rejects(invoke(), { code: 'EMAIL_NOT_ACCEPTED' });
  assert.equal(sends, 3);
  await assert.rejects(send('someone@gmail.com', 'Your CampusMesh Password Reset Code', '654321'), { code: 'EMAIL_CONFIGURATION' });
  assert.equal(sends, 3);
});
