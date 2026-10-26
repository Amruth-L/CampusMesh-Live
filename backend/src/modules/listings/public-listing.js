// Public API contract: adding a DB column must never expose it automatically.
const fields = [
  'id',
  'owner_id',
  'owner_name',
  'title',
  'description',
  'price',
  'rent_price',
  'deposit',
  'category',
  'condition',
  'location',
  'pickup_location_id',
  'delivery_available',
  'delivery_charge',
  'pickup_time',
  'image_url',
  'image_urls',
  'is_active',
  'demo_slug',
  'created_at',
  'updated_at',
  'paid_rentals_30d',
  'viewers_7d',
];
const publicListing = (row) =>
  Object.fromEntries(fields.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]]));
module.exports = { publicListing };
