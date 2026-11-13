// Safe themed web search for NPC memory: Wikipedia GeoSearch only.
// Off unless NPC_WEB_SEARCH=wikipedia. Nothing a player wrote is ever sent:
// the query is the NPC's coordinates and a fixed radius, so no player data
// leaves the server and no text can steer the search. Only *.wikipedia.org is
// called, with a short timeout and a small result cap; results are plain text
// (no HTML), screened like any tip and cached for a week per place.
import { clean } from "../ai/text-policy.mjs";

const HOST = /^[a-z]{2,3}\.wikipedia\.org$/;
const MAX_RESULTS = 5;

export function webSearchConfiguration(env = process.env) {
  const mode = (env.NPC_WEB_SEARCH || "").trim();
  if (!mode || mode === "off") return null;
  if (mode !== "wikipedia") throw Error("NPC_WEB_SEARCH must be wikipedia or off.");
  const lang = (env.NPC_WEB_SEARCH_LANG || "en").trim();
  if (!/^[a-z]{2,3}$/.test(lang)) throw Error("NPC_WEB_SEARCH_LANG must be a Wikipedia language code.");
  return { mode, lang };
}

const firstSentence = (text) => {
  const s = clean(text).replace(/\s*\([^)]*\)/g, "");
  const end = s.search(/[.!?](\s|$)/);
  return (end > 20 ? s.slice(0, end + 1) : s).slice(0, 170);
};

export function createWikipediaSearch({ lang = "en", fetcher = fetch, timeoutMs = 4000, radius = 2500 } = {}) {
  const host = `${lang}.wikipedia.org`;
  if (!HOST.test(host)) throw Error("Wikipedia host not allowed.");
  const get = async (params) => {
    const url = new URL(`https://${host}/w/api.php`);
    for (const [k, v] of Object.entries({ format: "json", formatversion: "2", ...params })) url.searchParams.set(k, String(v));
    if (!HOST.test(url.hostname)) throw Error("Wikipedia host not allowed.");
    const res = await fetcher(url, {
      headers: { Accept: "application/json", "User-Agent": "QuestLayer-NPC/1.0 (city exploration game)" },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw Error(`wikipedia-${res.status}`);
    return res.json();
  };
  return {
    name: "wikipedia",
    async nearby({ lat, lng }) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      const geo = await get({ action: "query", list: "geosearch", gscoord: `${lat.toFixed(5)}|${lng.toFixed(5)}`, gsradius: radius, gslimit: 12 });
      const pages = (geo?.query?.geosearch || []).slice(0, 12);
      if (!pages.length) return [];
      const ex = await get({ action: "query", prop: "extracts", exintro: 1, explaintext: 1, exsentences: 2, exlimit: 12, pageids: pages.map((p) => p.pageid).join("|") });
      const at = new Map(pages.map((p) => [p.pageid, { lat: Number(p.lat), lng: Number(p.lon) }]));
      const out = [];
      for (const p of ex?.query?.pages || []) {
        const title = clean(String(p.title || "")).slice(0, 60);
        const text = firstSentence(String(p.extract || ""));
        if (title.length < 2 || text.length < 30 || /\b(may refer to|is a list)\b/i.test(text)) continue;
        const spot = at.get(p.pageid);
        out.push({ ref: `wiki:${lang}:${p.pageid}`, place: title, text, ...(spot && Number.isFinite(spot.lat) && Number.isFinite(spot.lng) ? { spot } : {}) });
        if (out.length >= MAX_RESULTS) break;
      }
      return out;
    },
  };
}

export function webSearchFor(env = process.env, options = {}) {
  const config = webSearchConfiguration(env);
  return config ? createWikipediaSearch({ lang: config.lang, ...options }) : null;
}
