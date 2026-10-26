const root = require("node:path").resolve(__dirname, "../..");
const reviewUrl = process.env.REVIEW_DATABASE_URL;
const target = new URL(reviewUrl);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/campusmesh_review"
)
  throw new Error("Use the disposable local campusmesh_review database.");
for (const key of Object.keys(process.env))
  if (!["PATH", "HOME", "TMPDIR"].includes(key)) delete process.env[key];
Object.assign(process.env, {
  DATABASE_URL: reviewUrl,
  JWT_SECRET: "browser-local-review-only",
  PORT: "5174",
  SERVE_FRONTEND: "true",
  DIRECT_UPI_ENABLED: "true",
  CALLS_MODE: "preview",
  CALLS_SCHEDULER_ENABLED: "false",
});
const schema = "qa_browser_" + Date.now();
const photos = require(root + "/backend/src/modules/listings/photo-storage");
photos.prepare = async ({ images, cover }) => ({ images, cover });
photos.keyFor = () => null;
(async () => {
  const db = require(root + "/backend/src/config/database");
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.end();
  const Pool = require(root + "/backend/node_modules/pg").Pool;
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  require.cache[
    require.resolve(root + "/backend/src/config/database")
  ].exports = new Pool({ connectionString: url.toString() });
  await require(root + "/backend/src/db/migrate")();
  const actual = require(root + "/backend/src/config/database");
  const { randomUUID } = require("crypto");
  const bcrypt = require(root + "/backend/node_modules/bcrypt");
  const hash = await bcrypt.hash("review-password", 10);
  const users = [];
  for (const name of [
    "QA Lender With A Long Name",
    "QA Renter",
    "QA Courier",
  ]) {
    const id = randomUUID();
    await actual.query(
      "INSERT INTO users(id,name,email,password,email_verified,username) VALUES($1,$2,$3,$4,true,$5)",
      [id, name, id + "@dbit.co.in", hash, "qa_" + id.slice(0, 8)],
    );
    users.push({
      id,
      name,
      token: require(root + "/backend/node_modules/jsonwebtoken").sign(
        { id },
        process.env.JWT_SECRET,
      ),
    });
  }
  const items = [];
  for (const title of [
    "Calculus textbook for a one-day rental",
    "Long title: laboratory equipment with a protective case and complete accessories",
  ]) {
    const id = randomUUID();
    await actual.query(
      "INSERT INTO listings(id,owner_id,title,description,category,location,rent_price,price,deposit,delivery_available,delivery_charge,image_url) VALUES($1,$2,$3,'Disposable local review fixture','Books','Central Library',20.55,500,100,true,10,$4)",
      [id, users[0].id, title, "/images/categories/books.png"],
    );
    items.push(id);
  }
  await actual.query(
    "UPDATE listings SET pickup_location_id=(SELECT id FROM campus_locations WHERE building_name='Central Library' LIMIT 1)",
  );
  require("fs").writeFileSync(
    require("node:path").join(
      require("node:os").tmpdir(),
      "cm-browser-fixtures.json",
    ),
    JSON.stringify({ users, items }),
  );
  // This process owns only its generated qa_ schema. Never drop another schema.
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await actual.query(`DROP SCHEMA "${schema}" CASCADE`);
      await actual.end();
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  require(root + "/backend/src/server");
})();
