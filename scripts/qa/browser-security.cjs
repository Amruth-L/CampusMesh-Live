const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const browserToken = require("./browser-auth.cjs");
const root = path.resolve(__dirname, "../..");
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(require("node:os").tmpdir(), "cm-browser-fixtures.json"),
  ),
);
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 375, height: 720 },
    });
    const base = "http://127.0.0.1:5174";
    await context.route("**/*", (route) =>
      route.request().url().startsWith(base) ||
      route.request().url().startsWith("data:")
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const token = await browserToken(page.request, base, fixture.users[2]);
    await page.goto(base);
    await page.evaluate((value) => localStorage.setItem("token", value), token);
    await page.goto(base + "/account/settings");
    await page.getByRole("heading", { name: "Account settings" }).waitFor();
    const other = await context.newPage();
    await other.goto(base + "/account/settings");
    await other.getByRole("heading", { name: "Account settings" }).waitFor();
    await page.route("**/logout", (route) => route.abort());
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Could not sign out securely." })
      .waitFor();
    await page.screenshot({ path: root + "/artifacts/review/logout-retry-mobile.png" });
    assert.equal(
      await page.evaluate(() => Boolean(localStorage.getItem("token"))),
      true,
    );
    assert.equal(
      (
        await page.request.get(base + "/me", {
          headers: { Authorization: "Bearer " + token },
        })
      ).status(),
      200,
    );
    await page.unroute("**/logout");
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().endsWith("/logout"),
      ),
      page.getByRole("button", { name: "Log out", exact: true }).click(),
    ]);
    assert.equal(response.status(), 200);
    await page.waitForURL(base + "/");
    await other.waitForURL(base + "/login");
    await other.screenshot({ path: root + "/artifacts/review/logout-other-tab-mobile.png" });
    assert.equal(
      (
        await page.request.get(base + "/me", {
          headers: { Authorization: "Bearer " + token },
        })
      ).status(),
      403,
    );
    console.log(
      "PASS mobile logout failure/retry, cross-tab sign-out and copied-token rejection",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
