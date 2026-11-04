const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const base = 'http://127.0.0.1:5173';
const NEAR = 10n ** 24n;
const cfg = { setup_deposit: (NEAR/10n*3n).toString(), vault_reserve: (NEAR/4n).toString(), factory_storage: (NEAR/20n).toString(), created: 3, capacity: 50 };
const pools = [{ id: 'aurora.pool.f863973.m0', name: 'Aurora' }];
const active = { id: 'pos1', account_id: 'v1.factory.testnet', beneficiary: 'x', pool: pools[0].id, contribution_bps: 5000, state: 'registered', position: { stage: 'idle', principal: (5n*NEAR).toString(), staked: (5n*NEAR).toString(), owner_pending: '0', game_pending: '0', owner_credit: '0', game_credit: '0', exit_requested: false, epoch: 100 } };
const economy = { status: 'observed', treasury: { status: 'observed', observedAt: null, data: null }, staking: { status: 'observed', observedAt: null, data: { complete: true, totals: { principal: (55n*NEAR/10n).toString(), weightedStake: (3n*NEAR).toString(), realizedGameYieldPaid: '0' }, stakers: 2, coverage: {registeredPositions:2, observedPositions:2}, poolBalances: null, phases: {}, pools: [], outlook: { reason: '' } } }, worker: { status: 'idle', queued: 0 } };
(async () => {
  const b = await chromium.launch();
  for (const scenario of ['new', 'active']) for (const [w,h] of [[360,780],[390,844],[844,390],[1280,800]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('PAGEERR', e.message));
    await p.route(u => u.pathname === '/api/me' || u.pathname === '/api/session', async route => { const r = await route.fetch(); let j; try { j = await r.json(); } catch { return route.fulfill({ response: r }); } if (j.player) j.player.wallets = [{ account_id: 'ada.testnet' }]; await route.fulfill({ response: r, json: j }); });
    await p.route('**/api/native/vaults*', r => r.fulfill({ json: { network: 'testnet', factoryId: 'f.testnet', config: cfg, pools, positions: scenario === 'active' ? [active] : [], refund: null } }));
    await p.route('**/api/native/vaults/prepare', r => r.fulfill({ status: 503, json: { error: 'Staking is paused on this test server.' } }));
    await p.route('**/api/native/economy', r => r.fulfill({ json: economy }));
    await p.goto(base); await p.waitForTimeout(1500);
    const name = p.getByPlaceholder('Your explorer name');
    if (await name.count()) { await name.fill('Ada'); await p.getByRole('button', { name: /start exploring/i }).click(); }
    await p.waitForTimeout(3500);
    await p.getByRole('button', { name: 'Profile', exact: true }).first().click(); await p.waitForTimeout(800);
    await p.getByRole('button', { name: /fuel the city/i }).click(); await p.waitForTimeout(1500);
    const tag = `${scenario}-${w}x${h}`;
    await p.screenshot({ path: `${out}/${tag}.png` });
    const action = p.locator('.fuel-action');
    if (await action.count()) { await action.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${out}/${tag}-action.png` }); }
    if (scenario === 'active' && w === 390) {
      await p.locator('.fuel-amount input').fill('50');
      await p.waitForTimeout(300);
      await p.screenshot({ path: `${out}/${tag}-preview.png` });
      await p.locator('.fuel-action .primary-button').click(); await p.waitForTimeout(2000);
      await p.screenshot({ path: `${out}/${tag}-wallet-fallback.png` });
      const back = p.getByRole('button', { name: 'Back', exact: true }); if (await back.count()) { await back.click(); await p.waitForTimeout(1200); }
      await p.locator('.fuel-action').scrollIntoViewIfNeeded();
      await p.screenshot({ path: `${out}/${tag}-failed.png` });
    }
    await ctx.close();
  }
  await b.close();
})();
