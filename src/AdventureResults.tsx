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
}: {
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
      <div className="adventure-results-dialog">
        <div className="panel-heading">
          <h2 ref={heading} tabIndex={-1}>
            {selection.mode === "history" ? tr("Your rewards") : tr("Reward collected")}
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
          {realm === "arena" ? tr("City demo") : tr("GPS play")} {" "}{tr("· saved rewards")}</p>
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
                <h3>{result.title}</h3>
                {result.status === "legacy-unavailable" || !result.reward ? (
                  <p>
                    {tr("This visit was confirmed before rewards were recorded in detail. The visit still counts.")}</p>
                ) : (
                  <>
                    {item ? (
                      <div className="adventure-result-stage">
                        {liveItem && result.itemCurrent.status === "owned" ? (
                          <Character
                            items={previewItems}
                            originTokenId={player.appearance.originTokenId}
                            preview
                          />
                        ) : (
                          <AuraArt color={item.color} slot={item.slot} name={item.name} />
                        )}
                        <strong>{item.name}</strong>
                        <span>
                          {item.slot === "above" ? tr("Above") : tr("Below")} character
                          {item.serial === null ? "" : ` · #${item.serial}`}
                        </span>
                        <p>
                          {result.itemCurrent.equipped
                            ? online && selection.fresh
                              ? tr("Equipped")
                              : tr("Equipped at the last online check")
                            : liveItem && result.itemCurrent.status === "owned"
                              ? tr("In your collection · not equipped")
                              : tr("Awarded Aura · as it looked then")}
                        </p>
                      </div>
                    ) : (
                      <div className="adventure-result-no-item">
                        <GameObjectArt
                          kind="discovery"
                          state="completed"
                          size={48}
                        />
                        <p>{tr("No Aura this time. XP still counts.")}</p>
                      </div>
                    )}
                    <p className="adventure-result-award">
                      <strong>+{result.reward.xp} XP</strong> ·{" "}
                      {gold(result.reward.goldU, 6)} {" "}{tr("practice GOLD")}</p>
                    {item && (
                      <p>
                        {!online || !selection.fresh
                          ? tr("Go online to check you still own it before trying it on.")
                          : result.itemCurrent.reason ||
                            (result.itemCurrent.status === "owned"
                              ? tr("This Aura is in your collection.")
                              : tr("Check that you still own this Aura before trying it on."))}
                      </p>
                    )}
                    {!selection.fresh && !results.error && online && (
                      <p role="status">
                        {selection.checking
                          ? tr("Checking what you own…")
                          : tr("Check what you own before trying it on.")}
                      </p>
                    )}
                    {equipItem && (
                      <button
                        className="primary-button"
                        disabled={busy || !online || !selection.fresh}
                        onClick={() => onEquip(result)}
                      >
                        {tr("Try it on")}{" "}<Check size={20} />
                      </button>
                    )}
                    {item && liveItem && selection.fresh && itemActions?.(liveItem)}
                  </>
                )}
                {!equipItem && selection.fresh && (
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={onMap}
                  >
                    {tr("Back to map")}{" "}<ArrowRight size={20} />
                  </button>
                )}
                <p className="adventure-result-date">
                  {tr("Confirmed")}{" "}{new Date(result.completedAt).toLocaleString()}{tr(". Viewing this does not collect the reward again.")}</p>
              </>
            ) : (
              !results.error && <p role="status">{tr("Loading your reward…")}</p>
            )}
            {selection.id && (
              <button
                className="secondary-button"
                disabled={!online || busy}
                onClick={() => onInspect(selection.id!)}
              >
                {selection.fresh
                  ? item
                    ? tr("Check what I own")
                    : tr("Refresh")
                  : tr("Try again")}
              </button>
            )}
            <button
              className="secondary-button"
              disabled={busy}
              onClick={onInventory}
            >
              {tr("Open collection")}</button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={results.history}
            >
              {tr("All rewards")}</button>
            {(equipItem || !result || !selection.fresh) && (
              <button className="text-button" disabled={busy} onClick={onMap}>
                {tr("Back to map")}</button>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
