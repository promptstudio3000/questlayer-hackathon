// MetaLayer settings: the same Settings sheet look as GotchiGO (gear in the top
// right, Map / Game / Help / Account groups). Only the first group changes with
// the game: world tools instead of GPS, city overview and globe. Account and
// wallet stay in the platform Settings, one tap away. Technical receipts wait
// under Advanced, never in the game screens.
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Crosshair,
  Cube,
  GameController,
  House,
  Lifebuoy,
  MapTrifold,
  PersonSimpleRun,
  SlidersHorizontal,
  SpeakerHigh,
  UserCircle,
  Vibrate,
  type Icon,
} from "@phosphor-icons/react";
import { cue, feedbackPreferences, previewSound, setFeedbackPreferences, subscribeFeedback } from "../feedback";
import { tr } from "../i18n";
import { LanguageSetting, SettingsSwitch } from "../screens";
import { Group, LinkRow } from "../SettingsScreen";
import "../settings-screen.css";

export function LayerSettings({ mapShown, onMap, onLocate, onAtlas, onSquare, onLand, onGuide, onProofs, onAccount, onExit }: {
  mapShown: boolean; onMap: () => void; onLocate: () => void; onAtlas: () => void;
  onSquare: () => void; onLand: () => void; onGuide: () => void; onProofs: () => void;
  onAccount: () => void; onExit: () => void;
}) {
  const [feedback, setFeedback] = useState(feedbackPreferences);
  useEffect(() => subscribeFeedback(setFeedback), []);
  const tile = (TileIcon: Icon, label: string, run: () => void, pressed?: boolean) => (
    <button type="button" className="settings-tile" aria-pressed={pressed} onClick={run}>
      <TileIcon size={22} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
  return (
    <div className="settings-screen">
      <Group id="world" icon={MapTrifold} title={tr("World")}>
        <div className="settings-tiles">
          {tile(Crosshair, tr("My location"), onLocate)}
          {tile(MapTrifold, tr("Shared atlas"), onAtlas)}
          {tile(House, tr("Central square"), onSquare)}
          {tile(Cube, tr("Land and building"), onLand)}
        </div>
        <SettingsSwitch icon={MapTrifold} label={tr("Show minimap")} checked={mapShown} onChange={() => onMap()} />
      </Group>
      <Group id="game" icon={GameController} title={tr("Game")}>
        <LanguageSetting />
        <SettingsSwitch icon={SpeakerHigh} label={tr("Sound")} checked={feedback.sound}
          onChange={(on) => { setFeedbackPreferences({ sound: on }); if (on) previewSound(); }} />
        <SettingsSwitch icon={Vibrate} label={tr("Vibration")} checked={feedback.haptics}
          onChange={(on) => { setFeedbackPreferences({ haptics: on }); if (on) cue("step"); }} />
        <SettingsSwitch icon={PersonSimpleRun} label={tr("Reduce motion")} checked={feedback.motion === "reduce"}
          onChange={(on) => setFeedbackPreferences({ motion: on ? "reduce" : "system" })} />
      </Group>
      <Group id="help" icon={Lifebuoy} title={tr("Help")}>
        <LinkRow icon={BookOpen} label={tr("How to play")} onClick={onGuide} />
      </Group>
      <Group id="account" icon={UserCircle} title={tr("Account")}>
        <LinkRow icon={UserCircle} label={tr("Account and backup")} onClick={onAccount} />
        <LinkRow icon={ArrowLeft} label={tr("Back to GotchiGO")} onClick={onExit} />
      </Group>
      <details className="settings-group screen-details settings-advanced">
        <summary><SlidersHorizontal size={20} aria-hidden="true" />{tr("Advanced")}</summary>
        <LinkRow icon={Cube} label={tr("Actions and NEAR proofs")} onClick={onProofs} />
      </details>
    </div>
  );
}
