import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MapNotes, type MapNote } from "../src/MapNotes";
import "../src/style.css";
import "../src/styles.css";
const params = new URLSearchParams(location.search);
const start = Date.now();
let account = "fixture-explorer";
let failReads = params.get("state") === "error";
let loseResponse = params.get("outcome") === "lost-after-save";
let pendingResponse = params.get("outcome") === "pending";
const operations = new Map<
  string,
  { found: boolean; id?: string; state: string }
>();
const blocked = new Set<string>();
let notes: MapNote[] =
  params.get("state") === "empty"
    ? []
    : [
        {
          id: "fixture-note-a",
          player_id: "river-explorer",
          author: "Riverbank Explorer",
          text: "The bench beside the public riverside path catches the evening sun. The flowers are already changing colour.",
          lat: 49.7475,
          lng: 13.3776,
          image: null,
          author_fix: null,
          created_at: start - 420000,
          arena: params.get("arena") !== "0",
          own: false,
          state: "published",
        },
        {
          id: "fixture-note-b",
          player_id: "fixture-explorer",
          author: "Your explorer",
          text: "There is a carved date on the bridge plaque. Look from the footpath; there is no need to step into the road.",
          lat: 49.748,
          lng: 13.378,
          image: null,
          author_fix: null,
          created_at: start - 3600000,
          arena: params.get("arena") !== "0",
          own: true,
          state: "published",
        },
      ];
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
    location.href,
  );
  if (
    !url.pathname.startsWith("/api/messages") &&
    !url.pathname.startsWith("/api/social/blocks")
  )
    return originalFetch(input, init);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const method = init?.method || "GET";
  const result = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  await new Promise((resolve) => setTimeout(resolve, 180));
  if (init?.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  if (method === "GET" && failReads)
    return result(
      {
        error: "The note service is temporarily unavailable. Please try again.",
      },
      503,
    );
  if (url.pathname === "/api/messages/operation")
    return result(
      operations.get(url.searchParams.get("clientId") || "") || {
        found: false,
      },
    );
  if (url.pathname === "/api/messages/operation/abandon") {
    const receipt = operations.get(body.clientId);
    if (receipt && ["published", "hidden", "deleted"].includes(receipt.state))
      return result(receipt);
    const abandoned = { found: true, state: "abandoned" };
    operations.set(body.clientId, abandoned);
    return result(abandoned);
  }
  if (url.pathname === "/api/social/blocks") {
    if (method === "GET")
      return result({
        blocks: [...blocked].map((playerId) => ({
          playerId,
          name: "Riverbank Explorer",
          createdAt: start,
        })),
      });
    if (method === "DELETE") blocked.delete(body.targetPlayerId);
    else blocked.add(body.targetPlayerId);
    return result({
      playerId: body.targetPlayerId,
      blocked: method !== "DELETE",
    });
  }
  if (url.pathname.endsWith("/report"))
    return result({ state: "open", replayed: false });
  if (method === "DELETE") {
    const id = decodeURIComponent(url.pathname.split("/").pop()!);
    notes = notes.filter((n) => n.id !== id);
    return result({ id, state: "deleted" });
  }
  if (method === "POST") {
    const prior = operations.get(body.clientId);
    if (prior && prior.state === "published")
      return result({ id: prior.id, state: "published", replayed: true });
    if (prior?.state === "abandoned")
      return result({ error: "This publication was discarded." }, 409);
    if (pendingResponse) {
      operations.set(body.clientId, { found: true, state: "processing" });
      throw new TypeError("The connection stopped before its result arrived.");
    }
    const id = `fixture-note-${notes.length + 1}`;
    operations.set(body.clientId, { found: true, id, state: "published" });
    notes.unshift({
      id,
      player_id: account,
      author: "Your explorer",
      text: body.text,
      image: body.image,
      lat: body.lat,
      lng: body.lng,
      arena: body.arena,
      author_fix: body.shareGps ? body.fix : null,
      own: true,
      state: "published",
      created_at: Date.now(),
    });
    if (loseResponse) {
      loseResponse = false;
      throw new TypeError("The connection stopped before its result arrived.");
    }
    return result({ id, state: "published", replayed: false }, 201);
  }
  return result({
    messages: notes
      .filter((n) => !blocked.has(n.player_id))
      .map((n) => ({ ...n, own: n.player_id === account })),
  });
};
function Fixture() {
  const [player, setPlayer] = useState(account),
    [large, setLarge] = useState(params.get("text") === "large"),
    [message, setMessage] = useState(
      "Interface fixture · synthetic local notes · no server, chain or location permission.",
    );
  return (
    <main className={`map-notes-fixture ${large ? "enlarged" : ""}`}>
      <aside>
        <p>{message}</p>
        <details>
          <summary>Review controls</summary>
          <div>
            <button
              onClick={() => {
                failReads = !failReads;
                setMessage(
                  failReads
                    ? "Next read will fail."
                    : "Reads restored. Use Refresh nearby notes.",
                );
              }}
            >
              Toggle read failure
            </button>
            <button onClick={() => setLarge(!large)}>Enlarge text</button>
            <button
              onClick={() => {
                account =
                  account === "fixture-explorer"
                    ? "second-explorer"
                    : "fixture-explorer";
                setPlayer(account);
                setMessage(`Switched to ${account}.`);
              }}
            >
              Switch player
            </button>
            <button
              onClick={() => {
                pendingResponse = false;
                for (const [key, receipt] of operations)
                  if (receipt.state === "processing")
                    operations.set(key, { found: true, state: "retryable" });
                setMessage(
                  "Pending operation is now retryable. Use Check status.",
                );
              }}
            >
              Finish pending failure
            </button>
          </div>
        </details>
      </aside>
      <MapNotes
        key={player}
        playerId={player}
        position={{ lat: 49.7475, lng: 13.3776 }}
        fix={{ lat: 49.7475, lng: 13.3776, accuracy: 8, timestamp: Date.now() }}
        arena={params.get("arena") !== "0"}
        notify={setMessage}
        onBlockChange={() => setMessage("Map presence refresh requested.")}
      />
      <style>{`body{margin:0;background:#f2ebff;overflow:auto}#root{min-height:100dvh}.map-notes-fixture{max-width:540px;margin:24px auto;padding:24px;background:#fcfaff;min-height:calc(100dvh - 48px);border-radius:20px}.map-notes-fixture>aside{margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #dcd1eb;font-size:14px;color:#665577}.map-notes-fixture>aside p{margin:0 0 8px}.map-notes-fixture>aside summary{min-height:48px;display:flex;align-items:center;cursor:pointer}.map-notes-fixture>aside div{display:flex;flex-wrap:wrap;gap:8px}.map-notes-fixture>aside button{font:inherit;min-height:48px;padding:8px 12px;background:white;border:1px solid #dcd1eb;border-radius:8px}.map-notes-fixture.enlarged .map-notes,.map-notes-fixture.enlarged .map-notes input,.map-notes-fixture.enlarged .map-notes textarea,.map-notes-fixture.enlarged .map-notes label{font-size:32px}.map-notes-fixture.enlarged .map-notes-secondary{font-size:28px}#root .map-notes-fixture.enlarged .map-notes :is(input,textarea,button,select,label,span){font-size:32px}#root .map-notes-fixture.enlarged .map-notes :is(input,textarea){font-size:32px!important}@media(max-width:540px){.map-notes-fixture{margin:0;min-height:100dvh;border-radius:0;padding:20px}}`}</style>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
