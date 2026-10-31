# Game UI and AI-assisted design research

Reviewed 31 October 2026. Source review and QuestLayer-specific synthesis; not an
installation, benchmark, security audit or endorsement of all upstream rules.

## Scope and evidence

Read both supplied X posts in the browser, followed their repository destinations,
and inspected upstream READMEs, repository trees and selected relevant files. The
first post links seven repositories. The second critiques design trends and does
not supply another repository collection. The supplied UI Skills page leads to
Emil Kowalski's skills repository.

Additional research covers seven other repositories: ibelick/ui-skills,
anthropics/skills, Godot demos, Shattered Pixel Dungeon, Game Programming Patterns,
Aavegotchi assets and Aavegotchi sprite generation. This makes **15 repositories**
including Emil's. Review depth is recorded below. No claim is made to have read
every file in these large projects. Tools were not installed or executed and game
examples were studied as source rather than playtested.

Local review covered `src/App.tsx`, `src/GameMap.tsx`, `src/Ghost.tsx`,
`src/style.css`, `src/types.ts`, relevant quest settlement, current product plans,
integration/asset notices and the running app at `http://127.0.0.1:5173/`.
Desktop Explore was visually inspected at 1280×720. Mobile findings are source
findings; no physical-phone verification is claimed.

## Supplied sources

| Source | Useful takeaway | QuestLayer interpretation |
| --- | --- | --- |
| [kiosa's collection](https://x.com/thegreatest_sv/status/2115876572464812071) | Tools cover design context, critique, Figma, effects, animation, video and 3D authoring. | These are different jobs. Installing all seven does not establish game quality. Promotional counts and performance claims are not benchmarks. |
| [Ayush Soni's critique](https://x.com/ayushsoni_io/status/2115322579187867898) | Repeated stylistic devices make unrelated products feel templated. | Ask what each label, divider or frame communicates. Keep necessary structure and collectible frames; remove ornament without meaning. |
| [Emil design-engineering page](https://www.ui-skills.com/skills/emilkowalski/emil-design-eng) | Small interaction details and purposeful motion compound into craft. | Study the upstream source, then adapt it to a touch exploration game and the chosen identity. |

## All seven linked repositories

### UI UX Pro Max: reference for specific usability problems

[Repository](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), observed tree
`9a3f14f7423037ccb8feeb4fee7482291b9c820e`. Read README,
`.claude/skills/ui-ux-pro-max/SKILL.md` and relevant rows in
[`src/ui-ux-pro-max/data/ux-guidelines.csv`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/9a3f14f7423037ccb8feeb4fee7482291b9c820e/src/ui-ux-pro-max/data/ux-guidelines.csv).

Adopt its priority on accessibility, touch, feedback and platform-aware layout before
decoration. Use it for a concrete problem such as keyboard-open sheets or inline
errors. Do not ask its industry palette generator to override the explicit brand.
The detailed CSV distinguishes platform units and context; shorthand touch-size
recommendations are not universal web requirements. QuestLayer deliberately chooses
48 CSS px effective touch targets. No search scripts were executed.

### Impeccable: critique vocabulary and adaptation

[Repository](https://github.com/pbakaus/impeccable), observed tree
`df3a4abe7d0840d5f60324812c432e00b66a4e75`. Read README, selected
`reference/critique.md` and
[`reference/adapt.md`](https://github.com/pbakaus/impeccable/blob/df3a4abe7d0840d5f60324812c432e00b66a4e75/.agents/skills/impeccable/reference/adapt.md);
inspected reference organization.

Adopt narrow reviews with a named target, explicit product/design context, responsive
adaptation, concise wording and hardening for failures. Its central adaptation
lesson is to rethink the phone task rather than scale a desktop panel. Treat a
detector result as review input, not a verdict about design quality. Purple, frames
and occasional gradients can be correct for the requested brand. Installation,
hooks and review orchestration were researched, not invoked: this report is not an
Impeccable command run or detector result.

### Framelink Figma Context MCP: conditional handoff tooling

[Repository](https://github.com/GLips/Figma-Context-MCP), observed tree
`c083d65c7e002923e7cb98f4e3bdafb105e90f6d`. Read README and inspected tree.

The documented role is simplifying Figma layout/style data for agents. Useful when
a chosen design is maintained in Figma. It neither invents good game design nor
proves one-shot fidelity. No QuestLayer Figma design was supplied; this environment
already has Figma tools. Defer an additional connector until it supplies a specific
missing capability.

### React Bits: selective effects rather than the visual foundation

[Repository](https://github.com/DavidHDev/react-bits), observed tree
`4dc7b5b7772e1217c8fb8d2a7aa074302180e5b4`. Read README and
[`LICENSE.md`](https://github.com/DavidHDev/react-bits/blob/4dc7b5b7772e1217c8fb8d2a7aa074302180e5b4/LICENSE.md);
inspected catalogue organization without auditing individual effects.

Potential use: one deliberate reward detail or a separate promotional surface.
Shader backgrounds, cursor followers, animated text and rotating cards compete with
targets and mobile GPU work on the walking map. Measure a selected effect and include
a reduced-motion fallback. The reviewed license is MIT plus a Commons Clause
condition, not plain MIT; inspect the selected file's terms and preserve notices
before copying. No components or runtime dependencies were imported.

### GSAP Skills: sequences when they justify their complexity

[Repository](https://github.com/greensock/gsap-skills), observed tree
`aed9cfd3277740755f6bfc1155c7aa645403b760`. Read README,
[`gsap-react`](https://github.com/greensock/gsap-skills/blob/aed9cfd3277740755f6bfc1155c7aa645403b760/skills/gsap-react/SKILL.md)
and `gsap-performance/SKILL.md`.

Adopt scoped targets, lifecycle cleanup, reduced simultaneous work, batched DOM
reads/writes and transform/opacity-first animation. GSAP could suit an authored
chest sequence if CSS/WAAPI becomes awkward; it is unnecessary for every button.
Avoid scroll-triggered storytelling in core map controls. Upstream pricing claims
do not replace reviewing the runtime license at adoption time.

### HyperFrames: separate video production

[Repository](https://github.com/heygen-com/hyperframes), observed tree
`443ded42615f81fd5a4b97d34318676fb76957bd`. Read README and inspected tree.

Its described output is deterministic video from HTML/CSS/media and seekable
animation. Potential use: a later trailer or hackathon walkthrough using real
gameplay. It does not improve touch controls or quest readability. Keep it outside
the game bundle and distinguish a video concept from captured play.

### MCP for Blender: optional asset authoring

[Repository](https://github.com/ahujasid/mcp-for-blender), observed tree
`992233bb258975a05eec8b5691465c50c2831e34`. Read README and inspected tree.

Its documented role is AI-assisted modeling and scene manipulation in Blender.
Potential use: a controlled prop/chest family with a shared art brief and export
budgets. Text-generated 3D does not establish consistent silhouettes, web materials,
asset provenance or mobile performance. Authoring remains separate from runtime;
keep the lightweight renderer for the first UI slice. No models were generated.

## Additional community and game repositories

| Repository and reviewed scope | Concrete lesson | Adoption boundary |
| --- | --- | --- |
| [emilkowalski/skills](https://github.com/emilkowalski/skills), tree `a81dbca07f2217b7103e510c0f13f8d5b017afc9`; `emil-design-eng` and `mobile-native` | Press feedback; purposeful, interruptible movement; safe areas, large inputs, capability-gated hover and real-phone checks. | Keep a local timing policy; do not blindly copy blur tricks, universal easing claims or platform assumptions. |
| [ibelick/ui-skills](https://github.com/ibelick/ui-skills), tree `3823f1573f6fb564a091a062594b95066dbd974c`; `baseline-ui` and `fixing-accessibility` | Hierarchy, meaningful empty states, visible labels, dialog focus, inline errors. | Preserve the React/CSS stack. Its Tailwind/Motion requirements, custom-easing ban and purple-gradient ban are not QuestLayer policy. |
| [anthropics/skills frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md), current file | Ground composition in the product's world; choose type deliberately; critique template habits. | Adapt website-oriented advice to playable UI. Do not make a game into a landing page. |
| [godotengine/godot-demo-projects](https://github.com/godotengine/godot-demo-projects), tree `b761b4cd5718a7118f2c95eb55f181d0a5f004f1`; multiple-resolutions README/`main.gd`, accessibility README/`custom_control.gd`, drag/drop README | HUD bounds, aspect ratio and interface scale are distinct; custom visuals still need accessible names, state and input actions. | Use principles in HTML/React. No engine migration or direct adoption of engine units. |
| [00-Evan/shattered-pixel-dungeon](https://github.com/00-Evan/shattered-pixel-dungeon), tree `57a4e06a4caf162446d1c28caa7983f0493fecf0`; README, `Toolbar.java`, `WndBag.java` | One inventory window, stable grid, explicit selection/use states and alternative input affordances. Item selection checks the item is still present. | Source is GPL-3.0-or-later. Study behavior rather than copying source/art. Internal canvas sizes are not CSS target sizes. Game not run. |
| [munificent/game-programming-patterns](https://github.com/munificent/game-programming-patterns), tree `898b1f2e1818c80d7eed5eba98e9903ec13b7771`; State chapter | Model legal quest/reward/sheet transitions instead of accumulating interacting flags. | A small reducer/discriminated union can suffice; no mandatory state-machine package. |
| [aavegotchi/aavegotchi-assets](https://github.com/aavegotchi/aavegotchi-assets), tree `b302ce569ac7f98a97947ce4e66f63bae85a0c66`; tree/`colors.js` | Intentional ecosystem color roles and separately named item colors. | Module palette differs from brand PDF. Do not mix unrecorded or replace QuestLayer's rarity model. |
| [aavegotchi/aavegotchi-game-sprites](https://github.com/aavegotchi/aavegotchi-game-sprites), tree `c2004f55e175edc82ee7936d21e62b06ca46680c`; tree/README | Configured trait layers can preserve individual character identity. | Validate coverage, layering, missing assets, permissions and mobile output before adopting a sprite pipeline. |

## Other primary references

- [Aavegotchi brand guide](https://www.aavegotchi.com/press-kit/AAVEGOTCHi_BRAND_STYLE_GUIDE.pdf):
  rendered all 18 pages as a contact sheet; inspected the palette page at larger size.
  Pages 12–17 inform the direction. Its visibly white swatch has an apparent printed
  hex error; `DESIGN.md` records this instead of propagating it.
- [Game Accessibility Guidelines — Basic](https://gameaccessibilityguidelines.com/basic/):
  readable text, large separated controls, clear language, interactive tutorials,
  saved options and non-color/non-audio alternatives. Numeric thresholds in our
  design policy are project choices, not attributed to this page.
- [Aavegotchi IP/stewardship announcement](https://blog.aavegotchi.com/aavegotchi-beyond-the-one-studio-model/):
  discusses possible changes, rather than establishing blanket CC0 for all assets
  or trademarks. Existing project notices still apply to future asset selection.

## Resolve source disagreements deliberately

| Disagreement | QuestLayer decision | Reason |
| --- | --- | --- |
| Generic deslop advice discourages purple; the requested identity uses it. | Documented purple action role, restrained pink discovery accent. | Identity takes precedence over a fashion blacklist. |
| Emil favors custom easing; baseline-ui forbids it by default. | One reviewed local curve with separate timing roles. | Consistent response is more useful than incompatible rule sets. |
| Sources favor different animation libraries. | CSS/WAAPI first; one justified dependency later if needed. | MapLibre already creates substantial rendering work. |
| Website skills encourage hero compositions. | Open with the character, place and current objective. | A returning player needs to play immediately. |
| Pixel games often use tiny UI. | Preserve pixel art; use readable DOM text and generous touch targets. | Art pixels and interaction pixels serve different purposes. |
| Excitement can encourage constant animation. | Strongest reaction for a confirmed meaningful discovery. | Routine pickup must stay fast and quiet. |

## Adoption decision

Use project-owned `AGENTS.md`, `DESIGN.md`, proposed tokens and a concrete backlog
as the shared development contract. Consult upstream repositories for specific
problems. Prioritize first adventure, mobile objective and consistent character
preview. Effects, 3D authoring and video follow only when those fundamentals work.

No external skills, connectors, packages or third-party assets were installed or
copied. The new local documents are original project-specific synthesis. Runtime
code was not changed and the player-facing app was not redesigned or deployed.
