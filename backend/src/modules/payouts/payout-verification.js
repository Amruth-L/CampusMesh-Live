// Route product activation and bank verification are separate checks.
function recipientVerification(product, requireSettlement = false) {
  const configuration = product?.active_configuration || {};
  const destinations = configuration.settlement_accounts;
  const destination = Array.isArray(destinations)
    ? destinations.find((item) => item.method === 'bank_account' && item.active === true && item.bank_account?.is_default === true)
    : null;
  const bank = destination?.bank_account || (!requireSettlement && !Array.isArray(destinations) ? configuration.settlements : null);
  const bankReady = destination
    ? destination.verification_status === 'verified'
    : !requireSettlement && !Array.isArray(destinations) && Boolean(bank?.account_number);
  const needsAttention = ['needs_clarification', 'suspended', 'rejected'].includes(product?.activation_status) ||
    (Array.isArray(destinations) && destinations.some((item) => ['failed', 'rejected'].includes(item.verification_status)));
  return {
    status: needsAttention ? 'NEEDS_ATTENTION' : product?.activation_status === 'activated' && bankReady ? 'ACTIVE' : 'PENDING',
    // New API responses may expose only two trailing digits; never imply four.
    bankLast4: bank?.account_number ? String(bank.account_number).match(/\d{1,4}$/)?.[0] || null : null,
    beneficiaryName: bank?.beneficiary_name || null,
  };
}
module.exports = { recipientVerification };
