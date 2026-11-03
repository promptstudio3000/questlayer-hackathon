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
}
