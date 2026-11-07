import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportGeographyRegion, planSourceRegions } from '../server/world-preparation/export.mjs';
const [mode, configPath] = process.argv.slice(2);
if (!['plan', 'export'].includes(mode) || !configPath) throw Error('Use plan|export <isolated-config.json>.');
const config = JSON.parse(readFileSync(resolve(configPath)));
if (mode === 'plan') {
  const plan = await planSourceRegions(config);
  writeFileSync(resolve(config.output), JSON.stringify(plan, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ plans: plan.plans.length, omitted: plan.omitted.length }));
} else {
  const result = await exportGeographyRegion(config);
  console.log(JSON.stringify({ catalogFile: result.catalogFile, roles: Object.fromEntries(Object.entries(result.report).map(([r, v]) => [r, v.output])) }));
}
