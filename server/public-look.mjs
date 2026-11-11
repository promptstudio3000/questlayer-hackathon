// A small public avatar for lists (creators, task posters): the same reduced
// look the map draws (avatar colour, worn Aura colours, worn wearable clones)
// read from the database only, no chain calls. No wallet, account or
// inventory beyond what the explorer wears. Test-world bots carry demoBot.
import { wornWearables } from "./gotchi-wearables.mjs";
import { levelFor } from "./domain.mjs";

const color = (value) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : null;

export function publicLook(db, playerId, now = Date.now()) {
  const look = { color: "#b8a1ed", above: null, below: null, wearables: [], level: 1, demoBot: false };
  if (typeof playerId !== "string") return look;
  look.demoBot = /^seed-[a-z0-9-]{1,60}$/.test(playerId);
  try {
    const player = db.prepare("SELECT xp FROM players WHERE id=?").get(playerId);
    if (player) look.level = levelFor(player.xp);
    const rows = db
      .prepare(
        "SELECT kind,color,slot FROM inventory WHERE player_id=? AND (kind='avatar' OR equipped=1)",
      )
      .all(playerId);
    look.color = color(rows.find((i) => i.kind === "avatar")?.color) || look.color;
    for (const slot of ["above", "below"])
      look[slot] = color(rows.find((i) => i.kind === "aura" && i.slot === slot)?.color);
    // Read only: never create the wearables tables from a list read.
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='wearable_clones'").get())
      look.wearables = wornWearables(db, playerId, now).map((w) => ({ id: w.id, slot: w.slot, dims: w.dims }));
  } catch {
    // An optional table is missing on this database: keep the plain ghost.
  }
  return look;
}
