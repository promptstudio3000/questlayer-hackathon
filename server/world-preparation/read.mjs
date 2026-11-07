import { gunzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { exactKeys, requireValue, sha256 } from "./canonical.mjs";
import { inputFile, MAX_INPUT_BYTES, readBounded } from "./storage.mjs";
import { PREPARATION_SCHEMA } from "./schema.mjs";

function bytesFor(root, ref, prefix, suffix) {
  exactKeys(ref, ["path", "sha256", "bytes"], "bundle reference");
  requireValue(
    /^[a-f0-9]{64}$/.test(ref.sha256) &&
      ref.path === `${prefix}/${ref.sha256}.${suffix}`,
    "Invalid content-addressed bundle reference.",
  );
  const bytes = readBounded(inputFile(root, ref.path));
  requireValue(
    bytes.length === ref.bytes && sha256(bytes) === ref.sha256,
    "Bundle checksum/size mismatch.",
  );
  return bytes;
}

// Deliberately named content: loading does not generate, allocate or authorize a
// claim. No private reference can be loaded through the public path parameter.
export function readPreparedContent(manifestFile, regionId) {
  const root = dirname(resolve(manifestFile));
  const manifest = JSON.parse(readBounded(manifestFile));
  return readPreparedRegion(root, manifest, manifest.regions.find((r) => r.id === regionId));
}

// Batch importers parse the immutable manifest once, avoiding quadratic work
// as the region inventory grows. Bundle and geometry hashes are still checked.
export function readPreparedRegion(root, manifest, entry) {
  requireValue(
    manifest.schema === PREPARATION_SCHEMA &&
      manifest.state === "content-prepared" &&
      manifest.activation?.permitted === false,
    "Expected a sealed content-only preparation manifest.",
  );
  requireValue(
    entry?.state === "prepared",
    "Region is absent from this prepared day.",
  );
  const bytes = bytesFor(root, entry.public, "public/regions", "json.gz");
  const content = JSON.parse(
    gunzipSync(bytes, { maxOutputLength: MAX_INPUT_BYTES }),
  );
  requireValue(
    content.schema === "questlayer.world-region-content/1" &&
      content.region === entry.id &&
      content.epoch.id === manifest.epoch.id &&
      content.status === "content-only",
    "Prepared content belongs to another region or day.",
  );
  for (const o of content.objects)
    if (o.geometry) bytesFor(root, o.geometry, "public/geometry", "json");
  return content;
}
