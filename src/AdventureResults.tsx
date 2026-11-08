import { ChainLink } from "./ChainLink";
import {
  Check,
  ClockCounterClockwise,
  X,
} from "@phosphor-icons/react";
import { ArrowRight } from "./dir-icons";
import { useEffect, useRef, type ReactNode } from "react";
import { Dialog } from "./Dialog";
import { Character } from "./Character";
import { AuraArt } from "./Ghost";
import { GameObjectArt } from "./game-object-art";
import { gold } from "./api";
import { AURA_SUPPLY, auraSet, catalogEditionFor } from "./aura-catalog";
import {
  adventureItemForEquip,
  type AdventureRealm,
  type AdventureResult,
} from "./adventure-results";
import type { useAdventureResults } from "./useAdventureResults";
import type { Item, Player } from "./types";
import "./adventure-results.css";
import { tr } from "./i18n";

type Results = ReturnType<typeof useAdventureResults>;

export function AdventureResultResume({
  result,
  onInspect,
}: {
  result: AdventureResult;
  onInspect: () => void;
}) {
  return (
    <button
      className="adventure-notice adventure-result-resume"
      onClick={onInspect}
    >
      <GameObjectArt
        kind={result.reward?.item ? "chest" : "discovery"}
        state="completed"
        size={32}
      />
      <span>
        <strong>{tr("Reward collected")}</strong>
        <small>
          {result.title}
          {result.reward ? ` · +${result.reward.xp} XP` : ""}
        </small>
      </span>
      <ArrowRight size={20} aria-hidden="true" />
    </button>
  );
}

export function AdventureResultHistoryButton({
  onOpen,
}: {
  onOpen: () => void;
}) {
  return (
    <button
      className="secondary-button adventure-history-button"
      onClick={onOpen}
    >
      <ClockCounterClockwise size={20} aria-hidden="true" /> {" "}{tr("Adventure results")}</button>
  );
}

export function AdventureResultDialog({
  results,
  player,
  realm,
  online,
  busy,
  actionError,
  onEquip,
  onInventory,
  onMap,
  onInspect,
  itemActions,
  intent = "reward",
  note,
}: {
  intent?: "reward" | "share";
  note?: string;
  /** Secure and share controls for the Aura in this result (slice 3). */
  itemActions?: (item: Item) => ReactNode;
  results: Results;
  player: Player;
  realm: AdventureRealm;
  online: boolean;
  busy: boolean;
  actionError?: string;
  onEquip: (result: AdventureResult) => void;
  onInventory: () => void;
  onMap: () => void;
  onInspect: (id: string) => void;
}) {
  const selection = results.selection;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!selection) return;
    const frame = requestAnimationFrame(() => heading.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [selection?.mode, selection?.id]);
  if (!selection) return null;
  const result = selection.result;
  const item = result?.reward?.item;
  const edition = item ? catalogEditionFor(item) : null;
  const set = edition ? auraSet(edition.set) : null;
  const equipItem = result
    ? adventureItemForEquip(result, player, realm)
    : null;
  const liveItem = item
    ? player.inventory.find((candidate) => candidate.id === item.id)
    : null;
  const previewItems = liveItem
    ? [
        ...player.inventory
          .filter((candidate) => candidate.id !== liveItem.id)
          .map((candidate) =>
            candidate.slot === liveItem.slot
              ? { ...candidate, equipped: 0 }
              : candidate,
          ),
        { ...liveItem, equipped: 1 },
      ]
    : player.inventory;
  return (
    <Dialog
      label={selection.mode === "history" ? tr("Your rewards") : tr("Your reward")}
      onClose={results.close}
    >
      <div className="adventure-results-dialog" data-intent={intent}>
        <div className="panel-heading">
          <h2 ref={heading} tabIndex={-1}>
            {selection.mode === "history" ? tr("Your rewards") : result?.reward?.item && result.viewedAt === null ? tr("Nice find!") : tr("Reward collected")}
          </h2>
          <button
            className="icon-button"
            aria-label={tr("Close rewards")}
            onClick={results.close}
          >
            <X size={22} />
          </button>
        </div>
        <p className="adventure-result-domain">
          {realm === "arena" ? tr("City demo") : tr("GPS play")} {" "}{selection.mode === "history" && tr("· saved rewards")}</p>
        {!online && (
          <p role="status">
            {tr("You're offline. Reconnect to check what you own right now.")}</p>
        )}
        {results.error && (
          <p className="inline-error" role="alert">
            {results.error}
          </p>
        )}
        {actionError && (
          <p className="inline-error" role="alert">
            {actionError}
          </p>
        )}
        {selection.mode === "history" ? (
          <>
            <p>
              {tr("Every confirmed visit is kept here, with or without an Aura, even after the place closes.")}</p>
            <button
              className="secondary-button"
              disabled={!online || results.loading}
              onClick={() => void results.refresh()}
            >
              {results.loading ? tr("Loading…") : tr("Refresh")}
            </button>
            {!results.loading &&
              !results.error &&
              online &&
              results.results.length === 0 && (
                <p>
                  {tr("No rewards yet. Confirm a visit or open a chest to see it here.")}</p>
              )}
            <ol className="adventure-result-list">
              {results.results.map((receipt) => (
                <li key={receipt.id}>
                  <button onClick={() => onInspect(receipt.id)}>
                    <GameObjectArt
                      kind={receipt.reward?.item ? "chest" : "discovery"}
                      state="completed"
                      size={32}
                    />
                    <span>
                      <strong>{receipt.title}</strong>
                      <small>
                        {new Date(receipt.completedAt).toLocaleString()}
                        <br />
                        {receipt.reward
                          ? tr("+{0} XP · {1} practice GOLD{2}", { 0: receipt.reward.xp, 1: gold(receipt.reward.goldU, 6), 2: receipt.reward.item ? ` · ${receipt.reward.item.name}` : " · no Aura" })
                          : tr("Details not recorded")}
                      </small>
                    </span>
                    <ArrowRight size={20} aria-hidden="true" />
                  </button>
                  {receipt.chain && <ChainLink chain={receipt.chain} />}
                </li>
              ))}
            </ol>
            {results.nextCursor && (
              <button
                className="secondary-button"
                disabled={results.loading || !online}
                onClick={() => void results.refresh(results.nextCursor!)}
              >
                {tr("Older rewards")}</button>
            )}
            <button className="text-button" onClick={onMap}>
              {tr("Back to map")}</button>
          </>
        ) : (
          <>
            {result ? (
              <>
                <div className="reward-moment">
                  {item ? <div className="reward-moment-art"><AuraArt color={item.color} slot={item.slot} name={item.name} /></div>
                    : <div className="reward-moment-art"><GameObjectArt kind="discovery" state="completed" size={112} /></div>}
                  <h3>{item?.name || result.title}</h3>
                  {item && <p className="reward-edition">
                    {set?.name && <span>{set.name}</span>}
                    {item.serial !== null && <span>#{item.serial}{edition ? ` / ${AURA_SUPPLY}` : ""}</span>}
                    <span>{item.rarity === "common" ? tr("Common") : item.rarity === "rare" ? tr("Rare") : item.rarity === "epic" ? tr("Epic") : item.rarity === "legendary" ? tr("Legendary") : item.rarity}</span>
                    <span>{item.slot === "above" ? tr("Above character") : tr("Below character")}</span>
                  </p>}
                  {result.reward && <p className="reward-moment-values"><strong>+{result.reward.xp} XP</strong>{result.reward.goldU > 0 && <> · {gold(result.reward.goldU, 6)} {tr("practice GOLD")}</>}</p>}
                  {result.reward?.near && <p className="reward-moment-values"><strong>+{result.reward.near.amountNear} {tr("NEAR testnet")}</strong><br />
                    {result.reward.near.state === "converted" ? tr("Converted to QGOLD") : result.reward.near.state === "conversion-carry" ? tr("Fractional NEAR remains credited") : tr("Awaiting QGOLD settlement")}</p>}
                  {!item && result.reward && <p>{tr("No Aura this time. XP still counts.")}</p>}
                  {note && <p>{note}</p>}
                  {item && <p className="reward-cosmetic-note">{tr("Auras change your look, not your power.")}</p>}
                  {item && (!online || !selection.fresh) && <p role="status">{selection.checking ? tr("Checking what you own…") : tr("Go online to check you still own it before trying it on.")}</p>}
                  {item && selection.fresh && result.itemCurrent.status !== "owned" && <p role="status">{result.itemCurrent.reason || tr("Awarded Aura · as it looked then")}</p>}
                  {item && selection.fresh && result.itemCurrent.equipped && <p className="reward-equipped">{tr("Equipped")}</p>}
                </div>
                {intent !== "share" && (equipItem ? <button className="primary-button" disabled={busy || !online || !selection.fresh} onClick={() => onEquip(result)}>{tr("Try it on")}<Check size={20} aria-hidden="true" /></button>
                  : !selection.fresh && online && selection.id ? <button className="primary-button" disabled={busy || selection.checking} onClick={() => onInspect(selection.id!)}>{selection.checking ? tr("Checking what you own…") : tr("Try again")}</button>
                  : <button className="primary-button" disabled={busy} onClick={onMap}>{tr("Back to map")}<ArrowRight size={20} aria-hidden="true" /></button>)}
                {intent === "share" && item && liveItem && selection.fresh && itemActions?.(liveItem)}
                <details className="reward-more" open={intent === "share" ? true : undefined}>
                  <summary>{tr("Learn more")}</summary>
                  <p>{result.title}</p>
                  <p className="adventure-result-date">{tr("Confirmed")} {new Date(result.completedAt).toLocaleString()}{tr(". Viewing this does not collect the reward again.")}</p>
                  {result.status === "legacy-unavailable" || !result.reward ? <p>{tr("This visit was confirmed before rewards were recorded in detail. The visit still counts.")}</p>
                    : <p>+{result.reward.xp} {"XP"} · {gold(result.reward.goldU, 6)} {tr("practice GOLD")}</p>}
                  {edition && <p>{tr("Edition size: {0}. This is the series limit, not the number remaining.", { 0: AURA_SUPPLY })}</p>}
                  {item && <p>{result.itemCurrent.reason || (result.itemCurrent.status === "owned" ? tr("This Aura is in your collection.") : tr("Check that you still own this Aura before trying it on."))}</p>}
                  {liveItem && result.itemCurrent.status === "owned" && <div className="reward-outfit-preview"><Character items={previewItems} originTokenId={player.appearance.originTokenId} preview /></div>}
                  {intent !== "share" && item && liveItem && selection.fresh && itemActions?.(liveItem)}
                  {result.chain && <ChainLink chain={result.chain} />}
                  {selection.id && <button className="secondary-button" disabled={!online || busy || selection.checking} onClick={() => onInspect(selection.id!)}>{selection.fresh ? item ? tr("Check what I own") : tr("Refresh") : tr("Try again")}</button>}
                  <button className="secondary-button" disabled={busy} onClick={onInventory}>{tr("Open collection")}</button>
                  <button className="secondary-button" disabled={busy} onClick={results.history}>{tr("All rewards")}</button>
                </details>
                {(equipItem || intent === "share") && <button className="text-button" disabled={busy} onClick={onMap}>{tr("Back to map")}</button>}
              </>
            ) : !results.error && <p role="status">{tr("Loading your reward…")}</p>}

          </>
        )}
      </div>
    </Dialog>
  );
}
