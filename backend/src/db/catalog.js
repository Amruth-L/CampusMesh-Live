const catalog = require('./data/catalog.json');
const path = require('path');
const fs = require('fs');
async function seedCatalog(client, ownerId) {
  for (const item of catalog) {
    const image = `/images/catalog/${item.slug}.jpg`;
    if (!fs.existsSync(path.resolve(__dirname, '../../../frontend/public' + image)))
      throw new Error(`Missing catalog image: ${item.slug}`);
    const description = `Demo rental listing: ${item.title}. Item-specific illustrative catalog image. This sample inventory is for exploring CampusMesh; confirm availability with the owner before renting.`;
    const existing = await client.query(
      'SELECT id FROM listings WHERE owner_id=$1 AND (demo_slug=$2 OR title=$3 OR title=$4) ORDER BY created_at LIMIT 1',
      [ownerId, item.slug, item.title, item.legacyTitle || item.title],
    );
    if (existing.rowCount) {
      await client.query(
        'UPDATE listings SET title=$2,category=$3,image_url=$4,description=$5,demo_slug=$6,updated_at=NOW() WHERE id=$1',
        [existing.rows[0].id, item.title, item.category, image, description, item.slug],
      );
    } else {
      await client.query(
        `INSERT INTO listings(title,description,price,category,image_url,owner_id,condition,rent_price,deposit,location,delivery_available,delivery_charge,pickup_location_id,demo_slug)
        VALUES($1,$2,$3,$4,$5,$6,'Good',$7,$8,'Central Library',TRUE,20,'library-ground-floor-rental-counter-02',$9)`,
        [
          item.title,
          description,
          item.rent * 12,
          item.category,
          image,
          ownerId,
          item.rent,
          item.deposit,
          item.slug,
        ],
      );
    }
  }
}
module.exports = seedCatalog;
