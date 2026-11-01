const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const base = process.env.BASE || 'http://127.0.0.1:5173';
const minted = process.env.MINTED === '1';
(async () => {
  const b = await chromium.launch();
  const [w,h] = (process.env.SIZE||'390x844').split('x').map(Number);
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  if (minted) {
    const patch = async (route) => { const r = await route.fetch(); const j = await r.json(); const pl = j.player; if (pl) pl.inventory = pl.inventory.map(i => i.kind==='aura' ? { ...i, native_claim_state: 'minted' } : i); await route.fulfill({ response: r, json: j }); };
    await p.route(u => u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/identity') && !u.pathname.startsWith('/api/events'), async (route) => { const r = await route.fetch(); let j; try { j = await r.json(); } catch { return route.fulfill({ response: r }); } const fix = pl => { if (pl && pl.inventory) pl.inventory = pl.inventory.map(i => i.kind==='aura' ? { ...i, native_claim_state: 'minted' } : i); }; fix(j.player); await route.fulfill({ response: r, json: j }); });
    await p.route('**/api/identity/sessions', r => r.fulfill({ json: { sessions: [], recovery: { demoPasskeys: 0, nearAccounts: [] } } }));
  }
  await p.goto(base); await p.waitForTimeout(1500);
  const name = p.getByPlaceholder('Your explorer name');
  if (await name.count()) { await name.fill('Ada'); await p.getByRole('button', { name: /start exploring/i }).click(); }
  await p.waitForTimeout(4000);
  await p.locator('.recommended-quest').first().click(); await p.waitForTimeout(1200);
  const tag = `${w}x${h}${minted?'-secured':''}`;
  for (let i = 0; i < 6; i++) {
    const btns = await p.locator('main button').allInnerTexts();
    const walk = p.getByRole('button', { name: /walk there/i });
    const open = p.getByRole('button', { name: /open chest|open the chest|collect|finish/i });
    if (await open.count() && await open.first().isEnabled()) { await open.first().click(); await p.waitForTimeout(2500); break; }
    if (await walk.count()) { await walk.first().click(); await p.waitForTimeout(6000); continue; }
    console.log('buttons', btns.join(' | ').slice(0, 400)); break;
  }
  await p.screenshot({ path: `${out}/${tag}-result.png` });
  const dlg = p.locator('dialog[open] .adventure-results-dialog');
  if (await dlg.count()) {
    const share = p.getByRole('button', { name: /share your aura/i });
    await share.scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${out}/${tag}-result-actions.png` });
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }).catch(() => null), share.click()]);
    if (dl) { await dl.saveAs(`${out}/share-card${minted?'-secured':''}.png`); console.log('card saved'); }
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/${tag}-after-share.png` });
    const nudge = p.locator('.passkey-nudge');
    if (await nudge.count()) { await nudge.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${out}/${tag}-passkey-nudge.png` }); }
  } else console.log('no dialog');
  await b.close();
})();
