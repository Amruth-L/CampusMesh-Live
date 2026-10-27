const browserToken = require("./browser-auth.cjs");
const { chromium } = require("playwright-core");
const fs = require("fs"),
  assert = require("assert/strict");
const f = JSON.parse(
    fs.readFileSync(
      require("node:path").join(
        require("node:os").tmpdir(),
        "cm-browser-fixtures.json",
      ),
    ),
  ),
  root = require("node:path").resolve(__dirname, "../.."),
  base = "http://127.0.0.1:5174";
(async () => {
  const b = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const c = await b.newContext({ viewport: { width: 375, height: 720 } });
  await c.route("**/*", (r) =>
    r.request().url().startsWith(base) ? r.continue() : r.abort(),
  );
  const future = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date(Date.now() + 14 * 86400000));
  const p = await c.newPage();
  p.setDefaultTimeout(10000);
  f.users[1].token = await browserToken(p.request, base, f.users[1]);
  await p.goto(base);
  await p.evaluate((t) => localStorage.setItem("token", t), f.users[1].token);
  const headers = { Authorization: "Bearer " + f.users[1].token };
  for (const row of await (
    await p.request.get(base + "/api/cart", { headers })
  ).json())
    await p.request.delete(base + "/api/cart/" + row.id, { headers });
  for (const id of f.items) {
    const res = await p.request.post(base + "/api/cart/add", {
      headers,
      data: { item_id: id, start_date: future, end_date: future },
    });
    assert.equal(res.status(), 201);
  }
  await p.goto(base + "/cart");
  await p
    .getByRole("button", { name: "Continue to checkout", exact: true })
    .waitFor();
  await p.screenshot({ path: root + "/artifacts/review/cart-mobile.png" });
  await p
    .getByRole("button", { name: "Continue to checkout", exact: true })
    .click();
  await p.getByRole("heading", { name: "Request your rentals" }).waitFor();
  let failures = 1,
    count = 0;
  await p.route("**/api/rentals/book", (r) => {
    count++;
    if (failures-- > 0)
      return r.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Temporary request failure. Retry this item.",
        }),
      });
    return r.continue();
  });
  await p
    .getByRole("button", { name: "Send rental requests — no payment now" })
    .click();
  await p
    .getByText("Temporary request failure. Retry this item.", { exact: true })
    .waitFor();
  await p
    .getByRole("link", { name: "Request sent — view rental", exact: true })
    .waitFor();
  await p
    .getByRole("button", { name: "Send rental requests — no payment now" })
    .click();
  await p.waitForFunction(
    () =>
      [...document.querySelectorAll("a")].filter(
        (n) => n.textContent === "Request sent — view rental",
      ).length === 2,
  );
  assert.equal(count, 3);
  assert.ok(
    await p
      .getByRole("button", { name: "Send rental requests — no payment now" })
      .isDisabled(),
  );
  await p.screenshot({
    path: root + "/artifacts/review/cart-recovery-mobile.png",
  });
  console.log(
    "PASS cart partial failure, retry skips successful item (3 requests, 2 rentals)",
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
