import { ArrowRight } from "./dir-icons";
import { useLearning } from "./useLearning";
import { helpText } from "./activity-help";
import { tr } from "./i18n";
import { ActorPortrait } from "./ActorPortrait";
import { useFormDraft } from "./useFormDraft";
import { ScreenTabs, type ScreenTab } from "./ScreenTabs";
// Encounter sheet for a roaming NPC, built like a game dialog: a big portrait
// with the NPC's line in a speech bubble, the actions the server computed
// (they always work without AI) and a box to write to them. Everything else
// (open tasks, the keeper's vault, the character profile) lives in tabs.
import { NpcGear } from "./NpcGear";
import { comeBackLine } from "./come-back";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
} from "@phosphor-icons/react";
import { Dialog } from "./Dialog";
import "./art-world";
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
import { ApiError } from "./api";
import { chainTradesReady, explorerTxUrl, fillOnChain, handOverOnChain, secureTradeAura } from "./chain-trades";
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
type Tab = "talk" | "tasks" | "vault" | "about";

function Portrait({ model, label, emote }: { model: string; label: string; emote: string }) {
  return (
    <div className="npc-portrait">
      <ActorPortrait model={model} label={label} />
      {emote && (
        <span className="npc-emote" aria-hidden="true">
          {emote}
        </span>
      )}
    </div>
  );
}

const roomyDialog = () =>
  typeof matchMedia === "function" && matchMedia("(min-width: 901px) and (min-height: 700px)").matches;

export default function NpcSheet({ actorId, playerId, draftRealm, encounter, onClose, onQuest }: { onQuest?: (questId: string) => void; playerId: string; draftRealm: string; actorId: string; encounter: ActorEncounter; onClose: () => void }) {
  const t = npcStrings();
  const learning = useLearning(playerId);
  const [reply, setReply] = useState<NpcReply | null>(null);
  const draft = useFormDraft({playerId, form:`npc-message:${actorId}`, realm:draftRealm, fields:{message:300}, initial:{message:""}});
  const message = draft.values.message;
  const latestMessage = useRef(message);
  latestMessage.current = message;
  const setMessage = (value: string) => draft.setField("message", value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [trades, setTrades] = useState<Record<string, NpcTrade>>({});
  const [vault, setVault] = useState<KeeperView | null>(null);
  const [tab, setTab] = useState<Tab>("talk");
  const [flow, setFlow] = useState<"greeting" | "choices" | "offer" | "accepted">("greeting");
  const [selectedOffer, setSelectedOffer] = useState<ActorOffer | null>(null);
  const flowHost = useRef<HTMLDivElement>(null);
  // A desktop dialog has room for the services, so it opens with them shown;
  // a phone keeps the short greeting and folds them under "Learn more".
  const [detailsOpen, setDetailsOpen] = useState(roomyDialog);
  useEffect(() => {
    if (flow === "greeting") return;
    const frame = requestAnimationFrame(() => flowHost.current?.querySelector<HTMLElement>(".npc-story-step h3, .npc-continue")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [flow]);
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
  const keep = (offerId: string, trade: NpcTrade) => setTrades((all) => ({ ...all, [offerId]: trade }));
  /** Trade-up: hand the Auras over on NEAR, then let the trader check and pay out. */
  const settleTradeUp = async (offerId: string, trade: NpcTrade) => {
    if (chainTradesReady() && trade.state === "issued") {
      setNotice(t.handingOver);
      await handOverOnChain(trade);
    }
    let done: NpcTrade | null = null;
    for (let attempt = 0; attempt < 6 && !done; attempt++) {
      try {
        done = await tradeUpComplete(actorId, token, offerId);
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "NPC_TRADE_PENDING") || attempt === 5) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    keep(offerId, done!);
    setNotice(t.trade(done!, name));
    // The payout becomes an NFT on the player's account straight away.
    if (done!.secureItemId && !done!.replay) await secureTradeAura(done!.secureItemId).catch(() => false);
  };
  const accept = (offer: ActorOffer) =>
    run(async () => {
      if (isTrade(offer)) {
        const trade = await tradeAccept(actorId, token, offer.id);
        keep(offer.id, trade);
        if (!chainTradesReady() || trade.state !== "issued") {
          setNotice(t.trade(trade, name));
          return;
        }
        if (trade.kind === "trade_up") return settleTradeUp(offer.id, trade);
        // Buys and sales settle on NEAR Intents right here, in one tap.
        setNotice(t.settlingOnChain);
        const filled = await fillOnChain(trade);
        keep(offer.id, filled);
        setNotice(t.tradeOnChain(filled, name));
        return;
      }
      await npcAccept(actorId, token, offer.id);
      learning.acknowledge("npc");
      const fresh = await npcGreet(actorId, token);
      setReply(fresh);
      // Accepting is the whole decision: straight back to the map, guided
      // to the first stop.
      const first = fresh.active?.find((line) => line.offerId === offer.id)?.steps.find((step) => !step.done);
      if (first?.questId && onQuest) {
        onClose();
        onQuest(first.questId);
        return;
      }
      setNotice(t.accepted(offer.label));
      setSelectedOffer(offer);
      setFlow("accepted");
    });
  const turnIn = (line: NpcActiveLine) =>
    run(async () => {
      const r = await npcTurnIn(actorId, token, line.offerId);
      setNotice(r.replay ? t.already : line.errand ? t.errandDone(r.xp, r.errand?.clueBonusXp) : t.turnedIn(r));
      await refresh();
    });
  const handOver = (offerId: string) => run(() => settleTradeUp(offerId, trades[offerId]));
  const proofs = Object.values(trades).flatMap((x) => x.txHashes || (x.txHash ? [x.txHash] : []));
  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    const draftRevision = draft.revision;
    if (!text) return;
    run(async () => {
      const r = await npcTalk(actorId, token, text);
      setReply((old) => ({ ...r, npc: r.npc ?? old?.npc }));
      if (latestMessage.current.trim() === text) draft.discard(draftRevision);
      setNotice("");
    });
  };

  const archetype = reply?.npc?.archetype || encounter.actor.archetype;
  const title = reply?.npc?.title || encounter.actor.title;
  const suggested = reply?.offer?.id;
  const active = reply?.active ?? [];
  const ready = active.filter((line) => line.steps.every((s) => s.done));
  const pendingHandOver = Object.entries(trades).filter(([, x]) => x.kind === "trade_up" && x.state === "issued");
  const tabs: ScreenTab<Tab>[] = [
    { id: "talk", label: t.tabTalk, icon: Sparkle },
    { id: "tasks", label: t.tabTasks, icon: ListChecks, count: active.length || undefined },
    ...(vault ? [{ id: "vault" as Tab, label: t.tabVault, icon: Vault }] : []),
    { id: "about", label: t.tabAbout, icon: IdentificationCard },
  ];

  const offerMeta = (offer: ActorOffer) => {
    const terms = offer.terms as { xp?: number; aura?: boolean; patron?: boolean; pathLine?: number; pathOf?: number };
    if (isTrade(offer)) return trades[offer.id] ? t.signed : t.offerTag[offer.kind];
    if (terms.patron) return t.patron(terms.pathLine, terms.pathOf);
    return t.reward(terms.xp, !!terms.aura) || t.offerTag[offer.kind] || "";
  };

  const nextAcceptedStep = selectedOffer ? active.find(line => line.offerId === selectedOffer.id)?.steps.find(step => !step.done) : null;
  const questOffers = (reply?.menu || []).filter((offer) => offer.kind === "quest" || offer.kind === "chapter");
  // Offers already listed under "Choose a quest" are not repeated in the Talk tab.
  const shownAbove = new Set(reply && (flow === "greeting" || flow === "choices") ? questOffers.slice(0, 2).map((offer) => offer.id) : []);
  const moreOffers = (reply?.menu || []).filter((offer) => !shownAbove.has(offer.id));
  const openServices = (next: Tab) => { setTab(next); setDetailsOpen(true); };
  // Nothing to choose in the greeting (traders, keepers): their counter is
  // open right away, without a Continue step.
  const direct = !!reply && !questOffers.length && !active.length;
  useEffect(() => { if (direct) openServices(vault ? "vault" : "talk"); }, [direct]);
  const offerSteps = selectedOffer && Array.isArray(selectedOffer.terms.steps)
    ? selectedOffer.terms.steps.filter((step): step is { title: string } => !!step && typeof step === "object" && typeof step.title === "string")
    : [];
  const turnInButton = (line: NpcActiveLine) => (
    <button type="button" className="npc-action turn-in" disabled={busy} onClick={() => turnIn(line)}>
      <span className="npc-action-icon">
        <CheckCircle weight="fill" />
      </span>
      <span className="npc-action-label">{line.label}</span>
      <small>{line.errand ? t.errandReport(line.xp, line.errand.clueBonusXp) : t.turnIn(line.xp, line.aura)}</small>
    </button>
  );

  return (
    <Dialog presentation="encounter" label={t.talkTo(name)} onClose={onClose}>
      <div className={`npc-sheet npc-linear npc-${archetype}`} ref={flowHost}>
        <header className="npc-hero">
          <Portrait model={encounter.actor.model} label={name} emote={reply ? EMOTE[reply.emote] || "" : ""} />
          <div className="npc-plate">
            <span className="npc-role">{t.role[archetype] || archetype}</span>
            <h2>{name}</h2>
          </div>
        </header>

        <p className="npc-bubble" aria-live="polite">
          {flow === "accepted" ? notice : reply ? reply.say : t.thinking}
        </p>

        {reply && flow === "greeting" && (ready.length > 0 || active.length > 0) && <button className="primary-button npc-continue" disabled={busy} onClick={() => openServices("tasks")}>{tr("Your tasks")}<ArrowRight aria-hidden="true" /></button>}
        {reply && (flow === "greeting" || flow === "choices") && questOffers.length > 0 && <section className="npc-story-step" aria-label={tr("Choose a quest")}>
          {questOffers.slice(0, 2).map((offer) => <button key={offer.id} className="npc-choice" disabled={busy} onClick={() => accept(offer)}>
            <span>{offer.label}</span><small>{offerMeta(offer)}</small><ArrowRight aria-hidden="true" />
          </button>)}
        </section>}
        {flow === "accepted" && nextAcceptedStep && <p className="npc-next-step">{nextAcceptedStep.title}</p>}
        {flow === "accepted" && <button className="primary-button npc-continue" onClick={() => { onClose(); if (nextAcceptedStep) onQuest?.(nextAcceptedStep.questId); }}>{tr("Back to map")}<ArrowRight aria-hidden="true" /></button>}
        {notice && flow !== "accepted" && <p className="npc-notice" role="status">{notice}</p>}
        {error && <div className="npc-error" role="alert"><p>{error}</p>
          {!reply && <button className="secondary-button" disabled={busy} onClick={() => run(refresh)}>{t.retry}</button>}
        </div>}
        <details className="npc-more" open={detailsOpen} onToggle={(e) => setDetailsOpen(e.currentTarget.open)}>
          <summary>{tr("More")}</summary>
        <ScreenTabs label={t.talkTo(name)} idBase={`npc-${actorId}`} tabs={tabs} value={tab} onChange={setTab} sticky={false} />

        {tab === "talk" && (
          <div className="npc-panel" role="tabpanel" id={`npc-${actorId}-panel`} aria-labelledby={`npc-${actorId}-tab-${tab}`}>
            <div className="npc-actions">
              {ready.map((line) => (
                <div key={line.offerId}>{turnInButton(line)}</div>
              ))}
              {moreOffers.map((offer) => (
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
              {archetype === "trader" && <NpcGear actorId={actorId} encounter={token} />}
              {reply && !moreOffers.length && !shownAbove.size && !ready.length && !reply.locked?.length && archetype !== "trader" && (
                <p className="npc-empty" data-testid={encounter.comeBack ? "npc-come-back" : undefined}>
                  {encounter.comeBack ? `${comeBackLine(encounter.actor, encounter.comeBack)} ${tr("You can still ask me anything.")}` : t.noActions}
                </p>
              )}
              {active.length > ready.length && (
                <button type="button" className="npc-link" onClick={() => setTab("tasks")}>
                  {t.moreTasks(active.length - ready.length)} →
                </button>
              )}
            </div>
          </div>
        )}

        {tab === "tasks" && (
          <div className="npc-panel" role="tabpanel" id={`npc-${actorId}-panel`} aria-labelledby={`npc-${actorId}-tab-${tab}`}>
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
                    {line.errand
                      ? done
                        ? t.errandReport(line.xp, line.errand.clueBonusXp)
                        : t.errandNotReady
                      : done
                        ? t.turnIn(line.xp, line.aura)
                        : t.notReady}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {tab === "vault" && vault && (
          <div className="npc-panel npc-vault" role="tabpanel" id={`npc-${actorId}-panel`} aria-labelledby={`npc-${actorId}-tab-${tab}`}>
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
          <div className="npc-panel npc-about" role="tabpanel" id={`npc-${actorId}-panel`} aria-labelledby={`npc-${actorId}-tab-${tab}`}>
            <h3>{t.about}</h3>
            {title && <p>{title}</p>}
            {reply?.note && <p>{reply.note}</p>}
            <p className="npc-fine">
              {reply?.source === "near-ai" ? t.privateVoice : reply?.source && reply.source !== "template" ? t.aiVoice : t.stdVoice}
            </p>
            {reply?.verification && (
              <p className="npc-fine">
                <a href={reply.verification.url} target="_blank" rel="noreferrer">
                  {t.verifyReply}
                </a>{" "}
                <code>{reply.verification.chatId}</code>
              </p>
            )}
            <p className="npc-fine">{t.aiNote}</p>
          </div>
        )}

        {proofs.length > 0 && (
          <p className="npc-fine npc-proof">
            {t.onChainProof}{" "}
            {[...new Set(proofs)].map((hash, i) => (
              <a key={hash} href={explorerTxUrl(hash)} target="_blank" rel="noreferrer" data-tx={hash}>
                {i ? " · " : ""}
                {hash.slice(0, 6)}…
              </a>
            ))}
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
        </details>
      </div>
    </Dialog>
  );
}
