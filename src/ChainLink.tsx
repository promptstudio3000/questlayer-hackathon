// The on-chain proof icon. One look everywhere: a spinner while the action is
// on its way to NEAR, a sealed check linking the transaction on the explorer
// once confirmed, a warning (linking the account page) when it failed.
import { useEffect, useState } from "react";
import { CircleNotch, SealCheck, WarningCircle } from "@phosphor-icons/react";
import { api, ApiError } from "./api";
import { tr } from "./i18n";
import {
  chainHref,
  chainState,
  fromPoll,
  pollPath,
  POLL_DELAYS_MS,
  type ChainRef,
} from "./chain-proof";
import "./chain-link.css";

// A record that does not exist: link the account when known, else hide.
const gone = (ref: ChainRef): ChainRef =>
  ref.account ? { account: ref.account } : { ...ref, status: "off" };

export function useChainRef(chain: ChainRef | null | undefined) {
  const [live, setLive] = useState<ChainRef | null | undefined>(chain);
  const key = chain
    ? `${chain.id ?? ""}|${chain.status ?? ""}|${chain.tx ?? ""}|${chain.account ?? ""}`
    : "";
  useEffect(() => setLive(chain), [key]);
  const state = chainState(live);
  const path = state === "pending" ? pollPath(live) : null;
  useEffect(() => {
    if (!path || !live) return;
    let stop = false,
      step = 0,
      timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const next = fromPoll(live, await api(path));
        if (stop) return;
        // No such record (an action from before chain records existed): show
        // nothing rather than a spinner that never ends.
        if (!next) return setLive(gone(live));
        if (chainState(next) !== "pending") return setLive(next);
      } catch (e) {
        if (stop) return;
        if (e instanceof ApiError && e.status === 404)
          return setLive(gone(live));
        /* network trouble: keep waiting until the last poll */
      }
      if (!stop && ++step < POLL_DELAYS_MS.length)
        timer = setTimeout(tick, POLL_DELAYS_MS[step]);
    };
    timer = setTimeout(tick, POLL_DELAYS_MS[0]);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [path]);
  return live;
}

export function ChainLink({
  chain,
  label = false,
  interactive = true,
  className = "",
}: {
  chain: ChainRef | null | undefined;
  /** Show a short word next to the icon ("On NEAR", "Saving…"). */
  label?: boolean;
  /** False inside decorations (reward bursts) that cannot be tapped. */
  interactive?: boolean;
  className?: string;
}) {
  const live = useChainRef(chain);
  const state = chainState(live);
  if (state === "hidden") return null;
  const href = chainHref(live);
  const text =
    state === "pending"
      ? tr("Saving on NEAR…")
      : state === "failed"
        ? tr("Not saved on NEAR")
        : live?.tx || live?.explorer
          ? tr("See on NEAR explorer")
          : tr("On NEAR");
  const Icon =
    state === "pending" ? CircleNotch : state === "failed" ? WarningCircle : SealCheck;
  const body = (
    <>
      <Icon
        className={state === "pending" ? "chain-link-spin" : undefined}
        size={16}
        weight={state === "pending" ? "bold" : "fill"}
        aria-hidden="true"
      />
      {label && (
        <span>
          {state === "pending"
            ? tr("Saving…")
            : state === "failed"
              ? tr("Not saved")
              : tr("On NEAR")}
        </span>
      )}
    </>
  );
  const classes = `chain-link is-${state}${label ? " has-label" : ""} ${className}`.trim();
  if (!interactive || !href || state === "pending")
    return (
      <span
        className={classes}
        role={interactive ? "status" : undefined}
        aria-hidden={interactive ? undefined : true}
        title={interactive ? text : undefined}
        aria-label={interactive ? text : undefined}
      >
        {body}
      </span>
    );
  return (
    <a
      className={classes}
      href={href}
      target="_blank"
      rel="noreferrer"
      title={text}
      aria-label={text}
      onClick={(e) => e.stopPropagation()}
    >
      {body}
    </a>
  );
}
