const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const base = 'http://127.0.0.1:8891';
const swPath = '/home/user/questlayer-hackathon/dist/sw.js';
(async () => {
  const b = await chromium.launch();
  for (const [w,h] of [[360,780],[390,844],[844,390],[1280,800]]) {
    const orig = fs.readFileSync(swPath,'utf8');
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('PAGEERR', e.message));
    await p.goto(base); await p.waitForTimeout(1500);
    const name = p.getByPlaceholder('Your explorer name');
    if (await name.count()) { await name.fill('Tester'); await p.getByRole('button', { name: /start exploring/i }).click(); }
    await p.waitForTimeout(3000);
    await p.evaluate(() => navigator.serviceWorker.ready);
    // install prompt: Chrome fires beforeinstallprompt only for real installability; simulate the event.
    await p.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = async () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); });
    const t = p.locator('.sheet-toggle'); if (await t.isVisible() && (await t.getAttribute('aria-expanded'))==='false') { await t.click(); await p.waitForTimeout(600); }
    const card = p.locator('.install-nudge'); if (await card.count()) await card.scrollIntoViewIfNeeded();
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${out}/${w}x${h}-install.png` });
    // ship a "new version": change the worker and come back to the tab
    fs.writeFileSync(swPath, orig.replace('questlayer-shell-v2', 'questlayer-shell-v2-next'));
    await p.reload(); await p.waitForTimeout(3000);
    const toast = p.locator('.update-toast');
    console.log(w, 'update toast visible:', await toast.isVisible());
    await p.screenshot({ path: `${out}/${w}x${h}-update.png` });
    if (await toast.isVisible()) { await p.getByRole('button', { name: 'Reload' }).click(); await p.waitForTimeout(3000); console.log(w,'after reload toast:', await toast.isVisible()); }
    fs.writeFileSync(swPath, orig);
    await ctx.setOffline(true);
    await p.reload().catch(e => console.log('offline reload', e.message)); await p.waitForTimeout(3000);
    await p.screenshot({ path: `${out}/${w}x${h}-offline.png` });
    await ctx.close();
  }
  await b.close();
})();
