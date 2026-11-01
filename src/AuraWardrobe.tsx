import { Funnel, Sparkle } from "@phosphor-icons/react";
import { AuraSprite } from "./aura-art";
import {
  AURA_RARITIES,
  AURA_SETS,
  activeAuraSet,
  catalogEditionFor,
  auraSet,
  entitlementLabel,
  setMembers,
} from "./aura-catalog.ts";
import {
  catalogProgress,
  isFiltered,
  type WardrobeFilter,
} from "./aura-wardrobe.ts";
import type { Item } from "./types";

const RARITY_LABEL: Record<string, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

/** Slot/rarity/set filters for the Aura wardrobe. Native controls only. */
export function AuraWardrobeFilters({
  filter,
  onChange,
  shown,
  total,
  disabled,
}: {
  filter: WardrobeFilter;
  onChange: (next: WardrobeFilter) => void;
  shown: number;
  total: number;
  disabled?: boolean;
}) {
  return (
    <fieldset className="aura-filters" disabled={disabled}>
      <legend>
        <Funnel size={18} aria-hidden="true" /> Filter Auras
      </legend>
      <div className="aura-filter-slots" role="group" aria-label="Slot">
        {(["all", "above", "below"] as const).map((slot) => (
          <button
            type="button"
            key={slot}
            aria-pressed={filter.slot === slot}
            onClick={() => onChange({ ...filter, slot })}
          >
            {slot === "all" ? "All" : slot === "above" ? "Above" : "Below"}
          </button>
        ))}
      </div>
      <label>
        Rarity
        <select
          value={filter.rarity}
          onChange={(e) =>
            onChange({
              ...filter,
              rarity: e.target.value as WardrobeFilter["rarity"],
            })
          }
        >
          <option value="all">All rarities</option>
          {AURA_RARITIES.map((r) => (
            <option key={r} value={r}>
              {RARITY_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Set
        <select
          value={filter.set}
          onChange={(e) => onChange({ ...filter, set: e.target.value })}
        >
          <option value="all">All sets</option>
          {AURA_SETS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <p className="aura-filter-count" aria-live="polite">
        {isFiltered(filter) ? `Showing ${shown} of ${total}` : `${total} Auras`}
        {isFiltered(filter) && (
          <button
            type="button"
            className="aura-filter-reset"
            onClick={() =>
              onChange({ slot: "all", rarity: "all", set: "all" })
            }
          >
            Clear filters
          </button>
        )}
      </p>
    </fieldset>
  );
}

/** Shows the active cosmetic set, or which piece would complete one. */
export function AuraSetStatus({ items }: { items: Item[] }) {
  const above = items.find((i) => i.equipped && i.slot === "above"),
    below = items.find((i) => i.equipped && i.slot === "below"),
    set = activeAuraSet(above, below);
  if (set)
    return (
      <p
        className="aura-set-status active"
        style={{ "--aura-set-glow": set.glow } as React.CSSProperties}
      >
        <Sparkle size={18} weight="fill" aria-hidden="true" />
        <span>
          <strong>{set.name} set</strong> · {set.bonus}. Cosmetic only, no
          gameplay effect.
        </span>
      </p>
    );
  const worn = above || below,
    wornEdition = worn && catalogEditionFor(worn),
    hint = wornEdition
      ? setMembers(wornEdition.set).filter((e) => e.slot !== wornEdition.slot)
      : [];
  if (!hint.length) return null;
  return (
    <p className="aura-set-status">
      <Sparkle size={18} aria-hidden="true" />
      <span>
        Wear {hint.map((e) => e.demoName).join(" or ")} {worn?.slot === "above" ? "below" : "above"}{" "}
        for a matching set glow. Cosmetic only.
      </span>
    </p>
  );
}

/** Every catalog edition, where it can be found and how many you hold. */
export function AuraCatalog({ items }: { items: Item[] }) {
  const progress = catalogProgress(items);
  return (
    <details className="aura-catalog">
      <summary>
        Aura catalog · {progress.found} of {progress.total} found
      </summary>
      <ul>
        {progress.entries.map(({ edition, owned }) => (
          <li key={edition.id} className={owned ? "owned" : "missing"}>
            <AuraSprite
              edition={edition.id}
              slot={edition.slot}
              size={1}
              animated={false}
            />
            <div>
              <strong>{edition.demoName}</strong>
              <span>
                {RARITY_LABEL[edition.rarity]} ·{" "}
                {edition.slot === "above" ? "Above" : "Below"} ·{" "}
                {auraSet(edition.set)?.name} set
              </span>
              <small>
                {entitlementLabel(edition.rarity)}
                {edition.native ? " · Can be secured on NEAR" : ""}
              </small>
            </div>
            <em>{owned ? `×${owned}` : "Not found"}</em>
          </li>
        ))}
      </ul>
    </details>
  );
}
