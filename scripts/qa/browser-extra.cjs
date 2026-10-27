const browserToken = require("./browser-auth.cjs");
const { chromium } = require("playwright-core");
const fs = require("fs");
const assert = require("assert/strict");
const fixture = JSON.parse(
  fs.readFileSync(
    require("node:path").join(
      require("node:os").tmpdir(),
      "cm-browser-fixtures.json",
    ),
  ),
);
const root = require("node:path").resolve(__dirname, "../.."),
  out = root + "/artifacts/review",
  base = "http://127.0.0.1:5174";
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 720 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
  });
  await ctx.route("**/*", (r) =>
    r.request().url().startsWith(base) || r.request().url().startsWith("data:")
      ? r.continue()
      : r.abort(),
  );
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  fixture.users[0].token = await browserToken(
    page.request,
    base,
    fixture.users[0],
  );
  await page.goto(base);
  await page.evaluate(
    (t) => localStorage.setItem("token", t),
    fixture.users[0].token,
  );
  await page.goto(base + "/add-listing");
  await page
    .getByLabel("Product Title *", { exact: true })
    .fill("QA created listing with decimal prices");
  await page
    .getByLabel("Description *", { exact: true })
    .fill("Disposable local browser test");
  await page.getByLabel("Item value (₹)", { exact: true }).fill("350.99");
  await page.getByLabel("Daily rent (₹)", { exact: true }).fill("12.35");
  await page.getByLabel("Security Deposit (₹)", { exact: true }).fill("75.25");
  await page
    .getByLabel("Select On-Campus Pickup Location *", { exact: true })
    .selectOption({ index: 1 });
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(root + "/frontend/public/images/categories/books.png");
  await page.getByText("Cover", { exact: true }).waitFor();
  // Recoverable server failure keeps all input and pictures.
  await page.route("**/listings", (r) =>
    r.request().method() === "POST"
      ? r.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Temporary test failure. Retry." }),
        })
      : r.continue(),
  );
  await page
    .getByRole("button", { name: "Publish listing", exact: true })
    .tap();
  await page
    .getByText("Temporary test failure. Retry.", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("Daily rent (₹)", { exact: true }).inputValue(),
    "12.35",
  );
  await page.unroute("**/listings");
  const saved = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/listings"),
  );
  await page
    .getByRole("button", { name: "Publish listing", exact: true })
    .tap();
  const response = await saved;
  assert.equal(response.status(), 201);
  const made = await response.json();
  await page.getByText("Listing published.", { exact: true }).waitFor();
  await page.goto(base + "/edit-listing/" + made.id);
  await page.getByLabel("Daily rent (₹)", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Daily rent (₹)", { exact: true }).inputValue(),
    "12.35",
  );
  assert.equal(
    await page.getByLabel("Security Deposit (₹)", { exact: true }).inputValue(),
    "75.25",
  );
  await page.getByLabel("Daily rent (₹)", { exact: true }).fill("13.45");
  await page.getByRole("button", { name: "Save changes", exact: true }).tap();
  await page.getByText("Changes saved.", { exact: true }).waitFor();
  await page.reload();
  await page.getByLabel("Daily rent (₹)", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Daily rent (₹)", { exact: true }).inputValue(),
    "13.45",
  );
  await page
    .getByLabel("Daily rent (₹)", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: out + "/edit-pricing-mobile.png" });
  console.log(
    "PASS create/photo/failure/retry/edit/reload with simulated touch",
  );
  await page.setViewportSize({ width: 390, height: 360 });
  await page
    .getByRole("button", { name: "Save changes", exact: true })
    .scrollIntoViewIfNeeded();
  const reachable = await page
    .getByRole("button", { name: "Save changes", exact: true })
    .evaluate((n) => {
      const r = n.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: innerHeight };
    });
  assert.ok(reachable.top >= 0 && reachable.bottom < reachable.height - 64);
  console.log("PASS short viewport action reachability", reachable);
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto(base + "/marketplace");
  await page.getByRole("button", { name: "Choose dates" }).first().waitFor();
  await page.evaluate(() => window.scrollTo(0, 400));
  const before = await page.evaluate(() => scrollY);
  await page
    .getByRole("link", { name: "Payments", exact: true })
    .first()
    .click();
  await page
    .getByRole("heading", { name: /Payments/ })
    .first()
    .waitFor();
  const forward = await page.evaluate(() => scrollY);
  assert.equal(forward, 0);
  await page.goBack();
  await page.getByRole("button", { name: "Choose dates" }).first().waitFor();
  const after = await page.evaluate(() => scrollY);
  console.log("SCROLL", { before, forward, after });
  const colorData = await page.evaluate(() => {
    const el = [...document.querySelectorAll("button")].find((n) =>
      n.textContent.includes("Choose dates"),
    );
    return {
      button: getComputedStyle(el).color,
      buttonBackground: getComputedStyle(el).backgroundColor,
      muted: getComputedStyle(document.documentElement)
        .getPropertyValue("--text-muted")
        .trim(),
      width: innerWidth,
      height: innerHeight,
      touch: navigator.maxTouchPoints,
    };
  });
  await page.screenshot({ path: out + "/marketplace-touch-mobile.png" });
  fs.writeFileSync(
    out + "/browser-extra-results.json",
    JSON.stringify(
      {
        createEdit: "passed",
        recoverableFailure: "passed",
        shortViewport: reachable,
        scroll: { before, forward, after },
        renderedColors: colorData,
        physicalDevice: false,
      },
      null,
      2,
    ),
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
