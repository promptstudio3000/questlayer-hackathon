#!/usr/bin/env node
// Drop-in game art helper (art/README.md).
//
//   node scripts/art.mjs list          writes docs/ART-LIST.md from art/catalog.json
//   node scripts/art.mjs list --check  fails when docs/ART-LIST.md is out of date
//   node scripts/art.mjs check         checks every file in art/ (name, format, size, weight)
//
// The browser picks the files up at build time (src/art-overrides.ts), so a
// dropped-in file only needs `npm run art:check`, a commit and the usual deploy.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(join(root, "art/catalog.json"), "utf8"));
const places = JSON.parse(readFileSync(join(root, "server/data/place-badges.json"), "utf8")).badges.map((b) => b.id);
const auraIds = JSON.parse(readFileSync(join(root, "server/data/aura-catalog.json"), "utf8")).editions.map((e) => e.id);
const OBJECT_KINDS = ["coin", "chest", "discovery", "route", "place"];
const OBJECT_STATES = ["ready", "open", "completed", "locked"];
const LATER_FOLDERS = ["zones", "challenges", "currency", "emotes", "quests", "ui"];

/** Which catalog group a key belongs to, or null for an unknown name. */
export function groupFor(key) {
  const exact = catalog.groups.find((g) => g.items.some((i) => i.key === key && !i.pattern));
  if (exact) return exact;
  const [folder, name = ""] = key.split("/");
  const group = catalog.groups.find((g) => g.id === folder);
  if (folder === "objects" && OBJECT_KINDS.some((k) => OBJECT_STATES.some((s) => name === `${k}-${s}`))) return group;
  if (folder === "auras" && auraIds.some((id) => name === `${id}-above` || name === `${id}-below`)) return group;
  if (folder === "badges" && places.includes(name)) return group;
  if (LATER_FOLDERS.includes(folder) && name) return catalog.groups.find((g) => g.id === "later");
  return null;
}

function size(file) {
  const b = readFileSync(file);
  if (b.length > 24 && b.toString("ascii", 1, 4) === "PNG") return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const chunk = b.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

export function checkArt(dir = join(root, "art")) {
  const errors = [], warnings = [], found = [];
  for (const file of walk(dir)) {
    const rel = relative(dir, file).split("\\").join("/");
    if (rel === "catalog.json" || rel === "README.md" || rel.endsWith(".gitkeep") || rel.startsWith(".")) continue;
    const m = /^(.+)\.(png|webp|svg)$/.exec(rel);
    if (!m) {
      errors.push(`${rel}: use .png, .webp or .svg`);
      continue;
    }
    if (m[1] !== m[1].toLowerCase()) errors.push(`${rel}: use lower-case file names`);
    const key = m[1].toLowerCase();
    const group = groupFor(key);
    if (!group) {
      errors.push(`${rel}: unknown name, see docs/ART-LIST.md for the exact file names`);
      continue;
    }
    const item = group.items.find((i) => i.key === key) || {};
    const kb = statSync(file).size / 1024;
    const maxKB = item.maxKB || group.maxKB;
    if (maxKB && kb > maxKB * 2) errors.push(`${rel}: ${Math.round(kb)} KB, keep it under ${maxKB} KB (compress or use WebP)`);
    else if (maxKB && kb > maxKB) warnings.push(`${rel}: ${Math.round(kb)} KB, aim for under ${maxKB} KB`);
    if (m[2] === "svg") {
      const text = readFileSync(file, "utf8");
      if (/<script|on[a-z]+\s*=|<foreignObject/i.test(text)) errors.push(`${rel}: SVG must not contain scripts or event handlers`);
    } else {
      const s = size(file);
      if (!s) errors.push(`${rel}: not a valid ${m[2].toUpperCase()} file`);
      else {
        const min = item.minPx || group.minPx;
        if (min && Math.min(s.w, s.h) < min) warnings.push(`${rel}: ${s.w}×${s.h} is small, use at least ${min} px`);
        const aspect = item.aspect || group.aspect;
        if (aspect && Math.abs(s.w / s.h / aspect - 1) > 0.15)
          warnings.push(`${rel}: ${s.w}×${s.h}, expected about ${item.size || group.size} (it is fitted, but may look small)`);
      }
    }
    found.push(key);
  }
  return { errors, warnings, found };
}

const md = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
export function renderList() {
  const lines = [
    "# Game art list",
    "",
    "<!-- Generated by `npm run art:list` from art/catalog.json. Edit the catalog, not this file. -->",
    "",
    "Everything visual in QuestLayer that can be replaced by a generated image, what it is for, how big it must be and a prompt to generate it. Drop a finished file into the folder with the exact name and it replaces the placeholder on the next build. Nothing else changes: if a file is missing, the current art stays.",
    "",
    "## How to drop files in",
    "",
    "1. Generate the image with the house style below plus the item's prompt.",
    "2. Remove the background (PNG/WebP with transparency) and crop to the size in the table. SVG is fine for flat art.",
    "3. Save it as `art/<folder>/<name>.png` (or `.webp` / `.svg`), lower-case, exactly the name in the table, e.g. `art/actors/merchant.png`.",
    "4. Run `npm run art:check`. It lists unknown names (typos), wrong formats, too small or too heavy files.",
    "5. Commit and deploy as usual. Vite fingerprints the files, so phones get the new art right away.",
    "",
    "Priority: **1** = biggest visible win (logo, NPCs, monsters, map objects), **2** = next, **3** = optional.",
    "",
    "## House style (paste before every prompt)",
    "",
    `> ${catalog.style.prompt}`,
    "",
    `**Negative prompt:** ${catalog.style.negative}`,
    "",
    "Palette: " + Object.entries(catalog.style.palette).map(([k, v]) => `${k} \`${v}\``).join(", ") + ".",
    "",
    "Rarity accents: " + Object.entries(catalog.style.rarityColours).map(([k, v]) => `${k} \`${v}\``).join(", ") + ".",
    "",
    "Tips: generate at 2–4× the target size and scale down; keep one seed/reference image per family (NPCs, monsters, objects, Auras) so the set looks consistent; if the generator cannot do transparency, ask for a flat `#00FF00` background and remove it. Export PNG with alpha or WebP (quality ~85).",
    "",
  ];
  let total = 0;
  for (const g of catalog.groups) {
    lines.push(`## ${g.title}`, "");
    lines.push(`Folder: \`${g.folder}/\` · Size: ${g.size} · Formats: ${g.formats.join(", ")}${g.maxKB ? ` · Max ~${g.maxKB} KB each` : ""}`, "");
    lines.push(g.how, "");
    lines.push("| File | What | Used for | Now | Prio | Prompt |", "| --- | --- | --- | --- | --- | --- |");
    for (const i of g.items) {
      total += i.pattern ? 0 : 1;
      const file = g.replaceInPublic ? `\`${i.key}\`` : `\`art/${i.key}${i.pattern ? "" : ".png"}\``;
      const what = `${md(i.name)}${i.size ? ` (${md(i.size)})` : ""}${i.hooked === false ? " · *needs hook*" : ""}`;
      lines.push(`| ${file} | ${what} | ${md(i.use)} | ${md(i.now)} | ${i.priority} | ${md(i.prompt)} |`);
    }
    lines.push("");
  }
  lines.push(
    "## How it works in code",
    "",
    "- `src/art-overrides.ts` collects `art/**/*.{png,webp,svg}` at build time (Vite `import.meta.glob`) and registers them in `src/art-registry.ts`.",
    "- Each placeholder asks `artUrl(key)` first: logo (`BrandLogo`), player (`STARTER_SPRITE`), NPC/monster map sprites and sheets (`actorSprite`, `createActorScene`), dialog portraits (`NpcSheet`), Auras (`AuraSprite`, `auraMarkup`), map/list objects (`GameObjectArt`, `gameObjectMarkup`, map coin and street-find icons) and place badges (`BadgeBook`).",
    "- Missing file = current art. NFT media already minted on NEAR (`public/aura-*.svg`, explorer cover) never change.",
    "- `tests/art-catalog.test.mjs` keeps the catalog in step with the game data and this file in step with the catalog.",
    "",
    `${total} named files in total.`,
    "",
  );
  return lines.join("\n");
}

const main = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const [cmd, flag] = main ? process.argv.slice(2) : [];
if (cmd === "list") {
  const path = join(root, "docs/ART-LIST.md");
  const text = renderList();
  if (flag === "--check") {
    if (readFileSync(path, "utf8") !== text) {
      console.error("docs/ART-LIST.md is out of date: run npm run art:list");
      process.exit(1);
    }
  } else writeFileSync(path, text);
  console.log("docs/ART-LIST.md ok");
} else if (cmd === "check") {
  const { errors, warnings, found } = checkArt();
  for (const w of warnings) console.warn(`warn  ${w}`);
  for (const e of errors) console.error(`error ${e}`);
  console.log(`${found.length} art file(s) ready${found.length ? `: ${found.join(", ")}` : ""}`);
  if (errors.length) process.exit(1);
} else if (cmd) {
  console.error("usage: node scripts/art.mjs list [--check] | check");
  process.exit(2);
}
