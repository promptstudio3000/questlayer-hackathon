// Real encounter UI; the browser acceptance harness supplies isolated responses.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MonsterChallenge } from "../../src/MonsterChallenge";
import { BossFight } from "../../src/BossFight";
import { beginLearning, finishLearningIntro } from "../../src/learning-store";
import { loadLocale, tr } from "../../src/i18n";
import "../../src/style.css";
import "../../src/secondary-surfaces.css";

await loadLocale();
const fixture = (window as any).__challengeFixture;
const playerId = "example-explorer";
if (fixture.novice) { beginLearning(playerId); finishLearningIntro(playerId, true); }
const actor = { id: "example", name: "Lickquidator", kind: "monster" as const, archetype: "roamer" as const, model: "lick-soldier" };
function Screen() {
  const [open, setOpen] = useState(false);
  return <main><button onClick={() => setOpen(true)}>{tr("Open")}</button>{open && (fixture.boss
    ? <BossFight actor={{ ...actor, archetype: "boss" }} encounter="local" worldId="local" playerId={playerId} onClose={() => setOpen(false)} />
    : <MonsterChallenge actor={actor} encounter="local" playerId={playerId} onClose={() => setOpen(false)} />)}</main>;
}
createRoot(document.getElementById("root")!).render(<Screen />);
