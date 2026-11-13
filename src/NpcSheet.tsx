import { ArrowRight } from "./dir-icons";
import { distanceLabel } from "./app-bits";
import { useLearning } from "./useLearning";
import { helpText } from "./activity-help";
import { tr } from "./i18n";
import { ActorPortrait } from "./ActorPortrait";
import { useFormDraft } from "./useFormDraft";
import { ScreenTabs, type ScreenTab } from "./ScreenTabs";
// Encounter sheet for a roaming NPC, built like a game dialog: a big portrait
// and three tabs, one job each. Talk is the conversation (the greeting and
// the NPC's own question as chat messages), Tasks holds everything the NPC
// offers and what the player is doing for it (the server computes those and
// they always work without AI), and Profile tells who the character is and
// which places it has heard of, with how far they are. The keeper adds Vault.
import { NpcGear } from "./NpcGear";
import { comeBackLine } from "./come-back";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  CheckCircle,
  Coins,
  DiceFive,
  IdentificationCard,
  ListChecks,
  MapPin,
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
  npcMission,
  npcTalk,
  npcTurnIn,
  tradeAccept,
  tradeUpComplete,
  type KeeperView,
  type NpcActiveLine,
  type NpcPlace,
  type NpcReply,
  type NpcTrade,
} from "./npc-client";
import { npcStrings } from "./npc-i18n";
import { ApiError } from "./api";
import { chainTradesReady, explorerTxUrl, fillOnChain, handOverOnChain, secureTradeAura } from "./chain-trades";
import { InnerVault, StakeTodayCard, seenCeremony, seenRank } from "./StakeToday";
import "./npc-sheet.css";

// The Talk tab's thread (src/NpcChat.tsx) loads with the first greeting.
const NpcChat = lazy(() => import("./NpcChat"));
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

export default function NpcSheet({ actorId, playerId, draftRealm, encounter, onClose, onQuest, keeperPanel }: { keeperPanel?: ReactNode; onQuest?: (questId: string) => void; playerId: string; draftRealm: string; actorId: string; encounter: ActorEncounter; onClose: () => void }) {
  const t = npcStrings();
  const learning = useLearning(playerId);
  const [reply, setReply] = useState<NpcReply | null>(null);
  const draft = useFormDraft({playerId, form:`npc-message:${actorId}`, realm:draftRealm, fields:{message:300}, initial:{message:""}});
  const message = draft.values.message;
  const setMessage = (value: string) => draft.setField("message", value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [trades, setTrades] = useState<Record<string, NpcTrade>>({});
  const [vault, setVault] = useState<KeeperView | null>(null);
  const [tab, setTab] = useState<Tab>("talk");
  const [selectedOffer, setSelectedOffer] = useState<ActorOffer | null>(null);
  const flowHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedOffer) return;
    const frame = requestAnimationFrame(() => flowHost.current?.querySelector<HTMLElement>(".npc-continue")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [selectedOffer]);
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
    });
  const turnIn = (line: NpcActiveLine) =>
    run(async () => {
      const r = await npcTurnIn(actorId, token, line.offerId);
      setNotice(r.replay ? t.already : line.errand ? t.errandDone(r.xp, r.errand?.clueBonusXp) : t.turnedIn(r));
      await refresh();
    });
  const handOver = (offerId: string) => run(() => settleTradeUp(offerId, trades[offerId]));
  const proofs = Object.values(trades).flatMap((x) => x.txHashes || (x.txHash ? [x.txHash] : []));
  const chatTalk = async (text: string) => {
    const r = await npcTalk(actorId, token, text);
    setReply((old) => ({ ...r, npc: r.npc ?? old?.npc, mission: old?.mission, lore: old?.lore, places: old?.places }));
    return r;
  };
  const chatAnswer = async (text: string) => {
    const r = await npcMission(actorId, token, text);
    setReply((old) => (old ? { ...old, mission: r.mission } : old));
    if (r.xp > 0) learning.acknowledge("npc");
    return r;
  };

  const archetype = reply?.npc?.archetype || encounter.actor.archetype;
  const title = reply?.npc?.title || encounter.actor.title;
  const suggested = reply?.offer?.id;
  const active = reply?.active ?? [];
  const ready = active.filter((line) => line.steps.every((s) => s.done));
  const offers = reply?.menu || [];
  const pendingHandOver = Object.entries(trades).filter(([, x]) => x.kind === "trade_up" && x.state === "issued");
  const hasVault = !!(vault || keeperPanel);
  const tabs: ScreenTab<Tab>[] = [
    { id: "talk", label: t.tabTalk, icon: Sparkle },
    { id: "tasks", label: t.tabTasks, icon: ListChecks, count: offers.length + ready.length || undefined },
    ...(hasVault ? [{ id: "vault" as Tab, label: t.tabVault, icon: Vault }] : []),
    { id: "about", label: t.tabAbout, icon: IdentificationCard },
  ];
  // The first tab is the one with something to do: a reward to collect or a
  // trader's counter goes to Tasks, the keeper to the vault, the rest talk.
  const opened = useRef(false);
  useEffect(() => {
    if (!reply || opened.current) return;
    opened.current = true;
    if (ready.length || (archetype === "trader" && offers.length)) setTab("tasks");
    else if (archetype === "keeper" && hasVault) setTab("vault");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reply, hasVault]);

  const offerMeta = (offer: ActorOffer) => {
    const terms = offer.terms as { xp?: number; aura?: boolean; patron?: boolean; pathLine?: number; pathOf?: number };
    if (isTrade(offer)) return trades[offer.id] ? t.signed : t.offerTag[offer.kind];
    if (terms.patron) return t.patron(terms.pathLine, terms.pathOf);
    return t.reward(terms.xp, !!terms.aura) || t.offerTag[offer.kind] || "";
  };

  const nextAcceptedStep = selectedOffer ? active.find((line) => line.offerId === selectedOffer.id)?.steps.find((step) => !step.done) : null;
  const turnInButton = (line: NpcActiveLine) => (
    <button type="button" className="npc-action turn-in" disabled={busy} onClick={() => turnIn(line)}>
      <span className="npc-action-icon">
        <CheckCircle weight="fill" />
      </span>
      <span className="npc-action-label">{line.label}</span>
      <small>{line.errand ? t.errandReport(line.xp, line.errand.clueBonusXp) : t.turnIn(line.xp, line.aura)}</small>
    </button>
  );
  const panel = (id: Tab, extra = "") => ({
    className: `npc-panel${extra}`,
    role: "tabpanel",
    id: `npc-${actorId}-panel`,
    "aria-labelledby": `npc-${actorId}-tab-${id}`,
  });
  const placeRow = (place: NpcPlace) => (
    <li key={place.name} className="npc-place">
      <MapPin weight="duotone" aria-hidden="true" />
      <span className="npc-place-text">
        <strong>{place.name}</strong>
        <small>{place.tip}</small>
      </span>
      <span className="npc-place-meta">
        <span className="npc-place-topic">{t.topic[place.topic] || place.topic}</span>
        {Number.isFinite(place.distanceM) && <span className="npc-place-distance">{distanceLabel(place.distanceM!)}</span>}
      </span>
    </li>
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

        <ScreenTabs label={t.talkTo(name)} idBase={`npc-${actorId}`} tabs={tabs} value={tab} onChange={setTab} sticky={false} />

        {error && (
          <div className="npc-error" role="alert">
            <p>{error}</p>
            {!reply && (
              <button className="secondary-button" disabled={busy} onClick={() => run(refresh)}>
                {t.retry}
              </button>
            )}
          </div>
        )}

        {/* Talk stays mounted so the thread survives a look at another tab. */}
          <div {...(tab === "talk" ? panel("talk") : { className: "npc-panel" })} hidden={tab !== "talk"}>
            {reply ? (
              <Suspense fallback={<p className="npc-bubble">{reply.say}</p>}>
                <NpcChat
                  name={name}
                  greeting={reply.say}
                  mission={reply.mission}
                  text={message}
                  onText={setMessage}
                  onSent={() => draft.discard()}
                  onTalk={chatTalk}
                  onAnswer={chatAnswer}
                />
              </Suspense>
            ) : (
              <p className="npc-bubble" aria-live="polite">
                {t.thinking}
              </p>
            )}
            {reply && (offers.length > 0 || ready.length > 0) && (
              <button type="button" className="npc-link" onClick={() => setTab("tasks")}>
                {t.tasksWaiting(offers.length + ready.length)} →
              </button>
            )}
          </div>

        {tab === "tasks" && (
          <div {...panel("tasks")}>
            {notice && (
              <p className="npc-notice" role="status">
                {notice}
              </p>
            )}
            {selectedOffer && nextAcceptedStep && <p className="npc-next-step">{nextAcceptedStep.title}</p>}
            {selectedOffer && (
              <button
                className="primary-button npc-continue"
                onClick={() => {
                  onClose();
                  if (nextAcceptedStep) onQuest?.(nextAcceptedStep.questId);
                }}
              >
                {tr("Back to map")}
                <ArrowRight aria-hidden="true" />
              </button>
            )}
            <div className="npc-actions">
              {ready.map((line) => (
                <div key={line.offerId}>{turnInButton(line)}</div>
              ))}
              {offers.map((offer) => (
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
              {reply && !offers.length && !active.length && !reply.locked?.length && archetype !== "trader" && (
                <p className="npc-empty" data-testid={encounter.comeBack ? "npc-come-back" : undefined}>
                  {encounter.comeBack ? `${comeBackLine(encounter.actor, encounter.comeBack)} ${tr("You can still ask me anything.")}` : t.noActions}
                </p>
              )}
            </div>
            {/* Finished lines already have their turn-in button above. */}
            {active.length > ready.length && <h3 className="npc-subhead">{tr("Your tasks")}</h3>}
            {active.filter((line) => !ready.includes(line)).map((line) => {
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
                  {!done && <p className="npc-fine">{line.errand ? t.errandNotReady : t.notReady}</p>}
                </div>
              );
            })}
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
          </div>
        )}

        {tab === "vault" && hasVault && (
          <div {...panel("vault", " npc-vault")}>
            {vault?.stake && (
              <>
                <StakeTodayCard
                  card={vault!.stake!}
                  onSeen={(id) =>
                    void seenCeremony(id).finally(() =>
                      setVault((v) => (v?.stake ? { ...v, stake: { ...v.stake, ceremonies: v.stake.ceremonies.filter((c) => c.id !== id) } } : v)),
                    )
                  }
                  onRankSeen={() => {
                    const r = vault?.stake?.rank?.rankUp?.rank;
                    if (r)
                      void seenRank(r).finally(() =>
                        setVault((v) => (v?.stake?.rank ? { ...v, stake: { ...v.stake, rank: { ...v.stake.rank, rankUp: null } } } : v)),
                      );
                  }}
                />
                <InnerVault card={vault!.stake!} />
              </>
            )}
            {keeperPanel ||
              (vault && (
                <section aria-label={t.vaultBalance}>
                  <h3>{t.vaultBalance}</h3>
                  <ul className="npc-keeper">
                    {vault.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}

        {tab === "about" && (
          <div {...panel("about", " npc-about")}>
            {title && <h3>{title}</h3>}
            {reply?.lore?.backstory && <p>{reply.lore.backstory}</p>}
            {!!reply?.lore?.likes.length && <p className="npc-likes">{t.likes(reply.lore.likes.join(", "))}</p>}
            <h3 className="npc-subhead">{t.placesKnown}</h3>
            {reply?.places?.length ? <ul className="npc-places">{reply.places.map(placeRow)}</ul> : <p className="npc-empty">{t.noPlaces}</p>}
            <p className="npc-fine">
              {reply?.source === "near-ai" ? t.privateVoice : reply?.source && reply.source !== "template" ? t.aiVoice : t.stdVoice}
              {reply?.verification && (
                <>
                  {" · "}
                  <a href={reply.verification.url} target="_blank" rel="noreferrer">
                    {t.verifyReply}
                  </a>
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
