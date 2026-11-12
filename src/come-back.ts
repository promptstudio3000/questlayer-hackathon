// "Come back tomorrow at 07:00": when a monster or NPC with nothing on offer
// is worth a visit again. The server sends the time (encounter.comeBack.at,
// server/actors/service.mjs comeBackFor); this only words it.
import { lang, tr } from "./i18n";
import type { ActorEncounter, ActorView } from "./actor-types";

const DAY = 86_400_000;
const dayStart = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function comeBackWhen(at: number, now = Date.now()): string {
  const time = new Date(at).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((dayStart(at) - dayStart(now)) / DAY);
  if (days <= 0) return tr("today at {0}", { 0: time });
  if (days === 1) return tr("tomorrow at {0}", { 0: time });
  return tr("on {0} at {1}", { 0: new Date(at).toLocaleDateString(lang, { weekday: "long" }), 1: time });
}

/** One sentence for an actor that has nothing for this player right now. */
export function comeBackLine(actor: ActorView, comeBack: ActorEncounter["comeBack"], now = Date.now()): string {
  if (actor.state === "cooldown" && actor.cooldownUntil && actor.cooldownUntil > now)
    return tr("It is resting after your last try. Come back {0} for another go.", { 0: comeBackWhen(actor.cooldownUntil, now) });
  if (!comeBack) return actor.kind === "npc" ? tr("Nothing for you today.") : tr("Nothing to win here right now.");
  const when = comeBackWhen(comeBack.at, now);
  if (comeBack.reason === "boss_beaten") return tr("This week's boss is beaten. A new one rises {0}.", { 0: when });
  if (comeBack.reason === "beaten") return tr("You already beat it today. Come back {0} to win something again.", { 0: when });
  if (actor.kind === "npc") return tr("Nothing for you today. Come back {0} for new tasks.", { 0: when });
  return tr("It has nothing for you today. Come back {0} to win something.", { 0: when });
}
