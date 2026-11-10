/**
 * A message pinned into the ground: the illustration on top of the quick
 * create dialogs (note, topic, place). Decorative; the dialog title says what
 * it is. `kind` tints the card.
 */
export function NotePinArt({ kind = "note" }: { kind?: "note" | "topic" | "place" }) {
  const card = kind === "topic" ? "#e9ddff" : kind === "place" ? "#dff6e8" : "#fff4c7";
  const ink = kind === "topic" ? "#672eeb" : kind === "place" ? "#1f7a4a" : "#a0661b";
  return (
    <svg className="note-pin-art" viewBox="0 0 220 110" role="presentation" aria-hidden="true" focusable="false">
      <ellipse cx="110" cy="98" rx="78" ry="9" fill="#1a033514" />
      <path d="M38 98c10-6 22-6 30 0M150 98c8-7 20-7 32 0" stroke="#7bc47f" strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d="M58 96l-4-10M64 96l2-11M160 96l-3-9M168 96l3-10" stroke="#5aa25f" strokeWidth="3" strokeLinecap="round" />
      <rect x="106" y="56" width="8" height="42" rx="2" fill="#7a4a24" />
      <rect x="106" y="56" width="3" height="42" rx="1.5" fill="#a26a3a" />
      <g transform="rotate(-6 110 38)">
        <rect x="72" y="12" width="76" height="50" rx="7" fill={card} stroke="#1a0335" strokeWidth="3" />
        {kind === "place" ? (
          <path d="M110 22c-8 0-13 6-13 12 0 9 13 20 13 20s13-11 13-20c0-6-5-12-13-12z" fill={ink} />
        ) : (
          <>
            <rect x="84" y="24" width="44" height="5" rx="2.5" fill={ink} />
            <rect x="84" y="35" width="52" height="5" rx="2.5" fill={ink} opacity=".55" />
            <rect x="84" y="46" width="34" height="5" rx="2.5" fill={ink} opacity=".55" />
          </>
        )}
        <circle cx="110" cy="12" r="5" fill="#ff4fa3" stroke="#1a0335" strokeWidth="2" />
      </g>
      <path d="M170 30c0-9 7-15 14-15s14 6 14 15v20l-5-4-4 4-5-4-5 4-4-4-5 4z" fill="#fff" stroke="#1a0335" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="179" cy="30" r="2.6" fill="#1a0335" />
      <circle cx="189" cy="30" r="2.6" fill="#1a0335" />
    </svg>
  );
}
