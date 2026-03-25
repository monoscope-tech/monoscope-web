import { test, expect } from "@playwright/test";

test.describe("React integration", () => {
  test.beforeEach(async ({ page }) => {
    // Collect console messages for assertions
    page.on("console", () => {});
    await page.goto("/");
  });

  test("renders with Monoscope session ID", async ({ page }) => {
    const session = page.locator("code");
    await expect(session).toHaveText(/^[0-9a-f-]{36}$/);
  });

  test("Record Event button logs to debug", async ({ page }) => {
    const logs: string[] = [];
    page.on("console", (msg) => logs.push(msg.text()));

    await page.getByRole("button", { name: "Record Event" }).click();
    // Debug mode logs span emissions
    expect(logs.some((l) => l.includes("Monoscope") || l.includes("button_click"))).toBe(true);
  });

  test("Set User button calls setUser", async ({ page }) => {
    const logs: string[] = [];
    page.on("console", (msg) => logs.push(msg.text()));

    await page.getByRole("button", { name: "Set User" }).click();
    // Debug mode warns about unknown user attrs or logs setUser
    await expect(page.locator("pre")).toContainText("Set user: user-42");
  });

  test("Custom Span button creates a span", async ({ page }) => {
    await page.getByRole("button", { name: "Custom Span" }).click();
    await expect(page.locator("pre")).toContainText("Custom span executed");
  });

  test("Error Boundary catches thrown error and shows fallback", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.getByRole("button", { name: "Trigger Error Boundary" }).click();
    await expect(page.getByText("Error caught by MonoscopeErrorBoundary")).toBeVisible();
  });

  test("Strict Mode: provider initializes only once", async ({ page }) => {
    const logs: string[] = [];
    page.on("console", (msg) => logs.push(msg.text()));

    // Wait for initial load to settle
    await page.waitForTimeout(500);
    // Session ID should be stable (displayed once in the UI)
    const sessionTexts = await page.locator("code").allTextContents();
    expect(sessionTexts).toHaveLength(1);
    expect(sessionTexts[0]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
