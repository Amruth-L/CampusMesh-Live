const { text, money, badInput } = require('../../shared/validation');
const categories = require('../../../../shared/listing-options.json');
function listingInput(body, current = {}) {
  const value = { ...current, ...body };
  for (const [key, label, max] of [
    ['title', 'Title', 200],
    ['description', 'Description', 500],
    ['category', 'Category', 80],
    ['location', 'Pickup location', 200],
  ])
    value[key] = text(value[key], label, { required: true, max });
  if (!categories.includes(value.category) && value.category !== current.category)
    throw badInput('Choose a supported category.');
  for (const [key, label] of [
    ['price', 'Item value'],
    ['rent_price', 'Daily rent'],
    ['deposit', 'Deposit'],
    ['delivery_charge', 'Delivery charge'],
  ])
    value[key] = money(Object.hasOwn(body, key) ? body[key] : (value[key] ?? 0), label);
  if (value.rent_price <= 0) throw badInput('Daily rent must be greater than zero.');
  if (value.price > 0 && value.deposit > value.price) throw badInput('Deposit cannot exceed the item value.');
  for (const key of ['delivery_available', 'is_active']) {
    if (Object.hasOwn(body, key) && typeof body[key] !== 'boolean')
      throw badInput(`${key} must be true or false.`);
    value[key] = value[key] ?? key === 'is_active';
    if (typeof value[key] !== 'boolean') throw badInput(`${key} must be true or false.`);
  }
  value.condition = text(value.condition ?? 'Good', 'Condition', { required: true, max: 50 });
  if (
    !['Brand New', 'Like New', 'Excellent', 'Good', 'Fair'].includes(value.condition) &&
    value.condition !== current.condition
  )
    throw badInput('Choose a supported condition.');
  value.pickup_time = text(value.pickup_time ?? '5 min', 'Pickup time', { max: 80 });
  if (value.pickup_location_id != null)
    value.pickup_location_id = text(value.pickup_location_id, 'Pickup point', { max: 100 });
  for (const key of ['image_url'])
    if (body[key] !== undefined && typeof body[key] !== 'string')
      throw badInput('Choose a valid cover photo.');
  if (
    body.image_urls !== undefined &&
    (!Array.isArray(body.image_urls) ||
      !body.image_urls.length ||
      body.image_urls.length > 5 ||
      body.image_urls.some((p) => typeof p !== 'string'))
  )
    throw badInput('Choose between one and five photos.');
  return value;
}
module.exports = { listingInput };
