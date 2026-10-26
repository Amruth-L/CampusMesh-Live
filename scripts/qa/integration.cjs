const root = require("node:path").resolve(__dirname, "../..");
const { Pool } = require(root + "/backend/node_modules/pg");
const { spawnSync } = require("child_process");
const fs = require("fs");
const { randomUUID } = require("crypto");
(async () => {
  const base = process.env.REVIEW_DATABASE_URL;
  const parsed = new URL(base);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.pathname !== "/campusmesh_review"
  )
    throw new Error("Use the disposable local campusmesh_review database.");
  fs.mkdirSync(root + "/artifacts/review", { recursive: true });
  const admin = new Pool({ connectionString: base });
  const files = [
    "direct-upi",
    "handover-evidence",
    "cart-checkout",
    "rental-booking",
    "rental-payment-recovery",
    "delivery-payment-completion",
    "open-delivery-return",
    "listing-deletion",
  ];
  for (const file of files) {
    const schema = "qa_suite_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(base);
    url.searchParams.set("options", `-c search_path=${schema}`);
    const db = new Pool({ connectionString: url.toString() });
    try {
      for (const f of fs
        .readdirSync(root + "/backend/src/db/migrations")
        .filter((n) => /^\d{3}_.+\.sql$/.test(n))
        .sort())
        await db.query(
          fs.readFileSync(root + "/backend/src/db/migrations/" + f, "utf8"),
        );
      const flags = {
        EVIDENCE_E2E: "1",
        CART_CHECKOUT_E2E: "1",
        RENTAL_BOOKING_E2E: "1",
        RENTAL_PAYMENT_RECOVERY_E2E: "1",
        DELIVERY_PAYMENT_E2E: "1",
        OPEN_DELIVERY_E2E: "1",
        LISTING_DELETION_E2E: "1",
      };
      const run = spawnSync(
        process.execPath,
        ["--test", `backend/test/${file}.contract.test.js`],
        {
          cwd: root,
          env: {
            PATH: process.env.PATH,
            DATABASE_URL: url.toString(),
            JWT_SECRET: "local-suite-only",
            CALLS_MODE: "preview",
            DIRECT_UPI_ENABLED: [
              "rental-booking",
              "rental-payment-recovery",
              "cart-checkout",
            ].includes(file)
              ? "false"
              : "true",
            ...flags,
          },
          encoding: "utf8",
          timeout: 180000,
        },
      );
      fs.writeFileSync(
        root + "/artifacts/review/" + file + ".log",
        run.stdout + run.stderr,
      );
      console.log(
        file,
        run.status,
        run.stdout.match(/ℹ (?:pass|fail|skipped) \d+/g)?.join(", "),
      );
      if (run.status !== 0) process.exitCode = 1;
    } finally {
      await db.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
  }
  await admin.end();
})();
