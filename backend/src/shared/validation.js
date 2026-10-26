const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === 'string' && UUID.test(value);
const passwordError = (value) =>
  typeof value !== 'string' || value.length < 6 || Buffer.byteLength(value) > 72
    ? 'Use a password of at least 6 characters and at most 72 bytes.'
    : null;
const badInput = (message) => Object.assign(new Error(message), { status: 400 });
function text(value, name, { required = false, max = 200 } = {}) {
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max)
    throw badInput(`${name}: enter ${required ? 'a non-empty' : 'a'} text value, up to ${max} characters.`);
  return value.trim();
}
function money(value, name) {
  if (
    !['number', 'string'].includes(typeof value) ||
    String(value).trim() === '' ||
    !/^\d+(?:\.\d{1,2})?$/.test(String(value)) ||
    !Number.isFinite(Number(value)) ||
    Number(value) > 1000000
  )
    throw badInput(`${name}: enter an amount from 0 to 1,000,000 with at most two decimal places.`);
  return Number(value);
}
module.exports = { isUuid, passwordError, badInput, text, money };
