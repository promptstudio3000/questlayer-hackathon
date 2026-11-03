// Encounter sheet for a roaming NPC: 3D portrait, speech bubble, the offer
// buttons the server computed (they always work without AI), a short chat
// box and the player's open tasks from this character, with turn-in.
import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import LockedChip, { openStakeScreen } from "./LockedChip";
import type { ActorEncounter, ActorOffer } from "./actor-types";
import {
  keeperView,
  npcAccept,
  npcGreet,
  npcTalk,
  npcTurnIn,
  tradeAccept,
  tradeUpComplete,
  type KeeperView,
  type NpcActiveLine,
  type NpcReply,
  type NpcTrade,
} from "./npc-client";
import { InnerVault, StakeTodayCard, seenCeremony, seenRank } from "./StakeToday";
import "./npc-sheet.css";
import { tr } from "./i18n";

const EMOTE: Record<string, string> = { wave: "👋", think: "🤔", laugh: "😄", shrug: "🤷", none: "" };
const isTrade = (offer: ActorOffer) => offer.kind.startsWith("trade_");
const near = (yocto: string) => (Number(BigInt(yocto) / 10n ** 21n) / 1000).toFixed(3);

function tradeText(t: NpcTrade, who: string) {
  if (t.kind === "trade_up")
    return t.state === "completed"
      ? tr("Done. {0}{1}", { 0: t.aura ? `${t.aura.name} (${t.aura.rarity}) is yours; secure it on NEAR from your wardrobe.` : "", 1: t.ledgerAura ? ` ${who} also hands you the ${t.ledgerAura.name}.` : "" })
      : tr("Send {0} to {1} (wardrobe → transfer), then tap \"Check hand-over\". The deal stays open 30 minutes.", { 0: t.tokens?.join(", "), 1: t.receiver });
  const minutes = Math.max(1, Math.round((t.deadlineMs - Date.now()) / 60000));
  return t.kind === "trade_buy"
    ? tr("{0} signed a buy order: {1} test NEAR for {2}. Open Market → Signed offers and tap \"Hand to the market and accept\" within {3} min.", { 0: who, 1: near(t.price), 2: t.tokenId, 3: minutes })
    : tr("{0} signed a sell order: {1} for {2} test NEAR. Open Market → Signed offers and buy it within {3} min.", { 0: who, 1: t.tokenId, 2: near(t.price), 3: minutes });
}

function Portrait({ model, label }: { model: string; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dispose: (() => void) | undefined, cancelled = false;
    import("./actor-models").then(({ createActorScene }) => {
      if (!cancelled && host.current) dispose = createActorScene(host.current, model, { label }).dispose;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [model, label]);
  return <div className="npc-portrait" ref={host} />;
}

export default function NpcSheet({ actorId, encounter, onClose }: { actorId: string; encounter: ActorEncounter; onClose: () => void }) {
  const [reply, setReply] = useState<NpcReply | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [trades, setTrades] = useState<Record<string, NpcTrade>>({});
  const [vault, setVault] = useState<KeeperView | null>(null);
  const token = encounter.encounter;
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("Something went wrong."));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    run(async () => setReply(await npcGreet(actorId, token)));
    if (encounter.actor.archetype === "keeper") keeperView(actorId, token).then(setVault, () => setVault(null));
  }, [actorId, token]);
  const refresh = async () => setReply(await npcGreet(actorId, token));
  const accept = (offer: ActorOffer) =>
    run(async () => {
      if (isTrade(offer)) {
        const t = await tradeAccept(actorId, token, offer.id);
        setTrades((all) => ({ ...all, [offer.id]: t }));
        setNotice(tradeText(t, reply?.npc?.name || encounter.actor.name));
        return;
      }
      await npcAccept(actorId, token, offer.id);
      setNotice(tr("Task accepted: {0}", { 0: offer.label }));
      await refresh();
    });
  const turnIn = (line: NpcActiveLine) =>
    run(async () => {
      const r = await npcTurnIn(actorId, token, line.offerId);
      setNotice(
        r.replay
          ? tr("Already turned in.")
          : `+${r.xp} XP${r.aura ? ` and ${r.aura.name} (${r.aura.rarity})` : ""}${r.edition ? `${r.aura ? "," : " and"} plus the NPC-only ${r.edition.name} (${r.edition.rarity})` : ""}.${r.aura || r.edition ? " Secure it on NEAR from your wardrobe." : ""}${r.patron ? ` Patron's Path ${r.patron.pathLine}/${r.patron.pathOf}: "${r.patron.story.title}". ${r.patron.story.text}${r.patron.edition && r.patron.edition.id !== r.edition?.id ? ` You also earned ${r.patron.edition.name}.` : ""}` : ""}${r.note ? ` ${r.note}` : ""}`,
      );
      await refresh();
    });
  const handOver = (offerId: string) =>
    run(async () => {
      const t = await tradeUpComplete(actorId, token, offerId);
      setTrades((all) => ({ ...all, [offerId]: t }));
      setNotice(tradeText(t, reply?.npc?.name || encounter.actor.name));
    });
  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    run(async () => {
      const r = await npcTalk(actorId, token, text);
      setReply((old) => ({ ...r, npc: r.npc ?? old?.npc }));
      setMessage("");
    });
  };
  const name = reply?.npc?.name || encounter.actor.name;
  const suggested = reply?.offer?.id;
  return (
    <Dialog label={tr("Talk to {0}", { 0: name })} onClose={onClose}>
      <div className="npc-sheet">
        <header className="npc-head">
          <Portrait model={encounter.actor.model} label={name} />
          <div>
            <h2>{name}</h2>
            {(reply?.npc?.title || encounter.actor.title) && <p className="npc-title">{reply?.npc?.title || encounter.actor.title}</p>}
            <p className="npc-source">{reply?.source && reply.source !== "template" ? tr("AI voice · answers from game data only") : tr("Standard replies")}</p>
          </div>
          <button type="button" className="npc-close" onClick={onClose} aria-label={tr("Close")}>×</button>
        </header>
        <p className="npc-bubble" aria-live="polite">
          {reply ? `${EMOTE[reply.emote] || ""} ${reply.say}`.trim() : "…"}
        </p>
        {reply?.note && <p className="npc-note">{reply.note}</p>}
        {!!reply?.active.length && (
          <section aria-label={tr("Your tasks")}>
            <h3>{tr("Your tasks")}</h3>
            {reply.active.map((line) => {
              const ready = line.steps.every((s) => s.done);
              return (
                <div className={`npc-task${line.patron ? " patron" : ""}`} key={line.offerId}>
                  <p>
                    {line.patron && <span className="patron-tag">{tr("✦ Patron")}{" "}{line.patron.pathLine}/{line.patron.pathOf}</span>} {line.label}
                  </p>
                  <ul>
                    {line.steps.map((s) => (
                      <li key={s.questId} className={s.done ? "done" : ""}>
                        {s.done ? "✓" : "○"} {s.title}
                        {s.zone ? ` · ${s.zone}` : ""}
                      </li>
                    ))}
                  </ul>
                  <button type="button" disabled={busy || !ready} onClick={() => turnIn(line)}>
                    {ready ? tr("Turn in for {0} XP{1}", { 0: line.xp, 1: line.aura ? " + Aura" : "" }) : tr("Finish the stops, then come back")}
                  </button>
                </div>
              );
            })}
          </section>
        )}
        {!!reply?.menu.length && (
          <section aria-label={tr("Offers")}>
            <h3>{tr("Offers")}</h3>
            {reply.menu.map((offer) => (
              <button
                type="button"
                key={offer.id}
                className={`npc-offer${offer.id === suggested ? " suggested" : ""}${(offer.terms as { patron?: boolean }).patron ? " patron" : ""}`}
                disabled={busy}
                onClick={() => accept(offer)}
              >
                <span>{offer.label}</span>
                <small>
                  {isTrade(offer)
                    ? trades[offer.id]
                      ? tr("Signed · see below")
                      : offer.kind === "trade_up"
                        ? tr("3 commons → 1 rare")
                        : tr("Signed order on the testnet market")
                    : `${String((offer.terms as { xp?: number }).xp ?? "")} XP${(offer.terms as { aura?: boolean }).aura ? " + Aura" : ""}${
                        (offer.terms as { patron?: boolean }).patron
                          ? ` · Patron's Path ${String((offer.terms as { pathLine?: number }).pathLine)}/${String((offer.terms as { pathOf?: number }).pathOf)}`
                          : ""
                      }`}
                </small>
              </button>
            ))}
            {Object.entries(trades)
              .filter(([, t]) => t.kind === "trade_up" && t.state === "issued")
              .map(([offerId]) => (
                <button type="button" key={offerId} disabled={busy} onClick={() => handOver(offerId)}>
                  {tr("Check hand-over")}</button>
              ))}
          </section>
        )}
        {!!reply?.locked?.length && (
          <section aria-label={tr("For stakers")}>
            <h3>{tr("For stakers")}</h3>
            {reply.locked.map((chip) => (
              <LockedChip
                key={chip.id}
                label={chip.label}
                perk={chip.perk}
                gate={chip.locked}
                onStake={(near) => {
                  onClose();
                  openStakeScreen(near);
                }}
              />
            ))}
          </section>
        )}
        {vault?.stake && (
          <>
            <StakeTodayCard
              card={vault.stake}
              onSeen={(id) =>
                void seenCeremony(id).finally(() =>
                  setVault((v) => (v?.stake ? { ...v, stake: { ...v.stake, ceremonies: v.stake.ceremonies.filter((c) => c.id !== id) } } : v)),
                )
              }
              onRankSeen={() => {
                const r = vault.stake?.rank?.rankUp?.rank;
                if (r)
                  void seenRank(r).finally(() =>
                    setVault((v) => (v?.stake?.rank ? { ...v, stake: { ...v.stake, rank: { ...v.stake.rank, rankUp: null } } } : v)),
                  );
              }}
            />
            <InnerVault card={vault.stake} />
          </>
        )}
        {vault && (
          <section aria-label={tr("Your vault and balance")}>
            <h3>{tr("Your vault and balance")}</h3>
            <ul className="npc-keeper">
              {vault.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}
        <form className="npc-chat" onSubmit={send}>
          <input
            value={message}
            maxLength={300}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={tr("Say something to {0}", { 0: name })}
            aria-label={tr("Message to {0}", { 0: name })}
          />
          <button type="submit" disabled={busy || !message.trim()}>{tr("Send")}</button>
        </form>
        {notice && <p className="npc-notice" role="status">{notice}</p>}
        {error && <p className="npc-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
