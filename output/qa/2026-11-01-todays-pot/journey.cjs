const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const base = 'http://127.0.0.1:5173';
const proof = fs.readFileSync('/home/user/questlayer-hackathon/public/native-distribution-proof.json','utf8');
const sizes = [[360,780],[390,844],[844,390],[1280,800]];
(async () => {
  const b = await chromium.launch();
  for (const native of (process.env.ONLY==="native"?[true]:[false,true])) for (const [w,h] of sizes) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('PAGEERR', e.message));
    if (native) {
      await p.route('**/api/native/distribution*', r => r.fulfill({ contentType:'application/json', body: proof }));
      await ctx.addInitScript(() => localStorage.setItem('questlayer-play-mode','near'));
    }
    await p.goto(base); await p.waitForTimeout(1500);
    const name = p.getByPlaceholder('Your explorer name');
    if (await name.count()) { await name.fill('Tester'); await p.getByRole('button', { name: /start exploring/i }).click(); }
    await p.waitForTimeout(4000);
    const t = p.locator('.sheet-toggle'); if (await t.count() && await t.isVisible() && (await t.getAttribute('aria-expanded'))==='false') { await t.click(); await p.waitForTimeout(700); }
    const pot = p.locator('.todays-pot').first();
    if (await pot.count()) { await pot.scrollIntoViewIfNeeded(); await p.waitForTimeout(500); }
    const tag = `${native?'native':'practice'}-${w}x${h}`;
    await p.screenshot({ path: `${out}/${tag}-explore.png` });
    if (await pot.count() && await pot.isVisible()) { await pot.click(); await p.waitForTimeout(1500); await p.screenshot({ path: `${out}/${tag}-funded.png` }); }
    else console.log('no pot', tag);
    await ctx.close();
  }
  await b.close();
})();
