// On phones an open sheet covers the bottom menu and hides the header until
// it closes (src/mobile-sheets.css). Journeys that switch screens close the
// open sheet first, as a player would, then tap the menu button.
export async function closeOpenSheet(page) {
  const close = page.locator(".main-panel .panel-heading .panel-close");
  if (await close.isVisible().catch(() => false)) await close.click();
  const toggle = page.locator(".main-panel .sheet-toggle[aria-expanded=true]");
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
}

export async function openScreen(page, name) {
  await closeOpenSheet(page);
  await page
    .getByRole("button", typeof name === "string" ? { name, exact: true } : { name })
    .first()
    .click();
}

// Settings is its own sheet behind the gear top right
// (src/SettingsScreen.tsx). Opens it and returns the sheet's content.
export async function openSettings(page) {
  const screen = page.locator(".settings-screen");
  if (await screen.isVisible().catch(() => false)) return screen;
  await closeOpenSheet(page);
  const toggle = page.locator(".map-settings-toggle");
  await toggle.waitFor({ timeout: 60_000 });
  await toggle.click();
  await screen.waitFor({ timeout: 30_000 });
  return screen;
}

// Wallets, devices, receipts and developer switches sit under "Advanced".
export async function openAdvancedSettings(page) {
  const screen = await openSettings(page);
  const advanced = screen.locator("#settings-advanced");
  if (!(await advanced.evaluate((d) => d.open))) await advanced.locator(":scope > summary").click();
  return screen;
}

// The play mode switch (city demo or GPS) is the first row of Settings.
// Opens it and returns the page, so a journey can write
// `(await openMapSettings(page)).getByRole(...)`. Choosing a mode closes the
// sheet; a journey that only reads it closes it with closeOpenSheet.
export async function openMapSettings(page) {
  await openSettings(page);
  return page;
}
