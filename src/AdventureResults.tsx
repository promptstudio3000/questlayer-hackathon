import {
  ArrowRight,
  Check,
  ClockCounterClockwise,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
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
import type { Player } from "./types";
import "./adventure-results.css";

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
        <strong>View confirmed result</strong>
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
      <ClockCounterClockwise size={20} aria-hidden="true" /> Adventure results
    </button>
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
}: {
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
      label={
        selection.mode === "history" ? "Adventure results" : "Adventure result"
      }
      onClose={results.close}
    >
      <div className="adventure-results-dialog">
        <div className="panel-heading">
          <h2 ref={heading} tabIndex={-1}>
            {selection.mode === "history"
              ? "Adventure results"
              : "Confirmed adventure"}
          </h2>
          <button
            className="icon-button"
            aria-label="Close adventure results"
            onClick={results.close}
          >
            <X size={22} />
          </button>
        </div>
        <p className="adventure-result-domain">
          Demo {realm === "arena" ? "arena" : "GPS play"} · saved results
        </p>
        {!online && (
          <p role="status">
            You are offline. Reconnect to check current ownership and equipment.
          </p>
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
              Inspect your completed adventures, including visits without an
              Aura. Awards stay recorded when a discovery closes.
            </p>
            <button
              className="secondary-button"
              disabled={!online || results.loading}
              onClick={() => void results.refresh()}
            >
              {results.loading ? "Loading results…" : "Refresh latest results"}
            </button>
            {!results.loading &&
              !results.error &&
              online &&
              results.results.length === 0 && (
                <p>
                  No saved results in this mode yet. Complete a discovery to
                  record its result.
                </p>
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
                          ? `+${receipt.reward.xp} XP · ${gold(receipt.reward.goldU, 6)} demo GOLD${receipt.reward.item ? ` · ${receipt.reward.item.name}` : " · no Aura"}`
                          : "Historical detail unavailable"}
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
                Older results
              </button>
            )}
            <button className="text-button" onClick={onMap}>
              Back to map
            </button>
          </>
        ) : (
          <>
            {result ? (
              <>
                <h3>{result.title}</h3>
                {result.status === "legacy-unavailable" || !result.reward ? (
                  <p>
                    This visit was completed before exact result records were
                    introduced. Your original completion remains recorded; its
                    exact reward cannot be reconstructed here.
                  </p>
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
                          <AuraArt color={item.color} slot={item.slot} />
                        )}
                        <strong>{item.name}</strong>
                        <span>
                          {item.slot === "above" ? "Above" : "Below"} character
                          {item.serial === null ? "" : ` · #${item.serial}`}
                        </span>
                        <p>
                          {result.itemCurrent.equipped
                            ? online && selection.fresh
                              ? "This Aura is equipped."
                              : "Equipped at the last online check."
                            : liveItem && result.itemCurrent.status === "owned"
                              ? "Demo outfit preview · not equipped"
                              : "Awarded Aura · historical appearance"}
                        </p>
                      </div>
                    ) : (
                      <div className="adventure-result-no-item">
                        <GameObjectArt
                          kind="discovery"
                          state="completed"
                          size={48}
                        />
                        <p>No Aura was awarded for this visit.</p>
                      </div>
                    )}
                    <p className="adventure-result-award">
                      <strong>+{result.reward.xp} XP</strong> ·{" "}
                      {gold(result.reward.goldU, 6)} demo GOLD awarded
                    </p>
                    {item && (
                      <p>
                        {!online || !selection.fresh
                          ? "Check current ownership online before equipping."
                          : result.itemCurrent.reason ||
                            (result.itemCurrent.status === "owned"
                              ? "This Aura is currently in your demo inventory."
                              : "Current item availability must be checked before equipping.")}
                      </p>
                    )}
                    {!selection.fresh && !results.error && online && (
                      <p role="status">
                        {selection.checking
                          ? "Checking current ownership…"
                          : "Check current ownership before equipping."}
                      </p>
                    )}
                    {equipItem && (
                      <button
                        className="primary-button"
                        disabled={busy || !online || !selection.fresh}
                        onClick={() => onEquip(result)}
                      >
                        Try it on <Check size={20} />
                      </button>
                    )}
                  </>
                )}
                {!equipItem && selection.fresh && (
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={onMap}
                  >
                    Back to map <ArrowRight size={20} />
                  </button>
                )}
                <p className="adventure-result-date">
                  Completed {new Date(result.completedAt).toLocaleString()}.
                  Inspecting a result does not collect another reward.
                </p>
              </>
            ) : (
              !results.error && <p role="status">Loading confirmed result…</p>
            )}
            {selection.id && (
              <button
                className="secondary-button"
                disabled={!online || busy}
                onClick={() => onInspect(selection.id!)}
              >
                {selection.fresh
                  ? item
                    ? "Check current ownership"
                    : "Refresh confirmed result"
                  : "Retry result check"}
              </button>
            )}
            <button
              className="secondary-button"
              disabled={busy}
              onClick={onInventory}
            >
              Open inventory
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={results.history}
            >
              All adventure results
            </button>
            {(equipItem || !result || !selection.fresh) && (
              <button className="text-button" disabled={busy} onClick={onMap}>
                Back to map
              </button>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
