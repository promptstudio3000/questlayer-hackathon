// Settings: its own sheet behind the gear in the top right corner (Lubos,
// 13 Nov 2026). Four short parts a player understands at a glance (Map, Game,
// Help, Account); wallets, devices, receipts and developer switches wait
// under one folded "Advanced".
import { useState, type ReactNode } from "react";
import {
  ArrowCounterClockwise,
  ArrowsOut,
  BookOpen,
  ChartDonut,
  Compass,
  Crosshair,
  Cube,
  Eye,
  EyeSlash,
  GameController,
  GlobeHemisphereWest,
  Lifebuoy,
  MapTrifold,
  NavigationArrow,
  PersonSimpleRun,
  Question,
  SignOut,
  SlidersHorizontal,
  SpeakerHigh,
  UserCircle,
  Vibrate,
  type Icon,
} from "@phosphor-icons/react";
import { ArrowRight } from "./dir-icons";
import { cue, previewSound, setFeedbackPreferences, type FeedbackPreferences } from "./feedback";
import { tr } from "./i18n";
import { InfoTip } from "./InfoTip";
import { Pip } from "./TourHelper";
import { LanguageSetting, SettingsSwitch } from "./screens";
import "./settings-screen.css";

export type SettingsMap = {
  /** The city demo is on. */
  demo: boolean;
  status: string;
  modeLabel: string;
  modeAria: string;
  onModeSwitch: () => void;
  onLocate: () => void;
  rotate: boolean;
  onRotate: (next: boolean) => void;
  onFull: () => void;
  overview: boolean;
  onOverview: () => void;
  globe: boolean;
  onGlobe: () => void;
};

export function Group({ id, icon: GroupIcon, title, children }: { id: string; icon: Icon; title: string; children: ReactNode }) {
  return (
    <section className="settings-group" aria-labelledby={`settings-${id}-title`}>
      <h2 id={`settings-${id}-title`} tabIndex={-1}><GroupIcon size={20} aria-hidden="true" />{title}</h2>
      {children}
    </section>
  );
}

export function LinkRow({ icon: RowIcon, label, onClick }: { icon: Icon; label: string; onClick: () => void }) {
  return (
    <button type="button" className="settings-row" onClick={onClick}>
      <RowIcon size={22} aria-hidden="true" /><span>{label}</span><ArrowRight size={18} aria-hidden="true" />
    </button>
  );
}

export function SettingsScreen({
  map,
  map3D,
  onMap3D,
  guide,
  sharePosition,
  onSharePosition,
  feedback,
  onHowToPlay,
  onAsk,
  onEconomy,
  account,
  advanced,
  onSignOut,
}: {
  map: SettingsMap;
  map3D: boolean;
  onMap3D: () => void;
  /** One switch for the helper: Pip where the tour runs, first-time tips elsewhere. */
  guide: { pip: boolean; on: boolean; onChange: (next: boolean) => void };
  sharePosition: boolean;
  onSharePosition: (next: boolean) => void;
  feedback: FeedbackPreferences;
  onHowToPlay: () => void;
  onAsk: () => void;
  onEconomy: () => void;
  /** Saving the explorer: passkey and backup words. */
  account: ReactNode;
  /** Wallets, devices, receipts and developer switches. */
  advanced: ReactNode;
  onSignOut: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const tile = (TileIcon: Icon, label: string, run: () => void, pressed?: boolean, className = "") => (
    <button type="button" className={`settings-tile ${className}`} aria-pressed={pressed} onClick={run}>
      <TileIcon size={22} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
  return (
    <div className="settings-screen">
      <Group id="map" icon={MapTrifold} title={tr("Map")}>
        <div className={`settings-mode${map.demo ? " demo" : ""}`}>
          <span className="status-dot" aria-hidden="true" />
          <span className="settings-mode-status map-settings-status">{map.status}</span>
          <button type="button" aria-label={map.modeAria} onClick={map.onModeSwitch}>
            {map.demo ? <NavigationArrow size={16} weight="fill" aria-hidden="true" /> : <ArrowCounterClockwise size={16} aria-hidden="true" />}
            {map.modeLabel}
          </button>
        </div>
        <div className="settings-tiles">
          {tile(Crosshair, tr("My location"), map.onLocate, undefined, "map-recenter")}
          {tile(ArrowsOut, tr("Full map"), map.onFull, undefined, "map-full-toggle")}
          {tile(MapTrifold, tr("City overview"), map.onOverview, map.overview)}
          {tile(GlobeHemisphereWest, tr("Globe"), map.onGlobe, map.globe)}
        </div>
        <SettingsSwitch icon={Compass} label={tr("Turn the map with me")} checked={map.rotate} onChange={map.onRotate} />
        <SettingsSwitch icon={Cube} label={tr("3D character")} checked={map3D} onChange={onMap3D} />
      </Group>
      <Group id="game" icon={GameController} title={tr("Game")}>
        <button
          type="button"
          role="switch"
          aria-checked={guide.on}
          className="settings-row settings-guide"
          onClick={() => guide.onChange(!guide.on)}
        >
          {guide.pip ? <Pip /> : <Question size={22} aria-hidden="true" />}
          <span>
            {guide.pip ? tr("Pip, your guide") : tr("First-time tips")}
            <small>{tr("Shows your next step on the map")}</small>
          </span>
          <span className="settings-switch" aria-hidden="true" />
        </button>
        <div className="settings-row-with-tip">
          <SettingsSwitch
            icon={sharePosition ? Eye : EyeSlash}
            label={tr("Show me to nearby explorers")}
            checked={sharePosition}
            onChange={onSharePosition}
          />
          <InfoTip label={tr("Location sharing")}>{tr("While the game is open on your screen, explorers within about 1.5 km see your name, look and position on their map. Your profile never shows where you are. Players you blocked never see you, and you never see them.")}</InfoTip>
        </div>
        <LanguageSetting />
        <SettingsSwitch
          icon={SpeakerHigh}
          label={tr("Sound")}
          checked={feedback.sound}
          onChange={(on) => {
            setFeedbackPreferences({ sound: on });
            if (on) previewSound();
          }}
        />
        <SettingsSwitch
          icon={Vibrate}
          label={tr("Vibration")}
          checked={feedback.haptics}
          onChange={(on) => {
            setFeedbackPreferences({ haptics: on });
            if (on) cue("step");
          }}
        />
        <SettingsSwitch
          icon={PersonSimpleRun}
          label={tr("Reduce motion")}
          checked={feedback.motion === "reduce"}
          onChange={(on) => setFeedbackPreferences({ motion: on ? "reduce" : "system" })}
        />
      </Group>
      <Group id="help" icon={Lifebuoy} title={tr("Help")}>
        <LinkRow icon={BookOpen} label={tr("How to play")} onClick={onHowToPlay} />
        <LinkRow icon={Question} label={tr("Ask a question")} onClick={onAsk} />
        <LinkRow icon={ChartDonut} label={tr("Game economy")} onClick={onEconomy} />
      </Group>
      <Group id="account" icon={UserCircle} title={tr("Account")}>
        {account}
        {leaving ? (
          <div className="settings-leave" role="group" aria-label={tr("Sign out")}>
            <p>{tr("Save a passkey or your 12 words first. Without them this explorer cannot come back.")}</p>
            <div className="settings-leave-actions">
              <button type="button" className="secondary-button" onClick={() => setLeaving(false)}>{tr("Cancel")}</button>
              <button type="button" className="primary-button" onClick={onSignOut}><SignOut size={20} aria-hidden="true" />{tr("Sign out")}</button>
            </div>
          </div>
        ) : (
          <button type="button" className="settings-row settings-sign-out" onClick={() => setLeaving(true)}>
            <SignOut size={22} aria-hidden="true" /><span>{tr("Sign out")}</span>
          </button>
        )}
      </Group>
      <details id="settings-advanced" className="settings-group screen-details settings-advanced">
        <summary><SlidersHorizontal size={20} aria-hidden="true" />{tr("Advanced")}</summary>
        {advanced}
      </details>
      {/* The public pages are reference reading: one quiet row at the bottom. */}
      <nav className="settings-links" aria-label={tr("How it works")}>
        {[["/how-it-works", tr("How it works")], ["/wiki", tr("Wiki")], ["/economy", tr("Economy")], ["/treasury", tr("Treasury")]].map(([href, label]) => (
          <a key={href} href={href}>{label}</a>
        ))}
      </nav>
    </div>
  );
}
