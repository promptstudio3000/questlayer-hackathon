// Lists every English UI string passed to tr() in src/, and for each
// dictionary in src/i18n/ which keys are missing or no longer used.
//
//   npm run i18n:keys                 summary per language
//   npm run i18n:keys -- --write-en   also writes src/i18n/en-keys.json,
//                                     the list a translator starts from
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const I18N = join(SRC, "i18n");

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

export function usedKeys() {
  const keys = new Set();
  for (const file of files(SRC)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("tr(")) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
      file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    (function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "tr") {
        const [first] = node.arguments;
        if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)))
          keys.add(first.text);
      }
      ts.forEachChild(node, visit);
    })(source);
  }
  return [...keys].sort();
}

// Text a player reads that skips tr(): JSX text and the label-like
// attributes (aria-label, title, placeholder, alt, label) given as a plain
// string. Brand names, units and codes that stay the same in every language
// are allowed.
const SAME_IN_EVERY_LANGUAGE = /^(GOLD|XP|NEAR|testNEAR|QuestLayer|QUEST|LAYER|HP|GPS|Čeština|cq_…|ipfs:\/\/bafy…)$/;
const LABEL_ATTRIBUTES = new Set(["aria-label", "title", "placeholder", "alt", "label"]);
export function untranslatedJsx() {
  const found = [];
  for (const file of files(SRC)) {
    if (!file.endsWith(".tsx")) continue;
    const text = readFileSync(file, "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const where = (node) =>
      `${file.slice(SRC.length + 1)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
    (function visit(node) {
      if (ts.isJsxText(node)) {
        const value = node.text.trim().replace(/\s+/g, " ");
        if (/\p{L}{2,}/u.test(value) && !SAME_IN_EVERY_LANGUAGE.test(value)) found.push(`${where(node)} ${JSON.stringify(value)}`);
      }
      if (
        ts.isJsxAttribute(node) &&
        LABEL_ATTRIBUTES.has(node.name.getText(source)) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        /\p{L}{2,}/u.test(node.initializer.text) &&
        !SAME_IN_EVERY_LANGUAGE.test(node.initializer.text)
      )
        found.push(`${where(node)} ${node.name.getText(source)}=${JSON.stringify(node.initializer.text)}`);
      ts.forEachChild(node, visit);
    })(source);
  }
  return found;
}

export function dictionaries() {
  return readdirSync(I18N)
    .filter((name) => /^[a-z]{2,3}(-[A-Za-z]+)?\.json$/.test(name))
    .map((name) => ({ id: name.replace(/\.json$/, ""), entries: JSON.parse(readFileSync(join(I18N, name), "utf8")) }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const keys = usedKeys();
  console.log(`${keys.length} English strings in tr() calls.`);
  if (process.argv.includes("--write-en")) {
    writeFileSync(join(I18N, "en-keys.json"), JSON.stringify(keys, null, 1) + "\n");
    console.log("Wrote src/i18n/en-keys.json");
  }
  const used = new Set(keys);
  for (const { id, entries } of dictionaries()) {
    const missing = keys.filter((k) => !(k in entries));
    const unused = Object.keys(entries).filter((k) => !used.has(k));
    console.log(`${id}: ${keys.length - missing.length}/${keys.length} translated, ${unused.length} unused`);
  }
  const raw = untranslatedJsx();
  console.log(`${raw.length} JSX texts outside tr()${raw.length ? ":\n  " + raw.join("\n  ") : "."}`);
}
