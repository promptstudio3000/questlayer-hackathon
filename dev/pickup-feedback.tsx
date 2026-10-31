import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PickupSummary, PickupAnnouncement } from "../src/PickupSummary";
import { usePickupFeedback } from "../src/usePickupFeedback";
import { demoPickupScope } from "../src/pickup-feedback";

function Fixture() {
  const [error, setError] = useState(false);
  const [actor, setActor] = useState("river-explorer");
  const next = useRef(0);
  const last = useRef<{ scope: string; coinId: string } | null>(null);
  const scope = demoPickupScope(actor, "synthetic-city", true);
  const feedback = usePickupFeedback(scope, error);
  function collect(count = 1) {
    for (let i = 0; i < count; i++) {
      const coinId = `fixture-coin-${++next.current}`;
      last.current = { scope, coinId };
      feedback.confirm(scope, {
        coinId,
        value: 10_000,
        xp: 2,
      });
    }
  }
  const large = new URLSearchParams(location.search).get("text") === "large";
  return (
    <main className={`feedback-fixture${large ? " large" : ""}`}>
      <h1>Calm pickup feedback</h1>
      <p>
        Presentation fixture. Receipts are simulated; no API request, balance
        change, GPS or wallet operation occurs.
      </p>
      <section
        className="feedback-preview"
        aria-label="Compact adventure preview"
      >
        <button className="sheet-toggle">
          <span className="sheet-toggle-label">
            Show adventures
            <PickupSummary totals={feedback.totals} />
          </span>
        </button>
        <div className="feedback-objective">
          <strong>Three details along the river</strong>
          <p>
            Follow the public path. Your next discovery stays readable while
            coins are confirmed.
          </p>
        </div>
      </section>
      {error && (
        <p role="alert" className="feedback-error">
          Simulated action error. Review the connection before trying again.
        </p>
      )}
      <label>
        <input
          type="checkbox"
          checked={error}
          onChange={(event) => setError(event.target.checked)}
        />
        Show an action error
      </label>
      <div className="feedback-controls">
        <button onClick={() => collect()}>Confirm one coin</button>
        <button onClick={() => collect(5)}>Confirm five-coin burst</button>
        <button
          disabled={!last.current}
          onClick={() =>
            last.current &&
            feedback.confirm(last.current.scope, {
              coinId: last.current.coinId,
              value: 10_000,
              xp: 2,
            })
          }
        >
          Replay last receipt
        </button>
        <button
          onClick={() =>
            setActor(
              actor === "river-explorer" ? "park-explorer" : "river-explorer",
            )
          }
        >
          Switch synthetic player
        </button>
      </div>
      <p>
        Current synthetic player: {actor}. Counts reset for a new player, world,
        mode or page reload. Wallet history remains authoritative.
      </p>
      <PickupAnnouncement text={feedback.announcement} />
      <style>{`body{margin:0;background:#f2ebff;color:#1a0335;font:16px/1.5 system-ui,sans-serif}*{box-sizing:border-box}.feedback-fixture{max-width:560px;margin:0 auto;padding:24px}.feedback-fixture h1{font-size:24px}.feedback-fixture button{min-height:48px;font:inherit;padding:12px;background:#fff;color:#441c6c;border:1px solid #806a99;border-radius:8px;white-space:normal;overflow-wrap:anywhere}.feedback-controls{display:flex;flex-wrap:wrap;gap:12px}.feedback-preview{background:#fcfaff;border-radius:20px;padding:16px}.feedback-preview .sheet-toggle{display:flex;width:100%;text-align:left;background:#fff}.feedback-objective{padding:16px 0}.feedback-objective p{margin-bottom:0}.feedback-fixture label{display:flex;align-items:center;gap:12px;min-height:48px;font-size:16px;color:#665577;margin:16px 0}.feedback-fixture input{width:24px;height:24px}.feedback-error{color:#a32947;background:#fff0f3;padding:16px;border-radius:8px}.feedback-fixture :focus-visible{outline:3px solid #672eeb;outline-offset:3px}.feedback-fixture.large .feedback-preview :is(span,small,strong,p){font-size:32px!important;line-height:1.5}`}</style>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>,
);
