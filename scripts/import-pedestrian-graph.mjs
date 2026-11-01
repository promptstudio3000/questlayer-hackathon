import { readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { importPedestrianGraph } from "../server/spatial/pedestrian-graph.mjs";
import { assert } from "../server/domain.mjs";

const args = process.argv.slice(2),
  options = {};
for (let i = 0; i < args.length; i += 2) {
  assert(
    ["--input", "--output", "--city", "--exclusions"].includes(args[i]) &&
      args[i + 1] &&
      !options[args[i]],
    "Use --input OSM_JSON --output GRAPH_JSON --city CITY_ID [--exclusions JSON].",
  );
  options[args[i]] = args[i + 1];
}
assert(
  options["--input"] && options["--output"] && options["--city"],
  "Supply explicit input, output and city.",
);
const input = resolve(options["--input"]),
  output = resolve(options["--output"]);
assert(
  input !== output && statSync(input).size <= 16 * 1024 * 1024,
  "Use a separate bounded source file.",
);
const exclusions = options["--exclusions"]
  ? JSON.parse(readFileSync(options["--exclusions"], "utf8"))
  : [];
const graph = importPedestrianGraph(JSON.parse(readFileSync(input, "utf8")), {
  cityId: options["--city"],
  exclusions,
});
writeFileSync(output, JSON.stringify(graph), { flag: "wx" });
console.log(
  JSON.stringify({
    cityId: graph.cityId,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    hash: graph.hash,
    fieldReview: graph.fieldReview,
    activated: false,
  }),
);
