// Deterministic input fixture; outcome scoring is performed by the Node harness.
import React from "react";
import { createRoot } from "react-dom/client";
import { ChallengePlay } from "../../src/MonsterChallenge";
import { Dialog } from "../../src/Dialog";
import "../../src/style.css";
import "../../src/secondary-surfaces.css";
const state = window as any;
createRoot(document.getElementById("root")!).render(
  <Dialog presentation="encounter" label="Input acceptance" onClose={() => {}}>
    <ChallengePlay challenge={state.__gameFixture} busy={false}
      monster={{id:"fixture",name:"Rune guardian",archetype:"guardian"}}
      submit={input => { state.__gameInput = input; }}
      onDone={result => { state.__gameResult = result; }}
      onError={message => { throw Error(message); }} />
  </Dialog>);
