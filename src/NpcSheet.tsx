// Encounter sheet for a roaming NPC, built like a game dialog: a big portrait
// with the NPC's line in a speech bubble, the actions the server computed
// (they always work without AI) and a box to write to them. Everything else
// (open tasks, the keeper's vault, the character profile) lives in tabs.
import { useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
  CheckCircle,
  Coins,
  DiceFive,
  IdentificationCard,
  ListChecks,
  PaperPlaneRight,
  Scroll,
  Sparkle,
  Swap,
  Sword,
  Vault,
  X,
} from "@phosphor-icons/react";
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
import { npcStrings } from "./npc-i18n";
import { InnerVault, StakeTodayCard, seenCeremony, seenRank } from "./StakeToday";
import "./npc-sheet.css";

const EMOTE: Record<string, string> = { wave: "👋", think: "🤔", laugh: "😄", shrug: "🤷", none: "" };
const isTrade = (offer: ActorOffer) => offer.kind.startsWith("trade_");
const ICON: Record<string, ReactNode> = {
  quest: <Scroll weight="duotone" />,
  chapter: <BookOpen weight="duotone" />,
  trade_buy: <Coins weight="duotone" />,
  trade_sell: <Coins weight="duotone" />,
  trade_up: <Swap weight="duotone" />,
  roll: <DiceFive weight="duotone" />,
  challenge: <Sword weight="duotone" />,
};
/** Portraits baked from the original models (scripts/bake-npc-portraits.mjs). */
const BAKED = new Set(["chronicler", "merchant", "keeper", "pilgrim", "wisp"]);
type Tab = "talk" | "tasks" | "vault" | "about";

function Portrait({ model, label, emote }: { model: string; label: string; emote: string }) {
  const [src, setSrc] = useState(BAKED.has(model) ? `/art/npc/${model}.png` : "");
  useEffect(() => {
    if (BAKED.has(model)) return;
    let gone = false;
    import("./actor-models").then(({ actorSprite }) => actorSprite(model, 384)).then((url) => !gone && setSrc(url), () => {});
    return () => {
      gone = true;
    };
  }, [model]);
  return (
    <div className="npc-portrait">
      {src && <img src={src} alt={label} width={384} height={384} />}
      {emote && (
        <span className="npc-emote" aria-hidden="true">
          {emote}
        </span>
      )}
    </div>
  );
}

export default function NpcSheet({ actorId, encounter, onClose }: { actorId: string; encounter: ActorEncounter; onClose: () => void }) {
  const t = npcStrings();
  const [reply, setReply] = useState<NpcReply | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [trades, setTrades] = useState<Record<string, NpcTrade>>({});
  const [vault, setVault] = useState<KeeperView | null>(null);
  const [tab, setTab] = useState<Tab>("talk");
  const token = encounter.encounter;
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    run(async () => setReply(await npcGreet(actorId, token)));
    if (encounter.actor.archetype === "keeper") keeperView(actorId, token).then(setVault, () => setVault(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId, token]);
  const name = reply?.npc?.name || encounter.actor.name;
  const refresh = async () => setReply(await npcGreet(actorId, token));
  const accept = (offer: ActorOffer) =>
    run(async () => {
      if (isTrade(offer)) {
        const trade = await tradeAccept(actorId, token, offer.id);
        setTrades((all) => ({ ...all, [offer.id]: trade }));
        setNotice(t.trade(trade, name));
        return;
      }
      await npcAccept(actorId, token, offer.id);
      setNotice(t.accepted(offer.label));
      await refresh();
    });
  const turnIn = (line: NpcActiveLine) =>
    run(async () => {
      const r = await npcTurnIn(actorId, token, line.offerId);
      setNotice(r.replay ? t.already : t.turnedIn(r));
      await refresh();
    });
  const handOver = (offerId: string) =>
    run(async () => {
      const trade = await tradeUpComplete(actorId, token, offerId);
      setTrades((all) => ({ ...all, [offerId]: trade }));
      setNotice(t.trade(trade, name));
    });
  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    run(async () => {
      const r = await npcTalk(actorId, token, text);
      setReply((old) => ({ ...r, npc: r.npc ?? old?.npc }));
      setMessage("");
      setNotice("");
    });
  };

  const archetype = reply?.npc?.archetype || encounter.actor.archetype;
  const title = reply?.npc?.title || encounter.actor.title;
  const suggested = reply?.offer?.id;
  const active = reply?.active ?? [];
  const ready = active.filter((line) => line.steps.every((s) => s.done));
  const pendingHandOver = Object.entries(trades).filter(([, x]) => x.kind === "trade_up" && x.state === "issued");
  const tabs: { id: Tab; label: string; icon: ReactNode; badge?: number }[] = [
    { id: "talk", label: t.tabTalk, icon: <Sparkle weight="duotone" /> },
    { id: "tasks", label: t.tabTasks, icon: <ListChecks weight="duotone" />, badge: active.length || undefined },
    ...(vault ? [{ id: "vault" as Tab, label: t.tabVault, icon: <Vault weight="duotone" /> }] : []),
    { id: "about", label: t.tabAbout, icon: <IdentificationCard weight="duotone" /> },
  ];

  const offerMeta = (offer: ActorOffer) => {
    const terms = offer.terms as { xp?: number; aura?: boolean; patron?: boolean; pathLine?: number; pathOf?: number };
    if (isTrade(offer)) return trades[offer.id] ? t.signed : t.offerTag[offer.kind];
    if (terms.patron) return t.patron(terms.pathLine, terms.pathOf);
    return t.reward(terms.xp, !!terms.aura) || t.offerTag[offer.kind] || "";
  };

  const turnInButton = (line: NpcActiveLine) => (
    <button type="button" className="npc-action turn-in" disabled={busy} onClick={() => turnIn(line)}>
      <span className="npc-action-icon">
        <CheckCircle weight="fill" />
      </span>
      <span className="npc-action-label">{line.label}</span>
      <small>{t.turnIn(line.xp, line.aura)}</small>
    </button>
  );

  return (
    <Dialog label={t.talkTo(name)} onClose={onClose}>
      <div className={`npc-sheet npc-${archetype}`}>
        <header className="npc-hero">
          <Portrait model={encounter.actor.model} label={name} emote={reply ? EMOTE[reply.emote] || "" : ""} />
          <div className="npc-plate">
            <span className="npc-role">{t.role[archetype] || archetype}</span>
            <h2>{name}</h2>
          </div>
          <button type="button" className="npc-close" onClick={onClose} aria-label={t.close}>
            <X weight="bold" />
          </button>
        </header>

        <p className="npc-bubble" aria-live="polite">
          {reply ? reply.say : t.thinking}
        </p>

        <nav className="npc-tabs" role="tablist">
          {tabs.map((x) => (
            <button
              type="button"
              role="tab"
              key={x.id}
              aria-selected={tab === x.id}
              className={tab === x.id ? "active" : ""}
              onClick={() => setTab(x.id)}
            >
              {x.icon}
              <span>{x.label}</span>
              {x.badge ? <b className="npc-badge">{x.badge}</b> : null}
            </button>
          ))}
        </nav>

        {tab === "talk" && (
          <div className="npc-panel" role="tabpanel">
            <div className="npc-actions">
              {ready.map((line) => (
                <div key={line.offerId}>{turnInButton(line)}</div>
              ))}
              {reply?.menu.map((offer) => (
                <button
                  type="button"
                  key={offer.id}
                  className={`npc-action${offer.id === suggested ? " suggested" : ""}${(offer.terms as { patron?: boolean }).patron ? " patron" : ""}`}
                  disabled={busy}
                  onClick={() => accept(offer)}
                >
                  <span className="npc-action-icon">{ICON[offer.kind] || <Sparkle weight="duotone" />}</span>
                  <span className="npc-action-label">{offer.label}</span>
                  <small>{offerMeta(offer)}</small>
                </button>
              ))}
              {pendingHandOver.map(([offerId]) => (
                <button type="button" className="npc-action turn-in" key={offerId} disabled={busy} onClick={() => handOver(offerId)}>
                  <span className="npc-action-icon">
                    <Swap weight="duotone" />
                  </span>
                  <span className="npc-action-label">{t.checkHandOver}</span>
                </button>
              ))}
              {reply?.locked?.map((chip) => (
                <LockedChip
                  key={chip.id}
                  label={chip.label}
                  perk={chip.perk}
                  gate={chip.locked}
                  onStake={(amount) => {
                    onClose();
                    openStakeScreen(amount);
                  }}
                />
              ))}
              {reply && !reply.menu.length && !ready.length && !reply.locked?.length && <p className="npc-empty">{t.noActions}</p>}
              {active.length > ready.length && (
                <button type="button" className="npc-link" onClick={() => setTab("tasks")}>
                  {t.moreTasks(active.length - ready.length)} →
                </button>
              )}
            </div>
          </div>
        )}

        {tab === "tasks" && (
          <div className="npc-panel" role="tabpanel">
            {!active.length && <p className="npc-empty">{t.noTasks}</p>}
            {active.map((line) => {
              const done = line.steps.every((s) => s.done);
              return (
                <div className={`npc-task${line.patron ? " patron" : ""}`} key={line.offerId}>
                  <p className="npc-task-title">
                    {line.patron && <span className="patron-tag">✦ {t.patron(line.patron.pathLine, line.patron.pathOf)}</span>} {line.label}
                  </p>
                  <ul>
                    {line.steps.map((s) => (
                      <li key={s.questId} className={s.done ? "done" : ""}>
                        {s.done ? "✓" : "○"} {s.title}
                        {s.zone ? ` · ${s.zone}` : ""}
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="npc-turnin" disabled={busy || !done} onClick={() => turnIn(line)}>
                    {done ? t.turnIn(line.xp, line.aura) : t.notReady}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {tab === "vault" && vault && (
          <div className="npc-panel npc-vault" role="tabpanel">
            {vault.stake && (
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
            <section aria-label={t.vaultBalance}>
              <h3>{t.vaultBalance}</h3>
              <ul className="npc-keeper">
                {vault.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          </div>
        )}

        {tab === "about" && (
          <div className="npc-panel npc-about" role="tabpanel">
            <h3>{t.about}</h3>
            {title && <p>{title}</p>}
            {reply?.note && <p>{reply.note}</p>}
            <p className="npc-fine">{reply?.source && reply.source !== "template" ? t.aiVoice : t.stdVoice}</p>
            <p className="npc-fine">{t.aiNote}</p>
          </div>
        )}

        {notice && (
          <button type="button" className="npc-notice" role="status" onClick={() => setNotice("")}>
            {notice}
          </button>
        )}
        {error && (
          <p className="npc-error" role="alert">
            {error}
          </p>
        )}

        <form className="npc-chat" onSubmit={send}>
          <input
            value={message}
            maxLength={300}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t.sayTo(name)}
            aria-label={t.messageTo(name)}
            enterKeyHint="send"
          />
          <button type="submit" disabled={busy || !message.trim()} aria-label={t.send}>
            <PaperPlaneRight weight="fill" />
          </button>
        </form>
      </div>
    </Dialog>
  );
}
