# Aura sprite evidence, 31 October 2026

Authored pixel-art Aura sprites (`src/aura-art-data.ts`, `src/aura-art.tsx`, `src/aura-art.css`) replacing the
plain CSS ellipse in the character composition (`src/Character.tsx`) and the map marker markup
(`src/character-art.ts`). Fixture: `dev/aura-art.html` (Vite dev server, Chromium via Playwright, DPR 2–3).

- `iteration-1-first-pass.png`, `iteration-2-curtains-wake.png`: design iterations on the raw markup before wiring
  (jagged aurora band → S-curve band with hanging curtains; scattered dust → moon wake; beaded ring → lit ring).
- `editions-light-3x.png`, `editions-dark-3x.png`: polar / moon / gold / generic × above / below at 1×, 2×, 3×
  on the `#FCFAFF` sheet and the `#1A0335` shell.
- `composed-character-3x.png`: `Character` with both slots, static, animated and compact (1×).
- `map-markers-3x.png`: `characterMarkerMarkup()` output in `.player-marker` (2×), `.other-player-marker` (1×)
  and `.map-overview-player`.
- `fixture-1280.png`, `fixture-390.png`, `fixture-360.png`, `fixture-844x390-landscape.png`: full fixture at
  desktop, phone and short-landscape widths; no horizontal page scroll.
- `fixture-reduced-motion-1280.png`: with `prefers-reduced-motion: reduce` emulated.

Verified in Chromium:
- Every edition/slot renders inline `<svg shape-rendering="crispEdges">` on its 48×24 / 56×20 grid at integer scales.
- Idle motion runs on `transform`/`opacity` only: frame A/B sparkle flip (1.6 s, steps) and a ≤2 px bob (`above`) /
  opacity pulse (`below`, 2.4 s). Probe at t=0 and t=0.8 s showed the frames swapped and translateY within 2 px.
- With reduced motion emulated, `getAnimations()` reports 0 running animations and frame A stays visible.
- `node --test tests/aura-art.test.mjs tests/game-object-art.test.mjs`, `npx tsc -b` and `npm run build` pass.

Not verified here: real iPhone Safari / Android Chrome, the live MapLibre map with GPS, and the 3D map character
overlay (`.character-model-ready`), which only shifts the `above` sprite 4 px higher.
