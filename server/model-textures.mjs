import sharp from "sharp";
import { assert } from "./domain.mjs";
let queue = Promise.resolve();
// Serialize bounded texture work on the VPS. Geometry, skinning and UVs remain intact.
export function optimizeModelTextures(bytes) {
  const task = queue.then(async () => {
    const [{ NodeIO }, { ALL_EXTENSIONS }] = await Promise.all([
      import("@gltf-transform/core"),
      import("@gltf-transform/extensions"),
    ]);
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS),
      document = await io.readBinary(bytes);
    for (const texture of document.getRoot().listTextures()) {
      const image = texture.getImage(),
        mime = texture.getMimeType();
      assert(
        image && ["image/jpeg", "image/png"].includes(mime),
        "Unsupported source texture.",
        503,
      );
      const size = await sharp(image, {
        limitInputPixels: 16777216,
      }).metadata();
      if (size.width <= 512 && size.height <= 512) continue;
      const pipeline = sharp(image, { limitInputPixels: 16777216 }).resize({
        width: 512,
        height: 512,
        fit: "inside",
        withoutEnlargement: true,
        kernel: "nearest",
      });
      const optimized = await (
        mime === "image/jpeg"
          ? pipeline.jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
          : pipeline.png({ compressionLevel: 9 })
      ).toBuffer();
      texture.setImage(new Uint8Array(optimized)).setMimeType(mime);
    }
    return Buffer.from(await io.writeBinary(document));
  });
  queue = task.catch(() => {});
  return task;
}
