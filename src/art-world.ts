// Drop-in art the welcome screen never shows (NPCs, monsters, portraits,
// Auras, badges and the next-wave folders). It is a separate module so it
// rides the map chunk instead of the first-load bundle (the first-session
// perf budget); GameMap, NpcSheet, BadgeBook and actor-models import it.
// Startup art (logo, objects, player) stays in src/art-overrides.ts.
import { artKeyFromPath, registerArt } from "./art-registry";

const files = import.meta.glob(
  ["/art/{actors,portraits,auras,badges,objects,zones,challenges,currency,emotes,quests,ui}/**/*.{png,webp,svg}", "/art/brand/{app-icon,wordmark}.*"],
  { eager: true, query: "?no-inline", import: "default" },
) as Record<string, string>;

registerArt(
  Object.fromEntries(
    Object.entries(files)
      .map(([path, url]) => [artKeyFromPath(path), url] as const)
      .filter((e): e is readonly [string, string] => !!e[0]),
  ),
);
