import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BookOpen, CaretDown, GlobeHemisphereWest, Cube, Flask, Question, Vault } from "@phosphor-icons/react";
import { BrandLogo } from "./Ghost";
import { tr } from "./i18n";
import { APP_NAME, REALMS } from "./realms";
import "./world-switcher.css";

export type GameLayerConfig = {
  id: "world" | "test";
  test: boolean;
  tour?: boolean;
  testLayerUrl: string | null;
  worldUrl: string | null;
  defaultTest?: boolean;
};

export function WorldSwitcher({
  virtual,
  enabled,
  layerName,
  onChoose,
  gameLayer,
}: {
  virtual: boolean;
  enabled: boolean;
  /** Display name of the virtual voxel layer (docs/LAYER.md). */
  layerName: string;
  onChoose: (virtual: boolean) => void;
  /** Test Layer or the real game, GotchiGO (docs/TEST-LAYER.md), from /api/config. */
  gameLayer?: GameLayerConfig | null;
}) {
  const test = !!gameLayer?.test;
  const outdoorName = test ? tr("Test Layer") : REALMS.questlayer.name;
  // The other server: the Test Layer from World (testnet only), World from the Test Layer.
  const other = test
    ? gameLayer?.worldUrl
      ? { url: gameLayer.worldUrl + "?world=1", name: REALMS.questlayer.name, text: tr("The real game.") }
      : null
    : gameLayer?.testLayerUrl
      ? { url: gameLayer.testLayerUrl, name: tr("Test Layer"), text: tr("Test coins, not real money.") }
      : null;
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  // Desktop: a dropdown hanging from the button. Phone: a bottom sheet (CSS).
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = button.current?.getBoundingClientRect();
      setAt(r && window.innerWidth > 760 ? { left: Math.max(8, r.left), top: r.bottom + 8 } : null);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-pressed="true"], a, button')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };
  const choice = (pressed: boolean | undefined, icon: ReactNode, name: string, text: string, act: (() => void) | string, disabled = false) =>
    typeof act === "string" ? (
      <a className="world-choice" href={act}>
        {icon}
        <span><strong>{name}</strong><small>{text}</small></span>
      </a>
    ) : (
      <button className="world-choice" aria-pressed={pressed} disabled={disabled} onClick={() => { setOpen(false); act(); }}>
        {icon}
        <span><strong>{name}</strong><small>{text}</small></span>
      </button>
    );
  return (
    <>
      <button
        ref={button}
        className="world-switcher"
        aria-label={tr("Choose your world")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <BrandLogo />
        <span className="world-switcher-name">
          {APP_NAME.toUpperCase()}
          <small>
            {virtual ? layerName : outdoorName}
          </small>
        </span>
        <CaretDown size={16} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div className="world-menu-layer" onClick={close}>
            <div
              ref={menu}
              className="world-picker"
              role="dialog"
              aria-label={tr("Choose your world")}
              style={at ? { left: at.left, top: at.top } : undefined}
              data-sheet={at ? undefined : ""}
              onClick={(e) => e.stopPropagation()}
            >
              <nav className="world-links" aria-label={tr("About the game")}>
                <a href="/how-it-works"><Question size={18} aria-hidden="true" />{tr("How it works")}</a>
                <a href="/wiki"><BookOpen size={18} aria-hidden="true" />{tr("Wiki")}</a>
                <a href="/treasury"><Vault size={18} aria-hidden="true" />{tr("Treasury")}</a>
              </nav>
              {choice(
                !virtual,
                test ? <Flask size={28} aria-hidden="true" /> : <GlobeHemisphereWest size={28} aria-hidden="true" />,
                outdoorName,
                test ? tr("Test coins, not real money.") : tr("Real places outdoors."),
                () => onChoose(false),
              )}
              {choice(
                virtual,
                <Cube size={28} aria-hidden="true" />,
                layerName,
                enabled ? tr("Shared voxel world.") : tr("Create your explorer to enter."),
                () => onChoose(true),
                !enabled,
              )}
              {other &&
                choice(
                  undefined,
                  test ? <GlobeHemisphereWest size={28} aria-hidden="true" /> : <Flask size={28} aria-hidden="true" />,
                  other.name,
                  other.text,
                  other.url,
                )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
