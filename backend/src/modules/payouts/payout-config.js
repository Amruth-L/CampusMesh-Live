const modeFor = (key = process.env.RAZORPAY_KEY_ID) =>
  /^rzp_live_/.test(key || '') ? 'live' : /^rzp_test_/.test(key || '') ? 'test' : null;
function payoutConfig(env = process.env) {
  const mode = modeFor(env.RAZORPAY_KEY_ID);
  const enabled = env.PAYOUTS_ENABLED === 'true';
  const approved = env.RAZORPAY_ROUTE_APPROVED === 'true';
  const configured = Boolean(
    enabled && approved && mode && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET,
  );
  return {
    mode,
    enabled,
    approved,
    configured,
    message: configured
      ? mode === 'live'
        ? 'Live payments selected. Complete your bank verification to receive eligible earnings.'
        : 'Test payouts only. No money moves.'
      : !approved
        ? 'Razorpay approval for CampusMesh marketplace payouts is pending. Bank verification and automatic payouts are unavailable until approval. Any recorded earnings remain visible here.'
        : 'Bank payouts are awaiting service configuration. Any recorded earnings remain visible here.',
  };
}
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
async function providerRead(read) {
  let timer;
  try {
    return await Promise.race([
      read(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(fail('Payout provider did not respond. Please retry status refresh.', 503)),
          15000,
        );
      }),
    ]);
  } finally {
    globalThis.clearTimeout(timer);
  }
}
module.exports = { modeFor, payoutConfig, fail, providerRead };
