// osmium-tool stages: filter a Geofabrik extract down to quest places, public
// paths and exclusion areas, then export each as GeoJSON text sequences.
// Resumable: a stage is skipped when its marker records the same input hash.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

export const EXTRACT_VERSION = "osm-extract-1";

export const FILTERS = Object.freeze({
  pois: [
    "nwr/tourism=artwork,viewpoint,museum,gallery,attraction,picnic_site,information",
    "nwr/historic",
    "nwr/amenity=fountain,library,marketplace,planetarium,music_venue,theatre,place_of_worship",
    "nwr/leisure=park,garden,nature_reserve,pitch,stadium,sports_centre,bandstand,picnic_table,skatepark",
    "nwr/man_made=observatory,tower,bridge",
    "nwr/place=square",
    "nwr/highway=trailhead",
    "wr/highway=pedestrian",
    "wr/boundary=protected_area",
  ],
  paths: [
    "w/highway=footway,path,pedestrian,living_street,track,cycleway,steps,residential,unclassified,bridleway",
  ],
  exclusions: [
    "wr/amenity=school,college,kindergarten,childcare,hospital,clinic,social_facility,nursing_home,prison,police,embassy,grave_yard",
    "wr/landuse=military,railway,quarry,construction,cemetery,prison",
    "wr/leisure=playground",
    "wr/military",
    "wr/office=diplomatic",
    "wr/aeroway=aerodrome",
  ],
});

const GEOMETRY = {
  pois: "point,linestring,polygon",
  paths: "linestring",
  exclusions: "polygon",
};

export function extractOsm({
  pbf,
  pbfSha256,
  workDir,
  region,
  osmium = "osmium",
  log = () => {},
}) {
  const outputs = {};
  for (const kind of Object.keys(FILTERS)) {
    const out = `${workDir}/osm-${region}-${kind}.geojsonseq`;
    const marker = `${out}.done`;
    const stamp = `${EXTRACT_VERSION}:${pbfSha256}:${FILTERS[kind].join(" ")}`;
    outputs[kind] = out;
    if (
      existsSync(out) &&
      existsSync(marker) &&
      readFileSync(marker, "utf8") === stamp
    ) {
      log(`unchanged osm ${kind} for ${region}`);
      continue;
    }
    log(`extracting osm ${kind} for ${region}`);
    const filtered = `${workDir}/osm-${region}-${kind}.pbf`;
    rmSync(marker, { force: true });
    execFileSync(
      osmium,
      [
        "tags-filter",
        pbf,
        ...FILTERS[kind],
        "-o",
        filtered,
        "--overwrite",
        "--no-progress",
      ],
      { stdio: "inherit" },
    );
    const part = `${out}.part`;
    execFileSync(
      osmium,
      [
        "export",
        filtered,
        "-f",
        "geojsonseq",
        "-x",
        "print_record_separator=false",
        "--attributes",
        "type,id",
        `--geometry-types=${GEOMETRY[kind]}`,
        "-i",
        `sparse_file_array,${workDir}/osm-${region}-${kind}.idx`,
        "-o",
        part,
        "--overwrite",
        "--no-progress",
      ],
      { stdio: "inherit" },
    );
    renameSync(part, out);
    rmSync(filtered, { force: true });
    rmSync(`${workDir}/osm-${region}-${kind}.idx`, { force: true });
    writeFileSync(marker, stamp);
  }
  return outputs;
}

/**
 * Cuts a demo city clip ([west, south, east, north]) out of a larger extract.
 * "simple": one pass, about 2 GB peak for any planet-wide id range ("smart"
 * peaked at 3.9 GB on BBBike New York and the worker's 3 GB limit killed it).
 * Ways that cross the edge keep only their inside part; that is enough for a
 * clip whose centre is 3-4 km from every edge.
 */
export function clipOsm({ pbf, out, bbox, osmium = "osmium" }) {
  const part = `${out}.part.osm.pbf`;
  execFileSync(
    osmium,
    [
      "extract",
      "-b",
      bbox.join(","),
      "-s",
      "simple",
      pbf,
      "-o",
      part,
      "--overwrite",
      "--no-progress",
    ],
    { stdio: "inherit" },
  );
  renameSync(part, out);
  return out;
}
