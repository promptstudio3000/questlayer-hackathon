import { readFileSync, writeFileSync } from 'node:fs';
import { buildLaunchScope } from '../server/world-preparation/launch-scope.mjs';
import { canonical, sha256 } from '../server/world-preparation/canonical.mjs';
if (![6,7].includes(process.argv.length)||process.argv.length===7&&process.argv[6]!=='--eu-only') throw Error('Use prepare-launch-scope.mjs <index.json> <cities15000.txt> <cities15000.zip> <output.json> [--eu-only].');
const [indexFile,citiesFile,zipFile,output]=process.argv.slice(2),indexBytes=readFileSync(indexFile);
const scope=buildLaunchScope({index:JSON.parse(indexBytes),indexBytes,citiesText:readFileSync(citiesFile,'utf8'),citiesSha256:sha256(readFileSync(zipFile)),selection:process.argv.includes('--eu-only')?'eu-only':'global-launch'});
writeFileSync(output,canonical(scope)+'\n',{flag:'wx'});
console.log(JSON.stringify({hash:scope.hash,sources:scope.sources.length,capitals:scope.capitals.length,unmappedCapitals:scope.unmappedCapitals.length}));
