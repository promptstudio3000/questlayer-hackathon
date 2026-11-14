# Globe clusters

When the explorer turns the map into a globe (Settings → Map → Globe), bubbles
show where in the world there is something to play.

## What a bubble counts

- **Player quests** (gold bubble): published creator quests whose creator has a
  public profile, counted at the quest's first stop. Player-made content leads,
  so a bubble that holds any player quest shows that number.
- **Cities** (violet bubble): playable cities with no player quest yet: the
  reviewed live cities and the auto cities (Czech, Slovak and Austrian towns,
  the demo cities abroad and the capitals).

## How bubbles group

The client clusters the spots by zoom (MapLibre GeoJSON clustering, radius
44 px, stops merging at zoom 9). On a phone this gives one bubble per country
or group of small neighbours when the whole globe is visible, one per region
(kraj, state) at zoom 5–7, and one per city closer in. Tapping a bubble flies
one step closer, so a country splits into its regions. There are no country or
region polygons: grouping is by distance on screen, which keeps the payload
small and works everywhere on Earth.

## Data and privacy

`GET /api/globe` (public, cached 5 minutes in memory and by the browser)
returns `spots: [lng, lat, playerQuests, cities]` rounded to 0.01° (about
1 km), plus totals. No titles, authors or ids. Code: `server/globe-content.mjs`,
`src/globe-clusters-layer.ts` (own chunk, loaded the first time the globe
opens, so the first screen does not grow).

## Base map

The base style paints built-up areas (`landuse` residential) almost white. The
day-and-night painter (`src/map-sky.ts`) now tints them with the building
colour, so they no longer glow as white patches on the night globe.
