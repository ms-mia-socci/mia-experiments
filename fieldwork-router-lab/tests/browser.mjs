import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto("http://127.0.0.1:5373");
await page.getByRole("button", { name: /Mia Socci/ }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: ".local/landing.png", fullPage: true });
console.log("landing", await page.locator("h1").innerText());
await page
  .getByPlaceholder("Tell us what you want to get done…")
  .fill(
    "I want a short explanation of what AG-UI is, based on your existing knowledge, without browsing. Please recommend Claude for this writing task.",
  );
await page.getByRole("button", { name: "Submit", exact: true }).click();
await page
  .getByRole("button", { name: "Start with Claude", exact: true })
  .waitFor({ timeout: 90000 });
console.log(
  "recommendation",
  await page.locator(".recommendation").innerText(),
);
await page.screenshot({ path: ".local/recommendation.png", fullPage: true });
await page
  .getByRole("button", { name: "Start with Claude", exact: true })
  .click();
await page.waitForFunction(
  () => document.querySelector(".run-status")?.textContent === "Ready",
  {},
  { timeout: 90000 },
);
console.log("claude", await page.locator(".chat-messages").innerText());
await page.screenshot({ path: ".local/handoff.png", fullPage: true });
await page
  .getByPlaceholder("Message Claude Agent SDK…")
  .fill(
    "Save a text file called poc-proof.txt containing exactly: Fieldwork handoff works.",
  );
await page.getByRole("button", { name: "Submit", exact: true }).click();
await page
  .getByRole("button", { name: "Approve save", exact: true })
  .waitFor({ timeout: 90000 });
await page.getByRole("button", { name: "Approve save", exact: true }).click();
await page.waitForFunction(
  () => document.querySelector(".run-status")?.textContent === "Ready",
  {},
  { timeout: 90000 },
);
await page.getByRole("button", { name: /^Files/ }).click();
console.log("files", await page.locator(".inspector-content").innerText());
const link = page.getByRole("link", {
  name: "Download poc-proof.txt",
  exact: true,
});
console.log(
  "download",
  await (
    await page.request.get(
      new URL(await link.getAttribute("href"), "http://127.0.0.1:5373").href,
    )
  ).text(),
);
await page.reload();
await page.waitForTimeout(2000);
console.log("reload", await page.locator(".chat-panel").getAttribute("aria-label"));
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Toggle behind the work" }).click();
await page.screenshot({ path: ".local/mobile.png", fullPage: true });
await browser.close();
