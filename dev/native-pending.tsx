import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PendingNativeTransactions } from "../src/PendingNativeTransactions";
import {
  NATIVE_PENDING_EVENT,
  type PendingNativeTransaction,
} from "../src/confirmed-native-transaction";
import "../src/style.css";
const playerId = "fixture_native_pending",
  accountId = "fixture-explorer.testnet",
  key = `questlayer:native-pending:v1:${playerId}`;
const hash = "H".repeat(44);
function Fixture() {
  const [response, setResponse] = useState("confirmed"),
    [linked, setLinked] = useState(true);
  const largeText =
    new URLSearchParams(location.search).get("text") === "large";
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      if (input !== "/api/native/transactions/confirm")
        return original(input, init);
      if (response === "offline") throw Error("Fixture offline");
      const body = JSON.parse(String(init?.body));
      if (response === "failed")
        return Response.json(
          {
            error:
              "The final withdrawal callback returned false. Refresh the current balance before retrying.",
            code: "NATIVE_OPERATION_NOT_COMPLETED",
          },
          { status: 409 },
        );
      return Response.json({
        confirmed: true,
        network: "testnet",
        accountId: body.accountId,
        contractId: body.quote.receiverId,
        transactionHash: body.transactionHash,
      });
    };
    return () => {
      window.fetch = original;
    };
  }, [response]);
  function seed(phase: PendingNativeTransaction["phase"]) {
    const entry: PendingNativeTransaction = {
      id: crypto.randomUUID(),
      playerId,
      accountId,
      createdAt: Date.now(),
      phase,
      transactionHash: phase === "awaiting_wallet" ? null : hash,
      quote: {
        network: "testnet",
        signerId: accountId,
        receiverId: "questlayer-market-20261031.testnet",
        methodName: "withdraw",
        args: {},
        gas: "150000000000000",
        deposit: "1",
      },
      ...(phase === "failed"
        ? {
            error:
              "This transaction is final but its withdrawal did not complete.",
            errorCode: "NATIVE_OPERATION_NOT_COMPLETED",
          }
        : {}),
    };
    sessionStorage.removeItem(key);
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, playerId, entries: [entry] }),
    );
    window.dispatchEvent(new Event(NATIVE_PENDING_EVENT));
  }
  return (
    <main
      style={{
        maxWidth: 600,
        margin: "24px auto",
        padding: 16,
        boxSizing: "border-box",
      }}
    >
      <h1>Receipt recovery fixture</h1>
      <p>
        Synthetic browser states. No wallet, signature or network transaction.
      </p>
      {largeText && (
        <style>{`#root .native-pending :is(p,small,span,b,summary,label,input,button,a,dt,dd,pre) { font-size: 32px !important; } #root .native-pending h3 { font-size: 40px !important; }`}</style>
      )}
      <details>
        <summary style={{ minHeight: 48, fontSize: 16, cursor: "pointer" }}>
          Review controls
        </summary>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["submitted", "failed", "awaiting_wallet"] as const).map(
            (phase) => (
              <button
                key={phase}
                className="secondary-button"
                style={{ minHeight: 48, fontSize: 16 }}
                onClick={() => seed(phase)}
              >
                {phase === "submitted"
                  ? "Add pending receipt"
                  : phase === "failed"
                    ? "Add final failure"
                    : "Add missing receipt"}
              </button>
            ),
          )}
          <button
            className="secondary-button"
            style={{ minHeight: 48, fontSize: 16 }}
            onClick={() => {
              sessionStorage.removeItem(key);
              localStorage.removeItem(key);
              window.dispatchEvent(new Event(NATIVE_PENDING_EVENT));
            }}
          >
            Clear fixture
          </button>
        </div>
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginTop: 16,
            fontSize: 16,
          }}
        >
          Fixture confirmation response
          <select
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            style={{ minHeight: 48, fontSize: 16 }}
          >
            <option value="confirmed">Final confirmation</option>
            <option value="failed">Final failure</option>
            <option value="offline">Unavailable connection</option>
          </select>
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            minHeight: 48,
            gap: 12,
            fontSize: 16,
          }}
        >
          <input
            type="checkbox"
            checked={linked}
            onChange={(e) => setLinked(e.target.checked)}
            style={{ width: 24, height: 24 }}
          />
          Original NEAR wallet linked
        </label>
      </details>
      <PendingNativeTransactions
        playerId={playerId}
        linkedAccounts={linked ? [accountId] : []}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
