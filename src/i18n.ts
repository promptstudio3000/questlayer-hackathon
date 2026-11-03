// Player-facing language. English everywhere by default; another language
// only when the player picks it in Profile · Settings (or opens a ?lang= link).
// The browser language is deliberately NOT used to switch automatically.
//
// Strings are keyed by their English text, so anything without an entry in
// the chosen dictionary simply stays English. Each dictionary is its own
// chunk, downloaded only by players who chose that language; main.tsx loads
// it before the first render. Call `tr` at render time (module-level labels
// use getters), never while a module is being evaluated.
//
// Adding a language: put src/i18n/<id>.json next to cs.json (same English
// keys, see `npm run i18n:keys`) and add one line to LANGUAGES below.

type Dictionary = Record<string, string>;
type Language = {
  label: string;
  dir?: "rtl";
  load?: () => Promise<{ default: Dictionary }>;
};

const LANGUAGES = {
  en: { label: "English" },
  cs: { label: "Čeština", load: () => import("./i18n/cs.json") },
  ru: { label: "Русский", load: () => import("./i18n/ru.json") },
} satisfies Record<string, Language>;

export type Lang = keyof typeof LANGUAGES;

export const LANGS: readonly { id: Lang; label: string }[] = (
  Object.keys(LANGUAGES) as Lang[]
).map((id) => ({ id, label: LANGUAGES[id].label }));

const STORAGE_KEY = "questlayer.lang";

type Vars = Record<string, unknown>;

const isLang = (value: unknown): value is Lang =>
  typeof value === "string" && Object.hasOwn(LANGUAGES, value);

function chosenLang(): Lang {
  try {
    // A shared link can pick the language: ?lang=cs or ?lang=en.
    const fromUrl = globalThis.location
      ? new URLSearchParams(globalThis.location.search).get("lang")
      : null;
    if (isLang(fromUrl)) {
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, fromUrl);
      } catch {
        // Storage blocked: the URL choice still applies to this load.
      }
      return fromUrl;
    }
  } catch {
    // No usable location: fall through to the saved choice.
  }
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isLang(value) ? value : "en";
  } catch {
    return "en";
  }
}

export const lang: Lang = chosenLang();

let dictionary: Dictionary = {};

/** Load the chosen dictionary. main.tsx waits for this before rendering. */
export async function loadLocale(): Promise<void> {
  const language: Language = LANGUAGES[lang];
  if (typeof document !== "undefined") {
    document.documentElement.lang = lang;
    document.documentElement.dir = language.dir ?? "ltr";
  }
  if (!language.load) return;
  try {
    dictionary = (await language.load()).default;
  } catch {
    // Offline before the chunk was cached: play in English.
    dictionary = {};
  }
}

function fill(text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * Translate an English UI string. `{name}` placeholders are filled from
 * `vars` in every language.
 */
export function tr(english: string, vars?: Vars): string {
  return fill(dictionary[english] ?? english, vars);
}

/** Save a new language and reload so every screen switches at once. */
export function setLang(next: Lang) {
  if (next === lang) return;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode: the choice cannot be kept; try a link instead.
  }
  const url = new URL(location.href);
  url.searchParams.delete("lang");
  if (next !== "en") url.searchParams.set("lang", next);
  location.replace(url.toString());
}
