// A blank MapLibre style for e2e journeys that run offline. The game's style
// (https://tiles.openfreemap.org/styles/positron) needs the internet; a
// journey that blocks other hosts would otherwise never see the map finish
// loading, and nothing drawn on it (explorer markers, pins) would appear.
// Served in its place, the map loads at once with a plain background and
// every game marker on top.
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

export const BLANK_MAP_STYLE = {
  version: 8,
  name: "e2e blank",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#efe9df" } }],
};

/** Route the game's map style to the blank one; register after any catch-all abort route. */
export async function serveBlankMapStyle(context) {
  await context.route(MAP_STYLE_URL, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BLANK_MAP_STYLE) }),
  );
}
