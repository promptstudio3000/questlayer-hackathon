import { useEffect, useState } from "react";
import { MapPin } from "@phosphor-icons/react";
import { ArrowRight } from "./dir-icons";
import type { ZonePresence as Presence } from "./zone-presence";
import { tr } from "./i18n";
const WELCOME_MS = 9000;
// One greeting per visit: a sheet opening and closing over the map must not
// replay it, coming back after ten minutes away does.
const seen = { id: "", at: 0, until: 0 };
export function ZonePresence({ presence, arena, onOpen }: { presence: Presence; arena: boolean; onOpen: () => void }) {
  // Walking into a zone greets with its name and what waits there; after a
  // few seconds the label settles back to plain words over the map.
  const [welcome, setWelcome] = useState(false);
  const settled = presence.state !== "uncertain";
  useEffect(() => {
    if (!settled) return;
    const now = Date.now();
    if (seen.id !== presence.zone.id || now - seen.at > 600000) seen.until = now + WELCOME_MS;
    seen.id = presence.zone.id;
    seen.at = now;
    setWelcome(now < seen.until);
    const timer = setTimeout(() => setWelcome(false), Math.max(0, seen.until - now));
    return () => clearTimeout(timer);
  }, [presence.zone.id, settled]);
  useEffect(() => {
    const beat = setInterval(() => { if (seen.id === presence.zone.id) seen.at = Date.now(); }, 30000);
    return () => clearInterval(beat);
  }, [presence.zone.id]);
  const greet = welcome && settled;
  const text = presence.state === "uncertain" ? tr("Location uncertain") : presence.state === "locked" ? tr("Opens at Tier") + ` ${presence.zone.tier}` : presence.state === "closed" ? tr("Not open now") : presence.state === "cleared" ? tr("Completed") : greet ? tr("{0} quests here. Tap to see them.", { 0: presence.count }) : tr("{0} activities here", { 0: presence.count });
  return <aside className={`zone-presence zone-presence-${presence.state}${greet ? " zone-presence-welcome" : ""}`} aria-label={tr("Current zone")}>
    <button onClick={onOpen}><MapPin size={24} weight="fill" aria-hidden="true" /><span><small>{presence.state === "uncertain" ? text : greet ? tr("Welcome to") : arena ? tr("Demo zone") : tr("Inside zone")}</small><strong>{presence.zone.name}</strong>{presence.state !== "uncertain" && <small>{text}</small>}</span><ArrowRight size={20} aria-hidden="true" /></button>
    <span className="sr-only" role="status">{presence.zone.name}: {text}</span>
  </aside>;
}
