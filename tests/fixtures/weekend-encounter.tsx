// Browser-only acceptance mount. Uses the real encounter screens and real local API.
import React from "react";
import { createRoot } from "react-dom/client";
import { ActorSheet } from "../../src/ActorSheet";
import "../../src/style.css";
import "../../src/secondary-surfaces.css";

const fixture = (window as any).__encounterFixture;
const root = createRoot(document.getElementById("root")!);
root.render(<ActorSheet playerId={fixture.playerId} actor={fixture.actor} worldId={fixture.worldId}
  location={{...fixture.position, accuracy:8, timestamp:Date.now()}}
  onQuest={(id) => { (window as any).__focusedQuest = id; }}
  onClose={() => root.render(<p>Encounter closed</p>)} />);
