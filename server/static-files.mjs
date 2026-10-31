import { existsSync, statSync, realpathSync } from "node:fs";
import { resolve, extname, basename, sep } from "node:path";
import { assert } from "./domain.mjs";
export const hashedAsset = (path) =>
  /^\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|jpe?g|webp|svg|gif)$/.test(
    path,
  );
function regularFile(root, file) {
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  const actual = realpathSync(file),
    boundary = realpathSync(root);
  assert(actual.startsWith(boundary + sep), "Path is not allowed.", 403);
  return true;
}
export function resolvePublicFile(root, pathname, sharedAssetsRoot = null) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    assert(false, "Invalid file path.", 400);
  }
  assert(
    !decoded
      .split("/")
      .some(
        (part, index) =>
          part.startsWith(".") && !(index === 1 && part === ".well-known"),
      ),
    "Path is not allowed.",
    403,
  );
  const boundary = resolve(root),
    file = resolve(boundary, `.${decoded}`);
  assert(
    file === boundary || file.startsWith(boundary + sep),
    "Path is not allowed.",
    403,
  );
  if (regularFile(boundary, file))
    return {
      file,
      cacheControl: hashedAsset(decoded)
        ? "public,max-age=31536000,immutable"
        : extname(file) === ".html"
          ? "no-cache"
          : "public,max-age=3600",
      retained: false,
    };
  if (sharedAssetsRoot && hashedAsset(decoded)) {
    const shared = resolve(sharedAssetsRoot),
      candidate = resolve(shared, basename(decoded));
    if (regularFile(shared, candidate))
      return {
        file: candidate,
        cacheControl: "public,max-age=31536000,immutable",
        retained: true,
      };
  }
  assert(
    !decoded.startsWith("/assets/") && !extname(decoded),
    "This public file does not exist.",
    404,
  );
  const index = resolve(boundary, "index.html");
  assert(regularFile(boundary, index), "Build the application first.", 503);
  return { file: index, cacheControl: "no-cache", retained: false };
}
