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

// The play mode switch (city demo or GPS) lives in Map settings behind the
// gear top right (src/MapSettings.tsx). Opens it and returns the page, so a
// journey can write `(await openMapSettings(page)).getByRole(...)`.
export async function openMapSettings(page) {
  const toggle = page.locator(".map-settings-toggle");
  await toggle.waitFor({ timeout: 60_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return page;
}
