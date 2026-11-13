// Earned wisp rolls (docs/NPC-GAMES.md, GAME-LOOPS P0-4). Spends one roll
// ticket from the hunt pouch on the npc-games contract: the explorer account
// starts the roll with a server-signed ticket, the server reveals its secret
// a few blocks later, the reveal draws the prize on chain and the server pays
// exactly that prize as a demo Aura the player can secure on NEAR. Every call
// is relayed with zero NEAR attached: there is nothing to bet.
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { tr } from "./i18n";
import { ChainLink } from "./ChainLink";

export type RollCall = {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas: string;
  deposit: string;
};
type RollView = {
  rollId: string;
  state: "issued" | "started" | "settled";
  outcome: "Resolved" | "TimedOut" | null;
  prize: string | null;
  capped: boolean;
  reward: { kind: "aura"; name: string; rarity: string } | { kind: "xp"; xp: number } | null;
};
type Status = {
  enabled: boolean;
  reason: string | null;
  odds: { prize: string; label: string; chance: number; dailyCap: number | null; minimum: boolean }[];
  tickets: { earned: number; used: number; available: number };
  rolls: RollView[];
};
type Step = { roll: RollView; next: "start" | "ticket" | "wait" | "resolve" | "timeout" | "done"; call?: RollCall };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (x: number) => `${Math.round(x * 1000) / 10} %`;
function rewardText(r: RollView) {
  if (!r.reward) return tr("Rolling…");
  const what = r.reward.kind === "aura" ? `${r.reward.name} (${r.reward.rarity})` : tr("{0} XP (that Aura has run out)", { 0: r.reward.xp });
  return r.outcome === "TimedOut" ? tr("{0}, the guaranteed prize", { 0: what }) : what;
}

export function WispRolls({
  accountId,
  send,
  onWon,
}: {
  // The explorer (managed) account; rolls are relayed from it without a popup.
  accountId: string | null;
  send: (call: RollCall) => Promise<void>;
  onWon: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [won, setWon] = useState<RollView | null>(null);

  async function load() {
    try {
      setStatus(await api<Status>("/npc-rolls"));
    } catch {
      setStatus(null);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function drive(step: Step): Promise<RollView> {
    for (let i = 0; i < 40; i++) {
      if (step.next === "done") return step.roll;
      if (step.next === "ticket") step = await api<Step>("/npc-rolls", { accountId });
      if (step.next === "start" || step.next === "resolve" || step.next === "timeout") {
        if (!step.call) throw Error("The wisp lost track of this roll. Try again.");
        setBusy(step.next === "start" ? tr("Starting your roll…") : step.next === "resolve" ? tr("The wisp is drawing…") : tr("Claiming the guaranteed prize…"));
        await send(step.call);
      } else await sleep(1500);
      step = await api<Step>(`/npc-rolls/${encodeURIComponent(step.roll.rollId)}`, {});
    }
    throw Error("Still rolling. Check back in a minute; your ticket is safe.");
  }

  async function roll(pending?: RollView) {
    setError(null);
    setWon(null);
    setBusy(tr("Asking the wisp…"));
    try {
      const first = pending
        ? await api<Step>(`/npc-rolls/${encodeURIComponent(pending.rollId)}`, {})
        : await api<Step>("/npc-rolls", { accountId });
      const done = await drive(first);
      setWon(done);
      onWon();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : tr("The roll could not finish. Your ticket is safe."));
    } finally {
      setBusy("");
      await load();
    }
  }

  if (!status) return null;
  const pending = status.rolls.find((r) => r.state !== "settled" && r.state !== "issued");
  const recent = status.rolls.filter((r) => r.state === "settled").slice(0, 3);
  if (!status.tickets.earned && !recent.length) return null;
  return (
    <section className="aura-claims wisp-rolls" aria-label={tr("Wisp rolls")}>
      <h2>{tr("Roll at the wisp")}</h2>
      <p>
        {tr("You have")}{" "}<strong>{status.tickets.available}</strong> {" "}{tr("roll ticket")}{status.tickets.available === 1 ? "" : "s"} {" "}{tr("from Pocket Wisps and the weekly boss. A roll is free and the odds are fixed.")}</p>
      {status.odds.length > 0 && (
        <ul className="wisp-odds">
          {status.odds.map((o) => (
            <li key={o.prize}>
              {o.label}: {pct(o.chance)}
              {o.dailyCap ? tr(" (at most {0} a day for everyone; after that the roll pays the guaranteed prize)", { 0: o.dailyCap }) : ""}
              {o.minimum ? tr(" · guaranteed") : ""}
            </li>
          ))}
        </ul>
      )}
      {!status.enabled && <p>{status.reason}</p>}
      {status.enabled && !accountId && <p>{tr("Your explorer account is still being set up. Rolls open once it is ready.")}</p>}
      {status.enabled && accountId && (
        <button
          className="button"
          disabled={!!busy || (!pending && status.tickets.available < 1)}
          onClick={() => void roll(pending)}
        >
          {busy || (pending ? tr("Finish your roll") : tr("Roll at the wisp"))}
        </button>
      )}
      {won && (
        <p className="monster-rewards">
          {tr("The wisp gave you")}{" "}{rewardText(won)}{"."}{" "}
          <ChainLink label chain={{ id: `roll:${won.rollId}` }} />
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {recent.length > 0 && !won && (
        <p className="monster-sub">
          {tr("Last rolls:")}{" "}
          {recent.map((r, i) => (
            <span key={r.rollId}>
              {i > 0 && " · "}
              {rewardText(r)} <ChainLink chain={{ id: `roll:${r.rollId}` }} />
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
