import { resolve } from "node:path";
import { prepareGeographicDay } from "../server/world-preparation/geography.mjs";
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--catalog", "--out", "--day"].includes(args[i]) || !args[i + 1] || options[args[i]]) throw Error("Use --catalog <catalog.json> --out <days-directory> --day YYYY-MM-DD.");
  options[args[i]] = args[i + 1];
}
if (Object.keys(options).length !== 3) throw Error("--catalog, --out and --day are required.");
const result = await prepareGeographicDay({ catalogFile: resolve(options["--catalog"]), outputDir: resolve(options["--out"]), day: options["--day"] });
console.log(JSON.stringify(result, null, 2));
if (result.state !== "content-prepared") process.exitCode = 2;
