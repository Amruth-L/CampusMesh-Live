const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const { SESv2Client, GetAccountCommand, GetEmailIdentityCommand } = require('@aws-sdk/client-sesv2');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { emailConfiguration } = require('./send-email');

async function check() {
  const config = emailConfiguration();
  if (config.provider === 'lambda') {
    const client = new LambdaClient({ region: config.region, maxAttempts: 1 });
    try {
      const result = await client.send(new InvokeCommand({ FunctionName: config.functionName, InvocationType: 'DryRun' }),
        { abortSignal: globalThis.AbortSignal.timeout(12000) });
      console.log(JSON.stringify({ provider: 'lambda', region: config.region,
        invokePermission: result.StatusCode === 204,
        note: 'Read-only invocation permission check. No email sent. Gmail authentication and actual inbox delivery require a separate test.' }, null, 2));
      if (result.StatusCode !== 204) process.exitCode = 1;
    } finally { client.destroy(); }
    return;
  }
  if (config.provider !== 'ses') throw new Error('Set EMAIL_PROVIDER=ses to check the HTTPS email setup.');
  const client = new SESv2Client({ region: config.region, maxAttempts: 1 });
  const send = command => client.send(command, { abortSignal: globalThis.AbortSignal.timeout(12000) });
  try {
    const account = await send(new GetAccountCommand({}));
    let verified = false;
    for (const identity of [config.from, config.from.split('@')[1]]) {
      try {
        const result = await send(new GetEmailIdentityCommand({ EmailIdentity: identity }));
        if (result.VerifiedForSendingStatus) { verified = true; break; }
      } catch (error) {
        if (error.name !== 'NotFoundException') throw error;
      }
    }
    console.log(JSON.stringify({
      provider: 'ses', region: config.region, senderVerified: verified,
      sendingEnabled: account.SendingEnabled === true,
      productionAccess: account.ProductionAccessEnabled === true,
      readyForGeneralRecipients: verified && account.SendingEnabled === true && account.ProductionAccessEnabled === true,
      note: 'Read-only check. No email sent. Runtime also needs ses:SendEmail permission; actual inbox delivery must be tested separately.',
    }, null, 2));
    if (!verified || !account.SendingEnabled || !account.ProductionAccessEnabled) process.exitCode = 1;
  } finally { client.destroy(); }
}
check().catch(error => {
  const code = String(error.code || error.name || 'EmailError');
  console.error('[email-check]', /^[A-Za-z0-9_]{1,60}$/.test(code) ? code : 'EmailError');
  if (error.code === 'EMAIL_CONFIGURATION' || error.message.startsWith('Set EMAIL_PROVIDER')) console.error(error.message);
  else console.error('Check AWS credentials, region and ses:GetAccount / ses:GetEmailIdentity permissions. Secret values are not printed.');
  process.exitCode = 1;
});
