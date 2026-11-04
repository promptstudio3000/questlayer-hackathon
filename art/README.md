# Drop-in game art

Put generated images here to replace QuestLayer's placeholder art. The full list of
file names, sizes and generation prompts is in [docs/ART-LIST.md](../docs/ART-LIST.md)
(generated from `catalog.json`).

```
art/brand/logo.svg            top-left logo
art/actors/<model>.png        NPC / monster on the map (512×512, facing right)
art/portraits/<model>.png     NPC / monster dialog portrait (768×768)
art/objects/<kind>.png        coin, chest, discovery, route, place (128×128)
art/auras/<edition>.png       Aura effect only (above 192×96, below 224×80)
art/badges/<kind or id>.png   place badge medal (256×256)
art/player/explorer.png       default explorer look (384×448)
```

Rules: lower-case names exactly as listed, PNG/WebP with transparency or SVG, then
`npm run art:check`, commit, deploy. A missing file keeps the current art.
