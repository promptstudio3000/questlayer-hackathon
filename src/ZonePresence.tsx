import { MapPin } from "@phosphor-icons/react";
import { ArrowRight } from "./dir-icons";
import type { ZonePresence as Presence } from "./zone-presence";
import { tr } from "./i18n";
export function ZonePresence({ presence, arena, onOpen }: { presence: Presence; arena: boolean; onOpen: () => void }) {
  const text = presence.state === "uncertain" ? tr("Location uncertain") : presence.state === "locked" ? tr("Opens at Tier") + ` ${presence.zone.tier}` : presence.state === "closed" ? tr("Not open now") : presence.state === "cleared" ? tr("Completed") : tr("{0} activities here", { 0: presence.count });
  return <aside className={`zone-presence zone-presence-${presence.state}`} aria-label={tr("Current zone")}>
    <button onClick={onOpen}><MapPin size={24} weight="fill" aria-hidden="true" /><span><small>{presence.state === "uncertain" ? text : arena ? tr("Demo zone") : tr("Inside zone")}</small><strong>{presence.zone.name}</strong>{presence.state !== "uncertain" && <small>{text}</small>}</span><ArrowRight size={20} aria-hidden="true" /></button>
    <span className="sr-only" role="status">{presence.zone.name}: {text}</span>
  </aside>;
}
