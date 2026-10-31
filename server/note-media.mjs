import {
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  lstatSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { assert, id } from "./domain.mjs";

// These files are app-hosted public-note images, never private task evidence.
// Every read still goes through the note's current visibility and block policy.
export class NoteMedia {
  constructor(directory = ".data/media") {
    this.directory = resolve(directory);
    this.active = 0;
    this.pruneCursor = 0;
  }
  file(url) {
    const name =
      typeof url === "string" &&
      url.match(/^\/api\/media\/(image_[a-f0-9-]{36}\.jpg)$/)?.[1];
    return name ? resolve(this.directory, name) : null;
  }
  remove(url) {
    const path = this.file(url);
    if (path) rmSync(path, { force: true });
  }
  prune(db, { now = Date.now(), graceMs = 86400000, limit = 100 } = {}) {
    if (!existsSync(this.directory)) return { checked: 0, removed: 0 };
    const files = readdirSync(this.directory)
      .filter((name) => this.file(`/api/media/${name}`))
      .sort();
    let checked = 0,
      removed = 0;
    const linked = db.prepare("SELECT 1 FROM messages WHERE image=? LIMIT 1");
    const count = Math.min(limit, files.length);
    for (let i = 0; i < count; i++) {
      const name = files[(this.pruneCursor + i) % files.length],
        url = `/api/media/${name}`;
      const path = this.file(url);
      try {
        const stat = lstatSync(path);
        checked++;
        if (stat.isFile() && stat.mtimeMs < now - graceMs && !linked.get(url)) {
          rmSync(path);
          removed++;
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    this.pruneCursor = files.length
      ? (this.pruneCursor + count) % files.length
      : 0;
    return { checked, removed };
  }
  async store(data) {
    if (data === null || data === undefined) return null;
    assert(
      typeof data === "string" && data.length <= 1_333_370,
      "Use an image smaller than 1 MB.",
      413,
    );
    const match = data.match(
      /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/,
    );
    assert(match && match[2].length % 4 === 0, "Use a JPG, PNG or WebP image.");
    const bytes = Buffer.from(match[2], "base64");
    assert(
      bytes.length > 0 && bytes.length <= 1_000_000,
      "Use an image smaller than 1 MB.",
      413,
    );
    assert(
      bytes.toString("base64") === match[2],
      "The image encoding is invalid.",
    );
    assert(
      this.active < 2,
      "Image processing is busy. Please retry this note shortly.",
      503,
    );
    this.active++;
    try {
      const pipeline = sharp(bytes, {
        limitInputPixels: 16_000_000,
        failOn: "warning",
      });
      const meta = await pipeline.metadata();
      assert(
        meta.format === match[1] && (meta.pages ?? 1) === 1,
        "Use a still JPG, PNG or WebP image.",
      );
      // Sharp strips EXIF/GPS and other original metadata unless explicitly retained.
      const clean = await pipeline
        .rotate()
        .resize({
          width: 1024,
          height: 1024,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 78 })
        .toBuffer();
      assert(clean.length < 400_000, "The processed image is too large.", 413);
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const url = `/api/media/${id("image")}.jpg`;
      writeFileSync(this.file(url), clean, { mode: 0o600, flag: "wx" });
      return url;
    } catch (error) {
      if (error.status) throw error;
      assert(
        false,
        "This image could not be read. Choose another JPG, PNG or WebP image.",
      );
    } finally {
      this.active--;
    }
  }
}
