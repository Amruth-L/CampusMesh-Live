const browserToken = require("./browser-auth.cjs");
const { chromium } = require("playwright-core");
const fs = require("fs");
const assert = require("assert/strict");
const root = require("node:path").resolve(__dirname, "../..");
const fixture = JSON.parse(
  fs.readFileSync(
    require("node:path").join(
      require("node:os").tmpdir(),
      "cm-browser-fixtures.json",
    ),
  ),
);
const out = root + "/artifacts/review";
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) =>
    route.request().url().startsWith("http://127.0.0.1:5174") ||
    route.request().url().startsWith("data:")
      ? route.continue()
      : route.abort(),
  );
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = "http://127.0.0.1:5174";
  const measurements = [];
  async function signOut() {
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().endsWith("/logout"),
      ),
      page.getByRole("button", { name: "Log out", exact: true }).click(),
    ]);
    assert.equal(response.status(), 200);
    await page.waitForURL(base + "/");
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  async function shot(name) {
    await page.screenshot({ path: out + "/" + name + ".png", fullPage: false });
  }
  async function measure(screen) {
    const value = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      logout: (() => {
        const b = document.querySelector('[aria-label="Log out"]');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return {
          x: r.x,
          right: r.right,
          width: r.width,
          height: r.height,
          visible: r.left >= 0 && r.right <= innerWidth,
        };
      })(),
      unlabelled: [
        ...document.querySelectorAll(
          "input:not([type=hidden]),select,textarea",
        ),
      ]
        .filter((n) => !n.labels?.length && !n.getAttribute("aria-label"))
        .map((n) => n.outerHTML.slice(0, 120)),
    }));
    measurements.push({ screen, ...value });
    assert.ok(
      value.scrollWidth <= value.width + 1,
      screen + " overflow " + JSON.stringify(value),
    );
    assert.ok(value.logout?.visible, screen + " logout clipped");
    fs.writeFileSync(
      out + "/browser-results.json",
      JSON.stringify(
        { measurements, journeys: "in progress", pageErrors: errors },
        null,
        2,
      ),
    );
  }
  fixture.users[1].token = await browserToken(
    page.request,
    base,
    fixture.users[1],
  );
  fixture.users[0].token = await browserToken(
    page.request,
    base,
    fixture.users[0],
  );
  await page.goto(base);
  await page.evaluate(
    (token) => localStorage.setItem("token", token),
    fixture.users[1].token,
  );
  await page.goto(base + "/marketplace");
  await page.getByRole("button", { name: "Choose dates" }).first().waitFor();
  for (const width of [320, 360, 375, 390, 414, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await measure("marketplace");
  }
  await shot("marketplace-desktop");
  await page.setViewportSize({ width: 320, height: 720 });
  await shot("marketplace-mobile");
  const trigger = page.getByRole("button", { name: "Choose dates" }).first();
  await trigger.click();
  await page.getByRole("dialog").waitFor();
  assert.equal(
    await page.evaluate(() => document.activeElement.getAttribute("role")),
    "dialog",
  );
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page.evaluate(() =>
      document.querySelector("[role=dialog]").contains(document.activeElement),
    ),
    true,
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() =>
      document.activeElement.getAttribute("aria-label"),
    ),
    "Close rental dialog",
  );
  await page.getByLabel("Start date", { exact: true }).fill(today);
  await page.getByLabel("End date", { exact: true }).fill(today);
  await page.waitForFunction(
    () =>
      !document.querySelector("[role=dialog] button:last-child")?.disabled &&
      document
        .querySelector("[role=dialog]")
        ?.innerText.includes("After acceptance:"),
  );
  for (const width of [320, 360, 375, 390, 414, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await measure("rental-dialog");
    const sizes = await page
      .locator("[role=dialog] button[aria-pressed][aria-label]")
      .evaluateAll((nodes) =>
        nodes.map((n) => ({ w: n.offsetWidth, h: n.offsetHeight })),
      );
    assert.ok(sizes.every((s) => s.h >= 44));
  }
  await shot("rental-dialog-desktop");
  await page.setViewportSize({ width: 320, height: 720 });
  await shot("rental-dialog-mobile");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent.trim()),
    "Choose dates",
  );
  await trigger.click();
  await page.getByLabel("Start date", { exact: true }).fill(today);
  await page.getByLabel("End date", { exact: true }).fill(today);
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await page.getByText("Added to cart.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("heading", { name: "Booking Summary", exact: true, level: 1 })
    .waitFor();
  await page
    .getByRole("button", { name: "Send request", exact: false })
    .waitFor();
  assert.equal(await page.locator("#end-date").getAttribute("min"), today);
  assert.equal(await page.locator("#end-date").inputValue(), today);
  assert.ok(
    !(await page.locator("body").innerText()).includes(
      "Deposit due within 30 minutes",
    ),
  );
  for (const width of [320, 360, 375, 390, 414, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await measure("booking-summary");
  }
  await shot("summary-desktop");
  await page.setViewportSize({ width: 390, height: 720 });
  await shot("summary-mobile");
  // Failed quotes must not leave a stale payable amount enabled.
  await page.route("**/api/pricing/calculate", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Test quote unavailable" }),
    }),
  );
  await page
    .locator("#end-date")
    .fill(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(Date.now() + 86400000),
      ),
    );
  await page.getByText("Test quote unavailable").waitFor();
  assert.ok(
    await page
      .getByRole("button", { name: "Quote unavailable", exact: true })
      .isDisabled(),
  );
  await page.unroute("**/api/pricing/calculate");
  await page.locator("#end-date").fill(today);
  await page
    .getByRole("button", { name: "Send request", exact: false })
    .click();
  await page.waitForURL("**/rent-details/**");
  const rentalUrl = page.url();
  await page
    .getByText(/Waiting for|Lender|Owner|request/i)
    .first()
    .waitFor();
  // Owner acceptance, using a separate authenticated local browser context.
  const ownerContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  await ownerContext.route("**/*", (route) =>
    route.request().url().startsWith(base) ? route.continue() : route.abort(),
  );
  await ownerContext.addInitScript(
    (token) => localStorage.setItem("token", token),
    fixture.users[0].token,
  );
  const ownerPage = await ownerContext.newPage();
  const upiResponse = await ownerPage.request.put(base + "/api/direct-upi/profile", {
    headers: { Authorization: "Bearer " + fixture.users[0].token },
    data: { upi_id: "qa-lender@bank", payee_name: "QA Lender", confirm: true },
  });
  assert.equal(upiResponse.status(), 200);
  await ownerPage.goto(base + "/lend");
  await ownerPage
    .getByRole("button", { name: "Accept request", exact: true })
    .first()
    .click();
  await ownerPage
    .getByRole("link", { name: "Manage rental", exact: true })
    .first()
    .waitFor();
  await page.goto(rentalUrl);
  await page
    .getByText(/payment|UPI/i)
    .first()
    .waitFor();
  await shot("accepted-rental-mobile");
  // Same shared listing form on edit, values survive save/reload, no fabricated metrics.
  await page.evaluate(
    (token) => localStorage.setItem("token", token),
    fixture.users[0].token,
  );
  await page.goto(base + "/edit-listing/" + fixture.items[0]);
  await page.getByLabel("Daily rent (₹)", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Daily rent (₹)", { exact: true }).inputValue(),
    "20.55",
  );
  assert.equal(
    await page.getByText("Availability timeframe", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByText("Trust score: 98", { exact: false }).count(),
    0,
  );
  await page.getByLabel("Daily rent (₹)", { exact: true }).fill("21.75");
  await page.getByLabel("Security Deposit (₹)", { exact: true }).fill("80.25");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Changes saved.", { exact: true }).waitFor();
  await page.reload();
  await page.getByLabel("Daily rent (₹)", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Daily rent (₹)", { exact: true }).inputValue(),
    "21.75",
  );
  for (const width of [320, 360, 375, 390, 414, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await measure("edit-listing");
  }
  await shot("edit-listing-desktop");
  await page.setViewportSize({ width: 375, height: 720 });
  await shot("edit-listing-mobile");
  console.log("PASS edit, 32 width checks");
  await page.goto(base + "/account/settings");
  await page.getByRole("heading", { name: "Account settings" }).waitFor();
  assert.equal(
    await page.getByText("Total rentals", { exact: true }).count(),
    0,
  );
  await measure("settings");
  await shot("settings-mobile");
  // Short landscape and larger text simulate constrained layouts, not a physical keyboard.
  await page.setViewportSize({ width: 768, height: 320 });
  await measure("settings-landscape");
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  await measure("settings-200-percent-text");
  await page.evaluate(() => (document.documentElement.style.fontSize = ""));
  await page.goto(base + "/payouts");
  await page
    .getByRole("heading", { name: /Payments/ })
    .first()
    .waitFor();
  assert.equal(
    await page
      .locator('nav[aria-label="Mobile workspaces"] [aria-current=page]')
      .count(),
    0,
  );
  await measure("payments");
  console.log("PASS settings, text scale, payments");
  // Sign-in real local endpoint; recovery is validated without sending email.
  await signOut();
  await page.goto(base + "/login");
  await page
    .getByRole("textbox", { name: /email/i })
    .fill(fixture.users[1].id + "@dbit.co.in");
  await page.getByLabel("Password", { exact: true }).fill("review-password");
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"));
  await signOut();
  await page.goto(base + "/forgot-password");
  await page
    .getByRole("textbox", { name: /email/i })
    .fill("personal@gmail.com");
  await page.getByRole("button", { name: /send.*code/i }).click();
  await page
    .getByText("Enter your DBIT campus email.", { exact: true })
    .waitFor();
  console.log("PASS local sign-in and recovery validation");
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    out + "/browser-results.json",
    JSON.stringify(
      { measurements, journeys: "passed", pageErrors: errors },
      null,
      2,
    ),
  );
  console.log("PASS browser journeys", measurements.length, "viewport checks");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
