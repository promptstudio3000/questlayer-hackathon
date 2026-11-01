// near-api-js (with its crypto and borsh dependencies) is about a fifth of the
// app's JavaScript and is only needed once the player signs something, so it
// is loaded on first use instead of with the welcome screen.
let nearApi: Promise<typeof import("near-api-js")> | undefined;
export function loadNearApi() {
  nearApi ??= import("near-api-js").catch((error) => {
    nearApi = undefined;
    throw error;
  });
  return nearApi;
}
